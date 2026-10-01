param(
  [Parameter(Mandatory=$true)][string]$StagingDir,
  [Parameter(Mandatory=$true)][string]$OutputDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$staging = (Resolve-Path $StagingDir).Path
$manifestPath = Join-Path $staging 'guardian-native-manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne 'metaengine.browser.guardian-native-staging-manifest.v1' `
    -or $manifest.source_head -notmatch '^[0-9a-f]{40}$' `
    -or @($manifest.binaries).Count -ne 2) { throw 'bootstrap_staging_binding_invalid' }
$service = Join-Path $staging 'METAENGINEBrowserGuardian.exe'
$configure = Join-Path $staging 'METAENGINEBrowserGuardianConfigure.exe'
foreach ($asset in @($service,$configure)) {
  $row = @($manifest.binaries | Where-Object { $_.name -eq (Split-Path $asset -Leaf) })
  if ($row.Count -ne 1 -or (Get-FileHash $asset -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row[0].sha256 `
      -or (Get-Item $asset).Length -ne $row[0].size) { throw 'bootstrap_staging_asset_drift' }
}
$serviceSha = (Get-FileHash $service -Algorithm SHA256).Hash.ToLowerInvariant()
$configSha = (Get-FileHash $configure -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestSha = (Get-FileHash $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceHead = [string]$manifest.source_head
$slotId = $sourceHead.Substring(0,16) + '-' + $manifestSha.Substring(0,16)
$out = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('guardian-bootstrap-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsRoot = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vsRoot) { throw 'bootstrap_cpp_toolchain_missing' }
$vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
$utf8 = [System.Text.UTF8Encoding]::new($false)
try {
  $header = @"
#pragma once
constexpr char kBootstrapSourceHead[] = "$sourceHead";
constexpr char kBootstrapServiceSha256[] = "$serviceSha";
constexpr char kBootstrapConfiguratorSha256[] = "$configSha";
constexpr char kBootstrapManifestSha256[] = "$manifestSha";
constexpr char kBootstrapSlotId[] = "$slotId";
constexpr wchar_t kBootstrapSlotIdW[] = L"$slotId";
"@
  [System.IO.File]::WriteAllText((Join-Path $temp 'guardian-bootstrap-binding.hpp'), $header, $utf8)
  # PE resources are compile-time exact production bytes, never user path input.
  $resource = '201 RCDATA "{0}"' -f $service.Replace('\','\\')
  $resource += "`r`n" + ('202 RCDATA "{0}"' -f $configure.Replace('\','\\'))
  $resource += "`r`n" + ('203 RCDATA "{0}"' -f $manifestPath.Replace('\','\\'))
  [System.IO.File]::WriteAllText((Join-Path $temp 'guardian-bootstrap.rc'), $resource, $utf8)
  $exeName = 'METAENGINE-Guardian-Bootstrap-' + [string]$manifest.package_version + '-x64.exe'
  $exe = Join-Path $out $exeName
  $source = Join-Path $root 'native\browser-guardian-scm\browser-guardian-machine-bootstrap.cpp'
  $command = 'call "{0}" >nul && rc.exe /nologo /fo bootstrap.res guardian-bootstrap.rc && cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE /I"{1}" "{2}" bootstrap.res /Fe:"{3}" /link advapi32.lib bcrypt.lib shell32.lib ole32.lib /MANIFEST:EMBED /MANIFESTUAC:"level=''requireAdministrator'' uiAccess=''false''"' -f $vcvars,$temp,$source,$exe
  Push-Location $temp
  try { & $env:ComSpec /d /s /c $command; if ($LASTEXITCODE -ne 0) { throw "bootstrap_compile_exit_$LASTEXITCODE" } }
  finally { Pop-Location }
  $binding = [ordered]@{
    schema='metaengine.browser-guardian.machine-bootstrap-binding.v1'
    source_head=$sourceHead
    package_version=[string]$manifest.package_version
    slot_id=$slotId
    bootstrap_name=$exeName
    bootstrap_sha256=(Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    bootstrap_size=[int64](Get-Item $exe).Length
    guardian_manifest_sha256=$manifestSha
    service_sha256=$serviceSha
    configurator_sha256=$configSha
    embedded_assets_only=$true
    explicit_elevated_install_required=$true
    automatic_retry_allowed=$false
    authority_effect=$false
  }
  [System.IO.File]::WriteAllText((Join-Path $out 'guardian-machine-bootstrap-binding.json'), ($binding | ConvertTo-Json -Depth 4), $utf8)
  Write-Output ($binding | ConvertTo-Json -Depth 4 -Compress)
} finally { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
