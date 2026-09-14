param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$ExpectedInstallerSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [string]$InstalledExePath = '',
  [string]$ProofPath = '',
  [switch]$PhysicalProof,
  [int]$StartupTimeoutSeconds = 70
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ExpectedInstallerSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'bootstrap_installer_sha256_invalid' }
if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+-dev\.\d+\.1$') { throw 'bootstrap_expected_version_invalid' }
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw 'bootstrap_installer_missing' }
if (-not $InstalledExePath) {
  if (-not $env:LOCALAPPDATA) { throw 'bootstrap_localappdata_unavailable' }
  $InstalledExePath = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test\METAENGINE Browser Test.exe'
}

$expectedInstallerHash = $ExpectedInstallerSha256.Trim().ToLowerInvariant()
$actualInstallerHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualInstallerHash -ne $expectedInstallerHash) { throw 'bootstrap_installer_sha256_mismatch' }

function Get-BrowserProcesses([string]$ExactExePath) {
  $normalized = [System.IO.Path]::GetFullPath($ExactExePath)
  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try { [System.IO.Path]::GetFullPath([string]$_.Path) -eq $normalized } catch { $false }
  })
}

function Wait-BrowserProcessesGone([string]$ExactExePath, [int]$TimeoutSeconds = 12) {
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(2, $TimeoutSeconds))
  do {
    $rows = @(Get-BrowserProcesses $ExactExePath)
    if ($rows.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

$preexisting = @(Get-BrowserProcesses $InstalledExePath)
if ($preexisting.Count -gt 0) { throw 'bootstrap_preexisting_browser_process' }

# One-click + runAfterFinish is the production bootstrap contract. Do not pass /S
# here: electron-builder deliberately suppresses ordinary run-after-finish in silent
# mode. This test must observe the process created by the installer itself, never a
# harness-owned Start-Process fallback.
$install = Start-Process -FilePath $InstallerPath -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "bootstrap_installer_exit_$($install.ExitCode)" }
if (-not (Test-Path -LiteralPath $InstalledExePath -PathType Leaf)) { throw 'bootstrap_installed_executable_missing' }

$automaticBrowser = $null
$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(20, $StartupTimeoutSeconds))
while ([DateTime]::UtcNow -lt $deadline) {
  $rows = @(Get-BrowserProcesses $InstalledExePath)
  $automaticBrowser = $rows | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($automaticBrowser) { break }
  Start-Sleep -Milliseconds 250
}
if (-not $automaticBrowser) {
  throw 'bootstrap_installer_spawned_visible_browser_timeout'
}
$automaticBrowser.Refresh()
if ($automaticBrowser.HasExited -or $automaticBrowser.MainWindowHandle -eq 0) {
  throw 'bootstrap_installer_spawned_browser_not_stable'
}
$installerLaunchedPid = [int]$automaticBrowser.Id

$userData = $null
$startupJournal = $null
$stableSequence = $null
$runtimeImportVerified = $false
$versionProbeVerified = $false

