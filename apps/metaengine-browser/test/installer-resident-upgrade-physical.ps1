$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$legacyVersion = '0.7.0-dev.34759310781.1'
$legacySha256 = '0b636b691e4d05d360298036e0fc43f6db1238a3e8ec41aee995484894137e55'
$legacyUrl = "https://github.com/PatrickFrome/Compute/releases/download/v$legacyVersion/METAENGINE-Browser-Test-Setup-$legacyVersion-x64.exe"
$temp = $env:RUNNER_TEMP
if (-not $temp) { throw 'runner_temp_required' }
$legacyInstaller = Join-Path $temp 'reported-broken-resident-baseline.exe'
$targetInstallerPathFile = Join-Path $temp 'target-installer-path.txt'
if (-not (Test-Path -LiteralPath $targetInstallerPathFile)) { throw 'target_installer_path_evidence_missing' }
$targetInstaller = (Get-Content -LiteralPath $targetInstallerPathFile -Raw).Trim()
if (-not (Test-Path -LiteralPath $targetInstaller -PathType Leaf)) { throw 'target_installer_missing' }
$app = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test\METAENGINE Browser Test.exe'

function Wait-ProcessGone([int]$ProcessId, [int]$Seconds, [string]$Label) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "${Label}_still_alive:$ProcessId"
}

function Read-DetachedSentinelByCustody([int]$ParentPid, [string]$Executable, [string]$ProfilePath) {
  if (-not $ProfilePath -or -not [IO.Path]::IsPathRooted($ProfilePath)) { return $null }
  $statePath = Join-Path $ProfilePath 'metaengine-browser-sentinel-v1.json'
  $heartbeatPath = "$statePath.worker-heartbeat-v1.json"
  foreach ($file in @($statePath, $heartbeatPath)) {
    $info = Get-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    if (-not $info -or $info.PSIsContainer -or $info.Length -lt 2 -or $info.Length -gt 32768 -or
        ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }
  }
  try {
    $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $workerPid = [int]$state.worker_pid
    if ($workerPid -le 0) { return $null }
    $wmiRows = @(Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction Stop)
    if ($wmiRows.Count -ne 1) { return $null }
    $record = $wmiRows[0]
    $inputValue = [ordered]@{
      parentPid = $ParentPid; executable = $Executable;
      state = $state; heartbeat = $heartbeat;
      process = [ordered]@{
        ProcessId = [int]$record.ProcessId;
        ParentProcessId = [int]$record.ParentProcessId;
        ExecutablePath = [string]$record.ExecutablePath;
        CommandLine = [string]$record.CommandLine;
      }
    }
    # This native witness is never a new authority root. It is checked by
    # the exact reviewed verifier without publishing process command lines.
    $receiptText = ($inputValue | ConvertTo-Json -Depth 12 -Compress) | & node (Join-Path $PSScriptRoot '../scripts/qa-resident-sentinel-readback.mjs') 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $receipt = $receiptText | ConvertFrom-Json -ErrorAction Stop
    if ($receipt.schema -ne 'metaengine.browser.qa-resident-sentinel-readback.v1' -or
        $receipt.state -ne 'VERIFIED' -or $receipt.parent_pid -ne $ParentPid -or
        $receipt.worker_pid -ne $workerPid -or $receipt.worker_custody_token_verified -ne $true -or
        $receipt.heartbeat_fresh -ne $true -or $receipt.process_executable_verified -ne $true -or
        $receipt.worker_script_verified -ne $true -or $receipt.authority_effect -ne $false) { return $null }
    return $record
  } catch { return $null }
}

