param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$VcVarsPath = $env:ME2_VCVARS_PATH,
  [string]$GpgPath = $env:ME2_GPG_PATH,
  [string]$NodePath = $env:ME2_NODE_PATH,
  [string]$MsvcToolsetVersion = '',
  [string]$WindowsSdkVersion = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Assert-CmdPath([string]$Path) {
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '[%!"\r\n&|<>^()]') { throw 'guardian_openssl_unsafe_command_path' }
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'guardian_openssl_windows_msvc_required' }
$browserRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$signatureSourceDir = Join-Path $browserRoot 'native/browser-guardian-scm'
$signatureSource = Join-Path $signatureSourceDir 'browser-guardian-release-signature.cpp'
$signatureHeader = Join-Path $signatureSourceDir 'browser-guardian-release-signature.hpp'
$signatureTestSource = Join-Path $signatureSourceDir 'browser-guardian-release-signature-test.cpp'
$signatureNodeTest = Join-Path $browserRoot 'test/browser-guardian-release-signature.test.mjs'
$signatureLinkProbeSource = Join-Path $browserRoot 'native/openssl/guardian-signature-link-probe.cpp'
foreach ($path in @($signatureSource, $signatureHeader, $signatureTestSource, $signatureNodeTest, $signatureLinkProbeSource)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "guardian_openssl_existing_signature_input_missing:$path" }
  Assert-CmdPath $path
}
$repoRoot = (git -C $browserRoot rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'guardian_openssl_git_root_missing' }
$sourceHead = (git -C $repoRoot rev-parse HEAD).Trim()
if ((git -C $repoRoot status --porcelain --untracked-files=all | Out-String).Trim()) { throw 'guardian_openssl_source_checkout_not_clean' }
$lockPath = Join-Path $browserRoot 'native/openssl/guardian-openssl-source-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$lockSha = Get-Sha256 $lockPath
$source = (Resolve-Path -LiteralPath $SourceDir).Path
$out = [IO.Path]::GetFullPath($OutputDir)
foreach ($path in @($source, $out, $PSScriptRoot, $browserRoot)) { Assert-CmdPath $path }
if (Test-Path -LiteralPath $out) {
  if (-not (Test-Path -LiteralPath $out -PathType Container) -or @(Get-ChildItem -LiteralPath $out -Force).Count -ne 0) { throw 'guardian_openssl_output_must_be_empty' }
}
$verificationPath = Join-Path $source 'source-verification.json'
$verified = Get-Content -LiteralPath $verificationPath -Raw | ConvertFrom-Json
if ($verified.source_head -cne $sourceHead -or $verified.lock_sha256 -cne $lockSha `
    -or $verified.schema -cne 'metaengine.guardian-openssl-source-verification.v1' `
    -or $verified.openssl.signature_verified -ne $true `
    -or $verified.openssl.signing_primary_fingerprint -cne $lock.openssl.signing_primary_fingerprint `
    -or $verified.openssl.signing_subkey_fingerprint -cne $lock.openssl.signing_subkey_fingerprint) { throw 'guardian_openssl_source_verification_binding_invalid' }
if ((Get-Sha256 (Join-Path $source 'gpg-status.txt')) -cne $verified.gpg_status_sha256 `
    -or (Get-Sha256 (Join-Path $source 'openssl-release-signers.asc')) -cne $verified.certificate_sha256 `
    -or (Get-Sha256 (Join-Path $source 'guardian-openssl-source-lock.json')) -cne $lockSha) { throw 'guardian_openssl_source_evidence_digest_mismatch' }
