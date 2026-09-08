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

# PowerShell unwraps a function's single pipeline result. Materialize the caller-side
# collection so StrictMode sees a stable .Count for zero, one, or many processes.
$preexisting = @(Get-BrowserProcesses $InstalledExePath)
if ($preexisting.Count -gt 0) { throw 'bootstrap_preexisting_browser_process' }

$install = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "bootstrap_installer_exit_$($install.ExitCode)" }
if (-not (Test-Path -LiteralPath $InstalledExePath -PathType Leaf)) { throw 'bootstrap_installed_executable_missing' }

$userData = $null
$startupJournal = $null
$versionProbeVerified = $false
if ($PhysicalProof) {
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
  $userData = [string]$profile.user_data_path
  if (-not [System.IO.Path]::IsPathRooted($userData)) { throw 'bootstrap_profile_user_data_not_absolute' }
  $startupJournal = Join-Path $userData 'metaengine-browser-startup-journal-v1.json'
  Remove-Item $startupJournal -Force -ErrorAction SilentlyContinue
  Remove-Item "$startupJournal.corrupt-*" -Force -ErrorAction SilentlyContinue
  $versionProbeVerified = $true
}

# This is the bootstrap's required final effect: regardless of whether a future NSIS
# implementation also runs after Finish, a verified silent bootstrap always requests
# one ordinary Browser launch after the installer has completed. A pre-existing
# primary is forbidden above, so this launch cannot silently bind to stale authority.
$normalOut = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP 'bootstrap-normal-ui.out' } else { Join-Path $env:TEMP 'bootstrap-normal-ui.out' }
$normalErr = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP 'bootstrap-normal-ui.err' } else { Join-Path $env:TEMP 'bootstrap-normal-ui.err' }
Remove-Item $normalOut,$normalErr -Force -ErrorAction SilentlyContinue
$normal = Start-Process -FilePath $InstalledExePath -PassThru -RedirectStandardOutput $normalOut -RedirectStandardError $normalErr
$null = $normal.Handle

$visible = $false
$stableSequence = $null
$runtimeImportVerified = $false
$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(20, $StartupTimeoutSeconds))
while ([DateTime]::UtcNow -lt $deadline) {
  $normal.Refresh()
  if ($normal.HasExited) {
    Get-Content $normalErr -ErrorAction SilentlyContinue
    throw "bootstrap_normal_browser_exited_early:$($normal.ExitCode)"
  }

  if ($PhysicalProof -and $startupJournal -and (Test-Path -LiteralPath $startupJournal -PathType Leaf)) {
    try {
      $startup = Get-Content -LiteralPath $startupJournal -Raw | ConvertFrom-Json
      if ($startup.schema -ne 'metaengine.browser.startup-journal.v1') { throw 'bootstrap_startup_journal_schema_invalid' }
      if ([string]$startup.current_version -eq $ExpectedVersion -and [int64]$startup.current_pid -eq [int64]$normal.Id) {
        $runtimeImport = $startup.events | Where-Object {
          $_.boot_id -eq $startup.current_boot_id `
            -and $_.state -eq 'RUNTIME_IMPORT_OK' `
            -and [string]$_.version -eq $ExpectedVersion `
            -and [int64]$_.pid -eq [int64]$normal.Id
        } | Select-Object -Last 1
        $stable = $startup.events | Where-Object {
          $_.boot_id -eq $startup.current_boot_id `
            -and $_.state -eq 'PRIMARY_WINDOW_STABLE' `
            -and [string]$_.version -eq $ExpectedVersion `
            -and [int64]$_.pid -eq [int64]$normal.Id
        } | Select-Object -Last 1
        if ($runtimeImport) { $runtimeImportVerified = $true }
        if ($stable -and $stable.details.visible -eq $true) {
          $visible = $true
          $stableSequence = [int64]$stable.sequence
          break
        }
      }
    } catch {
      if ($_.Exception.Message -eq 'bootstrap_startup_journal_schema_invalid') { throw }
    }
  } else {
    $processes = @(Get-BrowserProcesses $InstalledExePath)
    if ($processes | Where-Object { $_.MainWindowHandle -ne 0 }) {
      $visible = $true
      break
    }
  }
  Start-Sleep -Milliseconds 250
}

if (-not $visible) {
  Get-Content $normalErr -ErrorAction SilentlyContinue
  if ($startupJournal -and (Test-Path -LiteralPath $startupJournal)) { Get-Content -LiteralPath $startupJournal -Raw -ErrorAction SilentlyContinue | Write-Host }
  throw 'bootstrap_browser_visible_window_timeout'
}
if ($PhysicalProof -and -not $runtimeImportVerified) { throw 'bootstrap_runtime_import_evidence_missing' }

$result = [ordered]@{
  schema = 'metaengine.browser.bootstrap-install-autostart-proof.v1'
  expected_version = $ExpectedVersion
  installer_sha256 = $actualInstallerHash
  installed_executable = $InstalledExePath
  installed_executable_exists = $true
  install_exit_code = [int]$install.ExitCode
  normal_launch_pid = [int]$normal.Id
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
