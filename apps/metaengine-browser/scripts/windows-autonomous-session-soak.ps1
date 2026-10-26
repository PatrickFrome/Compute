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

function Resolve-SoakLaunchPorts {
  param([string]$UiPort = $env:ME2_UI_PORT, [string]$GatewayPort = $env:ME2_UI_GATEWAY_PORT, [string]$DaemonPort = $env:ME2_REST_PORT)
  $ports = [ordered]@{}
  foreach ($entry in @(@('ui', $UiPort, 3000), @('gateway', $GatewayPort, 8137), @('daemon', $DaemonPort, 3041))) {
    $value = [string]$entry[1]
    if ([string]::IsNullOrEmpty($value)) { $value = [string]$entry[2] }
    if ($value -notmatch '^[1-9][0-9]{0,4}$' -or [int64]$value -gt 65535) { throw 'soak_launch_ports_invalid' }
    $ports[[string]$entry[0]] = [int]$value
  }
  return $ports
}

function Resolve-SoakUiEndpoint {
  param([int]$Port, [string]$HealthUrl = $env:ME2_UI_HEALTH_URL)
  if ($Port -lt 1 -or $Port -gt 65535) { throw 'soak_launch_ports_invalid' }
  $endpoint = "http://127.0.0.1:${Port}/"
  if (-not [string]::IsNullOrEmpty($HealthUrl) -and -not [string]::Equals($HealthUrl, $endpoint, [StringComparison]::Ordinal)) {
    throw 'soak_ui_endpoint_contract_invalid'
  }
  return $endpoint
}

function Get-SoakProperty {
  param($Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -ne $property) { return $property.Value }
  return $null
}

function Invoke-SoakUiProbe {
  param([string]$Endpoint)
  $status = $null
  try {
    # powershell.exe is Windows PowerShell 5.1: do not depend on IE parsing or
    # an interactive first-use prompt when checking the exact isolated UI port.
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Endpoint -Method Get -TimeoutSec 2
    $status = [int]$response.StatusCode
    if ($status -ge 200 -and $status -lt 500) { return [ordered]@{ status=$status; outcome='READY' } }
  } catch {
    $failureResponse = Get-SoakProperty $_.Exception 'Response'
    $failureStatus = Get-SoakProperty $failureResponse 'StatusCode'
    if ($null -ne $failureStatus -and [int]$failureStatus -ge 100 -and [int]$failureStatus -le 599) { $status = [int]$failureStatus }
  }
  return [ordered]@{ status=$status; outcome=$(if ($null -eq $status) { 'PROBE_FAILED' } else { 'HTTP_REJECTED' }) }
}

function Get-SoakMe2Failure {
  param($Row)
  $schema = [string](Get-SoakProperty $Row 'schema')
  $event = [string](Get-SoakProperty $Row 'event')
  $allowed = switch ($schema) {
    'metaengine.browser.me2.ui-host.v1' { @('UI_DIR_NOT_FOUND','UI_INITIAL_READINESS_FAILED','SPAWN_ERROR','RESTARTS_EXHAUSTED') }
    'metaengine.browser.me2.daemon-host.v1' { @('DAEMON_LAUNCH_NOT_FOUND','DAEMON_INITIAL_READINESS_FAILED','SPAWN_ERROR','RESTARTS_EXHAUSTED') }
    'metaengine.browser.me2.integration.v1' { @('ME2_CONTRACT_MISMATCH','ME2_CONTRACT_UNREACHABLE','DAEMON_HOST_START_FAILED','UI_HOST_START_FAILED') }
    'metaengine.browser.me2-r97-installed-ui.v1' {
      $event = [string](Get-SoakProperty $Row 'state')
      @('ME2_R97_UI_CONTRACT_INCOMPLETE')
    }
    default { @() }
  }
  if (@($allowed) -contains $event) { return [ordered]@{ schema=$schema; event=$event } }
  return $null
}

function Test-SoakActivationAck {
  param($Ack, [int64]$PrimaryPid)
  $sequence = [int64]0
  $pidValue = [int64]0
  $validSequence = [int64]::TryParse([string](Get-SoakProperty $Ack 'event_sequence'), [ref]$sequence)
  $validPid = [int64]::TryParse([string](Get-SoakProperty $Ack 'primary_pid'), [ref]$pidValue)
  return [bool](
    [string](Get-SoakProperty $Ack 'schema') -eq 'metaengine.browser.secondary-launch.v1' `
    -and [string](Get-SoakProperty $Ack 'state') -eq 'PRIMARY_UI_ACTIVATION_ACKNOWLEDGED' `
    -and (Get-SoakProperty $Ack 'second_browser_runtime_started') -eq $false `
    -and (Get-SoakProperty $Ack 'authority_effect') -eq $false `
    -and [string](Get-SoakProperty $Ack 'launch_id') -match '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' `
    -and $validPid -and $pidValue -eq $PrimaryPid -and $pidValue -gt 0 -and $pidValue -le 2147483647 `
    -and $validSequence -and $sequence -ge 1 -and $sequence -le 9007199254740991
  )
}