foreach ($pin in @($lock.openssl.archive, $lock.openssl.signature, $lock.nasm.archive)) {
  if ([IO.Path]::GetFileName([string]$pin.filename) -cne [string]$pin.filename) { throw 'guardian_openssl_pin_filename_invalid' }
  $file = Join-Path $source ([string]$pin.filename)
  if ((Get-Item -LiteralPath $file).Length -ne $pin.size_bytes -or (Get-Sha256 $file) -cne $pin.sha256) { throw "guardian_openssl_pinned_file_mismatch:$($pin.filename)" }
}
$expectedArgs = @('VC-WIN64A','--release','no-shared','no-module','no-dso','no-engine','no-autoload-config','no-legacy','ASFLAGS=--reproducible')
if (($lock.configure_args -join ' ') -cne ($expectedArgs -join ' ')) { throw 'guardian_openssl_build_profile_unreviewed' }
if ($lock.openssl.source_date_epoch -ne 1790690724) { throw 'guardian_openssl_source_date_epoch_unreviewed' }
foreach ($version in @($MsvcToolsetVersion, $WindowsSdkVersion)) {
  if ($version -and $version -notmatch '^\d+(\.\d+){1,3}$') { throw 'guardian_openssl_toolchain_version_invalid' }
}
if (-not $VcVarsPath) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  $vsRoot = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
  if (-not $vsRoot) { throw 'guardian_openssl_msvc_toolchain_missing' }
  $VcVarsPath = Join-Path $vsRoot 'VC/Auxiliary/Build/vcvars64.bat'
}
$vcvarsOriginal = (Resolve-Path -LiteralPath $VcVarsPath).Path
Assert-CmdPath $vcvarsOriginal
$python = (Get-Command python.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$perl = (Get-Command perl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
if ($NodePath) { $node = (Resolve-Path -LiteralPath $NodePath).Path }
else {
  $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $defaultNodeVersion = (& $node -p 'process.versions.node').Trim()
  if ($LASTEXITCODE -ne 0) { throw 'guardian_openssl_node_version_probe_failed' }
  if ([version]$defaultNodeVersion -lt [version]'24.0.0' -and $env:RUNNER_TOOL_CACHE) {
    $cache = Join-Path $env:RUNNER_TOOL_CACHE 'node'
    if (Test-Path -LiteralPath $cache -PathType Container) {
      $versions = @(Get-ChildItem -LiteralPath $cache -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and [version]$_.Name -ge [version]'24.0.0' } | Sort-Object { [version]$_.Name } -Descending)
      foreach ($versionDir in $versions) {
        $candidate = Join-Path $versionDir.FullName 'x64/node.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $node = $candidate; break }
      }
    }
  }
}
foreach ($path in @($python, $perl, $node)) { Assert-CmdPath $path }
$nodeVersion = (& $node -p 'process.versions.node').Trim()
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'24.0.0') { throw 'guardian_openssl_existing_node24_required' }
$perlHost = (& $perl -e 'print $^O').Trim()
if ($LASTEXITCODE -ne 0 -or $perlHost -cne 'MSWin32') { throw 'guardian_openssl_native_windows_perl_required' }
if (-not $GpgPath) {
  $gpgCommand = Get-Command gpg.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($gpgCommand) { $GpgPath = $gpgCommand.Source }
  else {
    $gitDir = Split-Path (Get-Command git.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source -Parent
    foreach ($relative in @('../usr/bin/gpg.exe','../../usr/bin/gpg.exe')) {
      $candidate = [IO.Path]::GetFullPath((Join-Path $gitDir $relative))
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $GpgPath = $candidate; break }
    }
  }
}
if (-not $GpgPath -or -not (Test-Path -LiteralPath $GpgPath -PathType Leaf)) { throw 'guardian_openssl_existing_gpg_required_for_offline_reverification' }
$gpg = (Resolve-Path -LiteralPath $GpgPath).Path
Assert-CmdPath $gpg
New-Item -ItemType Directory -Path $out -Force | Out-Null
$work = Join-Path $out 'work'
$evidence = Join-Path $out 'evidence'
$artifact = Join-Path $out 'artifacts/openssl-static'
$signatureArtifact = Join-Path $out 'artifacts/guardian-signature'
foreach ($dir in @($work, $evidence, $artifact, (Join-Path $artifact 'lib'), (Join-Path $artifact 'include/openssl'),
    $signatureArtifact, (Join-Path $signatureArtifact 'lib'), (Join-Path $signatureArtifact 'include'))) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$reverificationDir = Join-Path $evidence 'source-reverification'
