param(
  [Parameter(Mandatory = $true)][string]$UserDataPath,
  [Parameter(Mandatory = $true)][string]$InstalledExePath,
  [Parameter(Mandatory = $true)][string]$ExpectedTargetVersion,
  [string]$ExpectedInstalledExeSha256 = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TransactionFile = 'metaengine-self-update-transaction-v1.json'
$PreInstallFile = 'metaengine-self-update-pre-install-receipt-v1.json'
$SuccessorFile = 'metaengine-self-update-successor-receipt-v1.json'

if ($ExpectedTargetVersion -notmatch '^\d+\.\d+\.\d+-dev\.\d+\.1$') {
  throw 'bootstrap_probe_expected_version_invalid'
}
$expectedHash = $ExpectedInstalledExeSha256.Trim().ToLowerInvariant()
if ($expectedHash -and $expectedHash -notmatch '^[a-f0-9]{64}$') {
  throw 'bootstrap_probe_expected_executable_sha256_invalid'
}

function Read-JsonEvidence([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [ordered]@{ read_state = 'ABSENT'; row = $null; error = $null }
  }
  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    $row = $raw | ConvertFrom-Json -ErrorAction Stop
    return [ordered]@{ read_state = 'READ'; row = $row; error = $null }
  } catch {
    return [ordered]@{ read_state = 'INVALID'; row = $null; error = ([string]$_.Exception.Message).Substring(0, [Math]::Min(200, ([string]$_.Exception.Message).Length)) }
  }
}

$transactionPath = Join-Path $UserDataPath $TransactionFile
$preInstallPath = Join-Path $UserDataPath $PreInstallFile
$successorPath = Join-Path $UserDataPath $SuccessorFile

$transaction = Read-JsonEvidence $transactionPath
$preInstall = Read-JsonEvidence $preInstallPath
$successor = Read-JsonEvidence $successorPath

$installed = [ordered]@{
  exists = $false
  path = $InstalledExePath
  sha256 = $null
  product_version = $null
  file_version = $null
  hash_matches_expected = $false
  readback_proven = $false
  error = $null
}

if (Test-Path -LiteralPath $InstalledExePath -PathType Leaf) {
  $installed.exists = $true
  try {
    $installed.sha256 = (Get-FileHash -LiteralPath $InstalledExePath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($InstalledExePath)
    $installed.product_version = if ($version.ProductVersion) { [string]$version.ProductVersion } else { $null }
    $installed.file_version = if ($version.FileVersion) { [string]$version.FileVersion } else { $null }
    $installed.hash_matches_expected = [bool]($expectedHash -and $installed.sha256 -eq $expectedHash)
    $installed.readback_proven = $true
  } catch {
    $installed.error = ([string]$_.Exception.Message).Substring(0, [Math]::Min(200, ([string]$_.Exception.Message).Length))
  }
} else {
  $installed.readback_proven = $true
}

$result = [ordered]@{
  schema = 'metaengine.self-update.bootstrap-probe.v1'
  version = '1.0.0'
  captured_at = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  expected_target_version = $ExpectedTargetVersion
  expected_installed_executable_sha256 = if ($expectedHash) { $expectedHash } else { $null }
  transaction_read_state = $transaction.read_state
  transaction = $transaction.row
  transaction_error = $transaction.error
  pre_install_receipt_read_state = $preInstall.read_state
  pre_install_receipt = $preInstall.row
  pre_install_receipt_error = $preInstall.error
  successor_receipt_read_state = $successor.read_state
  successor_receipt = $successor.row
  successor_receipt_error = $successor.error
  installed_executable = $installed
  mutation_performed = $false
  process_launch_performed = $false
  installer_effect_attempted = $false
  journal_mutation_performed = $false
  automatic_retry_allowed = $false
  authority_effect = $false
}

$result | ConvertTo-Json -Depth 12 -Compress
