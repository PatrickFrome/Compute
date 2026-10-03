param(
  [Parameter(Mandatory=$true)][string]$ExpectedSourceHead,
  [string]$ExpectedPackageVersion = '',
  [string]$EvidenceDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ExpectedSourceHead -notmatch '^[0-9a-f]{40}$') { throw "guardian_expected_source_head_invalid:$ExpectedSourceHead" }
if (Get-Service -Name 'METAENGINEBrowserGuardian' -ErrorAction SilentlyContinue) {
  throw 'guardian_service_must_not_be_activated_by_per_user_browser_update'
}

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test'
$staging = Join-Path $installRoot 'resources\guardian-native'
$manifestPath = Join-Path $staging 'guardian-native-manifest.json'
if (-not (Test-Path $manifestPath -PathType Leaf)) { throw 'installed_guardian_staging_manifest_missing' }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne 'metaengine.browser.guardian-native-staging-manifest.v1') { throw 'installed_guardian_staging_manifest_schema_invalid' }
if ([string]$manifest.source_head -ne $ExpectedSourceHead) { throw "installed_guardian_source_head_mismatch:$($manifest.source_head):$ExpectedSourceHead" }
if ($ExpectedPackageVersion -and [string]$manifest.package_version -ne $ExpectedPackageVersion) {
  throw "installed_guardian_package_version_mismatch:$($manifest.package_version):$ExpectedPackageVersion"
}
$authorityBoundaryValid = @(
  $manifest.staging_only -eq $true
  $manifest.service_activation_authorized -eq $false
  $manifest.service_installation_authorized -eq $false
  $manifest.service_start_authorized -eq $false
  $manifest.user_writable_service_activation_forbidden -eq $true
  $manifest.requires_machine_secure_copy -eq $true
  $manifest.authority_effect -eq $false
) -notcontains $false
if (-not $authorityBoundaryValid) { throw 'installed_guardian_staging_authority_invalid' }
if ([string]$manifest.required_machine_root -ne '%ProgramFiles%\METAENGINE\Guardian') { throw 'installed_guardian_machine_root_contract_drift' }
if ([string]$manifest.exact_service_binary_name -ne 'METAENGINEBrowserGuardian.exe') { throw 'installed_guardian_service_name_contract_drift' }
$pipeClientMeta = $manifest.browser_pipe_client
$pipeClientMetaValid = @(
  [string]$pipeClientMeta.name -eq 'METAENGINEBrowserGuardianPipeClient.exe'
  [string]$pipeClientMeta.role -eq 'fixed_exact_rights_user_session_pipe_client'
  [string]$pipeClientMeta.sha256 -match '^[0-9a-f]{64}

$binaryProof = @()
$verifiedBinaries = @{}
foreach ($row in @($manifest.binaries)) {
  $name = [string]$row.name
  if ($name -notin @('METAENGINEBrowserGuardian.exe','METAENGINEBrowserGuardianConfigure.exe')) { throw "installed_guardian_binary_name_untrusted:$name" }
  $binary = Join-Path $staging $name
  if (-not (Test-Path $binary -PathType Leaf)) { throw "installed_guardian_binary_missing:$name" }
  $actual = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne [string]$row.sha256) { throw "installed_guardian_binary_digest_mismatch:$name" }
  if ([int64](Get-Item $binary).Length -ne [int64]$row.size) { throw "installed_guardian_binary_size_mismatch:$name" }
  $verifiedBinaries[$name] = [ordered]@{ path=$binary; sha256=$actual; size=[int64]$row.size }
  $binaryProof += [ordered]@{name=$name;sha256=$actual;size=[int64]$row.size}
}
$manifestSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($EvidenceDir) {
  $evidence = [System.IO.Path]::GetFullPath($EvidenceDir)
  New-Item -ItemType Directory -Force -Path $evidence | Out-Null
  Copy-Item $manifestPath (Join-Path $evidence 'guardian-native-staging-manifest.json') -Force
  foreach ($name in @('METAENGINEBrowserGuardian.exe','METAENGINEBrowserGuardianConfigure.exe')) {
    $source = [string]$verifiedBinaries[$name].path
    $destination = Join-Path $evidence $name
    Copy-Item $source $destination -Force
    $evidenceSha = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($evidenceSha -ne [string]$verifiedBinaries[$name].sha256) { throw "guardian_release_asset_digest_mismatch:$name" }
    if ([int64](Get-Item $destination).Length -ne [int64]$verifiedBinaries[$name].size) { throw "guardian_release_asset_size_mismatch:$name" }
  }

  $verifiedPath = Join-Path $evidence 'verified-self-update-manifest.json'
  if (-not (Test-Path $verifiedPath -PathType Leaf)) { throw 'verified_self_update_manifest_missing_for_guardian_extension' }
  $verified = Get-Content $verifiedPath -Raw | ConvertFrom-Json
  $verifiedVersion = [string]$verified.version
  if (-not $verifiedVersion) { throw 'verified_self_update_version_missing_for_guardian_binding' }
  if ([string]$manifest.package_version -ne $verifiedVersion) {
    throw "guardian_staging_verified_target_version_mismatch:$($manifest.package_version):$verifiedVersion"
  }
  if ($ExpectedPackageVersion -and $ExpectedPackageVersion -ne $verifiedVersion) {
    throw "guardian_expected_package_version_evidence_drift:${ExpectedPackageVersion}:$verifiedVersion"
  }
  $verified | Add-Member -NotePropertyName guardian_native_staging_present -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_staging_verified -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_no_activation -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_requires_machine_secure_copy -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_manifest_sha256 -NotePropertyValue $manifestSha -Force
  $verified | Add-Member -NotePropertyName guardian_native_package_version -NotePropertyValue ([string]$manifest.package_version) -Force
  $verified | Add-Member -NotePropertyName guardian_native_release_assets_verified -NotePropertyValue $true -Force
  [System.IO.File]::WriteAllText($verifiedPath, (($verified | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
}

$proof = [ordered]@{
  schema = 'metaengine.browser.guardian-native-installed-staging-proof.v1'
  source_head = $ExpectedSourceHead
  package_version = [string]$manifest.package_version
  staging_path = $staging
  manifest_sha256 = $manifestSha
  binaries = $binaryProof
  browser_pipe_client = [ordered]@{
    name = [string]$pipeClientMeta.name
    sha256 = $pipeClientSha
    size = [int64]$pipeClientMeta.size
    exact_access_mask = [int64]$pipeClientMeta.exact_access_mask
    client_create_pipe_instance_allowed = $false
    caller_supplied_pipe_allowed = $false
    authority_effect = $false
  }
  guardian_service_absent = $true
  staging_only = $true
  release_assets_verified = [bool]$EvidenceDir
  requires_machine_secure_copy = $true
  service_activation_authorized = $false
  automatic_retry_allowed = $false
  authority_effect = $false
}
# Machine-readable contract: emit the final JSON object on PowerShell's success
# stream so callers may capture/parse it. Write-Host is intentionally forbidden
# here because host/information output is not a reliable pipeline return value.
Write-Output ($proof | ConvertTo-Json -Depth 6 -Compress)

  [int64]$pipeClientMeta.size -gt 0
  [int64]$pipeClientMeta.exact_access_mask -eq 1048963
  $pipeClientMeta.staged_user_session_only -eq $true
  $pipeClientMeta.machine_secure_copy_required -eq $false
  $pipeClientMeta.generic_read_requested -eq $false
  $pipeClientMeta.generic_write_requested -eq $false
  $pipeClientMeta.client_create_pipe_instance_allowed -eq $false
  $pipeClientMeta.caller_supplied_pipe_allowed -eq $false
  $pipeClientMeta.caller_supplied_shell_allowed -eq $false
  $pipeClientMeta.automatic_retry_allowed -eq $false
  $pipeClientMeta.authority_effect -eq $false
) -notcontains $false
if (-not $pipeClientMetaValid) { throw 'installed_guardian_pipe_client_contract_invalid' }
$pipeClientPath = Join-Path $staging ([string]$pipeClientMeta.name)
if (-not (Test-Path $pipeClientPath -PathType Leaf)) { throw 'installed_guardian_pipe_client_missing' }
$pipeClientSha = (Get-FileHash $pipeClientPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($pipeClientSha -ne [string]$pipeClientMeta.sha256) { throw 'installed_guardian_pipe_client_digest_mismatch' }
if ([int64](Get-Item $pipeClientPath).Length -ne [int64]$pipeClientMeta.size) { throw 'installed_guardian_pipe_client_size_mismatch' }
if (@($manifest.binaries).Count -ne 2) { throw 'installed_guardian_binary_cardinality_invalid' }

$binaryProof = @()
$verifiedBinaries = @{}
foreach ($row in @($manifest.binaries)) {
  $name = [string]$row.name
  if ($name -notin @('METAENGINEBrowserGuardian.exe','METAENGINEBrowserGuardianConfigure.exe')) { throw "installed_guardian_binary_name_untrusted:$name" }
  $binary = Join-Path $staging $name
  if (-not (Test-Path $binary -PathType Leaf)) { throw "installed_guardian_binary_missing:$name" }
  $actual = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne [string]$row.sha256) { throw "installed_guardian_binary_digest_mismatch:$name" }
  if ([int64](Get-Item $binary).Length -ne [int64]$row.size) { throw "installed_guardian_binary_size_mismatch:$name" }
  $verifiedBinaries[$name] = [ordered]@{ path=$binary; sha256=$actual; size=[int64]$row.size }
  $binaryProof += [ordered]@{name=$name;sha256=$actual;size=[int64]$row.size}
}
$manifestSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($EvidenceDir) {
  $evidence = [System.IO.Path]::GetFullPath($EvidenceDir)
  New-Item -ItemType Directory -Force -Path $evidence | Out-Null
  Copy-Item $manifestPath (Join-Path $evidence 'guardian-native-staging-manifest.json') -Force
  foreach ($name in @('METAENGINEBrowserGuardian.exe','METAENGINEBrowserGuardianConfigure.exe')) {
    $source = [string]$verifiedBinaries[$name].path
    $destination = Join-Path $evidence $name
    Copy-Item $source $destination -Force
    $evidenceSha = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($evidenceSha -ne [string]$verifiedBinaries[$name].sha256) { throw "guardian_release_asset_digest_mismatch:$name" }
    if ([int64](Get-Item $destination).Length -ne [int64]$verifiedBinaries[$name].size) { throw "guardian_release_asset_size_mismatch:$name" }
  }

  $verifiedPath = Join-Path $evidence 'verified-self-update-manifest.json'
  if (-not (Test-Path $verifiedPath -PathType Leaf)) { throw 'verified_self_update_manifest_missing_for_guardian_extension' }
  $verified = Get-Content $verifiedPath -Raw | ConvertFrom-Json
  $verifiedVersion = [string]$verified.version
  if (-not $verifiedVersion) { throw 'verified_self_update_version_missing_for_guardian_binding' }
  if ([string]$manifest.package_version -ne $verifiedVersion) {
    throw "guardian_staging_verified_target_version_mismatch:$($manifest.package_version):$verifiedVersion"
  }
  if ($ExpectedPackageVersion -and $ExpectedPackageVersion -ne $verifiedVersion) {
    throw "guardian_expected_package_version_evidence_drift:${ExpectedPackageVersion}:$verifiedVersion"
  }
  $verified | Add-Member -NotePropertyName guardian_native_staging_present -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_staging_verified -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_no_activation -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_requires_machine_secure_copy -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_manifest_sha256 -NotePropertyValue $manifestSha -Force
  $verified | Add-Member -NotePropertyName guardian_native_package_version -NotePropertyValue ([string]$manifest.package_version) -Force
  $verified | Add-Member -NotePropertyName guardian_native_release_assets_verified -NotePropertyValue $true -Force
  [System.IO.File]::WriteAllText($verifiedPath, (($verified | ConvertTo-Json -Depth 8) + "`n"), [System.Text.UTF8Encoding]::new($false))
}

$proof = [ordered]@{
  schema = 'metaengine.browser.guardian-native-installed-staging-proof.v1'
  source_head = $ExpectedSourceHead
  package_version = [string]$manifest.package_version
  staging_path = $staging
  manifest_sha256 = $manifestSha
  binaries = $binaryProof
  guardian_service_absent = $true
  staging_only = $true
  release_assets_verified = [bool]$EvidenceDir
  requires_machine_secure_copy = $true
  service_activation_authorized = $false
  automatic_retry_allowed = $false
  authority_effect = $false
}
# Machine-readable contract: emit the final JSON object on PowerShell's success
# stream so callers may capture/parse it. Write-Host is intentionally forbidden
# here because host/information output is not a reliable pipeline return value.
Write-Output ($proof | ConvertTo-Json -Depth 6 -Compress)
