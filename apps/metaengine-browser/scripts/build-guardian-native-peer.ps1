param(
  $CryptoBuild,
  [switch]$UnlinkedTestBuild,
  [string]$NodeHeadersPath,
  [string]$OutputDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'native-dist\guardian-peer'),
  [string]$VcVarsPath = $env:ME2_VCVARS_PATH
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'guardian-static-crypto.psm1')
if ([bool]$CryptoBuild -eq [bool]$UnlinkedTestBuild) { throw 'guardian_native_requires_fresh_crypto_or_explicit_unlinked_test' }
$crypto = $null
if ($CryptoBuild) { $crypto = Get-GuardianCryptoLink $CryptoBuild }

function Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function AssertCmdPath([string]$Path) {
  # These trusted build paths enter a cmd.exe command for MSVC setup. Reject
  # expansion/metacharacters rather than interpreting a path as shell syntax.
  if ($Path -match '["%!&|<>^\r\n]') { throw 'guardian_peer_build_path_shell_characters_forbidden' }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$vendored = Join-Path $root 'native\third_party\node-api-24.0.0'
if (-not $NodeHeadersPath) { $NodeHeadersPath = $vendored }

# Build-host inputs only. The installed PC never compiles, downloads headers,
# locates a compiler, loads node.dll or discovers a Node runtime through PATH.
if (-not $NodeHeadersPath -or -not [IO.Path]::IsPathRooted($NodeHeadersPath) -or
    -not (Test-Path -LiteralPath $NodeHeadersPath -PathType Container)) {
  throw 'guardian_peer_node_api_headers_required'
}
$headers = (Resolve-Path -LiteralPath $NodeHeadersPath).Path
# Exact files from the official Node v24.0.0 headers archive; Node-API v9 is used.
# https://nodejs.org/download/release/v24.0.0/node-v24.0.0-headers.tar.gz
# archive SHA256: 4605ee37eef345568f43de8c1843f3f7a243865654c1e942c50584de6bd59bb5
# https://nodejs.org/download/release/v24.0.0/SHASUMS256.txt
$headerPins = [ordered]@{
  'node_api.h' = 'd14db85d16f182045c42745a6e44b96e932dfe6e3bfcaac7a1096fae8412c579'
  'node_api_types.h' = '8d5d854088d5725fec9775510e0aeeeb790a41ad083c49bb721d950b86e6bd61'
  'js_native_api.h' = '048b4efdcd823f30afd323d61c8aba5be285077f9d790feb52a6fa6382df2541'
  'js_native_api_types.h' = '0410c31e227f81e2981363c4d543f4832ac3df785343ec64cee621742ff8a034'
}
function CheckHeaders {
  foreach ($entry in $headerPins.GetEnumerator()) {
    $file = Join-Path $headers $entry.Key
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Sha256 $file) -cne $entry.Value) {
      throw "guardian_peer_node_api_header_mismatch:$($entry.Key)"
    }
  }
}
CheckHeaders

$license = Join-Path $vendored 'LICENSE'
$provenance = Join-Path $vendored 'PROVENANCE.json'
if (-not (Test-Path -LiteralPath $license -PathType Leaf) -or
    (Sha256 $license) -cne 'b58bb782ec115892f61475a6199db165545926d93624ae172f25b7a6e1dafffe' -or
    -not (Test-Path -LiteralPath $provenance -PathType Leaf)) {
  throw 'guardian_peer_node_api_license_provenance_missing'
}
$sourceDir = Join-Path $root 'native\browser-guardian-scm'
$sources = @(
  (Join-Path $sourceDir 'browser-guardian-connected-peer-napi.cpp'),
  (Join-Path $sourceDir 'browser-guardian-connected-peer.cpp'),
  (Join-Path $sourceDir 'browser-guardian-installed-namespace.cpp')
)
foreach ($file in $sources) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'guardian_peer_native_source_missing' }
}
if ($VcVarsPath) {
  if (-not [IO.Path]::IsPathRooted($VcVarsPath) -or -not (Test-Path -LiteralPath $VcVarsPath -PathType Leaf)) {
    throw 'guardian_peer_explicit_vcvars_missing'
  }
  $vcvars = (Resolve-Path -LiteralPath $VcVarsPath).Path
} else {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) { throw 'guardian_peer_vswhere_missing' }
  $vsRoot = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
  if (-not $vsRoot) { throw 'guardian_peer_visual_studio_cpp_toolchain_missing' }
  $vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
}
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) { throw 'guardian_peer_vcvars64_missing' }

$out = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$target = Join-Path $out 'guardian-connected-peer.node'
$manifestPath = Join-Path $out 'guardian-peer-native-staging-manifest.json'
$ownedNames = @('guardian-connected-peer.node', 'guardian-peer-native-staging-manifest.json',
  'NODE-API-LICENSE.txt', 'node-api-header-provenance.json')
