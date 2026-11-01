param(
  [Parameter(Mandatory = $true)][string]$SourceArchive,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$VcVarsPath = $env:ME2_VCVARS_PATH
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Source built tooling only. Never install NASM or download executable tooling here.
$sourceUrl = 'https://codeload.github.com/netwide-assembler/nasm/tar.gz/4a56d66ed9626d5a3ded5414c9d8b7f1a48ce065'
$archiveSha256 = '77ad39a2c82908b6b39ebc7cf0368a510fa1cf3d427b682055eb6357a985b1ee'
$archiveSize = 1721803
$sourceCommit = '4a56d66ed9626d5a3ded5414c9d8b7f1a48ce065'
$tagObject = '8f1fb545a582c55c69607f457b4d1e71c19b2ecf'
$archiveRoot = "nasm-$sourceCommit"
$compilerFlags = '/O2 /Zi /nologo /std:c11 /bigobj /MT'
$windowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-FullyQualifiedSourcePath([string]$Path) {
  if ($windowsHost) {
    return ($Path -match '^[A-Za-z]:[\\/]' -or $Path -match '^\\\\[^\\/]+\\[^\\/]+\\')
  }
  return [IO.Path]::IsPathRooted($Path)
}

if (-not (Test-FullyQualifiedSourcePath $SourceArchive) -or -not (Test-Path -LiteralPath $SourceArchive -PathType Leaf)) {
  throw 'guardian_nasm_absolute_source_archive_required'
}
$archive = (Resolve-Path -LiteralPath $SourceArchive).Path
if ((Get-Sha256 $archive) -cne $archiveSha256) { throw 'guardian_nasm_source_archive_digest_mismatch' }
if (-not $windowsHost) { throw 'guardian_nasm_windows_msvc_required' }

$vcvars = $null
if ($VcVarsPath) {
  if (-not (Test-FullyQualifiedSourcePath $VcVarsPath) -or -not (Test-Path -LiteralPath $VcVarsPath -PathType Leaf)) {
    throw 'guardian_nasm_explicit_vcvars_missing'
  }
  $vcvars = (Resolve-Path -LiteralPath $VcVarsPath).Path
  # cmd expands percent and exclamation marks even within quoted paths.
  if ($vcvars -match '[%!"\r\n&|<>^()]') { throw 'guardian_nasm_vcvars_shell_metacharacter_forbidden' }
}
if (-not $env:ComSpec -or -not (Test-Path -LiteralPath $env:ComSpec -PathType Leaf)) { throw 'guardian_nasm_cmd_missing' }
$python = (Get-Command python.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$extractor = Join-Path $PSScriptRoot 'extract-guardian-pinned-source.py'
if (-not (Test-Path -LiteralPath $extractor -PathType Leaf)) { throw 'guardian_nasm_pinned_source_extractor_missing' }
$perl = (Get-Command perl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$perlVersion = (& $perl -e 'print $^V').Trim()
if ($LASTEXITCODE -ne 0 -or $perlVersion -notmatch '^v5\.') { throw 'guardian_nasm_perl5_required' }
$perlHost = (& $perl -e 'print $^O').Trim()
if ($LASTEXITCODE -ne 0 -or $perlHost -cne 'MSWin32') { throw 'guardian_nasm_native_windows_perl_required' }

$resolvedOut = [IO.Path]::GetFullPath($OutputDir)
if ($resolvedOut -notmatch '^[A-Za-z]:\\' -or $resolvedOut -match '[%!"\r\n&|<>^()]') {
  throw 'guardian_nasm_output_shell_path_forbidden'
}
if (Test-Path -LiteralPath $resolvedOut) {
  if (-not (Test-Path -LiteralPath $resolvedOut -PathType Container) -or @(Get-ChildItem -LiteralPath $resolvedOut -Force).Count -ne 0) {
    throw 'guardian_nasm_output_must_be_empty'
  }
}

$requiredSourceFiles = @('Mkfiles/msvc.mak', 'version', 'version.pl', 'asm/nasm.c', 'x86/insns.dat', 'x86/preinsns.pl', 'LICENSE', 'zlib/LICENSE', 'stdlib/strlcpy.c')

New-Item -ItemType Directory -Path $resolvedOut -Force | Out-Null
$buildRoot = Join-Path $resolvedOut 'source'
$binRoot = Join-Path $resolvedOut 'bin'
$logRoot = Join-Path $resolvedOut 'logs'
$licenseRoot = Join-Path $resolvedOut 'licenses'
foreach ($dir in @($binRoot, $logRoot, $licenseRoot)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$extractResult = @(& $python $extractor --archive $archive --sha256 $archiveSha256 --size-bytes $archiveSize --root-directory $archiveRoot --output-dir $buildRoot)
if ($LASTEXITCODE -ne 0) { throw 'guardian_nasm_source_extract_failed' }
foreach ($line in $extractResult) { Write-Host $line }
$sourceRoot = Join-Path $buildRoot $archiveRoot
foreach ($relative in $requiredSourceFiles) {
  $sourceFile = Join-Path $sourceRoot $relative
  if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf) -or ((Get-Item -LiteralPath $sourceFile).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "guardian_nasm_extracted_source_file_invalid:$relative"
  }
}
if ((Get-Content -LiteralPath (Join-Path $sourceRoot 'version') -Raw).Trim() -cne '3.02') { throw 'guardian_nasm_source_version_invalid' }

function Invoke-NasmBuildCommand([string]$Command, [string]$LogName) {
  $prefix = ''
  if ($vcvars) { $prefix = 'call "{0}" >nul && ' -f $vcvars }
  # Prevent compiler/linker/make environment flags from changing the reviewed profile.
  $prefix += 'set VSLANG=1033&& set CL=&& set _CL_=&& set LINK=&& set _LINK_=&& set MAKEFLAGS=&& set MFLAGS=&& set NMAKEFLAGS=&& set PERL5OPT=&& set PERL5LIB=&& '
  $lines = @(& $env:ComSpec /d /s /c "($prefix$Command) 2>&1")
  $exitCode = $LASTEXITCODE
  [IO.File]::WriteAllLines((Join-Path $logRoot $LogName), [string[]]$lines, [Text.UTF8Encoding]::new($false))
  foreach ($line in $lines) { Write-Host $line }
  if ($exitCode -ne 0) { throw "guardian_nasm_build_command_failed:$LogName`:exit_$exitCode" }
}

Push-Location $sourceRoot
try {
  [IO.File]::WriteAllText((Join-Path $sourceRoot 'guardian-nasm-msvc-probe.c'), "int guardian_nasm_msvc_probe(void) { return 0; }`n", [Text.UTF8Encoding]::new($false))
  Invoke-NasmBuildCommand 'where cl.exe && where nmake.exe && where dumpbin.exe && cl.exe /nologo /Bv /MT /c guardian-nasm-msvc-probe.c /Foguardian-nasm-msvc-probe.obj' 'msvc-toolchain.txt'
  # The Git source archive lacks generated C/header files. Use upstream's own
  # Perl recipes before compiling, rather than assuming release-tarball outputs.
  Invoke-NasmBuildCommand 'nmake.exe /NOLOGO /f Mkfiles\msvc.mak perlreq' 'source-generation.txt'
  foreach ($relative in @('version.h', 'version.mak', 'asm/pptok.c', 'asm/tokhash.c', 'x86/insnsa.c', 'x86/iflaggen.h', 'macros/macros.c')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relative) -PathType Leaf)) { throw "guardian_nasm_generated_source_missing:$relative" }
  }
  Invoke-NasmBuildCommand ('nmake.exe /NOLOGO /f Mkfiles\msvc.mak "CFLAGS={0}" nasm.exe' -f $compilerFlags) 'msvc-build.txt'
  Invoke-NasmBuildCommand 'dumpbin.exe /NOLOGO /HEADERS nasm.exe' 'pe-headers.txt'
  Invoke-NasmBuildCommand 'dumpbin.exe /NOLOGO /IMPORTS nasm.exe' 'pe-imports.txt'
} finally { Pop-Location }