function New-SoakDiagnostics {
  return [ordered]@{
    schema='metaengine.browser.session-soak-diagnostics.v1'; state='RUNNING'; phase='PROFILE_PROBE'; elapsed_ms=0; sequence=0
    first_failure=$null; cleanup_failure=$null
    process=[ordered]@{ pid=$null; exited=$null; exit_code=$null }
    ports=[ordered]@{ ui=$null; gateway=$null; daemon=$null }
    readiness=[ordered]@{ daemon=$false; contract=$false; ui_started=$false; ui=$false; gateway=$false; mission_removed=$false; primary_shell=$false; r97_dom=$false }
    ui_http=[ordered]@{ status=$null; outcome='UNOBSERVED' }
    me2_failure=$null; verified_activation_count=0
    diagnostic_only=$true; qualification_proven=$false; automatic_retry_allowed=$false; authority_effect=$false
  }
}

function Get-SoakFailureCode {
  param($Failure)
  $allowed = @(
    'packaged_browser_missing','proof_missing','activation_count_invalid','concurrent_burst_invalid',
    'activation_p95_budget_invalid','resource_budget_invalid','launch_ports_invalid','ui_endpoint_contract_invalid',
    'profile_probe_timeout','profile_probe_exit','profile_probe_output_missing','profile_probe_contract_invalid',
    'normal_ui_exited_early','runtime_import_failed','normal_ui_not_stable_visible','runtime_import_success_missing',
    'startup_always_on_control_state_invalid','runtime_genesis_contract_invalid','runtime_genesis_initial_tabs_invalid',
    'normal_ui_exited_before_resource_baseline','startup_resource_baseline_unsettled',
    'zero_topology_startup_created_initial_tab','zero_topology_startup_started_initial_remote_load',
    'normal_ui_exited_before_me2_settle','me2_runtime_degraded','me2_runtime_not_settled',
    'normal_ui_exited_before_resource_plateau','me2_resource_baseline_not_stable',
    'secondary_timeout','secondary_exit','secondary_ack_missing','secondary_ack_invalid','duplicate_launch_id',
    'primary_activation_missing','activation_sequence_not_monotonic','activation_ack_sequence_drift',
    'activation_sequence_duplicate','primary_died_after_activation','burst_secondary_timeout','burst_secondary_exit',
    'burst_secondary_ack_missing','burst_secondary_ack_invalid','burst_duplicate_launch_id','burst_primary_activation_missing',
    'burst_activation_ack_sequence_drift','burst_activation_sequence_duplicate','primary_died_during_post_activation_hold',
    'runtime_import_failed_after_activation_burst','redundant_durable_second_instance_marker_present',
    'activation_p95_budget_exceeded','working_set_growth_budget_exceeded','handle_growth_budget_exceeded',
    'concurrent_burst_budget_exceeded','activation_count_mismatch','shutdown_signal_timeout','shutdown_signal_failed',
    'shutdown_primary_timeout','primary_cleanup_unconfirmed'
  )
  $message = if ($Failure -is [System.Management.Automation.ErrorRecord]) { [string]$Failure.Exception.Message } else { [string]$Failure }
  if ($message -match '^soak_([a-z0-9_]+)(?=[:\s]|$)') {
    $code = $Matches[1] -replace '^profile_probe_exit_\d+$', 'profile_probe_exit'
    if ($allowed -contains $code) { return $code }
  }
  return 'other_failure'
}

function Set-SoakDiagnosticFailure {
  param([System.Collections.IDictionary]$Diagnostics, $Failure, [switch]$Cleanup)
  $row = [ordered]@{ code=(Get-SoakFailureCode $Failure); phase=[string]$Diagnostics.phase }
  if ($null -eq $Diagnostics.first_failure) { $Diagnostics.first_failure = $row }
  if ($Cleanup -and $null -eq $Diagnostics.cleanup_failure) { $Diagnostics.cleanup_failure = $row }
  $Diagnostics.state = 'FAILED'
}

function Write-SoakDiagnosticCheckpoint {
  param([System.Collections.IDictionary]$Diagnostics, [string]$Path, $Process = $null, [Diagnostics.Stopwatch]$Clock = $null)
  # A diagnostic write must never replace the original failure or authorize a
  # retry. Atomic replacement leaves the prior checkpoint readable if killed.
  $priorSequence = $Diagnostics.sequence
  if ($null -ne $Process) {
    try {
      $Process.Refresh()
      $Diagnostics.process = [ordered]@{ pid=[int]$Process.Id; exited=[bool]$Process.HasExited; exit_code=$null }
      if ($Process.HasExited) { $Diagnostics.process.exit_code = [int]$Process.ExitCode }
    } catch {
      $Diagnostics.process = [ordered]@{ pid=$Diagnostics.process.pid; exited=$null; exit_code=$null }
    }
  }
  try {
    if ($null -ne $Clock) { $Diagnostics.elapsed_ms = [Math]::Min([int64]86400000, $Clock.ElapsedMilliseconds) }
    $Diagnostics.sequence = [Math]::Min([int64]1000000, [int64]$priorSequence + 1)
    $json = $Diagnostics | ConvertTo-Json -Depth 7 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 16384) { $Diagnostics.sequence = $priorSequence; return }
    $next = "$Path.next"
    [IO.File]::WriteAllText($next, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($next, $Path, [NullString]::Value) }
    else { [IO.File]::Move($next, $Path) }
  } catch { $Diagnostics.sequence = $priorSequence }
}

