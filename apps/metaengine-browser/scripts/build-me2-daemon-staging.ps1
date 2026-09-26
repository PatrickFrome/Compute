param(
  [string]$ExpectedSourceHead = ''
)

$ErrorActionPreference = 'Stop'

$browserRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $browserRoot '..\..'))
$daemonRoot = Join-Path $repoRoot 'apps\me2-daemon'
$stageRoot = Join-Path $browserRoot 'me2-daemon-dist'
$exePath = Join-Path $stageRoot 'me2-daemon.exe'
$manifestPath = Join-Path $stageRoot 'me2-daemon-manifest.json'

if (-not (Test-Path $daemonRoot -PathType Container)) { throw 'me2_daemon_source_missing' }
$bun = Get-Command bun -ErrorAction SilentlyContinue
$bunCommand = if ($bun) { $bun.Source } else { 'npx' }
$bunPrefix = if ($bun) { @() } else { @('--yes', 'bun@1.3.3') }

$sourceHead = (git -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($sourceHead -notmatch '^[0-9a-f]{40}$') { throw 'me2_daemon_source_head_invalid' }
if ($ExpectedSourceHead -and $sourceHead -ne $ExpectedSourceHead.ToLowerInvariant()) {
  throw "me2_daemon_source_head_mismatch:$sourceHead:$ExpectedSourceHead"
}

$package = Get-Content (Join-Path $daemonRoot 'package.json') -Raw | ConvertFrom-Json
$storeText = Get-Content (Join-Path $daemonRoot 'store.ts') -Raw
$match = [regex]::Match($storeText, 'export\s+const\s+VERSION\s*=\s*["'']([^"'']+)["'']')
if (-not $match.Success) { throw 'me2_daemon_runtime_version_missing' }
$runtimeVersion = [string]$match.Groups[1].Value
$packageVersion = [string]$package.version
if (-not $packageVersion -or $packageVersion -ne $runtimeVersion) {
  throw "me2_daemon_version_drift:$packageVersion:$runtimeVersion"
}

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

Push-Location $daemonRoot
try {
  & $bunCommand @bunPrefix install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "me2_daemon_bun_install_exit_$LASTEXITCODE" }

  & $bunCommand @bunPrefix build --compile --target=bun-windows-x64 index.ts --outfile $exePath
  if ($LASTEXITCODE -ne 0) { throw "me2_daemon_compile_exit_$LASTEXITCODE" }
} finally {
  Pop-Location
}

if (-not (Test-Path $exePath -PathType Leaf)) { throw 'me2_daemon_executable_missing' }
$sha = (Get-FileHash $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item $exePath).Length
if ($bytes -lt 1048576) { throw "me2_daemon_executable_too_small:$bytes" }

$manifest = [ordered]@{
  schema = 'metaengine.browser.me2-daemon-package.v1'
  source_head = $sourceHead
  daemon_version = $runtimeVersion
  executable = 'me2-daemon.exe'
  executable_sha256 = $sha
  executable_bytes = [int64]$bytes
  runtime_embedded = $true
  external_bun_required = $false
  default_browser_host_boot_mode = 'probe'
  scheduler_authority = $false
  browser_actuation_authority = $false
  authority_effect = $false
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host ($manifest | ConvertTo-Json -Compress)
