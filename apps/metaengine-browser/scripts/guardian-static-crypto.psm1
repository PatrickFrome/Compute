Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Object identity is local to this module/process. JSON, paths and flags cannot
# import a previous build. Only the existing producer below creates a context.
$script:builds = [System.Collections.Generic.List[object]]::new()
function Get-GuardianContext($Context) {
  foreach ($entry in $script:builds) {
    if ([object]::ReferenceEquals($Context, $entry.Token)) { return $entry }
  }
  throw 'guardian_crypto_fresh_build_context_required'
}
function Assert-GuardianCommandPath([string]$Path) {
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '[%!"&|<>^\r\n]') { throw 'guardian_crypto_unsafe_command_path' }
}
function Invoke-GuardianCryptoReadback($Entry, [string]$Expected = '') {
  $arguments = @((Join-Path $PSScriptRoot 'verify-guardian-crypto-build.py'), '--build', $Entry.Output, '--source', $Entry.Source)
  if ($Expected) { $arguments += @('--expected-proof', $Expected) }
  $json = & python @arguments
  if ($LASTEXITCODE -ne 0) { throw 'guardian_crypto_byte_agreement_failed' }
  return ($json | ConvertFrom-Json)
}
function New-GuardianCryptoBuild {
  param([Parameter(Mandatory=$true)][string]$SourceDir, [Parameter(Mandatory=$true)][string]$OutputDir,
    [string]$VcVarsPath = $env:ME2_VCVARS_PATH)
  $entry = [pscustomobject]@{ Token = [object]::new(); Source = [IO.Path]::GetFullPath($SourceDir);
    Output = [IO.Path]::GetFullPath($OutputDir); Binding = $null;
    Handles = [System.Collections.Generic.List[object]]::new(); Outputs = @{} }
  # Fresh empty output and actual offline GPG reauthentication are enforced by
  # this producer. Do not replace invocation with acceptance of a manifest.
  & (Join-Path $PSScriptRoot 'build-guardian-openssl-static.ps1') -SourceDir $entry.Source -OutputDir $entry.Output -VcVarsPath $VcVarsPath | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'guardian_crypto_producer_failed' }
  try {
    $entry.Binding = Invoke-GuardianCryptoReadback $entry
    # Deny write/delete sharing until every consumer has finished linking. The
    # second readback hashes the now-held files, closing the check/open gap.
    foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $entry.Output 'artifacts') -Recurse -File)) {
      $entry.Handles.Add([IO.File]::Open($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read))
    }
    $null = Invoke-GuardianCryptoReadback $entry $entry.Binding.producer_proof_sha256
    $script:builds.Add($entry)
    return $entry.Token
  } catch {
    foreach ($handle in $entry.Handles) { $handle.Dispose() }
    throw
  }
}
function Get-GuardianCryptoLink {
  param([Parameter(Mandatory=$true)]$Context)
  $entry = Get-GuardianContext $Context
  $binding = Invoke-GuardianCryptoReadback $entry $entry.Binding.producer_proof_sha256
  $signature = Join-Path $entry.Output 'artifacts/guardian-signature/lib/guardian-release-signature.lib'
  $crypto = Join-Path $entry.Output 'artifacts/openssl-static/lib/libcrypto.lib'
  foreach ($file in @($signature, $crypto)) { Assert-GuardianCommandPath $file }
  return [pscustomobject]@{
    Compile = '/DMETAENGINE_GUARDIAN_RELEASE_SIGNATURE_LINKED'
    Link = ('"{0}" "{1}" ws2_32.lib gdi32.lib crypt32.lib user32.lib' -f $signature, $crypto)
    Binding = $binding
    EvidenceDirectory = (Join-Path $entry.Output 'evidence/consumers')
  }
}
function Register-GuardianNativeOutput {
  param($Context, [string]$Role, [string]$Path)
  $entry = Get-GuardianContext $Context
  $null = Get-GuardianCryptoLink $Context
  if ($entry.Outputs.ContainsKey($Role)) { throw 'guardian_crypto_output_already_registered' }
  $handle = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $entry.Handles.Add($handle)
  $entry.Outputs[$Role] = [pscustomobject]@{ Path = [IO.Path]::GetFullPath($Path); Sha = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
}
function Assert-GuardianNativeOutput {
  param($Context, [string]$Role, [string]$Path)
  $entry = Get-GuardianContext $Context
  $null = Get-GuardianCryptoLink $Context
  if (-not $entry.Outputs.ContainsKey($Role)) { throw 'guardian_crypto_same_build_native_output_required' }
  $row = $entry.Outputs[$Role]
  if ($row.Path -cne [IO.Path]::GetFullPath($Path) -or $row.Sha -cne (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash) {
    throw 'guardian_crypto_native_output_drift'
  }
}
function Assert-GuardianStaticPe {
  param([string]$Binary, [string]$VcVarsPath, [string]$EvidenceDir, [string]$MapPath)
  foreach ($path in @($Binary, $VcVarsPath, $EvidenceDir)) { Assert-GuardianCommandPath $path }
  New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
  $imports = Join-Path $EvidenceDir 'imports.txt'
  $headers = Join-Path $EvidenceDir 'headers.txt'
  $command = 'call "{0}" >nul && set VSLANG=1033&& dumpbin.exe /nologo /imports "{1}" > "{2}" && dumpbin.exe /nologo /headers "{1}" > "{3}"' -f $VcVarsPath,$Binary,$imports,$headers
  & $env:ComSpec /d /s /c $command
  if ($LASTEXITCODE -ne 0) { throw 'guardian_crypto_final_pe_inspection_failed' }
  $found = @([regex]::Matches((Get-Content -LiteralPath $imports -Raw), '(?im)^\s*([a-z0-9_.-]+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique)
  $allowed = @('kernel32.dll','advapi32.dll','crypt32.dll','user32.dll','gdi32.dll','ws2_32.dll','bcrypt.dll','ntdll.dll','shell32.dll','ole32.dll','userenv.dll','wtsapi32.dll','winhttp.dll')
  if ($found.Count -eq 0) { throw 'guardian_crypto_final_pe_imports_missing' }
  foreach ($dll in $found) { if ($dll -notin $allowed) { throw "guardian_crypto_final_pe_import_forbidden:$dll" } }
  if ((Get-Content -LiteralPath $headers -Raw) -notmatch '(?im)^\s*8664 machine \(x64\)\s*$') { throw 'guardian_crypto_final_pe_architecture' }
  if ($MapPath) {
    # A passed archive on a link line can be unused. Require the real consumer
    # map to contain both the public verifier and its crypto implementation.
    $map = Get-Content -LiteralPath $MapPath -Raw
    if ($map -notmatch 'verifyGuardianReleaseSignatureV2' -or $map -notmatch 'EVP_DigestVerify' `
        -or $map -notmatch 'guardian-release-signature' -or $map -notmatch 'libcrypto') {
      throw 'guardian_crypto_consumer_linkage_missing'
    }
    Copy-Item -LiteralPath $MapPath -Destination (Join-Path $EvidenceDir 'link.map') -Force
  }
  return $found
}
function Close-GuardianCryptoBuild {
  param($Context)
  $entry = Get-GuardianContext $Context
  foreach ($handle in $entry.Handles) { $handle.Dispose() }
  $null = $script:builds.Remove($entry)
}
Export-ModuleMember -Function New-GuardianCryptoBuild, Get-GuardianCryptoLink, Register-GuardianNativeOutput, Assert-GuardianNativeOutput, Assert-GuardianStaticPe, Assert-GuardianCommandPath, Close-GuardianCryptoBuild

function Copy-GuardianCryptoNotices {
  param($Context, [string]$Destination)
  $entry = Get-GuardianContext $Context
  $null = Get-GuardianCryptoLink $Context
  foreach ($name in @('LICENSE.txt','THIRD_PARTY_NOTICES.txt')) {
    Copy-Item -LiteralPath (Join-Path $entry.Output "artifacts/openssl-static/$name") -Destination (Join-Path $Destination "OPENSSL-$name") -Force
  }
}
Export-ModuleMember -Function Copy-GuardianCryptoNotices
