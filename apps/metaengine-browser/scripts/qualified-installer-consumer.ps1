param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Acquire', 'Verify', 'Wait')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedHead,

  [string]$WorkRoot,
  [string]$ConfigPath,
  [string]$BindingPath,
  [string]$ProofPath,
  [int]$TimeoutMinutes = 45,
  [int]$AcquireIntervalSeconds = 30,
  [int]$WaitIntervalSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ExpectedHead -notmatch '^[0-9a-fA-F]{40}$') {
  throw 'qualified_installer_expected_head_invalid'
}
$ExpectedHead = $ExpectedHead.ToLowerInvariant()
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$provenanceScript = Join-Path $scriptDir 'installer-provenance.mjs'
if (-not (Test-Path $provenanceScript -PathType Leaf)) {
  throw 'qualified_installer_provenance_script_missing'
}

function Read-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$MissingCode
  )
  if (-not (Test-Path $Path -PathType Leaf)) { throw $MissingCode }
  try {
    return Get-Content $Path -Raw | ConvertFrom-Json
  } catch {
    throw ($MissingCode + ':invalid_json')
  }
}

if ($Mode -eq 'Acquire') {
  if (-not $WorkRoot) { throw 'qualified_installer_work_root_missing' }
  if (-not $ConfigPath) { throw 'qualified_installer_config_path_missing' }
  if (-not (Test-Path $ConfigPath -PathType Leaf)) { throw 'qualified_installer_config_missing' }

  $WorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
  New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
  if (-not $BindingPath) { $BindingPath = Join-Path $WorkRoot 'consumer-binding.json' }
  $BindingPath = [System.IO.Path]::GetFullPath($BindingPath)

  $artifactName = "metaengine-browser-windows-candidate-$ExpectedHead"
  $acquireArgs = @(
    $provenanceScript, 'acquire',
    '--head', $ExpectedHead,
    '--workflow', 'browser-windows-package-smoke.yml',
    '--artifact', $artifactName,
    '--out', $WorkRoot,
    '--timeout-min', [string]$TimeoutMinutes,
    '--interval-sec', [string]$AcquireIntervalSeconds,
    '--absent-grace-min', '10',
    '--allow-in-progress', 'true'
  )
  & node @acquireArgs
  if ($LASTEXITCODE -ne 0) { throw 'qualified_installer_acquire_failed' }

  $resolvedPath = Join-Path $WorkRoot 'resolved.json'
  $resolved = Read-JsonFile -Path $resolvedPath -MissingCode 'qualified_installer_resolved_missing'
  $resolvedInvalid = (
    $resolved.schema -ne 'metaengine.browser.installer-run-resolved.v1' -or
    [string]$resolved.head_sha -ne $ExpectedHead -or
    [int64]$resolved.run_id -le 0 -or
    [int64]$resolved.run_number -le 0 -or
    [int64]$resolved.run_attempt -le 0
  )
  if ($resolvedInvalid) { throw 'qualified_installer_resolved_binding_invalid' }

  $archivePath = Join-Path $WorkRoot 'artifact.zip'
  if (-not (Test-Path $archivePath -PathType Leaf)) { throw 'qualified_installer_archive_missing' }
  $payloadPath = Join-Path $WorkRoot 'payload'
  Remove-Item $payloadPath -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $archivePath -DestinationPath $payloadPath -Force

  $verifyArgs = @(
    $provenanceScript, 'verify',
    '--dir', $payloadPath,
    '--expect-head', $ExpectedHead,
    '--expect-run-id', [string]$resolved.run_id,
    '--expect-run-number', [string]$resolved.run_number,
    '--expect-run-attempt', [string]$resolved.run_attempt,
    '--expect-workflow', 'browser-windows-package-smoke.yml',
    '--config', $ConfigPath
  )
  & node @verifyArgs
  if ($LASTEXITCODE -ne 0) { throw 'qualified_installer_verify_failed' }

  $acquiredPath = Join-Path $payloadPath 'acquired.json'
  $acquired = Read-JsonFile -Path $acquiredPath -MissingCode 'qualified_installer_acquired_missing'
  $acquiredInvalid = (
    $acquired.schema -ne 'metaengine.browser.installer-provenance-acquired.v1' -or
    [string]$acquired.source_head -ne $ExpectedHead -or
    [string]$acquired.provenance_run_id -ne [string]$resolved.run_id -or
    [int64]$acquired.provenance_run_number -ne [int64]$resolved.run_number -or
    [int64]$acquired.provenance_run_attempt -ne [int64]$resolved.run_attempt -or
    [string]$acquired.provenance_workflow -ne 'browser-windows-package-smoke.yml' -or
    [string]$acquired.provenance_schema -ne 'metaengine.browser.installer-provenance.v2' -or
    [string]$acquired.build_identity_sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$acquired.dependency_resolution_sha256 -notmatch '^[a-f0-9]{64}$' -or
    $acquired.build_identity_verified -ne $true -or
    $acquired.dependency_resolution_verified -ne $true -or
    $acquired.blockmap_verified -ne $true -or
    $acquired.config_verified -ne $true
  )
  if ($acquiredInvalid) { throw 'qualified_installer_acquired_binding_invalid' }
  if (-not (Test-Path ([string]$acquired.installer_path) -PathType Leaf)) {
    throw 'qualified_installer_payload_missing'
  }

  $binding = [ordered]@{
    schema = 'metaengine.browser.qualified-installer-consumer-binding.v1'
    source_head = $ExpectedHead
    artifact_name = $artifactName
    installer_path = [string]$acquired.installer_path
    installer_name = [string]$acquired.installer_name
    installer_sha256 = [string]$acquired.installer_sha256
    producer_run_id = [int64]$resolved.run_id
    producer_run_number = [int64]$resolved.run_number
    producer_run_attempt = [int64]$resolved.run_attempt
    producer_completed_at_acquire = [bool]$resolved.producer_completed
    provenance_path = [string]$acquired.provenance_path
    provenance_schema = [string]$acquired.provenance_schema
    build_identity_sha256 = [string]$acquired.build_identity_sha256
    dependency_resolution_sha256 = [string]$acquired.dependency_resolution_sha256
    build_identity_verified = [bool]$acquired.build_identity_verified
    dependency_resolution_verified = [bool]$acquired.dependency_resolution_verified
    blockmap_verified = [bool]$acquired.blockmap_verified
    config_verified = [bool]$acquired.config_verified
    authority_effect = $false
  }
  $binding | ConvertTo-Json -Depth 6 | Set-Content $BindingPath -Encoding utf8
  Write-Output ($binding | ConvertTo-Json -Compress -Depth 6)
  return
}

