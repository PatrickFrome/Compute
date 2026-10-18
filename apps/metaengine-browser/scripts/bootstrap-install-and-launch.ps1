param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$ExpectedInstallerSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [string]$InstalledExePath = '',
  # Candidate staged resources are used for a read-only compatibility refusal,
  # not as authenticated producer proof or permission to rewrite Owner custody.
  [string]$CandidateResourcesPath = '',
  [string]$ProofPath = '',
  [switch]$PhysicalProof,
  [ValidateRange(1,1800)][int]$InstallTimeoutSeconds = 1800,
  [int]$StartupTimeoutSeconds = 70
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-BootstrapProof($Proof) {
  $json = $Proof | ConvertTo-Json -Depth 8
  if ($ProofPath) {
    $parent = Split-Path -Parent $ProofPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($ProofPath, ($json + "`n"), [System.Text.UTF8Encoding]::new($false))
  }
  $json
}

if ($ExpectedInstallerSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'bootstrap_installer_sha256_invalid' }
if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+-dev\.\d+\.1$') { throw 'bootstrap_expected_version_invalid' }
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw 'bootstrap_installer_missing' }
if (-not $InstalledExePath) {
  if (-not $env:LOCALAPPDATA) { throw 'bootstrap_localappdata_unavailable' }
  $InstalledExePath = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test\METAENGINE Browser Test.exe'
}

$expectedInstallerHash = $ExpectedInstallerSha256.Trim().ToLowerInvariant()
$installerStream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $InstallerPath).Path)
try {
  $installerHasher = [System.Security.Cryptography.SHA256]::Create()
  try { $actualInstallerHash = [System.BitConverter]::ToString($installerHasher.ComputeHash($installerStream)).Replace('-', '').ToLowerInvariant() }
  finally { $installerHasher.Dispose() }
} finally { $installerStream.Dispose() }
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

# Refuse an incompatible installed Owner BEFORE the NSIS process can replace
# executable resources. Neither this check nor its receipt modifies Owner/PG.
$existingOwnerFile = if ($env:APPDATA) {
  Join-Path $env:APPDATA '@metaengine\browser-shell\metaengine-state-provider-v1.json'
} else { '' }
if ($existingOwnerFile -and (Test-Path -LiteralPath $existingOwnerFile)) {
  if (-not $CandidateResourcesPath) { throw 'bootstrap_owner_preinstall_resources_required' }
  $preflightScript = Join-Path $PSScriptRoot 'owner-runtime-preinstall-compatibility.mjs'
  if (-not (Test-Path -LiteralPath $preflightScript -PathType Leaf)) {
    throw 'bootstrap_owner_preinstall_verifier_unavailable'
  }
  $installedResourcesPath = Join-Path (Split-Path -Parent $InstalledExePath) 'resources'
  $preflightJson = & node $preflightScript --candidate-resources $CandidateResourcesPath --expected-version $ExpectedVersion --installed-resources $installedResourcesPath
  if ($LASTEXITCODE -ne 0) { throw 'bootstrap_owner_preinstall_incompatible' }
  try { $preflightResult = $preflightJson | ConvertFrom-Json } catch {
    throw 'bootstrap_owner_preinstall_receipt_invalid'
  }
  if ($preflightResult.schema -ne 'metaengine.browser.qa-owner-preinstall-compatibility.v1' `
      -or $preflightResult.state -ne 'COMPATIBLE' `
      -or $preflightResult.package_version -ne $ExpectedVersion `
      -or $preflightResult.installer_effect_attempted -ne $false `
      -or $preflightResult.owner_mutated -ne $false `
      -or $preflightResult.authority_effect -ne $false) {
    throw 'bootstrap_owner_preinstall_receipt_invalid'
  }
}

$boundedInstaller = Join-Path $PSScriptRoot 'install-package-bounded.ps1'
if (-not (Test-Path -LiteralPath $boundedInstaller -PathType Leaf)) { throw 'bootstrap_bounded_installer_missing' }
try {
  # The helper hashes the payload again immediately before launch and owns only
  # this installer process tree in a kill-on-close job with a fixed deadline.
  $installJson = & $boundedInstaller -InstallerPath $InstallerPath `
    -ExpectedSha256 $expectedInstallerHash -TimeoutSeconds $InstallTimeoutSeconds
  $install = $installJson | ConvertFrom-Json
  if ($install.schema -ne 'metaengine.browser.bounded-package-install.v1' `
      -or [string]$install.installer_sha256 -ne $expectedInstallerHash `
      -or [int64]$install.installer_pid -le 0 `
      -or [int]$install.installer_exit_code -ne 0 `
      -or [int]$install.timeout_seconds -ne $InstallTimeoutSeconds `
      -or $install.process_tree_scoped_job -ne $true `
      -or $install.descendant_cleanup_on_job_close -ne $true `
      -or $install.installed_payload_qualification_required -ne $true `
      -or $install.authority_effect -ne $false) { throw 'bootstrap_bounded_installer_receipt_invalid' }
  if (-not (Test-Path -LiteralPath $InstalledExePath -PathType Leaf)) { throw 'bootstrap_installed_executable_missing' }
} catch {
  # A terminated installer may already have changed files. Preserve uncertainty
  # for readback; never imply rollback or start another installation here.
  $reason = 'bootstrap_installer_unconfirmed'
  if ($_.Exception.Message -match '(package_installer_timeout|package_installer_exit_[0-9]+|bootstrap_bounded_installer_receipt_invalid|bootstrap_installed_executable_missing)') {
    $reason = $Matches[1]
  }
  Write-BootstrapProof ([ordered]@{
    schema = 'metaengine.browser.bootstrap-install-autostart-proof.v1'
    state = 'EFFECT_UNKNOWN'
    reason = $reason
    expected_version = $ExpectedVersion
    installer_sha256 = $actualInstallerHash
    installer_timeout_seconds = $InstallTimeoutSeconds
    installer_effect_attempted = $true
    installed_payload_qualification_required = $true
    automatic_browser_launch_performed = $false
    automatic_retry_allowed = $false
    rollback_confirmed = $false
    authority_effect = $false
    captured_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  }) | Write-Output
  throw
}

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
    $probe = Start-Process -FilePath $InstalledExePath -ArgumentList '--metaengine-profile-probe' -WindowStyle Hidden -PassThru -RedirectStandardOutput $profileOut -RedirectStandardError $profileErr
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

# Assisted NSIS keeps the manual run-after-finish UX, while verified automation uses
# a silent install followed by one exact normal launch. This proves the same packaged
# entry point without depending on installer UI availability in a CI/session-0 host.
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
  install_exit_code = [int]$install.installer_exit_code
  installer_pid = [int]$install.installer_pid
  installer_timeout_seconds = $InstallTimeoutSeconds
  installer_process_tree_scoped_job = $true
  normal_launch_pid = [int]$normal.Id
  silent_install_then_exact_normal_launch = $true
  automatic_browser_launch_performed = $true
  browser_visible = $true
  runtime_import_verified = $runtimeImportVerified
  startup_stable_event_sequence = $stableSequence
  user_data_path = $userData
  version_probe_verified = $versionProbeVerified
  bootstrap_launch_kind = 'POST_INSTALL_NORMAL'
  installer_effect_attempted = $true
  automatic_retry_allowed = $false
  authority_effect = $false
  captured_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
}
Write-BootstrapProof $result
