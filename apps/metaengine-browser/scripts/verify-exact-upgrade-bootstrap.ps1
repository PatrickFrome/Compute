param(
  [Parameter(Mandatory = $true)][string]$SourceHead,
  [Parameter(Mandatory = $true)][string]$RepairSourceHead,
  [Parameter(Mandatory = $true)][string]$BaselineBuild,
  [Parameter(Mandatory = $true)][string]$BaselineVersion,
  [Parameter(Mandatory = $true)][string]$BaselineInstallerSha256,
  [Parameter(Mandatory = $true)][string]$RepairVersion,
  [Parameter(Mandatory = $true)][string]$RepairInstallerPath,
  [Parameter(Mandatory = $true)][string]$RepairInstallerSha256,
  [Parameter(Mandatory = $true)][string]$PackagedExePath,
  [Parameter(Mandatory = $true)][string]$BootstrapScriptPath,
  [Parameter(Mandatory = $true)][string]$ProofDirectory,
  [int]$ProbeTimeoutSeconds = 20,
  [int]$InstallerTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Sha256([string]$Value, [string]$Label) {
  if ($Value -notmatch '^[a-fA-F0-9]{64}$') { throw "${Label}_sha256_invalid" }
  return $Value.Trim().ToLowerInvariant()
}

function Wait-ProcessGone([int]$ProcessId, [int]$Seconds, [string]$Label) {
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $Seconds))
  do {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "${Label}_still_alive:$ProcessId"
}

function Get-ExactExecutableProcesses([string]$Executable) {
  $target = [System.IO.Path]::GetFullPath($Executable)
  $targetName = [System.IO.Path]::GetFileName($target).Replace("'", "''")
  $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$targetName'" -ErrorAction SilentlyContinue)
  return @($rows | Where-Object {
    $candidate = [string]$_.ExecutablePath
    if (-not $candidate) { return $false }
    try {
      return [System.StringComparer]::OrdinalIgnoreCase.Equals(
        [System.IO.Path]::GetFullPath($candidate),
        $target
      )
    } catch {
      return $false
    }
  })
}

function Wait-ExactExecutableProcessesGone([string]$Executable, [int]$Seconds, [string]$Label) {
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $Seconds))
  do {
    $rows = @(Get-ExactExecutableProcesses $Executable)
    if ($rows.Count -eq 0) { return }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)

  $remaining = @(Get-ExactExecutableProcesses $Executable)
  $diagnostics = @($remaining | ForEach-Object {
    [ordered]@{
      pid = [int]$_.ProcessId
      parent_pid = [int]$_.ParentProcessId
      executable_path = [string]$_.ExecutablePath
      command_line = [string]$_.CommandLine
    }
  })
  Write-Host ($diagnostics | ConvertTo-Json -Depth 4 -Compress)
  throw "${Label}_exact_path_processes_still_alive:$($remaining.Count)"
}

function Read-JsonProbe([string]$Executable, [string]$Argument, [bool]$WriteProfileMarker = $false) {
  $stem = [guid]::NewGuid().ToString('N')
  $out = Join-Path $env:RUNNER_TEMP "browser-probe-$stem.out"
  $err = Join-Path $env:RUNNER_TEMP "browser-probe-$stem.err"
  Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
  $priorProfileWrite = $env:METAENGINE_PROFILE_PROBE_WRITE
  try {
    if ($WriteProfileMarker) { $env:METAENGINE_PROFILE_PROBE_WRITE = '1' }
    else { Remove-Item Env:METAENGINE_PROFILE_PROBE_WRITE -ErrorAction SilentlyContinue }
    $p = Start-Process -FilePath $Executable -ArgumentList $Argument -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $p.Handle
    if (-not $p.WaitForExit([Math]::Max(5, $ProbeTimeoutSeconds) * 1000)) {
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
      throw "probe_timeout:$Argument"
    }
    if ($p.ExitCode -ne 0) {
      Get-Content $err -ErrorAction SilentlyContinue | Write-Host
      throw "probe_exit_$($p.ExitCode):$Argument"
    }
  } finally {
    if ($null -eq $priorProfileWrite) { Remove-Item Env:METAENGINE_PROFILE_PROBE_WRITE -ErrorAction SilentlyContinue }
    else { $env:METAENGINE_PROFILE_PROBE_WRITE = $priorProfileWrite }
  }
  $line = Get-Content $out | Where-Object { $_.Trim() } | Select-Object -Last 1
  if (-not $line) { throw "probe_output_missing:$Argument" }
  return ($line | ConvertFrom-Json)
}