if (-not $BindingPath) { throw 'qualified_installer_binding_path_missing' }
$binding = Read-JsonFile -Path $BindingPath -MissingCode 'qualified_installer_binding_missing'
if ($binding.schema -ne 'metaengine.browser.qualified-installer-consumer-binding.v1' -or
    [string]$binding.source_head -ne $ExpectedHead -or
    [int64]$binding.producer_run_id -le 0 -or
    [int64]$binding.producer_run_number -le 0 -or
    [int64]$binding.producer_run_attempt -le 0 -or
    [string]$binding.provenance_schema -ne 'metaengine.browser.installer-provenance.v2' -or
    [string]$binding.build_identity_sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$binding.dependency_resolution_sha256 -notmatch '^[a-f0-9]{64}$' -or
    $binding.build_identity_verified -ne $true -or
    $binding.dependency_resolution_verified -ne $true) {
  throw 'qualified_installer_binding_invalid'
}

if ($Mode -eq 'Verify') {
  if (-not $ConfigPath) { throw 'qualified_installer_config_path_missing' }
  $payloadPath = Split-Path -Parent ([string]$binding.installer_path)
  & node $provenanceScript 'verify' '--dir' $payloadPath `
    '--expect-head' $ExpectedHead `
    '--expect-run-id' ([string]$binding.producer_run_id) `
    '--expect-run-number' ([string]$binding.producer_run_number) `
    '--expect-run-attempt' ([string]$binding.producer_run_attempt) `
    '--expect-workflow' 'browser-windows-package-smoke.yml' `
    '--config' $ConfigPath
  if ($LASTEXITCODE -ne 0) { throw 'qualified_installer_reverify_failed' }
  $acquired = Read-JsonFile -Path (Join-Path $payloadPath 'acquired.json') -MissingCode 'qualified_installer_acquired_missing'
  if ([string]$acquired.installer_sha256 -ne [string]$binding.installer_sha256 -or
      [string]$acquired.installer_path -ne [string]$binding.installer_path -or
      [string]$acquired.provenance_path -ne [string]$binding.provenance_path -or
      [string]$acquired.build_identity_sha256 -ne [string]$binding.build_identity_sha256 -or
      [string]$acquired.dependency_resolution_sha256 -ne [string]$binding.dependency_resolution_sha256 -or
      $acquired.build_identity_verified -ne $true -or $acquired.dependency_resolution_verified -ne $true -or
      $acquired.blockmap_verified -ne $true -or $acquired.config_verified -ne $true) {
    throw 'qualified_installer_reverify_binding_drift'
  }
  return
}

