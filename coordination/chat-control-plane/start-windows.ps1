param(
  [switch]$ResetCredentials
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "This launcher is for Windows. Start daemon/secure-entry.mjs directly on other systems."
}

function Reveal-SecureString([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function New-PairingSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  }
  finally {
    $rng.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Read-DpapiSecret([string]$Path) {
  $encrypted = Get-Content -LiteralPath $Path -Raw
  return Reveal-SecureString (ConvertTo-SecureString $encrypted)
}

function Save-DpapiSecret([string]$Path, [string]$Value) {
  $secure = ConvertTo-SecureString $Value -AsPlainText -Force
  $encrypted = ConvertFrom-SecureString $secure
  Set-Content -LiteralPath $Path -Value $encrypted -Encoding ASCII
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Write-Host "Node.js 20+ is required. Install the LTS release from https://nodejs.org/en/download and run this file again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 2
}

$nodeVersionText = (& $nodeCommand.Source --version).Trim()
$nodeMajor = [int](($nodeVersionText -replace '^v', '').Split('.')[0])
if ($nodeMajor -lt 20) {
  Write-Host "Node.js 20+ is required; found $nodeVersionText. Update it at https://nodejs.org/en/download." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 2
}

$configDirectory = Join-Path $env:LOCALAPPDATA "METAENGINE\A2ChatBridge"
$serviceRolePath = Join-Path $configDirectory "service-role.dpapi"
$pairingPath = Join-Path $configDirectory "pairing-secret.dpapi"
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

if ($ResetCredentials) {
  Remove-Item -LiteralPath $serviceRolePath, $pairingPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path -LiteralPath $serviceRolePath) {
  $serviceRoleKey = Read-DpapiSecret $serviceRolePath
}
else {
  Write-Host "Paste the Supabase service_role key. Input is masked and saved with Windows DPAPI for this Windows user only." -ForegroundColor Cyan
  $serviceRoleKey = Reveal-SecureString (Read-Host "SUPABASE_SERVICE_ROLE_KEY" -AsSecureString)
  if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
    throw "SUPABASE_SERVICE_ROLE_KEY is empty."
  }
  Save-DpapiSecret $serviceRolePath $serviceRoleKey
}

if (Test-Path -LiteralPath $pairingPath) {
  $pairingSecret = Read-DpapiSecret $pairingPath
}
else {
  $pairingSecret = New-PairingSecret
  Save-DpapiSecret $pairingPath $pairingSecret
}

$env:SUPABASE_SERVICE_ROLE_KEY = $serviceRoleKey
$env:A2_BRIDGE_SHARED_SECRET = $pairingSecret
$env:A2_BRIDGE_RECEIPTS_MODE = "OFF"

Set-Clipboard -Value $pairingSecret
Write-Host ""
Write-Host "Pairing secret copied to the clipboard." -ForegroundColor Green
Write-Host "In METAENGINE A2 Chat Bridge options: paste it into Local pairing secret, select the open ChatGPT tab, save, then click the extension icon until the badge says ON." -ForegroundColor Cyan
Write-Host "The dashboard will open after the daemon becomes healthy. Keep this window open; Ctrl+C stops the bridge." -ForegroundColor Cyan

$entry = Join-Path $PSScriptRoot "daemon\secure-entry.mjs"
$entryArgument = '"' + $entry + '"'
$daemon = $null
try {
  $daemon = Start-Process -FilePath $nodeCommand.Source -ArgumentList @($entryArgument) -NoNewWindow -PassThru
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($daemon.HasExited) {
      throw "The A2 bridge daemon exited with code $($daemon.ExitCode)."
    }
    try {
      $status = Invoke-WebRequest -Uri "http://127.0.0.1:8765/v1/status" -UseBasicParsing -TimeoutSec 1
      if ($status.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    }
    catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $healthy) {
    throw "The daemon did not become healthy at http://127.0.0.1:8765."
  }
  Start-Process "http://127.0.0.1:8765/"
  Wait-Process -Id $daemon.Id
}
finally {
  $env:SUPABASE_SERVICE_ROLE_KEY = $null
  $env:A2_BRIDGE_SHARED_SECRET = $null
  $serviceRoleKey = $null
  $pairingSecret = $null
  if ($daemon -and -not $daemon.HasExited) {
    Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue
  }
}