function Set-SoakPhase {
  param([ValidateSet('PROFILE_PROBE','NORMAL_UI_START','PRIMARY_WINDOW_READINESS','STARTUP_CONTRACT','STARTUP_SUBSYSTEMS','ME2_READINESS','RESOURCE_BASELINE','SEQUENTIAL_ACTIVATIONS','BURST_ACTIVATIONS','POST_ACTIVATION_HOLD','RESOURCE_BUDGETS','SHUTDOWN','COMPLETE')][string]$Phase)
  $diagnostics.phase = $Phase
  Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $diagnosticProcess -Clock $diagnosticClock
}

function Invoke-SoakCleanup {
  param([scriptblock]$Cleanup, $PrimaryFailure, [bool]$Passed, [System.Collections.IDictionary]$Diagnostics, [string]$Path, $Process = $null, [Diagnostics.Stopwatch]$Clock = $null)
  $Diagnostics.phase = 'SHUTDOWN'
  Write-SoakDiagnosticCheckpoint -Diagnostics $Diagnostics -Path $Path -Process $Process -Clock $Clock
  try { & $Cleanup }
  catch {
    Set-SoakDiagnosticFailure -Diagnostics $Diagnostics -Failure $_ -Cleanup
    # A failed shutdown is additional evidence, never a replacement for the
    # first readiness/activation failure already being rethrown by the caller.
    if ($null -eq $PrimaryFailure) { throw }
  } finally {
    if ($Passed -and $null -eq $Diagnostics.first_failure -and $null -eq $Diagnostics.cleanup_failure) {
      $Diagnostics.state = 'PASSED'
      $Diagnostics.phase = 'COMPLETE'
    }
    Write-SoakDiagnosticCheckpoint -Diagnostics $Diagnostics -Path $Path -Process $Process -Clock $Clock
  }
}