foreach ($entry in (Get-ChildItem -LiteralPath $out -Force)) {
  if ($entry.Name -cnotin $ownedNames -or $entry.PSIsContainer -or
      ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'guardian_peer_output_contains_unowned_or_reparse_entry'
  }
}
$stage = Join-Path $out ('.guardian-peer-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  $stagedBinary = Join-Path $stage 'guardian-connected-peer.node'
  $imports = Join-Path $stage 'imports.txt'
  foreach ($buildPath in @($vcvars, $headers, $sourceDir, $sources[0], $sources[1], $sources[2], $stagedBinary, $imports)) {
    AssertCmdPath $buildPath
  }
  $cryptoCompile = ''; $cryptoLink = ''
  if ($crypto) {
    $peerMap = Join-Path $stage 'peer.map'
    $cryptoCompile = $crypto.Compile; $cryptoLink = $crypto.Link + (' /MAP:"{0}"' -f $peerMap)
  }
  $command = 'call "{0}" >nul && set CL=&& set _CL_=&& set LINK=&& set _LINK_=&& cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /LD /DUNICODE /D_UNICODE {8} /I"{1}" /I"{2}" "{3}" "{4}" "{5}" /Fe:"{6}" /link advapi32.lib bcrypt.lib shell32.lib ole32.lib {9} && dumpbin.exe /nologo /imports "{6}" > "{7}"' -f $vcvars,$headers,$sourceDir,$sources[0],$sources[1],$sources[2],$stagedBinary,$imports,$cryptoCompile,$cryptoLink
  Push-Location $stage
  try {
    & $env:ComSpec /d /s /c $command
    if ($LASTEXITCODE -ne 0) { throw "guardian_peer_compile_exit_$LASTEXITCODE" }
  } finally { Pop-Location }
  CheckHeaders
  $peImports = @()
  if ($crypto) {
    $peImports = @(Assert-GuardianStaticPe $stagedBinary $vcvars (Join-Path $crypto.EvidenceDirectory 'peer-pe') -MapPath $peerMap)
    $null = Get-GuardianCryptoLink $CryptoBuild
  }
  if (-not (Test-Path -LiteralPath $stagedBinary -PathType Leaf)) { throw 'guardian_peer_native_binary_missing' }
  $importText = Get-Content -LiteralPath $imports -Raw
  if ($importText -match '(?im)^\s*(?:node\.(?:dll|exe)|libcrypto[^\s]*\.dll|libssl[^\s]*\.dll|vcruntime[^\s]*\.dll|msvcp[^\s]*\.dll|concrt[^\s]*\.dll)\s*$') {
    throw 'guardian_peer_external_runtime_import_forbidden'
  }
  $head = (git -C $root rev-parse HEAD).Trim()
  if ($head -notmatch '^[a-f0-9]{40}$') { throw 'guardian_peer_source_head_invalid' }
  $binary = Get-Item -LiteralPath $stagedBinary
  $manifest = [ordered]@{
    schema = 'metaengine.browser-guardian.peer-native-staging-manifest.v1'
    source_head = $head
    name = 'guardian-connected-peer.node'
    static_crypto = $(if ($crypto) { $crypto.Binding } else { $null })
    unlinked_test_build = [bool]$UnlinkedTestBuild
    pe_imports = $peImports
    napi_version = 9
    node_headers_version = '24.0.0'
    node_headers_archive_sha256 = '4605ee37eef345568f43de8c1843f3f7a243865654c1e942c50584de6bd59bb5'
    node_headers = $headerPins
    node_api_license_sha256 = (Sha256 $license)
    sha256 = (Sha256 $stagedBinary)
    bytes = [int64]$binary.Length
    in_process_connection = $true
    source = 'WINDOWS_NATIVE_CONNECTED_PIPE_OBSERVER'
    staging_only = $true
    windows_runtime_qualified = $false
    main_launch_implemented = $false
    loaded_runtime_code_attested = $false
    authority_effect = $false
  }
  # These outputs describe compilation only; they grant no native peer/launch
  # capability and cannot be supplied to the runtime as a claimed verified flag.
  # A repeat build refreshes only the exact owned outputs after recompilation;
  # no prior .node bytes or editable manifest is reused as build provenance.
  Move-Item -LiteralPath $stagedBinary -Destination $target -Force -ErrorAction Stop
  Copy-Item -LiteralPath $license -Destination (Join-Path $out 'NODE-API-LICENSE.txt') -Force -ErrorAction Stop
  Copy-Item -LiteralPath $provenance -Destination (Join-Path $out 'node-api-header-provenance.json') -Force -ErrorAction Stop
  [IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 5) + "`n"), [Text.UTF8Encoding]::new($false))
  if ((Sha256 $target) -cne $manifest.sha256) { throw 'guardian_peer_output_readback_mismatch' }
  if ($CryptoBuild) {
    Register-GuardianNativeOutput $CryptoBuild 'peer' $target
    Register-GuardianNativeOutput $CryptoBuild 'peer-manifest' $manifestPath
  }
  Write-Output ($manifest | ConvertTo-Json -Depth 5 -Compress)
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
