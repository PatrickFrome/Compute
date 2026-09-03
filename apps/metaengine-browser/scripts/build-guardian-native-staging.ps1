param(
  [string]$OutputDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'native-dist\guardian')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceDir = Join-Path $root 'native\browser-guardian-scm'
$serviceSource = Join-Path $sourceDir 'browser-guardian-scm-service.cpp'
$configuratorSource = Join-Path $sourceDir 'browser-guardian-scm-configure.cpp'
foreach ($path in @($serviceSource,$configuratorSource)) {
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
$configurator = Join-Path $resolvedOut 'METAENGINEBrowserGuardianConfigure.exe'
$serviceCmd = 'call "{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /W4 /WX /DUNICODE /D_UNICODE "{1}" /Fe:"{2}" /link advapi32.lib' -f $vcvars,$serviceSource,$service
& $env:ComSpec /d /s /c $serviceCmd
if ($LASTEXITCODE -ne 0) { throw "guardian_service_compile_exit_$LASTEXITCODE" }
$configCmd = 'call "{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /W4 /WX /DUNICODE /D_UNICODE "{1}" /Fe:"{2}" /link advapi32.lib shell32.lib ole32.lib' -f $vcvars,$configuratorSource,$configurator
& $env:ComSpec /d /s /c $configCmd
if ($LASTEXITCODE -ne 0) { throw "guardian_configurator_compile_exit_$LASTEXITCODE" }

$sourceHead = (git -C $root rev-parse HEAD).Trim()
if ($sourceHead -notmatch '^[0-9a-f]{40}$') { throw "guardian_staging_source_head_invalid:$sourceHead" }
$packageJsonPath = Join-Path $root 'package.json'
if (-not (Test-Path $packageJsonPath -PathType Leaf)) { throw 'guardian_staging_package_json_missing' }
$packageVersion = [string]((Get-Content $packageJsonPath -Raw | ConvertFrom-Json).version)
if (-not $packageVersion) { throw 'guardian_staging_package_version_missing' }

$binaries = @()
foreach ($item in @(
  @{ path=$service; role='scm_service_host'; activationTool=$false },
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

$manifest = [ordered]@{
  schema = 'metaengine.browser.guardian-native-staging-manifest.v1'
  version = '1.0.0'
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
if (@($readback.binaries).Count -ne 2) { throw 'guardian_staging_binary_cardinality_invalid' }
foreach ($row in @($readback.binaries)) {
  $binary = Join-Path $resolvedOut ([string]$row.name)
  if ((Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$row.sha256) { throw "guardian_staging_binary_readback_mismatch:$($row.name)" }
}
Write-Host ($readback | ConvertTo-Json -Depth 6 -Compress)
