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
if ($manifest.staging_only -ne $true
    -or $manifest.service_activation_authorized -ne $false
    -or $manifest.service_installation_authorized -ne $false
    -or $manifest.service_start_authorized -ne $false
    -or $manifest.user_writable_service_activation_forbidden -ne $true
    -or $manifest.requires_machine_secure_copy -ne $true
    -or $manifest.authority_effect -ne $false) {
  throw 'installed_guardian_staging_authority_invalid'
}
if ([string]$manifest.required_machine_root -ne '%ProgramFiles%\METAENGINE\Guardian') { throw 'installed_guardian_machine_root_contract_drift' }
if ([string]$manifest.exact_service_binary_name -ne 'METAENGINEBrowserGuardian.exe') { throw 'installed_guardian_service_name_contract_drift' }
if (@($manifest.binaries).Count -ne 2) { throw 'installed_guardian_binary_cardinality_invalid' }

$binaryProof = @()
foreach ($row in @($manifest.binaries)) {
  $name = [string]$row.name
  if ($name -notin @('METAENGINEBrowserGuardian.exe','METAENGINEBrowserGuardianConfigure.exe')) { throw "installed_guardian_binary_name_untrusted:$name" }
  $binary = Join-Path $staging $name
  if (-not (Test-Path $binary -PathType Leaf)) { throw "installed_guardian_binary_missing:$name" }
  $actual = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne [string]$row.sha256) { throw "installed_guardian_binary_digest_mismatch:$name" }
  if ([int64](Get-Item $binary).Length -ne [int64]$row.size) { throw "installed_guardian_binary_size_mismatch:$name" }
  $binaryProof += [ordered]@{name=$name;sha256=$actual;size=[int64]$row.size}
}
$manifestSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($EvidenceDir) {
  $evidence = [System.IO.Path]::GetFullPath($EvidenceDir)
  New-Item -ItemType Directory -Force -Path $evidence | Out-Null
  Copy-Item $manifestPath (Join-Path $evidence 'guardian-native-staging-manifest.json') -Force
  $verifiedPath = Join-Path $evidence 'verified-self-update-manifest.json'
  if (-not (Test-Path $verifiedPath -PathType Leaf)) { throw 'verified_self_update_manifest_missing_for_guardian_extension' }
  $verified = Get-Content $verifiedPath -Raw | ConvertFrom-Json
  $verifiedVersion = [string]$verified.version
  if (-not $verifiedVersion) { throw 'verified_self_update_version_missing_for_guardian_binding' }
  if ([string]$manifest.package_version -ne $verifiedVersion) {
    throw "guardian_staging_verified_target_version_mismatch:$($manifest.package_version):$verifiedVersion"
  }
  if ($ExpectedPackageVersion -and $ExpectedPackageVersion -ne $verifiedVersion) {
    throw "guardian_expected_package_version_evidence_drift:$ExpectedPackageVersion:$verifiedVersion"
  }
  $verified | Add-Member -NotePropertyName guardian_native_staging_present -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_staging_verified -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_no_activation -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_requires_machine_secure_copy -NotePropertyValue $true -Force
  $verified | Add-Member -NotePropertyName guardian_native_manifest_sha256 -NotePropertyValue $manifestSha -Force
  $verified | Add-Member -NotePropertyName guardian_native_package_version -NotePropertyValue ([string]$manifest.package_version) -Force
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
  requires_machine_secure_copy = $true
  service_activation_authorized = $false
  automatic_retry_allowed = $false
  authority_effect = $false
}
Write-Host ($proof | ConvertTo-Json -Depth 6 -Compress)
