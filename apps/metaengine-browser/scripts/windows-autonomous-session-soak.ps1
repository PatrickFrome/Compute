param(
  [Parameter(Mandatory = $true)][string]$AppPath,
  [Parameter(Mandatory = $true)][string]$ProofPath,
  [Parameter(Mandatory = $true)][string]$RunnerTemp,
  [int]$ActivationCount = 64,
  [int]$ConcurrentBurstSize = 8,
  [int]$PostActivationHoldSeconds = 30,
  [double]$ActivationP95BudgetMs = 1000,
  [int64]$MaxWorkingSetGrowthBytes = 67108864,
  [int64]$MaxHandleGrowth = 24
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path $AppPath -PathType Leaf)) { throw "soak_packaged_browser_missing:$AppPath" }
if (-not (Test-Path $ProofPath -PathType Leaf)) { throw "soak_proof_missing:$ProofPath" }
if ($ActivationCount -lt 1 -or $ActivationCount -gt 96) { throw 'soak_activation_count_invalid' }
if ($ConcurrentBurstSize -lt 0 -or $ConcurrentBurstSize -gt 16) { throw 'soak_concurrent_burst_invalid' }
if ($ActivationP95BudgetMs -lt 100) { throw 'soak_activation_p95_budget_invalid' }
if ($MaxWorkingSetGrowthBytes -lt 0 -or $MaxHandleGrowth -lt 0) { throw 'soak_resource_budget_invalid' }

$proof = Get-Content $ProofPath -Raw | ConvertFrom-Json
$profileOut = Join-Path $RunnerTemp 'soak-profile.out'
$profileErr = Join-Path $RunnerTemp 'soak-profile.err'
$priorProfileWrite = $env:METAENGINE_PROFILE_PROBE_WRITE
$env:METAENGINE_PROFILE_PROBE_WRITE = '1'
try {
  $profileProcess = Start-Process -FilePath $AppPath -ArgumentList '--metaengine-profile-probe' -PassThru -RedirectStandardOutput $profileOut -RedirectStandardError $profileErr
  $null = $profileProcess.Handle
  if (-not $profileProcess.WaitForExit(15000)) { throw 'soak_profile_probe_timeout' }
  if ($profileProcess.ExitCode -ne 0) { throw "soak_profile_probe_exit_$($profileProcess.ExitCode)" }
} finally {
  $env:METAENGINE_PROFILE_PROBE_WRITE = $priorProfileWrite
}

$profileLine = Get-Content $profileOut | Where-Object { $_.Trim() } | Select-Object -Last 1
if (-not $profileLine) { throw 'soak_profile_probe_output_missing' }
$profile = $profileLine | ConvertFrom-Json
if ($profile.schema -ne 'metaengine.browser.profile-probe.v1' -or $profile.primary_instance -ne $true -or -not [string]$profile.user_data_path) {
  throw 'soak_profile_probe_contract_invalid'
}

$journal = Join-Path ([string]$profile.user_data_path) 'metaengine-browser-startup-journal-v1.json'
Remove-Item $journal -Force -ErrorAction SilentlyContinue
Remove-Item "$journal.corrupt-*" -Force -ErrorAction SilentlyContinue