$diagnostics = New-SoakDiagnostics
$diagnosticClock = [Diagnostics.Stopwatch]::StartNew()
$diagnosticPath = Join-Path $RunnerTemp 'soak-diagnostics.json'
$diagnosticProcess = $null
$normal = $null
$normalErr = $null
$journal = $null
$soakPassed = $false
$primaryFailure = $null
Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Clock $diagnosticClock
try {
if (-not (Test-Path $AppPath -PathType Leaf)) { throw "soak_packaged_browser_missing:$AppPath" }
if (-not (Test-Path $ProofPath -PathType Leaf)) { throw "soak_proof_missing:$ProofPath" }
if ($ActivationCount -lt 1 -or $ActivationCount -gt 96) { throw 'soak_activation_count_invalid' }
if ($ConcurrentBurstSize -lt 0 -or $ConcurrentBurstSize -gt 16) { throw 'soak_concurrent_burst_invalid' }
if ($ActivationP95BudgetMs -lt 100) { throw 'soak_activation_p95_budget_invalid' }
if ($MaxWorkingSetGrowthBytes -lt 0 -or $MaxHandleGrowth -lt 0) { throw 'soak_resource_budget_invalid' }

$diagnostics.ports = Resolve-SoakLaunchPorts
$uiHealthEndpoint = Resolve-SoakUiEndpoint -Port $diagnostics.ports.ui
Set-SoakPhase 'PROFILE_PROBE'
$proof = Get-Content $ProofPath -Raw | ConvertFrom-Json
$profileOut = Join-Path $RunnerTemp 'soak-profile.out'
$profileErr = Join-Path $RunnerTemp 'soak-profile.err'
$priorProfileWrite = $env:METAENGINE_PROFILE_PROBE_WRITE
$env:METAENGINE_PROFILE_PROBE_WRITE = '1'
try {
  $profileProcess = Start-Process -FilePath $AppPath -ArgumentList '--metaengine-profile-probe' -PassThru -RedirectStandardOutput $profileOut -RedirectStandardError $profileErr
  $null = $profileProcess.Handle
  $diagnosticProcess = $profileProcess
  Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $diagnosticProcess -Clock $diagnosticClock
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

$userDataPath = [string]$profile.user_data_path
$journal = Join-Path $userDataPath 'metaengine-browser-startup-journal-v1.json'
$controlStatePath = Join-Path $userDataPath 'metaengine-native-supervisor-control-state-v1.json'
$runtimeGenesisPath = Join-Path $userDataPath 'metaengine-runtime-generation-v1.json'
Remove-Item $journal -Force -ErrorAction SilentlyContinue
Remove-Item "$journal.corrupt-*" -Force -ErrorAction SilentlyContinue

$normalOut = Join-Path $RunnerTemp 'soak-normal-ui.out'
$normalErr = Join-Path $RunnerTemp 'soak-normal-ui.err'
  $diagnosticProcess = $null
  $diagnostics.process = [ordered]@{ pid=$null; exited=$null; exit_code=$null }
  Set-SoakPhase 'NORMAL_UI_START'
  # Ordinary Explorer / Start Menu path: no smoke or probe flags.
  $normal = Start-Process -FilePath $AppPath -PassThru -RedirectStandardOutput $normalOut -RedirectStandardError $normalErr
  $null = $normal.Handle
  $diagnosticProcess = $normal
  Set-SoakPhase 'PRIMARY_WINDOW_READINESS'
  @{ pid=$normal.Id; version=[string]$proof.package_version } | ConvertTo-Json -Compress |
    Set-Content (Join-Path $RunnerTemp 'soak-running-primary.json') -Encoding utf8
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

  # PRIMARY_WINDOW_STABLE intentionally precedes degradable startup. Authority and
  # topology are independent: final runtime must be CONTROL+armed while the runtime
  # genesis marker decides whether any initial remote tab is requested.
  Set-SoakPhase 'STARTUP_CONTRACT'
  $controlState = $null
  $runtimeGenesis = $null
  $startupContractDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $startupContractDeadline) {
    if (-not $controlState -and (Test-Path $controlStatePath -PathType Leaf)) {
      try { $controlState = Get-Content $controlStatePath -Raw | ConvertFrom-Json } catch { $controlState = $null }
    }
    if (-not $runtimeGenesis -and (Test-Path $runtimeGenesisPath -PathType Leaf)) {
      try { $runtimeGenesis = Get-Content $runtimeGenesisPath -Raw | ConvertFrom-Json } catch { $runtimeGenesis = $null }
    }
    if ($controlState -and $runtimeGenesis) { break }
    Start-Sleep -Milliseconds 100
  }

  if (-not $controlState `
      -or $controlState.schema -ne 'metaengine.native-supervisor.control-state.v1' `
      -or [string]$controlState.supervisor_mode -ne 'CONTROL' `
      -or $controlState.armed -ne $true `
      -or $controlState.authority_effect -ne $false) {
    throw 'soak_startup_always_on_control_state_invalid'
  }
  if (-not $runtimeGenesis `
      -or $runtimeGenesis.schema -ne 'metaengine.browser.runtime-genesis.v1' `
      -or -not [string]$runtimeGenesis.generation `
      -or [string]$runtimeGenesis.supervisor_mode -ne 'CONTROL' `
      -or $runtimeGenesis.armed -ne $true `
      -or $runtimeGenesis.automatic_actuation_after_genesis -ne $false `
      -or $runtimeGenesis.authority_effect -ne $false) {
    throw 'soak_runtime_genesis_contract_invalid'
  }

  try { $requestedInitialTabs = [int64]$runtimeGenesis.initial_tabs } catch { throw 'soak_runtime_genesis_initial_tabs_invalid' }
  if ($requestedInitialTabs -lt 0 -or $requestedInitialTabs -gt 256) { throw 'soak_runtime_genesis_initial_tabs_invalid' }
  $zeroTopologyStartup = $requestedInitialTabs -eq 0

  $requiredStartupSubsystems = @(
    'OWNER_SAFETY_GATES',
    'USER_SESSION'
  )
  if (-not $zeroTopologyStartup) { $requiredStartupSubsystems += 'INITIAL_TAB_CREATE' }
  $requiredStartupSubsystems += @(
    'FLEET',
    'SHELL_SNAPSHOT',
    'DEVELOPMENT_PLANE',
    'NATIVE_SUPERVISOR'
  )
  if (-not $zeroTopologyStartup) { $requiredStartupSubsystems += 'INITIAL_REMOTE_LOAD' }
  Set-SoakPhase 'STARTUP_SUBSYSTEMS'
  $settledStartupSubsystems = New-Object 'System.Collections.Generic.HashSet[string]'
  $settleDeadline = [DateTime]::UtcNow.AddSeconds(35)
  while ([DateTime]::UtcNow -lt $settleDeadline -and $settledStartupSubsystems.Count -lt $requiredStartupSubsystems.Count) {
    $normal.Refresh()
    if ($normal.HasExited) { throw "soak_normal_ui_exited_before_resource_baseline:$($normal.ExitCode)" }
    if (Test-Path $normalOut -PathType Leaf) {
      foreach ($startupLine in @(Get-Content $normalOut -ErrorAction SilentlyContinue)) {
        if (-not [string]$startupLine -or -not ([string]$startupLine).Trim().StartsWith('{')) { continue }
        try { $startupRow = $startupLine | ConvertFrom-Json } catch { continue }
        if ([string](Get-SoakProperty $startupRow 'schema') -ne 'metaengine.browser-startup-subsystem.v1') { continue }
        if (@('SUBSYSTEM_READY','SUBSYSTEM_DEGRADED') -notcontains [string](Get-SoakProperty $startupRow 'state')) { continue }
        $subsystem = [string](Get-SoakProperty $startupRow 'subsystem')
        if ($requiredStartupSubsystems -contains $subsystem) { $null = $settledStartupSubsystems.Add($subsystem) }
      }
    }
    if ($settledStartupSubsystems.Count -lt $requiredStartupSubsystems.Count) { Start-Sleep -Milliseconds 100 }
  }
  if ($settledStartupSubsystems.Count -ne $requiredStartupSubsystems.Count) {
    $missing = @($requiredStartupSubsystems | Where-Object { -not $settledStartupSubsystems.Contains($_) })
    throw "soak_startup_resource_baseline_unsettled:$($missing -join ',')"
  }

  if ($zeroTopologyStartup -and (Test-Path $normalOut -PathType Leaf)) {
    $unexpectedInitialTabRows = 0
    $unexpectedInitialRemoteRows = 0
    foreach ($startupLine in @(Get-Content $normalOut -ErrorAction SilentlyContinue)) {
      if (-not [string]$startupLine -or -not ([string]$startupLine).Trim().StartsWith('{')) { continue }
      try { $startupRow = $startupLine | ConvertFrom-Json } catch { continue }
      if ([string](Get-SoakProperty $startupRow 'schema') -ne 'metaengine.browser-startup-subsystem.v1') { continue }
      if ([string](Get-SoakProperty $startupRow 'subsystem') -eq 'INITIAL_TAB_CREATE') { $unexpectedInitialTabRows += 1 }
      if ([string](Get-SoakProperty $startupRow 'subsystem') -eq 'INITIAL_REMOTE_LOAD') { $unexpectedInitialRemoteRows += 1 }
    }
    if ($unexpectedInitialTabRows -gt 0) { throw 'soak_zero_topology_startup_created_initial_tab' }
    if ($unexpectedInitialRemoteRows -gt 0) { throw 'soak_zero_topology_startup_started_initial_remote_load' }
  }

  # R108: the full installed runtime is asynchronous beyond PRIMARY_WINDOW_STABLE,
  # but the duplicate ME2 Mission Control scheduler/tab is intentionally absent.
  # Wait for exact daemon contract + UI/gateway + scheduler-removal evidence, then
  # demand a short handle plateau before measuring second-instance activations.
  Set-SoakPhase 'ME2_READINESS'
  $me2DaemonReady = $false
  $me2ContractOk = $false
  $me2UiStarted = $false
  $me2UiReady = $false
  $me2GatewayLive = $false
  $me2MissionControlRemoved = $false
  $me2PrimaryShellReady = $false
  $me2R97UiConfirmed = $false
  $me2Fatal = $null
  $me2Deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ([DateTime]::UtcNow -lt $me2Deadline) {
    $normal.Refresh()
    if ($normal.HasExited) { throw "soak_normal_ui_exited_before_me2_settle:$($normal.ExitCode)" }
    # Runtime failure rows are deliberately emitted on stderr. Reading only
    # stdout loses their finite cause and leaves an unexplained readiness timeout.
    foreach ($streamFile in @($normalOut, $normalErr)) {
      if (-not (Test-Path $streamFile -PathType Leaf)) { continue }
      foreach ($line in @(Get-Content $streamFile -ErrorAction SilentlyContinue)) {
        if (-not [string]$line -or -not ([string]$line).Trim().StartsWith('{')) { continue }
        try { $row = $line | ConvertFrom-Json } catch { continue }
        $schema = [string](Get-SoakProperty $row 'schema')
        $event = [string](Get-SoakProperty $row 'event')
        $state = [string](Get-SoakProperty $row 'state')
        if ($schema -eq 'metaengine.browser.me2.daemon-host.v1' -and @('DAEMON_HEALTHY','DAEMON_ADOPTED') -contains $event) { $me2DaemonReady = $true }
        if ($schema -eq 'metaengine.browser.me2.integration.v1' -and $event -eq 'ME2_CONTRACT_OK') { $me2ContractOk = $true }
        if ($schema -eq 'metaengine.browser.me2.ui-host.v1' -and @('UI_SPAWN','UI_ADOPTED') -contains $event) { $me2UiStarted = $true }
        if ($schema -eq 'metaengine.browser.me2.ui-gateway.v1' -and $event -eq 'GATEWAY_LIVE') { $me2GatewayLive = $true }
        if ($schema -eq 'metaengine.browser.me2.integration.v1' -and $event -eq 'DAEMON_MISSION_CONTROL_REMOVED' -and [string](Get-SoakProperty $row 'replacement') -eq 'NATIVE_BROWSER_FLEET_AND_SUPERVISOR' -and (Get-SoakProperty $row 'authority_effect') -eq $false) { $me2MissionControlRemoved = $true }
        if ($schema -eq 'metaengine.browser-local-shell.v2' -and $state -eq 'ME2_PRIMARY_SHELL_VISIBLE' -and [string](Get-SoakProperty $row 'shell_mode') -eq 'ME2_PRIMARY' -and (Get-SoakProperty $row 'deprecated_shell_bundle_present') -eq $false -and (Get-SoakProperty $row 'recovery_surface_authority') -eq $false -and (Get-SoakProperty $row 'authority_effect') -eq $false) { $me2PrimaryShellReady = $true }
        if ($schema -eq 'metaengine.browser.me2-r97-installed-ui.v1' -and $state -eq 'ME2_R97_UI_CONTRACT_CONFIRMED') { $me2R97UiConfirmed = $true }
        $fatal = Get-SoakMe2Failure $row
        if ($null -ne $fatal -and $null -eq $diagnostics.me2_failure) {
          $diagnostics.me2_failure = $fatal
          $me2Fatal = "$($fatal.schema)/$($fatal.event)"
        }
      }
    }
    $diagnostics.readiness = [ordered]@{ daemon=$me2DaemonReady; contract=$me2ContractOk; ui_started=$me2UiStarted; ui=$me2UiReady; gateway=$me2GatewayLive; mission_removed=$me2MissionControlRemoved; primary_shell=$me2PrimaryShellReady; r97_dom=$me2R97UiConfirmed }
    Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    if ($me2Fatal) { throw "soak_me2_runtime_degraded:$me2Fatal" }
    if ($me2UiStarted -and -not $me2UiReady) {
      $diagnostics.ui_http = Invoke-SoakUiProbe -Endpoint $uiHealthEndpoint
      $me2UiReady = $diagnostics.ui_http.outcome -eq 'READY'
      $diagnostics.readiness.ui = $me2UiReady
      Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    }
    if ($me2DaemonReady -and $me2ContractOk -and $me2UiReady -and $me2GatewayLive -and $me2MissionControlRemoved -and $me2PrimaryShellReady -and $me2R97UiConfirmed) { break }
    Start-Sleep -Milliseconds 200
  }
  if (-not ($me2DaemonReady -and $me2ContractOk -and $me2UiReady -and $me2GatewayLive -and $me2MissionControlRemoved -and $me2PrimaryShellReady -and $me2R97UiConfirmed)) {
    throw "soak_me2_runtime_not_settled:daemon=$me2DaemonReady,contract=$me2ContractOk,ui=$me2UiReady,gateway=$me2GatewayLive,mission_removed=$me2MissionControlRemoved,primary_shell=$me2PrimaryShellReady,r97_dom=$me2R97UiConfirmed"
  }

  Set-SoakPhase 'RESOURCE_BASELINE'
  $stableHandleSamples = 0
  $lastHandleSample = $null
  $plateauDeadline = [DateTime]::UtcNow.AddSeconds(12)
  while ([DateTime]::UtcNow -lt $plateauDeadline) {
    $normal.Refresh()
    if ($normal.HasExited) { throw "soak_normal_ui_exited_before_resource_plateau:$($normal.ExitCode)" }
    $sample = Get-Process -Id $normal.Id
    $count = [int64]$sample.HandleCount
    if ($null -ne $lastHandleSample -and [Math]::Abs($count - [int64]$lastHandleSample) -le 2) {
      $stableHandleSamples += 1
    } else {
      $stableHandleSamples = 0
    }
    $lastHandleSample = $count
    if ($stableHandleSamples -ge 4) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($stableHandleSamples -lt 4) { throw 'soak_me2_resource_baseline_not_stable' }

  $normal.Refresh()
  $primaryPid = [int64]$normal.Id
  $procBefore = Get-Process -Id $normal.Id
  $workingSetBefore = [int64]$procBefore.WorkingSet64
  $handlesBefore = [int64]$procBefore.HandleCount
  $launchIds = New-Object 'System.Collections.Generic.HashSet[string]'
  $activationSequences = New-Object 'System.Collections.Generic.HashSet[long]'
  $lastActivationSequence = [int64]$stable.sequence
  $activationLatencies = New-Object 'System.Collections.Generic.List[double]'
  $activationReceipts = New-Object 'System.Collections.Generic.List[object]'

  Set-SoakPhase 'SEQUENTIAL_ACTIVATIONS'
  for ($i = 1; $i -le $ActivationCount; $i++) {
    $secondOut = Join-Path $RunnerTemp "soak-secondary-$i.out"
    $secondErr = Join-Path $RunnerTemp "soak-secondary-$i.err"
    Remove-Item $secondOut,$secondErr -Force -ErrorAction SilentlyContinue
    Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    $activationStarted = [Diagnostics.Stopwatch]::StartNew()
    $second = Start-Process -FilePath $AppPath -PassThru -RedirectStandardOutput $secondOut -RedirectStandardError $secondErr
    $null = $second.Handle
    if (-not $second.WaitForExit(18000)) {
      try { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue } catch {}
      throw "soak_secondary_timeout:${i}"
    }
    if ($second.ExitCode -ne 0) { throw "soak_secondary_exit:${i}:$($second.ExitCode)" }
    # The latency SLO ends when the losing secondary exits successfully. At that
    # point it has already observed the exact durable activation ACK. Journal
    # parsing below is independent verification and must not inflate user-visible
    # activation latency with test-harness bookkeeping.
    $activationStarted.Stop()
    $activationElapsedMs = [double]$activationStarted.Elapsed.TotalMilliseconds
    $line = Get-Content $secondOut | Where-Object { $_.Trim() } | Select-Object -Last 1
    if (-not $line) { throw "soak_secondary_ack_missing:${i}" }
    $ack = $line | ConvertFrom-Json
    if (-not (Test-SoakActivationAck -Ack $ack -PrimaryPid $primaryPid)) {
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
    if (-not $activation -or $activation.details.visible -ne $true) { throw "soak_primary_activation_missing:${i}" }
    if ([int64]$activation.sequence -le $lastActivationSequence) { throw "soak_activation_sequence_not_monotonic:${i}" }
    if ([int64]$activation.sequence -ne [int64]$ack.event_sequence) { throw "soak_activation_ack_sequence_drift:${i}" }
    if (-not $activationSequences.Add([int64]$activation.sequence)) { throw "soak_activation_sequence_duplicate:${i}" }
    $activationLatencies.Add($activationElapsedMs)
    $lastActivationSequence = [int64]$activation.sequence
    $activationReceipts.Add([ordered]@{ kind='SEQUENTIAL'; index=$i; launch_id=[string]$ack.launch_id; event_sequence=[int64]$activation.sequence; primary_pid=$primaryPid; visible=$true })
    $diagnostics.verified_activation_count += 1
    Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    $normal.Refresh()
    if ($normal.HasExited) { throw "soak_primary_died_after_activation:${i}" }
  }

  Set-SoakPhase 'BURST_ACTIVATIONS'
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
      if (-not (Test-SoakActivationAck -Ack $ack -PrimaryPid $primaryPid)) {
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
      $activationReceipts.Add([ordered]@{ kind='BURST'; index=$row.Index; launch_id=[string]$row.Ack.launch_id; event_sequence=[int64]$activation.sequence; primary_pid=$primaryPid; visible=$true })
      $diagnostics.verified_activation_count += 1
      Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    }
  }

  # Keep the same ordinary primary instance alive after the activation burst.
  Set-SoakPhase 'POST_ACTIVATION_HOLD'
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

  Set-SoakPhase 'RESOURCE_BUDGETS'
  $procAfter = Get-Process -Id $normal.Id
  $latencySorted = @($activationLatencies | Sort-Object)
  $p95Index = [Math]::Max(0, [Math]::Min($latencySorted.Count - 1, [Math]::Ceiling($latencySorted.Count * 0.95) - 1))
  $p95Ms = if ($latencySorted.Count -gt 0) { [double]$latencySorted[$p95Index] } else { 0.0 }
  $workingSetAfter = [int64]$procAfter.WorkingSet64
  $handlesAfter = [int64]$procAfter.HandleCount
  $workingSetGrowth = [Math]::Max([int64]0, $workingSetAfter - $workingSetBefore)
  $handleGrowth = [Math]::Max([int64]0, $handlesAfter - $handlesBefore)
  $expectedActivationCount = $ActivationCount + $ConcurrentBurstSize

  # Persist all measured evidence before enforcing budgets so a failing artifact
  # still explains whether latency, memory or handles caused the red gate.
  $proof.normal_ui_boot_verified = $true
  $proof.second_instance_activations_verified = $launchIds.Count
  $proof | Add-Member -NotePropertyName activation_receipts -NotePropertyValue @($activationReceipts.ToArray()) -Force
  $proof | Add-Member -NotePropertyName primary_pid -NotePropertyValue $primaryPid -Force
  $proof | Add-Member -NotePropertyName startup_stable_sequence -NotePropertyValue ([int64]$stable.sequence) -Force
  $proof | Add-Member -NotePropertyName startup_resource_baseline_settled -NotePropertyValue $true -Force
  $proof | Add-Member -NotePropertyName startup_resource_baseline_subsystems -NotePropertyValue @($requiredStartupSubsystems) -Force
  $proof | Add-Member -NotePropertyName me2_runtime_baseline_settled -NotePropertyValue $true -Force
  $proof | Add-Member -NotePropertyName me2_daemon_ready -NotePropertyValue ([bool]$me2DaemonReady) -Force
  $proof | Add-Member -NotePropertyName me2_contract_ok -NotePropertyValue ([bool]$me2ContractOk) -Force
  $proof | Add-Member -NotePropertyName me2_ui_ready -NotePropertyValue ([bool]$me2UiReady) -Force
  $proof | Add-Member -NotePropertyName me2_gateway_live -NotePropertyValue ([bool]$me2GatewayLive) -Force
  $proof | Add-Member -NotePropertyName me2_mission_control_removed -NotePropertyValue ([bool]$me2MissionControlRemoved) -Force
  $proof | Add-Member -NotePropertyName me2_primary_shell_ready -NotePropertyValue ([bool]$me2PrimaryShellReady) -Force
  $proof | Add-Member -NotePropertyName me2_r97_dom_contract_verified -NotePropertyValue ([bool]$me2R97UiConfirmed) -Force
  $proof | Add-Member -NotePropertyName resource_baseline_after_r75_mount -NotePropertyValue $true -Force
  $proof | Add-Member -NotePropertyName resource_baseline_handle_plateau_samples -NotePropertyValue $stableHandleSamples -Force
  $proof | Add-Member -NotePropertyName startup_control_mode -NotePropertyValue ([string]$controlState.supervisor_mode) -Force
  $proof | Add-Member -NotePropertyName startup_control_armed -NotePropertyValue ([bool]$controlState.armed) -Force
  $proof | Add-Member -NotePropertyName startup_control_always_on_verified -NotePropertyValue $true -Force
  $safeGenesisGeneration = if ([string]$runtimeGenesis.generation -eq 'DEVOS_CLEAN_GENESIS_V2') { 'DEVOS_CLEAN_GENESIS_V2' } else { 'OTHER' }
  $proof | Add-Member -NotePropertyName runtime_genesis_generation -NotePropertyValue $safeGenesisGeneration -Force
  $proof | Add-Member -NotePropertyName runtime_genesis_initial_tabs -NotePropertyValue $requestedInitialTabs -Force
  $proof | Add-Member -NotePropertyName zero_topology_startup_verified -NotePropertyValue ([bool]$zeroTopologyStartup) -Force
  # Compatibility alias for older evidence consumers; it now means zero requested
  # startup topology and no longer means supervisor OFF/disarmed.
  $proof | Add-Member -NotePropertyName quiescent_startup_verified -NotePropertyValue ([bool]$zeroTopologyStartup) -Force
  $proof | Add-Member -NotePropertyName automatic_initial_tab_suppressed -NotePropertyValue ([bool]$zeroTopologyStartup) -Force
  $proof | Add-Member -NotePropertyName automatic_initial_remote_load_suppressed -NotePropertyValue ([bool]$zeroTopologyStartup) -Force
  $proof | Add-Member -NotePropertyName final_activation_sequence -NotePropertyValue $lastActivationSequence -Force
  $proof | Add-Member -NotePropertyName activation_latency_p95_ms -NotePropertyValue ([Math]::Round($p95Ms, 2)) -Force
  $proof | Add-Member -NotePropertyName activation_latency_p95_budget_ms -NotePropertyValue $ActivationP95BudgetMs -Force
  $proof | Add-Member -NotePropertyName activation_latency_measurement_boundary -NotePropertyValue 'SECONDARY_PROCESS_LAUNCH_TO_VALID_DURABLE_ACK_EXIT' -Force
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
  $proof | Add-Member -NotePropertyName resource_budget_evidence_captured -NotePropertyValue $true -Force
  $proof | ConvertTo-Json -Depth 6 | Set-Content $ProofPath -Encoding utf8
  Copy-Item $journal (Join-Path $RunnerTemp 'browser-startup-journal-soak.json') -Force

  if ($p95Ms -gt $ActivationP95BudgetMs) { throw "soak_activation_p95_budget_exceeded:$([Math]::Round($p95Ms,2))" }
  if ($workingSetGrowth -gt $MaxWorkingSetGrowthBytes) { throw "soak_working_set_growth_budget_exceeded:$workingSetGrowth" }
  if ($handleGrowth -gt $MaxHandleGrowth) { throw "soak_handle_growth_budget_exceeded:$handleGrowth" }
  if ($ConcurrentBurstSize -gt 0 -and $burstElapsedMs -gt 8000) { throw "soak_concurrent_burst_budget_exceeded:$([Math]::Round($burstElapsedMs,2))" }
  if ($proof.second_instance_activations_verified -ne $expectedActivationCount) { throw 'soak_activation_count_mismatch' }
  Write-Host ($proof | ConvertTo-Json -Compress)
  $soakPassed = $true
} catch {
  $primaryFailure = $_
  Set-SoakDiagnosticFailure -Diagnostics $diagnostics -Failure $primaryFailure
  Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $diagnosticProcess -Clock $diagnosticClock
  # Diagnostic-only readback. Never change the existing fatal soak result or
  # serialize raw Owner/userData fields into a public CI artifact.
  $failureCode = 'SOAK_OTHER_FAILURE'
  if ($_.Exception.Message -eq 'soak_normal_ui_not_stable_visible') {
    $failureCode = 'SOAK_NORMAL_UI_NOT_STABLE_VISIBLE'
  } elseif ($_.Exception.Message -eq 'soak_runtime_import_failed') {
    $failureCode = 'SOAK_RUNTIME_IMPORT_FAILED'
  }
  try {
    $readback = Join-Path $RunnerTemp 'soak-normal-ui-readback.json'
    & node (Join-Path $PSScriptRoot 'qa-soak-startup-readback.mjs') $journal $readback $failureCode $normalErr | Out-Null
  } catch {}
  throw
} finally {
  Invoke-SoakCleanup -PrimaryFailure $primaryFailure -Passed $soakPassed -Diagnostics $diagnostics -Path $diagnosticPath -Process $diagnosticProcess -Clock $diagnosticClock -Cleanup {
  if ($normal -and -not $normal.HasExited) {
    # The Owner runtime owns API/Edge children. Forced termination of only the
    # Browser can leave those children and its durable incarnation lock alive.
    $shutdown = Start-Process -FilePath $AppPath -ArgumentList '--metaengine-installer-shutdown' -WindowStyle Hidden -PassThru
    $null = $shutdown.Handle
    Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    if (-not $shutdown.WaitForExit(50000)) { throw 'soak_shutdown_signal_timeout' }
    if ($shutdown.ExitCode -ne 0) { throw 'soak_shutdown_signal_failed' }
    Write-SoakDiagnosticCheckpoint -Diagnostics $diagnostics -Path $diagnosticPath -Process $normal -Clock $diagnosticClock
    if (-not $normal.WaitForExit(60000)) { throw 'soak_shutdown_primary_timeout' }
  }
  if ($normal) {
    $normal.Refresh()
    if (-not $normal.HasExited -or $normal.ExitCode -ne 0) { throw 'soak_primary_cleanup_unconfirmed' }
  }
  if ($soakPassed) {
    $proof | Add-Member -NotePropertyName process_cleanup_confirmed -NotePropertyValue $true -Force
    $proof | ConvertTo-Json -Depth 6 | Set-Content $ProofPath -Encoding utf8
  }
  }
}
