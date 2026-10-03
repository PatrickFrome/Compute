param(
  [string]$OutputDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'native-dist\guardian')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceDir = Join-Path $root 'native\browser-guardian-scm'
$serviceSource = Join-Path $sourceDir 'browser-guardian-scm-service.cpp'
$actuatorSource = Join-Path $sourceDir 'browser-guardian-update-actuator.cpp'
$ownerObserverSource = Join-Path $sourceDir 'browser-guardian-owner-enrollment-observer.cpp'
$ownerStoreSource = Join-Path $sourceDir 'browser-guardian-owner-enrollment-store.cpp'
$ownerReconcilerSource = Join-Path $sourceDir 'browser-guardian-owner-enrollment-reconciler.cpp'
$ticketClientSource = Join-Path $sourceDir 'browser-guardian-enrollment-ticket-client.cpp'
$pipeClientSource = Join-Path $sourceDir 'browser-guardian-pipe-client.cpp'
$configuratorSource = Join-Path $sourceDir 'browser-guardian-scm-configure.cpp'
foreach ($path in @($serviceSource,$actuatorSource,$ownerObserverSource,$ownerStoreSource,$ownerReconcilerSource,$ticketClientSource,$pipeClientSource,$configuratorSource)) {
  if (-not (Test-Path $path -PathType Leaf)) { throw "guardian_native_source_missing:$path" }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'vswhere_missing' }
$vsRoot = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vsRoot) { throw 'visual_studio_cpp_toolchain_missing' }
$vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw 'vcvars64_missing' }

$resolvedOut = [System.IO.Path]::GetFullPath($OutputDir)
Remove-Item $resolvedOut -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $resolvedOut -Force | Out-Null

$service = Join-Path $resolvedOut 'METAENGINEBrowserGuardian.exe'
$pipeClient = Join-Path $resolvedOut 'METAENGINEBrowserGuardianPipeClient.exe'
$configurator = Join-Path $resolvedOut 'METAENGINEBrowserGuardianConfigure.exe'
$serviceCmd = 'call "{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE "{1}" "{2}" "{3}" "{4}" "{5}" "{6}" /Fe:"{7}" /link advapi32.lib bcrypt.lib shell32.lib ole32.lib userenv.lib wtsapi32.lib winhttp.lib' -f $vcvars,$serviceSource,$actuatorSource,$ownerObserverSource,$ownerStoreSource,$ownerReconcilerSource,$ticketClientSource,$service
& $env:ComSpec /d /s /c $serviceCmd
if ($LASTEXITCODE -ne 0) { throw "guardian_service_compile_exit_$LASTEXITCODE" }
$pipeClientCmd = 'call "{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE "{1}" /Fe:"{2}"' -f $vcvars,$pipeClientSource,$pipeClient
& $env:ComSpec /d /s /c $pipeClientCmd
if ($LASTEXITCODE -ne 0) { throw "guardian_pipe_client_compile_exit_$LASTEXITCODE" }
$configCmd = 'call "{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE "{1}" /Fe:"{2}" /link advapi32.lib shell32.lib ole32.lib' -f $vcvars,$configuratorSource,$configurator
& $env:ComSpec /d /s /c $configCmd
if ($LASTEXITCODE -ne 0) { throw "guardian_configurator_compile_exit_$LASTEXITCODE" }

$pipeClientContractRaw = (& $pipeClient --contract-json | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "guardian_pipe_client_contract_exit_$LASTEXITCODE" }
$pipeClientContract = $pipeClientContractRaw | ConvertFrom-Json
$pipeClientContractValid = @(
  $pipeClientContract.schema -eq 'metaengine.browser-guardian.pipe-client.v1'
  [int64]$pipeClientContract.exact_access_mask -eq 1048963
  $pipeClientContract.generic_read_requested -eq $false
  $pipeClientContract.generic_write_requested -eq $false
  $pipeClientContract.client_create_pipe_instance_allowed -eq $false
  $pipeClientContract.caller_supplied_pipe_allowed -eq $false
  $pipeClientContract.caller_supplied_shell_allowed -eq $false
  $pipeClientContract.automatic_retry_allowed -eq $false
  $pipeClientContract.authority_effect -eq $false
) -notcontains $false
if (-not $pipeClientContractValid) { throw 'guardian_pipe_client_contract_invalid' }