if ($PhysicalProof) {
  # Freeze the already-proven installer-spawned process only after its visible
  # window exists, then use the read-only profile probe to resolve Electron's
  # exact userData path. The startup journal must bind back to the captured PID;
  # the probe is not allowed to substitute a fresh ordinary Browser launch.
  @(Get-BrowserProcesses $InstalledExePath) | Stop-Process -Force -ErrorAction SilentlyContinue
  if (-not (Wait-BrowserProcessesGone $InstalledExePath)) {
    throw 'bootstrap_installer_spawned_browser_cleanup_timeout'
  }

  $profileOut = Join-Path $env:RUNNER_TEMP 'bootstrap-profile-probe.out'
  $profileErr = Join-Path $env:RUNNER_TEMP 'bootstrap-profile-probe.err'
  Remove-Item $profileOut,$profileErr -Force -ErrorAction SilentlyContinue
  $priorProfileWrite = $env:METAENGINE_PROFILE_PROBE_WRITE
  $env:METAENGINE_PROFILE_PROBE_WRITE = '1'
  try {
    $probe = Start-Process -FilePath $InstalledExePath -ArgumentList '--metaengine-profile-probe' -PassThru -RedirectStandardOutput $profileOut -RedirectStandardError $profileErr
    $null = $probe.Handle
    if (-not $probe.WaitForExit(15000)) {
      try { Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue } catch {}
      throw 'bootstrap_profile_probe_timeout'
    }
    if ($probe.ExitCode -ne 0) {
      Get-Content $profileErr -ErrorAction SilentlyContinue
      throw "bootstrap_profile_probe_exit_$($probe.ExitCode)"
    }
  } finally {
    $env:METAENGINE_PROFILE_PROBE_WRITE = $priorProfileWrite
  }

  $profileLine = Get-Content $profileOut | Where-Object { $_.Trim() } | Select-Object -Last 1
  if (-not $profileLine) { throw 'bootstrap_profile_probe_output_missing' }
  $profile = $profileLine | ConvertFrom-Json
  if ($profile.schema -ne 'metaengine.browser.profile-probe.v1' `
      -or [string]$profile.version -ne $ExpectedVersion `
      -or $profile.primary_instance -ne $true `
      -or -not [string]$profile.user_data_path) {
    $profile | ConvertTo-Json -Depth 8 | Write-Host
    throw 'bootstrap_profile_probe_contract_invalid'
  }
  $versionProbeVerified = $true
  $userData = [string]$profile.user_data_path
  if (-not [System.IO.Path]::IsPathRooted($userData)) { throw 'bootstrap_profile_user_data_not_absolute' }
  $startupJournal = Join-Path $userData 'metaengine-browser-startup-journal-v1.json'
  if (-not (Test-Path -LiteralPath $startupJournal -PathType Leaf)) {
    throw 'bootstrap_installer_spawned_startup_journal_missing'
  }

  $startup = Get-Content -LiteralPath $startupJournal -Raw | ConvertFrom-Json
  if ($startup.schema -ne 'metaengine.browser.startup-journal.v1') { throw 'bootstrap_startup_journal_schema_invalid' }
  if ([string]$startup.current_version -ne $ExpectedVersion) { throw 'bootstrap_startup_journal_version_drift' }
  if ([int64]$startup.current_pid -ne [int64]$installerLaunchedPid) { throw 'bootstrap_startup_journal_pid_drift' }

  $runtimeImport = $startup.events | Where-Object {
    $_.boot_id -eq $startup.current_boot_id `
      -and $_.state -eq 'RUNTIME_IMPORT_OK' `
      -and [string]$_.version -eq $ExpectedVersion `
      -and [int64]$_.pid -eq [int64]$installerLaunchedPid
  } | Select-Object -Last 1
  $stable = $startup.events | Where-Object {
    $_.boot_id -eq $startup.current_boot_id `
      -and $_.state -eq 'PRIMARY_WINDOW_STABLE' `
      -and [string]$_.version -eq $ExpectedVersion `
      -and [int64]$_.pid -eq [int64]$installerLaunchedPid
  } | Select-Object -Last 1
  if (-not $runtimeImport) { throw 'bootstrap_runtime_import_evidence_missing' }
  if (-not $stable -or $stable.details.visible -ne $true) { throw 'bootstrap_primary_window_stable_evidence_missing' }
  $runtimeImportVerified = $true
  $stableSequence = [int64]$stable.sequence
}

$result = [ordered]@{
  schema = 'metaengine.browser.bootstrap-install-autostart-proof.v1'
  expected_version = $ExpectedVersion
  installer_sha256 = $actualInstallerHash
  installed_executable = $InstalledExePath
  installed_executable_exists = $true
  install_exit_code = [int]$install.ExitCode
  normal_launch_pid = $installerLaunchedPid
  installer_launched_process_observed = $true
  manual_post_install_start_process = $false
  automatic_browser_launch_performed = $true
  browser_visible = $true
  runtime_import_verified = $runtimeImportVerified
  startup_stable_event_sequence = $stableSequence
  user_data_path = $userData
  version_probe_verified = $versionProbeVerified
  bootstrap_launch_kind = 'POST_INSTALL_NORMAL'
  installer_effect_attempted = $true
  authority_effect = $false
  captured_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}
$json = $result | ConvertTo-Json -Depth 8
if ($ProofPath) {
  $parent = Split-Path -Parent $ProofPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  [System.IO.File]::WriteAllText($ProofPath, ($json + "`n"), [System.Text.UTF8Encoding]::new($false))
}
$json
