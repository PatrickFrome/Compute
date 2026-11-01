$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts'
Import-Module (Join-Path $scriptRoot 'guardian-static-crypto.psm1')
foreach ($fake in @([object]::new(), @{ signature_verified = $true }, ('{"signature_verified":true,"source_head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' | ConvertFrom-Json))) {
  $rejected = $false
  try { $null = Get-GuardianCryptoLink $fake }
  catch {
    if ($_.Exception.Message -cne 'guardian_crypto_fresh_build_context_required') { throw }
    $rejected = $true
  }
  if (-not $rejected) { throw 'forged_context_accepted' }
}
foreach ($name in @('build-guardian-native-staging.ps1','build-guardian-native-peer.ps1','build-guardian-machine-bootstrap.ps1')) {
  $extra = @{}
  if ($name -eq 'build-guardian-machine-bootstrap.ps1') { $extra = @{ StagingDir = 'unused'; OutputDir = 'unused' } }
  foreach ($mode in @('missing','conflicting','forged')) {
    $argsForBuild = @{} + $extra
    $expected = 'guardian_native_requires_fresh_crypto_or_explicit_unlinked_test'
    if ($mode -ne 'missing') { $argsForBuild.CryptoBuild = [pscustomobject]@{ signature_verified = $true } }
    if ($mode -eq 'conflicting') { $argsForBuild.UnlinkedTestBuild = $true }
    if ($mode -eq 'forged') { $expected = 'guardian_crypto_fresh_build_context_required' }
    $rejected = $false
    try { & (Join-Path $scriptRoot $name) @argsForBuild }
    catch { if ($_.Exception.Message -cne $expected) { throw }; $rejected = $true }
    if (-not $rejected) { throw "guardian_build_mode_accepted:$name`:$mode" }
  }
}
Write-Output 'GUARDIAN_CONTEXT_NEGATIVES_PASS:12; no producer, compiler, installation or runtime qualification'