if (-not $ProofPath) { throw 'qualified_installer_proof_path_missing' }
$proof = Read-JsonFile -Path $ProofPath -MissingCode 'qualified_installer_proof_missing'

$terminalBindingInvalid = (
  $binding.schema -ne 'metaengine.browser.qualified-installer-consumer-binding.v1' -or
  [string]$binding.source_head -ne $ExpectedHead -or
  [int64]$binding.producer_run_id -le 0 -or
  [int64]$binding.producer_run_number -le 0 -or
  [int64]$binding.producer_run_attempt -le 0 -or
  [string]$proof.source_head -ne $ExpectedHead -or
  [int64]$proof.producer_run_id -ne [int64]$binding.producer_run_id -or
  [int64]$proof.producer_run_number -ne [int64]$binding.producer_run_number -or
  [int64]$proof.producer_run_attempt -ne [int64]$binding.producer_run_attempt
)
if ($terminalBindingInvalid) { throw 'qualified_installer_terminal_binding_drift' }

$waitArgs = @(
  $provenanceScript, 'wait',
  '--head', $ExpectedHead,
  '--workflow', 'browser-windows-package-smoke.yml',
  '--run-id', [string]$binding.producer_run_id,
  '--run-number', [string]$binding.producer_run_number,
  '--run-attempt', [string]$binding.producer_run_attempt,
  '--timeout-min', [string]$TimeoutMinutes,
  '--interval-sec', [string]$WaitIntervalSeconds
)
& node @waitArgs
if ($LASTEXITCODE -ne 0) { throw 'qualified_installer_producer_not_qualified' }

$proof | Add-Member -NotePropertyName producer_terminal_success -NotePropertyValue $true -Force
$proof | Add-Member -NotePropertyName producer_terminal_qualified_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
$proof | ConvertTo-Json -Depth 12 | Set-Content $ProofPath -Encoding utf8

$result = [ordered]@{
  schema = 'metaengine.browser.qualified-installer-producer-gate.v1'
  source_head = $ExpectedHead
  producer_run_id = [int64]$binding.producer_run_id
  producer_run_number = [int64]$binding.producer_run_number
  producer_run_attempt = [int64]$binding.producer_run_attempt
  producer_terminal_success = $true
  authority_effect = $false
}
Write-Output ($result | ConvertTo-Json -Compress -Depth 5)