$actuatorContractRaw = (& $service --update-actuator-contract-json | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "guardian_update_actuator_contract_exit_$LASTEXITCODE" }
$actuatorContract = $actuatorContractRaw | ConvertFrom-Json
if ($actuatorContract.schema -ne 'metaengine.browser-guardian.update-actuator.v1' `
    -or $actuatorContract.native_write_ahead_effect_barrier -ne $true `
    -or $actuatorContract.at_most_one_dispatch_per_effect_id -ne $true `
    -or $actuatorContract.first_binding_requires_server_admin_ticket -ne $true `
    -or $actuatorContract.ticket_single_use_server_revalidation_required -ne $true `
    -or $actuatorContract.owner_sid_from_impersonated_token_only -ne $true `
    -or $actuatorContract.owner_enrollment_create_if_absent_cas -ne $true `
    -or $actuatorContract.owner_enrollment_ambiguous_retry_allowed -ne $false `
    -or $actuatorContract.caller_supplied_path_allowed -ne $false `
    -or $actuatorContract.caller_supplied_url_allowed -ne $false `
    -or $actuatorContract.caller_supplied_shell_allowed -ne $false `
    -or $actuatorContract.automatic_retry_allowed -ne $false) {
  throw 'guardian_update_actuator_contract_invalid'
}
$actuatorSelfTestRaw = (& $service --update-actuator-self-test | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "guardian_update_actuator_self_test_exit_$LASTEXITCODE" }
$actuatorSelfTest = $actuatorSelfTestRaw | ConvertFrom-Json
if ($actuatorSelfTest.schema -ne 'metaengine.browser-guardian.update-actuator-self-test.v1' -or $actuatorSelfTest.ok -ne $true) {
  throw 'guardian_update_actuator_self_test_invalid'
}

$sourceHead = (git -C $root rev-parse HEAD).Trim()
if ($sourceHead -notmatch '^[0-9a-f]{40}$') { throw "guardian_staging_source_head_invalid:$sourceHead" }
$packageJsonPath = Join-Path $root 'package.json'
if (-not (Test-Path $packageJsonPath -PathType Leaf)) { throw 'guardian_staging_package_json_missing' }
$packageVersion = [string]((Get-Content $packageJsonPath -Raw | ConvertFrom-Json).version)
if (-not $packageVersion) { throw 'guardian_staging_package_version_missing' }

$binaries = @()
foreach ($item in @(
  @{ path=$service; role='scm_service_host_with_bounded_update_actuator'; activationTool=$false },
  @{ path=$configurator; role='scm_secure_configurator'; activationTool=$true }
)) {
  if (-not (Test-Path $item.path -PathType Leaf)) { throw "guardian_native_binary_missing:$($item.path)" }
  $file = Get-Item $item.path
  $sha = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -notmatch '^[0-9a-f]{64}$') { throw "guardian_native_binary_digest_invalid:$($file.Name)" }
  $binaries += [ordered]@{
    name = $file.Name
    role = $item.role
    sha256 = $sha
    size = [int64]$file.Length
    staged_only = $true
    activation_tool = [bool]$item.activationTool
  }
}

$pipeClientFile = Get-Item $pipeClient
$pipeClientSha = (Get-FileHash $pipeClientFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($pipeClientSha -notmatch '^[0-9a-f]{64}
  schema = 'metaengine.browser.guardian-native-staging-manifest.v1'
  version = '1.1.0'
  source_head = $sourceHead
  package_version = $packageVersion
  staging_root = 'resources/guardian-native'
  staging_only = $true
  service_activation_authorized = $false
  service_installation_authorized = $false
  service_start_authorized = $false
  user_writable_service_activation_forbidden = $true
  requires_machine_secure_copy = $true
  required_machine_root = '%ProgramFiles%\METAENGINE\Guardian'
  exact_service_binary_name = 'METAENGINEBrowserGuardian.exe'
  bounded_update_actuator_embedded = $true
  update_actuator_schema = [string]$actuatorContract.schema
  update_actuator_native_write_ahead_effect_barrier = $true
  update_actuator_at_most_one_dispatch_per_effect_id = $true
  update_actuator_enrolled_device_challenge_required = $true
  update_actuator_first_binding_requires_server_admin_ticket = $true
  update_actuator_ticket_single_use_server_revalidation_required = $true
  update_actuator_owner_sid_from_impersonated_token_only = $true
  update_actuator_owner_enrollment_create_if_absent_cas = $true
  update_actuator_owner_enrollment_ambiguous_retry_allowed = $false
  update_actuator_caller_supplied_path_allowed = $false
  update_actuator_caller_supplied_url_allowed = $false
  update_actuator_caller_supplied_shell_allowed = $false
  update_actuator_self_test_passed = $true
  browser_pipe_client = [ordered]@{
    name = $pipeClientFile.Name
    role = 'fixed_exact_rights_user_session_pipe_client'
    sha256 = $pipeClientSha
    size = [int64]$pipeClientFile.Length
    staged_user_session_only = $true
    machine_secure_copy_required = $false
    fixed_pipe_name = [string]$pipeClientContract.fixed_pipe
    exact_access_mask = [int64]$pipeClientContract.exact_access_mask
    generic_read_requested = $false
    generic_write_requested = $false
    client_create_pipe_instance_allowed = $false
    caller_supplied_pipe_allowed = $false
    caller_supplied_shell_allowed = $false
    automatic_retry_allowed = $false
    authority_effect = $false
  }
  binaries = $binaries
  automatic_retry_allowed = $false
  browser_authority = $false
  task_authority = $false
  scheduler_authority = $false
  page_model_text_authority = $false
  release_authority = $false
  authority_effect = $false
}
$manifestPath = Join-Path $resolvedOut 'guardian-native-manifest.json'
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 6) + "`n"), [System.Text.UTF8Encoding]::new($false))

$readback = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($readback.schema -ne 'metaengine.browser.guardian-native-staging-manifest.v1' -or $readback.staging_only -ne $true) { throw 'guardian_staging_manifest_readback_invalid' }
if ($readback.service_activation_authorized -ne $false -or $readback.requires_machine_secure_copy -ne $true) { throw 'guardian_staging_authority_readback_invalid' }
if ($readback.bounded_update_actuator_embedded -ne $true -or $readback.update_actuator_self_test_passed -ne $true) { throw 'guardian_update_actuator_manifest_readback_invalid' }
$pipeClientReadbackValid = @(
  [string]$readback.browser_pipe_client.name -eq 'METAENGINEBrowserGuardianPipeClient.exe'
  [string]$readback.browser_pipe_client.sha256 -eq $pipeClientSha
  [int64]$readback.browser_pipe_client.size -eq [int64]$pipeClientFile.Length
  [int64]$readback.browser_pipe_client.exact_access_mask -eq 1048963
  $readback.browser_pipe_client.client_create_pipe_instance_allowed -eq $false
  $readback.browser_pipe_client.caller_supplied_pipe_allowed -eq $false
  $readback.browser_pipe_client.authority_effect -eq $false
) -notcontains $false
if (-not $pipeClientReadbackValid) { throw 'guardian_pipe_client_manifest_readback_invalid' }
if (@($readback.binaries).Count -ne 2) { throw 'guardian_staging_binary_cardinality_invalid' }
foreach ($row in @($readback.binaries)) {
  $binary = Join-Path $resolvedOut ([string]$row.name)
  if ((Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$row.sha256) { throw "guardian_staging_binary_readback_mismatch:$($row.name)" }
}
Write-Host ($readback | ConvertTo-Json -Depth 6 -Compress)
) { throw 'guardian_pipe_client_digest_invalid' }

$manifest = [ordered]@{
  schema = 'metaengine.browser.guardian-native-staging-manifest.v1'
  version = '1.1.0'
  source_head = $sourceHead
  package_version = $packageVersion
  staging_root = 'resources/guardian-native'
  staging_only = $true
  service_activation_authorized = $false
  service_installation_authorized = $false
  service_start_authorized = $false
  user_writable_service_activation_forbidden = $true
  requires_machine_secure_copy = $true
  required_machine_root = '%ProgramFiles%\METAENGINE\Guardian'
  exact_service_binary_name = 'METAENGINEBrowserGuardian.exe'
  bounded_update_actuator_embedded = $true
  update_actuator_schema = [string]$actuatorContract.schema
  update_actuator_native_write_ahead_effect_barrier = $true
  update_actuator_at_most_one_dispatch_per_effect_id = $true
  update_actuator_enrolled_device_challenge_required = $true
  update_actuator_first_binding_requires_server_admin_ticket = $true
  update_actuator_ticket_single_use_server_revalidation_required = $true
  update_actuator_owner_sid_from_impersonated_token_only = $true
  update_actuator_owner_enrollment_create_if_absent_cas = $true
  update_actuator_owner_enrollment_ambiguous_retry_allowed = $false
  update_actuator_caller_supplied_path_allowed = $false
  update_actuator_caller_supplied_url_allowed = $false
  update_actuator_caller_supplied_shell_allowed = $false
  update_actuator_self_test_passed = $true
  binaries = $binaries
  automatic_retry_allowed = $false
  browser_authority = $false
  task_authority = $false
  scheduler_authority = $false
  page_model_text_authority = $false
  release_authority = $false
  authority_effect = $false
}
$manifestPath = Join-Path $resolvedOut 'guardian-native-manifest.json'
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 6) + "`n"), [System.Text.UTF8Encoding]::new($false))

$readback = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($readback.schema -ne 'metaengine.browser.guardian-native-staging-manifest.v1' -or $readback.staging_only -ne $true) { throw 'guardian_staging_manifest_readback_invalid' }
if ($readback.service_activation_authorized -ne $false -or $readback.requires_machine_secure_copy -ne $true) { throw 'guardian_staging_authority_readback_invalid' }
if ($readback.bounded_update_actuator_embedded -ne $true -or $readback.update_actuator_self_test_passed -ne $true) { throw 'guardian_update_actuator_manifest_readback_invalid' }
if (@($readback.binaries).Count -ne 2) { throw 'guardian_staging_binary_cardinality_invalid' }
foreach ($row in @($readback.binaries)) {
  $binary = Join-Path $resolvedOut ([string]$row.name)
  if ((Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$row.sha256) { throw "guardian_staging_binary_readback_mismatch:$($row.name)" }
}
Write-Host ($readback | ConvertTo-Json -Depth 6 -Compress)
