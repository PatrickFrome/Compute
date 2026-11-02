param(
  [switch]$TestLinkedNamespace,
  [Parameter(Mandatory=$true)][string]$SourceDir,
  [Parameter(Mandatory=$true)][string]$CryptoOutputDir,
  [string]$OutputRoot = '',
  [string]$VcVarsPath = $env:ME2_VCVARS_PATH
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Windows PowerShell 5.1 advanced parameter binding may precede script scope.
if (-not $OutputRoot) { $OutputRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'native-dist' }
Import-Module (Join-Path $PSScriptRoot 'guardian-static-crypto.psm1')
$context = New-GuardianCryptoBuild -SourceDir $SourceDir -OutputDir $CryptoOutputDir -VcVarsPath $VcVarsPath
try {
  $staging = Join-Path $OutputRoot 'guardian'
  & (Join-Path $PSScriptRoot 'build-guardian-native-staging.ps1') -CryptoBuild $context -OutputDir $staging -VcVarsPath $VcVarsPath
  & (Join-Path $PSScriptRoot 'build-guardian-native-peer.ps1') -CryptoBuild $context -OutputDir (Join-Path $OutputRoot 'guardian-peer') -VcVarsPath $VcVarsPath
  # Bootstrap embeds the actual held service/configurator/manifest. It does not
  # consume the signature API and must not get an unrelated crypto link flag.
  & (Join-Path $PSScriptRoot 'build-guardian-machine-bootstrap.ps1') -CryptoBuild $context -StagingDir $staging -OutputDir (Join-Path $OutputRoot 'guardian-bootstrap') -VcVarsPath $VcVarsPath
  if ($TestLinkedNamespace) {
    & (Join-Path $PSScriptRoot 'test-guardian-linked-namespace.ps1') -CryptoBuild $context -OutputDir (Join-Path $CryptoOutputDir 'evidence/linked-namespace') -VcVarsPath $VcVarsPath
  }
  $null = Get-GuardianCryptoLink $context
} finally { Close-GuardianCryptoBuild $context }