$baselineHashExpected = Assert-Sha256 $BaselineInstallerSha256 'baseline_installer'
$repairHashExpected = Assert-Sha256 $RepairInstallerSha256 'repair_installer'
if (-not (Test-Path -LiteralPath $RepairInstallerPath -PathType Leaf)) { throw 'repair_installer_missing' }
if (-not (Test-Path -LiteralPath $PackagedExePath -PathType Leaf)) { throw 'packaged_executable_missing' }
if (-not (Test-Path -LiteralPath $BootstrapScriptPath -PathType Leaf)) { throw 'bootstrap_script_missing' }
New-Item -ItemType Directory -Force -Path $ProofDirectory | Out-Null

$repairHash = (Get-FileHash -LiteralPath $RepairInstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($repairHash -ne $repairHashExpected) { throw "repair_installer_digest_mismatch:$repairHash" }
$packagedExeHash = (Get-FileHash -LiteralPath $PackagedExePath -Algorithm SHA256).Hash.ToLowerInvariant()

$baselineInstaller = Join-Path $env:RUNNER_TEMP "METAENGINE-Browser-Test-Setup-$BaselineVersion-x64.exe"
$baselineUrl = "https://github.com/PatrickFrome/Compute/releases/download/v$BaselineVersion/METAENGINE-Browser-Test-Setup-$BaselineVersion-x64.exe"
Invoke-WebRequest -UseBasicParsing -Uri $baselineUrl -OutFile $baselineInstaller
$baselineHash = (Get-FileHash -LiteralPath $baselineInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($baselineHash -ne $baselineHashExpected) { throw "baseline_installer_digest_mismatch:$baselineHash" }

$baselineInstall = Start-Process -FilePath $baselineInstaller -ArgumentList '/S' -PassThru
$null = $baselineInstall.Handle
if (-not $baselineInstall.WaitForExit([Math]::Max(30, $InstallerTimeoutSeconds) * 1000)) {
  try { Stop-Process -Id $baselineInstall.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw 'baseline_install_timeout'
}
if ($baselineInstall.ExitCode -ne 0) { throw "baseline_install_exit_$($baselineInstall.ExitCode)" }

$installedExe = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test\METAENGINE Browser Test.exe'
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw 'baseline_installed_executable_missing' }

$baselineVersionProbe = Read-JsonProbe $installedExe '--metaengine-version-probe'
if ($baselineVersionProbe.schema -ne 'metaengine.browser.version-probe.v1' `
    -or [string]$baselineVersionProbe.version -ne $BaselineVersion `
    -or $baselineVersionProbe.primary_instance -ne $true) {
  throw 'baseline_version_probe_invalid'
}
$baselineProfile = Read-JsonProbe $installedExe '--metaengine-profile-probe' $true
if ($baselineProfile.schema -ne 'metaengine.browser.profile-probe.v1' `
    -or [string]$baselineProfile.version -ne $BaselineVersion `
    -or $baselineProfile.primary_instance -ne $true `
    -or $baselineProfile.marker_present -ne $true `
    -or -not [string]$baselineProfile.user_data_path) {
  throw 'baseline_profile_probe_invalid'
}
$baselineUserData = [System.IO.Path]::GetFullPath([string]$baselineProfile.user_data_path)

$baselinePrimary = Start-Process -FilePath $installedExe -PassThru
$null = $baselinePrimary.Handle
Start-Sleep -Seconds 5
$baselinePrimary.Refresh()
if ($baselinePrimary.HasExited) { throw "baseline_primary_exited_before_upgrade:$($baselinePrimary.ExitCode)" }

$upgrade = Start-Process -FilePath $RepairInstallerPath -ArgumentList '/S' -PassThru
$null = $upgrade.Handle
if (-not $upgrade.WaitForExit([Math]::Max(30, $InstallerTimeoutSeconds) * 1000)) {
  try { Stop-Process -Id $upgrade.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw 'repair_upgrade_installer_timeout'
}
if ($upgrade.ExitCode -ne 0) { throw "repair_upgrade_installer_exit_$($upgrade.ExitCode)" }
Wait-ProcessGone -ProcessId $baselinePrimary.Id -Seconds 20 -Label 'baseline_primary'
Wait-ExactExecutableProcessesGone -Executable $installedExe -Seconds 20 -Label 'baseline_upgrade_drain'

if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) { throw 'repair_installed_executable_missing' }
$installedExeHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedExeHash -ne $packagedExeHash) {
  throw "installed_executable_digest_mismatch:installed=$installedExeHash packaged=$packagedExeHash"
}

$candidateVersionProbe = Read-JsonProbe $installedExe '--metaengine-version-probe'
if ($candidateVersionProbe.schema -ne 'metaengine.browser.version-probe.v1' `
    -or [string]$candidateVersionProbe.version -ne $RepairVersion `
    -or $candidateVersionProbe.primary_instance -ne $true) {
  throw 'repair_version_probe_invalid'
}
$candidateProfile = Read-JsonProbe $installedExe '--metaengine-profile-probe' $false
if ($candidateProfile.schema -ne 'metaengine.browser.profile-probe.v1' `
    -or [string]$candidateProfile.version -ne $RepairVersion `
    -or $candidateProfile.primary_instance -ne $true `
    -or $candidateProfile.marker_present -ne $true `
    -or -not [string]$candidateProfile.user_data_path) {
  throw 'repair_profile_probe_invalid'
}
$candidateUserData = [System.IO.Path]::GetFullPath([string]$candidateProfile.user_data_path)
if (-not [string]::Equals($baselineUserData, $candidateUserData, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "profile_user_data_path_changed:baseline=$baselineUserData candidate=$candidateUserData"
}

$newPrimary = Start-Process -FilePath $installedExe -PassThru
$null = $newPrimary.Handle
Start-Sleep -Seconds 5
$newPrimary.Refresh()
if ($newPrimary.HasExited) { throw "repair_primary_exited_early:$($newPrimary.ExitCode)" }
$shutdownSignal = Start-Process -FilePath $installedExe -ArgumentList '--metaengine-installer-shutdown' -PassThru
$null = $shutdownSignal.Handle
if (-not $shutdownSignal.WaitForExit(20000)) {
  try { Stop-Process -Id $shutdownSignal.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw 'repair_planned_shutdown_signal_timeout'
}
if ($shutdownSignal.ExitCode -ne 0) { throw "repair_planned_shutdown_signal_exit_$($shutdownSignal.ExitCode)" }
Wait-ProcessGone -ProcessId $newPrimary.Id -Seconds 20 -Label 'repair_primary_planned_shutdown'
Wait-ExactExecutableProcessesGone -Executable $installedExe -Seconds 20 -Label 'repair_planned_shutdown_drain'

$windowsProof = [ordered]@{
  schema = 'metaengine.browser.repair-windows-installer-verification.v2'
  source_head = $SourceHead
  repair_source_head = $RepairSourceHead
  baseline_build = $BaselineBuild
  baseline_version = $BaselineVersion
  baseline_installer_sha256 = $baselineHash
  baseline_primary_started = $true
  baseline_user_data_path = $baselineUserData
  upgrade_installer_exit = 0
  baseline_primary_gone = $true
  baseline_exact_path_processes_drained = $true
  target_version = $RepairVersion
  target_installer_sha256 = $repairHash
  target_version_probe = $true
  target_user_data_path = $candidateUserData
  profile_marker_survived_upgrade = $true
  profile_user_data_path_preserved = $true
  packaged_executable_sha256 = $packagedExeHash
  installed_executable_sha256 = $installedExeHash
  installed_executable_sha256_matches_packaged = $true
  target_primary_started = $true
  planned_shutdown_signal_exit = [int]$shutdownSignal.ExitCode
  planned_shutdown_verified = $true
  planned_shutdown_exact_path_processes_drained = $true
  authority_effect = $false
}
$windowsProofPath = Join-Path $ProofDirectory 'windows-installer-verification-proof.json'
[System.IO.File]::WriteAllText($windowsProofPath, (($windowsProof | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))

$bootstrapProofPath = Join-Path $ProofDirectory 'bootstrap-autostart-proof.json'
& $BootstrapScriptPath `
  -InstallerPath $RepairInstallerPath `
  -ExpectedInstallerSha256 $repairHash `
  -ExpectedVersion $RepairVersion `
  -InstalledExePath $installedExe `
  -ProofPath $bootstrapProofPath `
  -PhysicalProof `
  -StartupTimeoutSeconds 70 | Write-Host

if (-not (Test-Path -LiteralPath $bootstrapProofPath -PathType Leaf)) { throw 'bootstrap_autostart_proof_missing' }
$bootstrapProof = Get-Content -LiteralPath $bootstrapProofPath -Raw | ConvertFrom-Json
if ($bootstrapProof.schema -ne 'metaengine.browser.bootstrap-install-autostart-proof.v1' `
    -or [string]$bootstrapProof.expected_version -ne $RepairVersion `
    -or [string]$bootstrapProof.installer_sha256 -ne $repairHash `
    -or $bootstrapProof.browser_visible -ne $true `
    -or $bootstrapProof.runtime_import_verified -ne $true `
    -or $bootstrapProof.version_probe_verified -ne $true `
    -or -not $bootstrapProof.startup_stable_event_sequence) {
  throw 'bootstrap_autostart_proof_invalid'
}
$bootstrapUserData = [System.IO.Path]::GetFullPath([string]$bootstrapProof.user_data_path)
if (-not [string]::Equals($baselineUserData, $bootstrapUserData, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "bootstrap_profile_path_changed:baseline=$baselineUserData bootstrap=$bootstrapUserData"
}

$postBootstrapInstalledHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($postBootstrapInstalledHash -ne $packagedExeHash) {
  throw "bootstrap_installed_executable_digest_mismatch:installed=$postBootstrapInstalledHash packaged=$packagedExeHash"
}

$bootstrapPid = [int]$bootstrapProof.normal_launch_pid
if ($bootstrapPid -le 0 -or -not (Get-Process -Id $bootstrapPid -ErrorAction SilentlyContinue)) { throw 'bootstrap_primary_not_alive_after_proof' }
$bootstrapShutdown = Start-Process -FilePath $installedExe -ArgumentList '--metaengine-installer-shutdown' -PassThru
$null = $bootstrapShutdown.Handle
if (-not $bootstrapShutdown.WaitForExit(20000)) {
  try { Stop-Process -Id $bootstrapShutdown.Id -Force -ErrorAction SilentlyContinue } catch {}
  throw 'bootstrap_cleanup_shutdown_signal_timeout'
}
if ($bootstrapShutdown.ExitCode -ne 0) { throw "bootstrap_cleanup_shutdown_signal_exit_$($bootstrapShutdown.ExitCode)" }
Wait-ProcessGone -ProcessId $bootstrapPid -Seconds 20 -Label 'bootstrap_primary_cleanup'
Wait-ExactExecutableProcessesGone -Executable $installedExe -Seconds 20 -Label 'bootstrap_cleanup_drain'

$summary = [ordered]@{
  schema = 'metaengine.browser.exact-upgrade-bootstrap-qualification.v1'
  source_head = $SourceHead
  repair_source_head = $RepairSourceHead
  baseline_version = $BaselineVersion
  target_version = $RepairVersion
  installer_sha256 = $repairHash
  packaged_executable_sha256 = $packagedExeHash
  installed_executable_sha256 = $postBootstrapInstalledHash
  installed_executable_sha256_matches_packaged = $true
  profile_continuity_verified = $true
  profile_user_data_path = $baselineUserData
  bootstrap_autostart_verified = $true
  bootstrap_runtime_import_verified = $true
  bootstrap_primary_window_stable = $true
  planned_shutdown_exact_path_processes_drained = $true
  bootstrap_cleanup_shutdown_verified = $true
  bootstrap_cleanup_exact_path_processes_drained = $true
  authority_effect = $false
}
$summaryPath = Join-Path $ProofDirectory 'exact-upgrade-bootstrap-qualification-proof.json'
[System.IO.File]::WriteAllText($summaryPath, (($summary | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
$summary | ConvertTo-Json -Compress