$builtExe = Join-Path $sourceRoot 'nasm.exe'
if (-not (Test-Path -LiteralPath $builtExe -PathType Leaf)) { throw 'guardian_nasm_binary_missing' }
$headers = Get-Content -LiteralPath (Join-Path $logRoot 'pe-headers.txt') -Raw
if ($headers -notmatch '(?im)^\s*8664 machine \(x64\)\s*$') { throw 'guardian_nasm_binary_architecture_invalid' }
$imports = Get-Content -LiteralPath (Join-Path $logRoot 'pe-imports.txt') -Raw
if ($imports -match '(?im)^\s*(?:MSVCR[^\s]*|MSVCP[^\s]*|VCRUNTIME[^\s]*|UCRTBASE[D]?|api-ms-win-crt-[^\s]*)\.dll\s*$') {
  throw 'guardian_nasm_dynamic_crt_import_forbidden'
}
$exe = Join-Path $binRoot 'nasm.exe'
Copy-Item -LiteralPath $builtExe -Destination $exe
$versionOutput = (& $exe -v | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^NASM version 3\.02(?:\s|$)') { throw 'guardian_nasm_binary_version_invalid' }

# An executable smoke check proves the produced assembler emits Windows x64 COFF;
# the consumer still runs OpenSSL's upstream tests on the resulting crypto code.
$smokeSource = Join-Path $resolvedOut 'win64-smoke.asm'
$smokeObject = Join-Path $resolvedOut 'win64-smoke.obj'
[IO.File]::WriteAllText($smokeSource, "bits 64`nsection .text`nglobal guardian_nasm_smoke`nguardian_nasm_smoke:`nmov rax, rcx`nret`n", [Text.UTF8Encoding]::new($false))
$previousNasmEnv = $env:NASMENV
try {
  Remove-Item Env:NASMENV -ErrorAction SilentlyContinue
  & $exe --reproducible -f win64 -o $smokeObject $smokeSource
  $smokeExit = $LASTEXITCODE
} finally {
  if ($null -ne $previousNasmEnv) { $env:NASMENV = $previousNasmEnv }
}
if ($smokeExit -ne 0 -or -not (Test-Path -LiteralPath $smokeObject -PathType Leaf)) { throw 'guardian_nasm_win64_smoke_failed' }
$objectBytes = [IO.File]::ReadAllBytes($smokeObject)
if ($objectBytes.Length -lt 20 -or $objectBytes[0] -ne 0x64 -or $objectBytes[1] -ne 0x86) { throw 'guardian_nasm_win64_smoke_architecture_invalid' }
Copy-Item -LiteralPath (Join-Path $sourceRoot 'LICENSE') -Destination (Join-Path $licenseRoot 'NASM-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'zlib/LICENSE') -Destination (Join-Path $licenseRoot 'NASM-ZLIB-LICENSE.txt')
$strlcpySource = Get-Content -LiteralPath (Join-Path $sourceRoot 'stdlib/strlcpy.c') -Raw
$strlcpyNotice = [regex]::Match($strlcpySource, '(?s)\A/\*.*?\*/').Value
if (-not $strlcpyNotice.Contains('Copyright (c) 1998 Todd C. Miller') -or -not $strlcpyNotice.Contains('Permission to use, copy, modify, and distribute')) {
  throw 'guardian_nasm_strlcpy_notice_missing'
}
[IO.File]::WriteAllText((Join-Path $licenseRoot 'NASM-STRLCPY-NOTICE.txt'), ($strlcpyNotice + "`n"), [Text.UTF8Encoding]::new($false))

$manifest = [ordered]@{
  schema = 'metaengine.browser.guardian-nasm-source-build.v1'
  version = '3.02'
  source_url = $sourceUrl
  source_archive_sha256 = $archiveSha256
  source_archive_size_bytes = $archiveSize
  source_archive_root = $archiveRoot
  source_commit = $sourceCommit
  source_tag = 'nasm-3.02'
  source_tag_object = $tagObject
  source_built = $true
  build_profile = 'windows-x64-msvc-release-static-crt'
  compiler_flags = $compilerFlags
  upstream_generated_source_target = 'perlreq'
  upstream_binary_target = 'nasm.exe'
  perl_path = $perl
  perl_version = $perlVersion
  perl_host = $perlHost
  binary = 'bin/nasm.exe'
  binary_sha256 = Get-Sha256 $exe
  binary_version_output = $versionOutput
  license = 'BSD-2-Clause'
  license_file = 'licenses/NASM-LICENSE.txt'
  license_sha256 = Get-Sha256 (Join-Path $licenseRoot 'NASM-LICENSE.txt')
  bundled_code_licenses = @('Zlib', 'ISC')
  bundled_code_notices = @(
    [ordered]@{ file = 'licenses/NASM-ZLIB-LICENSE.txt'; sha256 = Get-Sha256 (Join-Path $licenseRoot 'NASM-ZLIB-LICENSE.txt') },
    [ordered]@{ file = 'licenses/NASM-STRLCPY-NOTICE.txt'; sha256 = Get-Sha256 (Join-Path $licenseRoot 'NASM-STRLCPY-NOTICE.txt') }
  )
  pe_x64_verified = $true
  dynamic_crt_imports_absent = $true
  win64_coff_smoke_passed = $true
  assembler_output_reproducible_option = '--reproducible'
  binary_build_date_reproducibility_verified = $false
  windows_upstream_tests_run = $false
  installation_performed = $false
  service_activation_authorized = $false
  execution_gate = 'CLOSED'
}
$manifestPath = Join-Path $resolvedOut 'nasm-build-manifest.json'
[IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 5) + "`n"), [Text.UTF8Encoding]::new($false))
Write-Output ($manifest | ConvertTo-Json -Depth 5 -Compress)