& $python (Join-Path $PSScriptRoot 'acquire-guardian-openssl-source.py') --verify-local-source-dir $source --evidence-dir $reverificationDir --gpg $gpg
if ($LASTEXITCODE -ne 0) { throw 'guardian_openssl_offline_signature_reverification_failed' }
$reverified = Get-Content -LiteralPath (Join-Path $reverificationDir 'source-verification.json') -Raw | ConvertFrom-Json
if ($reverified.verification_mode -cne 'offline_local_reverification' -or $reverified.network_used -ne $false `
    -or $reverified.openssl.signature_verified -ne $true -or $reverified.source_head -cne $sourceHead `
    -or $reverified.lock_sha256 -cne $lockSha) { throw 'guardian_openssl_offline_reverification_proof_invalid' }
$vcvars = Join-Path $work 'selected-vcvars.cmd'
$vcArgs = ''
if ($WindowsSdkVersion) { $vcArgs += " $WindowsSdkVersion" }
if ($MsvcToolsetVersion) { $vcArgs += " -vcvars_ver=$MsvcToolsetVersion" }
[IO.File]::WriteAllText($vcvars, "@chcp 65001 >nul`r`n" + ('@call "{0}"{1}' -f $vcvarsOriginal, $vcArgs) + "`r`n@exit /b %errorlevel%`r`n", [Text.UTF8Encoding]::new($false))

$nasmOut = Join-Path $work 'nasm'
try {
  & (Join-Path $PSScriptRoot 'build-guardian-nasm-static.ps1') -SourceArchive (Join-Path $source $lock.nasm.archive.filename) -OutputDir $nasmOut -VcVarsPath $vcvars
  if ($LASTEXITCODE -ne 0) { throw 'guardian_openssl_nasm_source_build_failed' }
} finally {
  if (Test-Path -LiteralPath (Join-Path $nasmOut 'logs')) { Copy-Item -LiteralPath (Join-Path $nasmOut 'logs') -Destination (Join-Path $evidence 'nasm') -Recurse }
}
$nasmProof = Get-Content -LiteralPath (Join-Path $nasmOut 'nasm-build-manifest.json') -Raw | ConvertFrom-Json
if ($nasmProof.source_archive_sha256 -cne $lock.nasm.archive.sha256 -or $nasmProof.win64_coff_smoke_passed -ne $true) { throw 'guardian_openssl_nasm_proof_invalid' }
Copy-Item -LiteralPath (Join-Path $nasmOut 'nasm-build-manifest.json') -Destination $evidence
Copy-Item -LiteralPath (Join-Path $nasmOut 'licenses') -Destination (Join-Path $evidence 'licenses') -Recurse
$nasmBin = Join-Path $nasmOut 'bin'
$extractOut = Join-Path $work 'openssl'
& $python (Join-Path $PSScriptRoot 'extract-guardian-pinned-source.py') --archive (Join-Path $source $lock.openssl.archive.filename) --sha256 $lock.openssl.archive.sha256 --size-bytes $lock.openssl.archive.size_bytes --root-directory $lock.openssl.archive.root_directory --output-dir $extractOut
if ($LASTEXITCODE -ne 0) { throw 'guardian_openssl_source_extract_failed' }
$buildRoot = Join-Path $extractOut $lock.openssl.archive.root_directory

function Invoke-LoggedBatch([string]$Name, [string[]]$Commands) {
  $batch = Join-Path $work "$Name.cmd"
  $lines = @('@echo off', '@chcp 65001 >nul', ('call "{0}" >nul' -f $vcvars), 'if errorlevel 1 exit /b %errorlevel%',
    ('set "PATH={0};%PATH%"' -f $nasmBin),
    ('set SOURCE_DATE_EPOCH={0}' -f $lock.openssl.source_date_epoch),
    'set VSLANG=1033', 'set CL=', 'set _CL_=', 'set LINK=', 'set _LINK_=', 'set MAKEFLAGS=', 'set MFLAGS=', 'set NMAKEFLAGS=',
    'set CC=', 'set CXX=', 'set AR=', 'set AS=', 'set ASFLAGS=', 'set NASMENV=', 'set RANLIB=', 'set CPP=', 'set RC=', 'set CFLAGS=', 'set CXXFLAGS=', 'set CPPFLAGS=', 'set LDFLAGS=',
    'set PERL5OPT=', 'set PERL5LIB=', 'set OPENSSL_LOCAL_CONFIG_DIR=', 'set OPENSSL_CONF=', 'set OPENSSL_CONF_INCLUDE=', 'set OPENSSL_MODULES=', 'set OPENSSL_ENGINES=',
    'set GUARDIAN_SENTINEL_LOADED=', 'set GUARDIAN_SENTINEL_MARKER_FILE=', 'set METAENGINE_GUARDIAN_RELEASE_SIGNATURE_TEST_BINARY=',
    ('cd /d "{0}"' -f $buildRoot))
  foreach ($command in $Commands) { $lines += $command; $lines += 'if errorlevel 1 exit /b %errorlevel%' }
  $lines += 'exit /b 0'
  [IO.File]::WriteAllLines($batch, [string[]]$lines, [Text.UTF8Encoding]::new($false))
  $log = Join-Path $evidence "$Name.txt"
  & $env:ComSpec /d /s /c ('call "{0}" > "{1}" 2>&1' -f $batch, $log)
  if ($LASTEXITCODE -ne 0) { throw "guardian_openssl_step_failed:$Name`:exit_$LASTEXITCODE`:log_$log" }
}