function Wait-SentinelChild([int]$ParentPid, [string]$Executable, [string]$ProfilePath, [int]$Seconds = 15) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentPid" -ErrorAction SilentlyContinue | Where-Object {
      $path = [string]$_.ExecutablePath
      $commandLine = [string]$_.CommandLine
      if (-not $path) { return $false }
      try {
        $sameExe = [System.StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFullPath($path), [System.IO.Path]::GetFullPath($Executable))
      } catch { $sameExe = $false }
      return $sameExe -and $commandLine -match 'browser-sentinel-worker\.cjs'
    })
    if ($children.Count -eq 1) { return $children[0] }
    if ($children.Count -gt 1) { throw "sentinel_child_cardinality_invalid:$($children.Count)" }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  # A Windows detached worker may no longer report the launcher's OS parent.
  # Never accept a guessed PID: require current custody, heartbeat and WMI.
  $detached = Read-DetachedSentinelByCustody -ParentPid $ParentPid -Executable $Executable -ProfilePath $ProfilePath
  if ($detached) { return $detached }
  $failure = [ordered]@{
    schema = 'metaengine.browser.qa-resident-sentinel-failure.v1'
    state = 'UNQUALIFIED'
    reason = 'SENTINEL_NATIVE_OR_CUSTODY_READBACK_MISSING'
    expected_parent_pid = $ParentPid
    automatic_retry_allowed = $false
    authority_effect = $false
  }
  $evidence = Join-Path (Get-Location).Path 'self-update-fast-evidence'
  if (Test-Path -LiteralPath $evidence -PathType Container) {
    [IO.File]::WriteAllText((Join-Path $evidence 'resident-sentinel-readback.json'),
      (($failure | ConvertTo-Json -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  }
  throw "sentinel_child_missing_for_parent:$ParentPid"
}

function Read-VersionProbe([string]$Executable, [string]$ProbeFlag = '--metaengine-version-probe') {
  if ($ProbeFlag -notin @('--metaengine-version-probe', '--metaengine-profile-probe')) { throw 'resident_probe_flag_invalid' }
  $out = Join-Path $temp ("resident-version-" + [guid]::NewGuid().ToString('N') + '.out')
  $err = Join-Path $temp ("resident-version-" + [guid]::NewGuid().ToString('N') + '.err')
  $p = Start-Process -FilePath $Executable -ArgumentList $ProbeFlag -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle
  if (-not $p.WaitForExit(15000)) { try { Stop-Process -Id $p.Id -Force } catch {}; throw 'version_probe_timeout' }
  if ($p.ExitCode -ne 0) { Get-Content $err -ErrorAction SilentlyContinue; throw "version_probe_exit_$($p.ExitCode)" }
  $line = Get-Content $out | Where-Object { $_.Trim() } | Select-Object -Last 1
  if (-not $line) { throw 'version_probe_output_missing' }
  return ($line | ConvertFrom-Json)
}

# Bind both artifact and installed-payload identities before deliberately downgrading.
# target-sha256.txt is the NSIS installer digest, not the installed Browser executable digest.
$targetVersion = (Get-Content (Join-Path $temp 'target-version.txt') -Raw).Trim()
$expectedTargetInstallerSha = (Get-Content (Join-Path $temp 'target-sha256.txt') -Raw).Trim().ToLowerInvariant()
$actualTargetInstallerSha = (Get-FileHash -LiteralPath $targetInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualTargetInstallerSha -ne $expectedTargetInstallerSha) { throw "target_installer_digest_mismatch:$actualTargetInstallerSha" }
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw 'target_installed_executable_missing_before_downgrade' }
$expectedInstalledExecutableSha = (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant()
$preDowngradeTargetProbe = Read-VersionProbe $app
if ([string]$preDowngradeTargetProbe.version -ne $targetVersion -or $preDowngradeTargetProbe.primary_instance -ne $true) { throw 'target_pre_downgrade_version_probe_invalid' }

# Reinstall the exact release the user reported as broken. The target candidate is
# already installed by the preceding self-update proof, but no Browser process is
# resident here, so the downgrade itself does not exercise the new fix yet.
Invoke-WebRequest -UseBasicParsing -Uri $legacyUrl -OutFile $legacyInstaller
$actualLegacySha = (Get-FileHash -LiteralPath $legacyInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualLegacySha -ne $legacySha256) { throw "legacy_installer_digest_mismatch:$actualLegacySha" }
$legacyInstall = Start-Process -FilePath $legacyInstaller -ArgumentList '/S' -PassThru -Wait
if ($legacyInstall.ExitCode -ne 0) { throw "legacy_install_exit_$($legacyInstall.ExitCode)" }
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw 'legacy_installed_executable_missing' }
$legacyProbe = Read-VersionProbe $app
if ([string]$legacyProbe.version -ne $legacyVersion -or $legacyProbe.primary_instance -ne $true) { throw 'legacy_version_probe_invalid' }

$legacyProfile = Read-VersionProbe $app '--metaengine-profile-probe'
$baselineUserData = (Get-Content (Join-Path $temp 'baseline-user-data-path.txt') -Raw).Trim()
if ($legacyProfile.primary_instance -ne $true -or $legacyProfile.marker_present -ne $true -or
    [string]$legacyProfile.version -ne $legacyVersion -or
    -not [IO.Path]::IsPathRooted([string]$legacyProfile.user_data_path) -or
    -not [String]::Equals([IO.Path]::GetFullPath([string]$legacyProfile.user_data_path),
      [IO.Path]::GetFullPath($baselineUserData), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'legacy_profile_custody_unverified'
}

# The workflow normally suppresses Sentinel for the synthetic self-update harness.
# Remove that override here: this phase must be a real ordinary Browser launch with
# HostResilience + detached Sentinel, matching the user's reported installation.
Remove-Item Env:METAENGINE_DISABLE_CRASH_SENTINEL -ErrorAction SilentlyContinue
Remove-Item Env:METAENGINE_SELF_UPDATE_TEST_MODE -ErrorAction SilentlyContinue
$legacyPrimary = Start-Process -FilePath $app -PassThru
$null = $legacyPrimary.Handle
Start-Sleep -Seconds 5
$legacyPrimary.Refresh()
if ($legacyPrimary.HasExited) { throw "legacy_primary_exited_before_upgrade:$($legacyPrimary.ExitCode)" }
$legacySentinel = Wait-SentinelChild -ParentPid $legacyPrimary.Id -Executable $app -ProfilePath ([string]$legacyProfile.user_data_path)
$legacySentinelPid = [int]$legacySentinel.ProcessId
if (-not (Get-Process -Id $legacySentinelPid -ErrorAction SilentlyContinue)) { throw 'legacy_sentinel_not_alive_before_upgrade' }

# This is the exact regression: run the new installer while the broken release is
# resident. It must not require Retry/Ignore UI, hang, or leave the old primary or
# Sentinel alive. Silent mode makes any unsafe customInit failure fail closed.
$upgrade = Start-Process -FilePath $targetInstaller -ArgumentList '/S' -PassThru
$null = $upgrade.Handle
if (-not $upgrade.WaitForExit(90000)) {
  try { Stop-Process -Id $upgrade.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw 'resident_upgrade_installer_timeout'
}
if ($upgrade.ExitCode -ne 0) { throw "resident_upgrade_installer_exit_$($upgrade.ExitCode)" }
Wait-ProcessGone -ProcessId $legacyPrimary.Id -Seconds 15 -Label 'legacy_primary'
Wait-ProcessGone -ProcessId $legacySentinelPid -Seconds 15 -Label 'legacy_sentinel'

# Verify the installed application payload is byte-identical to the exact target
# application that was installed by the preceding N->N+1 proof. The NSIS installer
# has a distinct digest and was verified separately above.
$installedSha = (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedSha -ne $expectedInstalledExecutableSha) { throw "resident_upgrade_installed_payload_digest_mismatch:$installedSha" }
$targetProbe = Read-VersionProbe $app
if ([string]$targetProbe.version -ne $targetVersion -or $targetProbe.primary_instance -ne $true) { throw 'resident_upgrade_target_version_probe_invalid' }

$newPrimary = Start-Process -FilePath $app -PassThru
$null = $newPrimary.Handle
Start-Sleep -Seconds 5
$newPrimary.Refresh()
if ($newPrimary.HasExited) { throw "resident_upgrade_new_primary_exited_early:$($newPrimary.ExitCode)" }
$newSentinel = Wait-SentinelChild -ParentPid $newPrimary.Id -Executable $app -ProfilePath ([string]$legacyProfile.user_data_path)
$newSentinelPid = [int]$newSentinel.ProcessId
if (-not (Get-Process -Id $newSentinelPid -ErrorAction SilentlyContinue)) { throw 'resident_upgrade_new_sentinel_not_alive' }

# Prove the new planned-shutdown handshake too, so future upgrades no longer need
# the legacy force fallback. A second exact executable sends the installer-only
# signal through Electron's singleton channel to the new primary. The control
# process itself must also exit zero; a timed-out interactive ACK path is a failure.
$shutdownSignal = Start-Process -FilePath $app -ArgumentList '--metaengine-installer-shutdown' -PassThru
$null = $shutdownSignal.Handle
if (-not $shutdownSignal.WaitForExit(20000)) { try { Stop-Process -Id $shutdownSignal.Id -Force } catch {}; throw 'planned_shutdown_signal_timeout' }
$shutdownSignal.Refresh()
if ($shutdownSignal.ExitCode -ne 0) { throw "planned_shutdown_signal_exit_$($shutdownSignal.ExitCode)" }
Wait-ProcessGone -ProcessId $newPrimary.Id -Seconds 20 -Label 'new_primary_planned_shutdown'
Wait-ProcessGone -ProcessId $newSentinelPid -Seconds 20 -Label 'new_sentinel_planned_shutdown'

$proof = [ordered]@{
  schema = 'metaengine.browser.installer-resident-upgrade-proof.v1'
  legacy_version = $legacyVersion
  legacy_installer_sha256 = $legacySha256
  legacy_primary_pid = $legacyPrimary.Id
  legacy_sentinel_pid = $legacySentinelPid
  resident_upgrade_installer_exit = 0
  legacy_primary_gone = $true
  legacy_sentinel_gone = $true
  target_version = $targetVersion
  target_installer_sha256 = $expectedTargetInstallerSha
  expected_installed_executable_sha256 = $expectedInstalledExecutableSha
  installed_executable_sha256 = $installedSha
  new_primary_pid = $newPrimary.Id
  new_sentinel_pid = $newSentinelPid
  new_primary_started = $true
  new_sentinel_started = $true
  planned_shutdown_signal_exit = $shutdownSignal.ExitCode
  planned_shutdown_verified = $true
  retry_dialog_required = $false
  authority_effect = $false
}
$proofPath = Join-Path $temp 'installer-resident-upgrade-proof.json'
[System.IO.File]::WriteAllText($proofPath, (($proof | ConvertTo-Json -Depth 6) + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Host ($proof | ConvertTo-Json -Compress)