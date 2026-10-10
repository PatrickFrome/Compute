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
$bunToolchainRequired = ([string]$env:ME2_BUN_TOOLCHAIN_REQUIRED).Trim().ToLowerInvariant() -eq 'true'
$expectedBunVersion = if ([string]$env:ME2_BUN_VERSION) { ([string]$env:ME2_BUN_VERSION).Trim() } else { '1.3.3' }
$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bunToolchainRequired -and -not $bun) { throw 'me2_daemon_required_bun_missing' }
$bunCommand = if ($bun) { $bun.Source } else { 'npx' }
$bunPrefix = if ($bun) { @() } else { @('--yes', "bun@$expectedBunVersion") }
$bunVersion = if ($bun) { [string](& $bun.Source --version | Select-Object -Last 1) } else { $expectedBunVersion }
$bunVersion = $bunVersion.Trim()
if ($bunToolchainRequired -and $bunVersion -ne $expectedBunVersion) {
  throw "me2_daemon_bun_version_mismatch:${bunVersion}:${expectedBunVersion}"
}

$sourceHead = (git -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($sourceHead -notmatch '^[0-9a-f]{40}$') { throw 'me2_daemon_source_head_invalid' }
if ($ExpectedSourceHead -and $sourceHead -ne $ExpectedSourceHead.ToLowerInvariant()) {
  throw "me2_daemon_source_head_mismatch:${sourceHead}:${ExpectedSourceHead}"
}

$package = Get-Content (Join-Path $daemonRoot 'package.json') -Raw | ConvertFrom-Json
$storeText = Get-Content (Join-Path $daemonRoot 'store.ts') -Raw
$match = [regex]::Match($storeText, 'export\s+const\s+VERSION\s*=\s*["'']([^"'']+)["'']')
if (-not $match.Success) { throw 'me2_daemon_runtime_version_missing' }
$runtimeVersion = [string]$match.Groups[1].Value
$packageVersion = [string]$package.version
$probeText = Get-Content (Join-Path $daemonRoot 'browser-probe-entry.ts') -Raw
$probeVersionMatch = [regex]::Match($probeText, 'const\s+VERSION\s*=\s*["'']([^"'']+)["'']')
if (-not $probeVersionMatch.Success) { throw 'me2_daemon_probe_version_missing' }
$probeVersion = [string]$probeVersionMatch.Groups[1].Value
if (-not $packageVersion -or $packageVersion -ne $runtimeVersion -or $probeVersion -ne $runtimeVersion) {
  throw "me2_daemon_version_drift:${packageVersion}:${runtimeVersion}:${probeVersion}"
}

Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

Push-Location $daemonRoot
try {
  # R105 standalone probe imports Node/Bun built-ins only. Do not install the
  # legacy daemon dependency graph (including model/provider SDKs) merely to
  # build the Browser compatibility process.
  $probeEntrypoint = Join-Path $daemonRoot 'browser-probe-entry.ts'
  if (-not (Test-Path $probeEntrypoint -PathType Leaf)) { throw 'me2_daemon_browser_probe_entry_missing' }
  # The Browser UI remains locked to Bun 1.3.3. The standalone daemon uses
  # its separately pinned Bun 1.4.3 compiler, physically verified on Ivy Bridge.
  # Bun 1.4.3 ships one Nehalem/SSE4.2 x64 binary with runtime CPU dispatch.
  # Bun 1.3.3 cannot download the legacy baseline compile target reliably.
  $daemonCompilerVersion = '1.4.3'
  $daemonNpx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if (-not $daemonNpx) { throw 'me2_daemon_pinned_npx_missing' }
  $priorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue' # npm may emit status notices on stderr.
  try {
    $actualCompilerVersion = [string](& $daemonNpx.Source --yes "bun@$daemonCompilerVersion" --version | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or $actualCompilerVersion.Trim() -ne $daemonCompilerVersion) { throw 'me2_daemon_compiler_version_drift' }
    & $daemonNpx.Source --yes "bun@$daemonCompilerVersion" build --compile --target=bun-windows-x64 browser-probe-entry.ts --outfile $exePath
    if ($LASTEXITCODE -ne 0) { throw "me2_daemon_compile_exit_$LASTEXITCODE" }
  } finally { $ErrorActionPreference = $priorAction }
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
  build_bun_version = '1.4.3'
  build_ui_bun_version = $bunVersion
  build_bun_compiler_source = 'npx-pinned-bun-1.4.3'
  build_compile_target = 'bun-windows-x64'
  cpu_compatibility = 'NEHALEM_SSE42_OR_NEWER'
  build_bun_toolchain_required = $bunToolchainRequired
  executable = 'me2-daemon.exe'
  executable_sha256 = $sha
  executable_bytes = [int64]$bytes
  runtime_embedded = $true
  external_bun_required = $false
  default_browser_host_boot_mode = 'probe'
  probe_only_entrypoint = 'browser-probe-entry.ts'
  browser_host_mode_override_allowed = $false
  browser_probe_read_only = $true
  standalone_probe_runtime = $true
  legacy_daemon_module_loaded = $false
  legacy_dependency_install_required = $false
  model_execution_enabled = $false
  provider_api_enabled = $false
  provider_network_enabled = $false
  agentchat_mutation_enabled = $false
  command_mutation_enabled = $false
  token_mutation_enabled = $false
  filesystem_mutation_enabled = $false
  sql_mutation_enabled = $false
  socket_mutation_surface_enabled = $false
  scheduler_authority = $false
  browser_actuation_authority = $false
  authority_effect = $false
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host ($manifest | ConvertTo-Json -Compress)