$probeSource = Join-Path $work 'msvc-probe.c'
[IO.File]::WriteAllText($probeSource, "int guardian_openssl_msvc_probe(void) { return 0; }`n", [Text.ASCIIEncoding]::new())
Invoke-LoggedBatch 'toolchain' @('where cl.exe', 'where lib.exe', 'where nmake.exe', 'where nasm.exe', 'where perl.exe', 'where dumpbin.exe',
  ('cl.exe /nologo /Bv /MT /c "{0}" /Fo"{1}"' -f $probeSource, (Join-Path $work 'msvc-probe.obj')),
  'echo VCToolsVersion=%VCToolsVersion%', 'echo WindowsSDKVersion=%WindowsSDKVersion%', 'perl.exe -V', 'nasm.exe -v', ('"{0}" --version' -f $node))
Invoke-LoggedBatch 'configure' @(('perl.exe Configure {0}' -f ($expectedArgs -join ' ')))
Invoke-LoggedBatch 'configdata' @('perl.exe configdata.pm --dump')
Invoke-LoggedBatch 'configuration-contract' @('perl.exe -I. -Mconfigdata -e "for(qw(shared module dso engine autoload-config legacy)){die qq(required-disabled:$_) unless exists $configdata::disabled{$_}}; for(qw(apps tests stdio)){die qq(unexpected-disabled:$_) if exists $configdata::disabled{$_}}"')
Invoke-LoggedBatch 'build' @('nmake.exe /NOLOGO')
Invoke-LoggedBatch 'upstream-tests' @('nmake.exe /NOLOGO test')
$dsoHeader = Join-Path $buildRoot 'include/crypto/dso_conf.h'
if ((Get-Content -LiteralPath $dsoHeader -Raw) -notmatch '#\s*define\s+DSO_NONE\b') { throw 'guardian_openssl_dso_none_missing' }
foreach ($header in @('include/crypto/dso_conf.h', 'include/openssl/configuration.h')) { Copy-Item -LiteralPath (Join-Path $buildRoot $header) -Destination $evidence }
if (@(Get-ChildItem -LiteralPath $buildRoot -Filter '*.dll' -Recurse -File).Count -ne 0) { throw 'guardian_openssl_unexpected_dynamic_library' }

$providerProbeSource = Join-Path $browserRoot 'native/openssl/guardian-openssl-provider-probe.cpp'
$sentinelSource = Join-Path $browserRoot 'native/openssl/guardian-openssl-provider-sentinel.cpp'
$providerProbe = Join-Path $work 'guardian-openssl-provider-probe.exe'
$hostileDir = Join-Path $work 'hostile-provider'
New-Item -ItemType Directory -Path $hostileDir | Out-Null
$sentinel = Join-Path $hostileDir 'guardian_external_probe.dll'
$hostileConfig = Join-Path $hostileDir 'openssl.cnf'
[IO.File]::WriteAllText($hostileConfig, "openssl_conf = guardian_test`n[guardian_test]`nproviders = guardian_providers`n[guardian_providers]`nguardian_external_probe = guardian_module`n[guardian_module]`nactivate = 1`n", [Text.ASCIIEncoding]::new())
Invoke-LoggedBatch 'provider-probe-build' @(
  ('cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /I"{0}" "{1}" /Fe:"{2}" /Fo"{3}" /link "{4}" ws2_32.lib gdi32.lib advapi32.lib crypt32.lib user32.lib' -f (Join-Path $buildRoot 'include'), $providerProbeSource, $providerProbe, (Join-Path $work 'provider-probe.obj'), (Join-Path $buildRoot 'libcrypto.lib')),
  ('cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /LD "{0}" /Fe:"{1}" /Fo"{2}" /link /IMPLIB:"{3}"' -f $sentinelSource, $sentinel, (Join-Path $work 'provider-sentinel.obj'), (Join-Path $hostileDir 'provider-sentinel.lib')))