$normalOut = Join-Path $RunnerTemp 'soak-normal-ui.out'
$normalErr = Join-Path $RunnerTemp 'soak-normal-ui.err'
$normal = $null
try {
  # Ordinary Explorer / Start Menu path: no smoke or probe flags.
  $normal = Start-Process -FilePath $AppPath -PassThru -RedirectStandardOutput $normalOut -RedirectStandardError $normalErr
  $null = $normal.Handle
  $deadline = [DateTime]::UtcNow.AddSeconds(55)
  $stable = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $normal.Refresh()
    if ($normal.HasExited) { throw "soak_normal_ui_exited_early:$($normal.ExitCode)" }
    if (Test-Path $journal -PathType Leaf) {
      try {
        $startup = Get-Content $journal -Raw | ConvertFrom-Json
        $failed = @($startup.events | Where-Object { $_.boot_id -eq $startup.current_boot_id -and $_.state -eq 'RUNTIME_IMPORT_FAILED' })
        if ($failed.Count -gt 0) { throw 'soak_runtime_import_failed' }
        $stable = $startup.events | Where-Object { $_.boot_id -eq $startup.current_boot_id -and $_.state -eq 'PRIMARY_WINDOW_STABLE' } | Select-Object -Last 1
        if ($stable) { break }
      } catch {
        if ($_.Exception.Message -eq 'soak_runtime_import_failed') { throw }
      }
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $stable -or $stable.details.visible -ne $true) { throw 'soak_normal_ui_not_stable_visible' }

  $startup = Get-Content $journal -Raw | ConvertFrom-Json
  $runtimeImport = $startup.events | Where-Object { $_.boot_id -eq $startup.current_boot_id -and $_.state -eq 'RUNTIME_IMPORT_OK' } | Select-Object -Last 1
  if (-not $runtimeImport) { throw 'soak_runtime_import_success_missing' }

  $normal.Refresh()
  $primaryPid = [int64]$normal.Id
  $procBefore = Get-Process -Id $normal.Id
  $workingSetBefore = [int64]$procBefore.WorkingSet64
  $handlesBefore = [int64]$procBefore.HandleCount
  $launchIds = New-Object 'System.Collections.Generic.HashSet[string]'
  $activationSequences = New-Object 'System.Collections.Generic.HashSet[long]'
  $lastActivationSequence = [int64]$stable.sequence
  $activationLatencies = New-Object 'System.Collections.Generic.List[double]'

  for ($i = 1; $i -le $ActivationCount; $i++) {
    $secondOut = Join-Path $RunnerTemp "soak-secondary-$i.out"
    $secondErr = Join-Path $RunnerTemp "soak-secondary-$i.err"
    Remove-Item $secondOut,$secondErr -Force -ErrorAction SilentlyContinue
    $activationStarted = [Diagnostics.Stopwatch]::StartNew()
    $second = Start-Process -FilePath $AppPath -PassThru -RedirectStandardOutput $secondOut -RedirectStandardError $secondErr
    $null = $second.Handle
    if (-not $second.WaitForExit(18000)) {
      try { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue } catch {}
      throw "soak_secondary_timeout:${i}"
    }
    if ($second.ExitCode -ne 0) { throw "soak_secondary_exit:${i}:$($second.ExitCode)" }
    $line = Get-Content $secondOut | Where-Object { $_.Trim() } | Select-Object -Last 1
    if (-not $line) { throw "soak_secondary_ack_missing:${i}" }
    $ack = $line | ConvertFrom-Json
    if ($ack.schema -ne 'metaengine.browser.secondary-launch.v1' `
        -or $ack.state -ne 'PRIMARY_UI_ACTIVATION_ACKNOWLEDGED' `
        -or $ack.second_browser_runtime_started -ne $false `
        -or $ack.authority_effect -ne $false `
        -or [int64]$ack.primary_pid -ne $primaryPid) {
      throw "soak_secondary_ack_invalid:${i}"
    }
    if (-not $launchIds.Add([string]$ack.launch_id)) { throw "soak_duplicate_launch_id:${i}" }

    $activationDeadline = [DateTime]::UtcNow.AddSeconds(12)
    $activation = $null
    while ([DateTime]::UtcNow -lt $activationDeadline) {
      $startup = Get-Content $journal -Raw | ConvertFrom-Json
      $activation = $startup.events | Where-Object {
        $_.boot_id -eq $startup.current_boot_id `
          -and $_.state -eq 'PRIMARY_WINDOW_ACTIVATED' `
          -and $_.details.launch_id -eq [string]$ack.launch_id
      } | Select-Object -Last 1
      if ($activation) { break }
      Start-Sleep -Milliseconds 25
    }
    $activationStarted.Stop()
    if (-not $activation -or $activation.details.visible -ne $true) { throw "soak_primary_activation_missing:${i}" }
    if ([int64]$activation.sequence -le $lastActivationSequence) { throw "soak_activation_sequence_not_monotonic:${i}" }
    if ([int64]$activation.sequence -ne [int64]$ack.event_sequence) { throw "soak_activation_ack_sequence_drift:${i}" }
    if (-not $activationSequences.Add([int64]$activation.sequence)) { throw "soak_activation_sequence_duplicate:${i}" }
    $activationLatencies.Add($activationStarted.Elapsed.TotalMilliseconds)
    $lastActivationSequence = [int64]$activation.sequence
    $normal.Refresh()
    if ($normal.HasExited) { throw "soak_primary_died_after_activation:${i}" }
  }

  $burstElapsedMs = 0.0
  if ($ConcurrentBurstSize -gt 0) {
    $burstWatch = [Diagnostics.Stopwatch]::StartNew()
    $burst = New-Object 'System.Collections.Generic.List[object]'
    for ($j = 1; $j -le $ConcurrentBurstSize; $j++) {
      $out = Join-Path $RunnerTemp "soak-burst-$j.out"
      $err = Join-Path $RunnerTemp "soak-burst-$j.err"
      Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $process = Start-Process -FilePath $AppPath -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
      $null = $process.Handle
      $burst.Add([pscustomobject]@{ Index=$j; Process=$process; Out=$out; Err=$err; Watch=$watch })
    }

    $burstAcks = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $burst) {
      if (-not $item.Process.WaitForExit(18000)) {
        try { Stop-Process -Id $item.Process.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw "soak_burst_secondary_timeout:$($item.Index)"
      }
      $item.Watch.Stop()
      if ($item.Process.ExitCode -ne 0) { throw "soak_burst_secondary_exit:$($item.Index):$($item.Process.ExitCode)" }
      $line = Get-Content $item.Out | Where-Object { $_.Trim() } | Select-Object -Last 1
      if (-not $line) { throw "soak_burst_secondary_ack_missing:$($item.Index)" }
      $ack = $line | ConvertFrom-Json
      if ($ack.schema -ne 'metaengine.browser.secondary-launch.v1' `
          -or $ack.state -ne 'PRIMARY_UI_ACTIVATION_ACKNOWLEDGED' `
          -or $ack.second_browser_runtime_started -ne $false `
          -or $ack.authority_effect -ne $false `
          -or [int64]$ack.primary_pid -ne $primaryPid) {
        throw "soak_burst_secondary_ack_invalid:$($item.Index)"
      }
      if (-not $launchIds.Add([string]$ack.launch_id)) { throw "soak_burst_duplicate_launch_id:$($item.Index)" }
      $burstAcks.Add([pscustomobject]@{ Ack=$ack; Index=$item.Index; ElapsedMs=[double]$item.Watch.Elapsed.TotalMilliseconds })
    }
    $burstWatch.Stop()
    $burstElapsedMs = [double]$burstWatch.Elapsed.TotalMilliseconds

    $startup = Get-Content $journal -Raw | ConvertFrom-Json
    foreach ($row in $burstAcks) {
      $activation = $startup.events | Where-Object {
        $_.boot_id -eq $startup.current_boot_id `
          -and $_.state -eq 'PRIMARY_WINDOW_ACTIVATED' `
          -and $_.details.launch_id -eq [string]$row.Ack.launch_id
      } | Select-Object -Last 1
      if (-not $activation -or $activation.details.visible -ne $true) { throw "soak_burst_primary_activation_missing:$($row.Index)" }
      if ([int64]$activation.sequence -ne [int64]$row.Ack.event_sequence) { throw "soak_burst_activation_ack_sequence_drift:$($row.Index)" }
      if (-not $activationSequences.Add([int64]$activation.sequence)) { throw "soak_burst_activation_sequence_duplicate:$($row.Index)" }
      if ([int64]$activation.sequence -gt $lastActivationSequence) { $lastActivationSequence = [int64]$activation.sequence }
    }
  }

  # Keep the same ordinary primary instance alive after the activation burst.
  if ($PostActivationHoldSeconds -gt 0) {
    $holdDeadline = [DateTime]::UtcNow.AddSeconds($PostActivationHoldSeconds)
    while ([DateTime]::UtcNow -lt $holdDeadline) {
      Start-Sleep -Milliseconds 500
      $normal.Refresh()
      if ($normal.HasExited) { throw 'soak_primary_died_during_post_activation_hold' }
    }
  }

  $startup = Get-Content $journal -Raw | ConvertFrom-Json
  $runtimeFailures = @($startup.events | Where-Object { $_.boot_id -eq $startup.current_boot_id -and $_.state -eq 'RUNTIME_IMPORT_FAILED' })
  if ($runtimeFailures.Count -gt 0) { throw 'soak_runtime_import_failed_after_activation_burst' }
  $receiveMarkers = @($startup.events | Where-Object { $_.boot_id -eq $startup.current_boot_id -and $_.state -eq 'SECOND_INSTANCE_RECEIVED' })
  if ($receiveMarkers.Count -ne 0) { throw 'soak_redundant_durable_second_instance_marker_present' }

  $procAfter = Get-Process -Id $normal.Id
  $latencySorted = @($activationLatencies | Sort-Object)
  $p95Index = [Math]::Max(0, [Math]::Min($latencySorted.Count - 1, [Math]::Ceiling($latencySorted.Count * 0.95) - 1))
  $p95Ms = if ($latencySorted.Count -gt 0) { [double]$latencySorted[$p95Index] } else { 0.0 }
  $workingSetAfter = [int64]$procAfter.WorkingSet64
  $handlesAfter = [int64]$procAfter.HandleCount
  $workingSetGrowth = [Math]::Max([int64]0, $workingSetAfter - $workingSetBefore)
  $handleGrowth = [Math]::Max([int64]0, $handlesAfter - $handlesBefore)
  $expectedActivationCount = $ActivationCount + $ConcurrentBurstSize

  if ($p95Ms -gt $ActivationP95BudgetMs) { throw "soak_activation_p95_budget_exceeded:$([Math]::Round($p95Ms,2))" }
  if ($workingSetGrowth -gt $MaxWorkingSetGrowthBytes) { throw "soak_working_set_growth_budget_exceeded:$workingSetGrowth" }
  if ($handleGrowth -gt $MaxHandleGrowth) { throw "soak_handle_growth_budget_exceeded:$handleGrowth" }
  if ($ConcurrentBurstSize -gt 0 -and $burstElapsedMs -gt 8000) { throw "soak_concurrent_burst_budget_exceeded:$([Math]::Round($burstElapsedMs,2))" }

  $proof.normal_ui_boot_verified = $true
  $proof.second_instance_activations_verified = $launchIds.Count
  $proof | Add-Member -NotePropertyName primary_pid -NotePropertyValue $primaryPid -Force
  $proof | Add-Member -NotePropertyName startup_stable_sequence -NotePropertyValue ([int64]$stable.sequence) -Force
  $proof | Add-Member -NotePropertyName final_activation_sequence -NotePropertyValue $lastActivationSequence -Force
  $proof | Add-Member -NotePropertyName activation_latency_p95_ms -NotePropertyValue ([Math]::Round($p95Ms, 2)) -Force
  $proof | Add-Member -NotePropertyName activation_latency_p95_budget_ms -NotePropertyValue $ActivationP95BudgetMs -Force
  $proof | Add-Member -NotePropertyName concurrent_activation_burst_size -NotePropertyValue $ConcurrentBurstSize -Force
  $proof | Add-Member -NotePropertyName concurrent_activation_burst_elapsed_ms -NotePropertyValue ([Math]::Round($burstElapsedMs, 2)) -Force
  $proof | Add-Member -NotePropertyName post_activation_hold_seconds -NotePropertyValue $PostActivationHoldSeconds -Force
  $proof | Add-Member -NotePropertyName working_set_before_bytes -NotePropertyValue $workingSetBefore -Force
  $proof | Add-Member -NotePropertyName working_set_after_bytes -NotePropertyValue $workingSetAfter -Force
  $proof | Add-Member -NotePropertyName working_set_growth_bytes -NotePropertyValue $workingSetGrowth -Force
  $proof | Add-Member -NotePropertyName working_set_growth_budget_bytes -NotePropertyValue $MaxWorkingSetGrowthBytes -Force
  $proof | Add-Member -NotePropertyName handle_count_before -NotePropertyValue $handlesBefore -Force
  $proof | Add-Member -NotePropertyName handle_count_after -NotePropertyValue $handlesAfter -Force
  $proof | Add-Member -NotePropertyName handle_growth -NotePropertyValue $handleGrowth -Force
  $proof | Add-Member -NotePropertyName handle_growth_budget -NotePropertyValue $MaxHandleGrowth -Force
  $proof | Add-Member -NotePropertyName redundant_durable_second_instance_markers -NotePropertyValue $receiveMarkers.Count -Force
  $proof | Add-Member -NotePropertyName duplicate_browser_runtime_observed -NotePropertyValue $false -Force
  if ($proof.second_instance_activations_verified -ne $expectedActivationCount) { throw 'soak_activation_count_mismatch' }
  $proof | ConvertTo-Json -Depth 6 | Set-Content $ProofPath -Encoding utf8
  Copy-Item $journal (Join-Path $RunnerTemp 'browser-startup-journal-soak.json') -Force
  Write-Host ($proof | ConvertTo-Json -Compress)
} finally {
  if ($normal -and -not $normal.HasExited) {
    cmd.exe /d /c "taskkill.exe /PID $($normal.Id) /T /F >nul 2>&1 & exit /b 0" | Out-Null
  }
}