$hostileEnvironment = @(
  ('set "OPENSSL_CONF={0}"' -f $hostileConfig), ('set "OPENSSL_CONF_INCLUDE={0}"' -f $hostileDir),
  ('set "OPENSSL_MODULES={0}"' -f $hostileDir), ('set "OPENSSL_ENGINES={0}"' -f $hostileDir))
$sentinelMarker = [IO.Path]::GetFullPath((Join-Path $work 'guardian-sentinel-loaded.marker'))
$workPrefix = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
if (-not $sentinelMarker.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase) -or $sentinelMarker.Length -ge 1024) { throw 'guardian_openssl_sentinel_marker_path_invalid' }
function Clear-SentinelMarker {
  if (Test-Path -LiteralPath $sentinelMarker) {
    if (-not (Test-Path -LiteralPath $sentinelMarker -PathType Leaf)) { throw 'guardian_openssl_sentinel_marker_not_file' }
    Remove-Item -LiteralPath $sentinelMarker -Force
  }
}
function Invoke-SentinelGuardedBatch([string]$Name, [string[]]$Commands, [bool]$Hostile) {
  Clear-SentinelMarker
  $runCommands = @('set GUARDIAN_SENTINEL_LOADED=', ('set "GUARDIAN_SENTINEL_MARKER_FILE={0}"' -f $sentinelMarker))
  if ($Hostile) { $runCommands += $hostileEnvironment }
  $runCommands += $Commands
  $runCommands += ('if exist "{0}" exit /b 96' -f $sentinelMarker)
  Invoke-LoggedBatch $Name $runCommands
  if (Test-Path -LiteralPath $sentinelMarker) { throw "guardian_openssl_sentinel_loaded:$Name" }
}
Invoke-SentinelGuardedBatch 'provider-probe' @(('"{0}"' -f $providerProbe)) $true
Invoke-LoggedBatch 'pe-imports' @(('dumpbin.exe /NOLOGO /IMPORTS "{0}"' -f $providerProbe))
Invoke-LoggedBatch 'pe-dependents' @(('dumpbin.exe /NOLOGO /DEPENDENTS "{0}"' -f $providerProbe))
Invoke-LoggedBatch 'pe-headers' @(('dumpbin.exe /NOLOGO /HEADERS "{0}"' -f $providerProbe))
$importsText = Get-Content -LiteralPath (Join-Path $evidence 'pe-imports.txt') -Raw
$imports = @([regex]::Matches($importsText, '(?im)^\s*([a-z0-9_.-]+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique)
$allowedImports = @('kernel32.dll','advapi32.dll','crypt32.dll','user32.dll','gdi32.dll','ws2_32.dll','bcrypt.dll','ntdll.dll')
if ($imports.Count -eq 0) { throw 'guardian_openssl_pe_import_evidence_missing' }
foreach ($dll in $imports) { if ($dll -notin $allowedImports) { throw "guardian_openssl_pe_import_not_allowed:$dll" } }
if ((Get-Content -LiteralPath (Join-Path $evidence 'pe-headers.txt') -Raw) -notmatch '(?im)^\s*8664 machine \(x64\)\s*$') { throw 'guardian_openssl_pe_architecture_invalid' }
$probeResult = Get-Content -LiteralPath (Join-Path $evidence 'provider-probe.txt') -Raw | ConvertFrom-Json
if ($probeResult.sha256_known_answer -ne $true -or $probeResult.external_provider_rejected -ne $true -or $probeResult.sentinel_not_loaded -ne $true) { throw 'guardian_openssl_provider_probe_failed' }

# Build the actual public production object separately from its test-only TU.
# The latter includes private implementation solely for the existing RFC/canonical
# tests; no fixture key or test root becomes part of the production archive.
$signatureObject = Join-Path $work 'signature.obj'
$signatureLibrary = Join-Path $signatureArtifact 'lib/guardian-release-signature.lib'
$signatureTest = Join-Path $work 'guardian-release-signature-test.exe'
$signatureLinkProbe = Join-Path $work 'signature-production-link-probe.exe'
$signatureInclude = Join-Path $signatureArtifact 'include'
Copy-Item -LiteralPath $signatureHeader -Destination $signatureInclude
$cryptoLibrary = Join-Path $buildRoot 'libcrypto.lib'
$cryptoInclude = Join-Path $buildRoot 'include'
Invoke-LoggedBatch 'signature-production-library-build' @(
  ('cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /I"{0}" /c "{1}" /Fo"{2}"' -f $cryptoInclude, $signatureSource, $signatureObject),
  ('lib.exe /NOLOGO /OUT:"{0}" "{1}"' -f $signatureLibrary, $signatureObject),
  ('lib.exe /NOLOGO /LIST "{0}"' -f $signatureLibrary),
  ('dumpbin.exe /NOLOGO /DIRECTIVES "{0}"' -f $signatureObject))
Invoke-LoggedBatch 'signature-test-build' @(
  ('cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /I"{0}" "{1}" /Fe:"{2}" /Fo"{3}" /link "{4}" ws2_32.lib gdi32.lib advapi32.lib crypt32.lib user32.lib' -f $cryptoInclude, $signatureTestSource, $signatureTest, (Join-Path $work 'signature-test.obj'), $cryptoLibrary))
Invoke-LoggedBatch 'signature-link-probe-build' @(
  ('cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /I"{0}" /I"{1}" "{2}" /Fe:"{3}" /Fo"{4}" /link "{5}" "{6}" ws2_32.lib gdi32.lib advapi32.lib crypt32.lib user32.lib' -f $signatureInclude, $cryptoInclude, $signatureLinkProbeSource, $signatureLinkProbe, (Join-Path $work 'signature-link-probe.obj'), $signatureLibrary, $cryptoLibrary))

# Prove the sentinel trap is effective before relying on its absence in child
# processes. This explicit test mode loads only our newly built disposable DLL.
Clear-SentinelMarker
Invoke-LoggedBatch 'signature-sentinel-positive-control' @(
  'set GUARDIAN_SENTINEL_LOADED=', ('set "GUARDIAN_SENTINEL_MARKER_FILE={0}"' -f $sentinelMarker),
  ('"{0}" --sentinel-control "{1}"' -f $signatureLinkProbe, $sentinel))
$sentinelControl = Get-Content -LiteralPath (Join-Path $evidence 'signature-sentinel-positive-control.txt') -Raw | ConvertFrom-Json
if ($sentinelControl.schema -cne 'metaengine.guardian.signature-sentinel-control.v1' -or $sentinelControl.sentinel_loaded -ne $true `
    -or -not (Test-Path -LiteralPath $sentinelMarker -PathType Leaf)) { throw 'guardian_openssl_sentinel_positive_control_failed' }
Clear-SentinelMarker

$nodeCommand = @(
  ('set "METAENGINE_GUARDIAN_RELEASE_SIGNATURE_TEST_BINARY={0}"' -f $signatureTest),
  ('"{0}" --test --test-reporter=tap "{1}"' -f $node, $signatureNodeTest))
foreach ($mode in @('clean', 'hostile')) {
  $hostile = $mode -ceq 'hostile'
  Invoke-SentinelGuardedBatch "signature-native-test-$mode" @(('"{0}"' -f $signatureTest)) $hostile
  $nativeTestOutput = (Get-Content -LiteralPath (Join-Path $evidence "signature-native-test-$mode.txt") -Raw).Trim()
  if ($nativeTestOutput -cne 'native_release_signature_checks=PASS; production_positive=UNAVAILABLE; loaded_code=NOT_ATTESTED') { throw 'guardian_openssl_native_signature_test_proof_invalid' }
  Invoke-SentinelGuardedBatch "signature-link-probe-$mode" @(('"{0}"' -f $signatureLinkProbe)) $hostile
  $linkProof = Get-Content -LiteralPath (Join-Path $evidence "signature-link-probe-$mode.txt") -Raw | ConvertFrom-Json
  if ($linkProof.schema -cne 'metaengine.guardian.signature-production-link-probe.v1' `
      -or $linkProof.malformed_manifest_rejected -ne $true -or $linkProof.canonical_zero_signature_rejected -ne $true `
      -or $linkProof.sentinel_not_loaded -ne $true -or $linkProof.productionroot_positive_available -ne $false `
      -or $linkProof.service_loaded_code_attested -ne $false) { throw 'guardian_openssl_production_link_probe_failed' }
  Invoke-SentinelGuardedBatch "signature-node-test-$mode" $nodeCommand $hostile
  $nodeLog = Get-Content -LiteralPath (Join-Path $evidence "signature-node-test-$mode.txt") -Raw
  if ($nodeLog -notmatch '(?m)^# fail 0\s*$' -or $nodeLog -notmatch '(?m)^# skipped 0\s*$' `
      -or $nodeLog -notmatch '(?m)^# pass [1-9][0-9]*\s*$') { throw 'guardian_openssl_native_signature_cross_language_test_summary_invalid' }
}
function Get-ReviewedSignaturePeImports([string]$Name, [string]$Binary) {
  Invoke-LoggedBatch "$Name-imports" @(('dumpbin.exe /NOLOGO /IMPORTS "{0}"' -f $Binary))
  Invoke-LoggedBatch "$Name-dependents" @(('dumpbin.exe /NOLOGO /DEPENDENTS "{0}"' -f $Binary))
  Invoke-LoggedBatch "$Name-headers" @(('dumpbin.exe /NOLOGO /HEADERS "{0}"' -f $Binary))
  $text = Get-Content -LiteralPath (Join-Path $evidence "$Name-imports.txt") -Raw
  $found = @([regex]::Matches($text, '(?im)^\s*([a-z0-9_.-]+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique)
  if ($found.Count -eq 0) { throw "guardian_openssl_signature_pe_import_evidence_missing:$Name" }
  foreach ($dll in $found) { if ($dll -notin $allowedImports) { throw "guardian_openssl_signature_pe_import_not_allowed:$Name`:$dll" } }
  if ((Get-Content -LiteralPath (Join-Path $evidence "$Name-headers.txt") -Raw) -notmatch '(?im)^\s*8664 machine \(x64\)\s*$') { throw "guardian_openssl_signature_pe_architecture_invalid:$Name" }
  return $found
}
$signatureTestImports = @(Get-ReviewedSignaturePeImports 'signature-test-pe' $signatureTest)
$signatureLinkImports = @(Get-ReviewedSignaturePeImports 'signature-link-probe-pe' $signatureLinkProbe)
$signatureBinaries = Join-Path $evidence 'native-signature-binaries'
New-Item -ItemType Directory -Path $signatureBinaries | Out-Null
foreach ($binary in @($signatureTest, $signatureLinkProbe)) { Copy-Item -LiteralPath $binary -Destination $signatureBinaries }

foreach ($name in @('libcrypto.lib','libssl.lib')) { Copy-Item -LiteralPath (Join-Path $buildRoot $name) -Destination (Join-Path $artifact 'lib') }
Copy-Item -Path (Join-Path $buildRoot 'include/openssl/*.h') -Destination (Join-Path $artifact 'include/openssl')
Copy-Item -LiteralPath (Join-Path $buildRoot 'LICENSE.txt') -Destination $artifact
[IO.File]::WriteAllText((Join-Path $artifact 'THIRD_PARTY_NOTICES.txt'), "OpenSSL $($lock.openssl.version)`nhttps://openssl-library.org/`nApache License 2.0: see LICENSE.txt (unmodified upstream text).`nThe verified upstream source archive does not contain a root NOTICE file.`n", [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $verificationPath -Destination $evidence
Copy-Item -LiteralPath $lockPath -Destination $evidence
Copy-Item -LiteralPath (Join-Path $source 'gpg-status.txt') -Destination $evidence
Copy-Item -LiteralPath (Join-Path $source 'openssl-release-signers.asc') -Destination $evidence
$artifactFiles = @(Get-ChildItem -LiteralPath $artifact -Recurse -File | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($artifact.Length + 1).Replace('\','/'); sha256 = Get-Sha256 $_.FullName; size_bytes = $_.Length }
})
$signatureArtifactFiles = @(Get-ChildItem -LiteralPath $signatureArtifact -Recurse -File | Sort-Object FullName | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($signatureArtifact.Length + 1).Replace('\','/'); sha256 = Get-Sha256 $_.FullName; size_bytes = $_.Length }
})
$proof = [ordered]@{
  schema = 'metaengine.browser.guardian-openssl-static-build.v1'
  source_head = $sourceHead
  source_worktree_clean = $true
  source_lock_sha256 = $lockSha
  openssl_version = $lock.openssl.version
  openssl_source_sha256 = $lock.openssl.archive.sha256
  source_date_epoch = $lock.openssl.source_date_epoch
  openssl_signature_verified = $true
  offline_windows_signature_reverified = $true
  gpg_executable_sha256 = Get-Sha256 $gpg
  node_version = $nodeVersion
  node_executable_sha256 = Get-Sha256 $node
  configure_args = $expectedArgs
  runtime_library = '/MT'
  nasm_source_built = $true
  nasm_binary_sha256 = $nasmProof.binary_sha256
  msvc_toolset_requested = $MsvcToolsetVersion
  windows_sdk_requested = $WindowsSdkVersion
  runner_image_version = $env:ImageVersion
  upstream_test_exit_code = 0
  upstream_test_log = 'evidence/upstream-tests.txt'
  pe_imports = $imports
  provider_probe_passed = $true
  external_provider_sentinel_not_loaded = $true
  native_verifier_linked = $false
  native_verifier_production_library_built = $true
  native_verifier_test_executable_linked = $true
  native_verifier_tests_passed = $true
  native_verifier_cross_language_tests_passed = $true
  native_verifier_production_link_probe_passed = $true
  native_verifier_sentinel_positive_control_passed = $true
  native_verifier_hostile_environment_tests_passed = $true
  productionroot_positive_available = $false
  native_verifier_linked_into_guardian_service = $false
  native_verifier_source_sha256 = Get-Sha256 $signatureSource
  native_verifier_test_source_sha256 = Get-Sha256 $signatureTestSource
  native_verifier_test_executable_sha256 = Get-Sha256 $signatureTest
  native_verifier_production_link_probe_sha256 = Get-Sha256 $signatureLinkProbe
  native_verifier_test_pe_imports = $signatureTestImports
  native_verifier_link_probe_pe_imports = $signatureLinkImports
  native_verifier_test_logs = @('evidence/signature-native-test-clean.txt','evidence/signature-native-test-hostile.txt',
    'evidence/signature-node-test-clean.txt','evidence/signature-node-test-hostile.txt',
    'evidence/signature-link-probe-clean.txt','evidence/signature-link-probe-hostile.txt')
  native_verifier_blocker = 'guardian_service_integration_loaded_code_and_production_root_positive_not_qualified'
  production_qualified = $false
  bit_identical_reproducibility_verified = $false
  installation_performed = $false
  service_activation_authorized = $false
  execution_gate = 'CLOSED'
  artifact_root = 'artifacts/openssl-static'
  consumer_include_directory = 'artifacts/openssl-static/include'
  consumer_crypto_library = 'artifacts/openssl-static/lib/libcrypto.lib'
  consumer_msvc_runtime_flag = '/MT'
  files = $artifactFiles
  native_verifier_artifact_root = 'artifacts/guardian-signature'
  native_verifier_consumer_include_directory = 'artifacts/guardian-signature/include'
  native_verifier_consumer_library = 'artifacts/guardian-signature/lib/guardian-release-signature.lib'
  native_verifier_files = $signatureArtifactFiles
}
[IO.File]::WriteAllText((Join-Path $out 'openssl-static-build-proof.json'), (($proof | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
Write-Output ($proof | ConvertTo-Json -Depth 8 -Compress)
