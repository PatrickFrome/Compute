param([Parameter(Mandatory=$true)]$CryptoBuild, [Parameter(Mandatory=$true)][string]$OutputDir,
  [string]$VcVarsPath = $env:ME2_VCVARS_PATH)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'guardian-static-crypto.psm1')
$crypto = Get-GuardianCryptoLink $CryptoBuild
if (-not $VcVarsPath) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  $vsRoot = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
  if (-not $vsRoot) { throw 'guardian_linked_namespace_toolchain_missing' }
  $VcVarsPath = Join-Path $vsRoot 'VC/Auxiliary/Build/vcvars64.bat'
}
$root = Split-Path $PSScriptRoot -Parent
$native = Join-Path $root 'native/browser-guardian-scm'
$probe = Join-Path $root 'test/native/browser-guardian-installed-namespace-probe.cpp'
$source = Join-Path $native 'browser-guardian-installed-namespace.cpp'
$out = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$binary = Join-Path $out 'linked-namespace-probe.exe'
foreach ($path in @($VcVarsPath,$native,$probe,$source,$binary)) { Assert-GuardianCommandPath $path }
$command = 'call "{0}" >nul && set CL=&& set _CL_=&& set LINK=&& set _LINK_=&& cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE /DMETAENGINE_GUARDIAN_NAMESPACE_TEST {1} /I"{2}" "{3}" "{4}" /Fe:"{5}" /link advapi32.lib bcrypt.lib {6}' -f $VcVarsPath,$crypto.Compile,$native,$probe,$source,$binary,$crypto.Link
Push-Location $out
try { & $env:ComSpec /d /s /c $command; if ($LASTEXITCODE -ne 0) { throw 'guardian_linked_namespace_compile_failed' } }
finally { Pop-Location }
$null = Assert-GuardianStaticPe $binary $VcVarsPath (Join-Path $out 'pe')
$lines = @(& $binary)
$exit = $LASTEXITCODE
[IO.File]::WriteAllLines((Join-Path $out 'runtime.jsonl'), [string[]]$lines, [Text.UTF8Encoding]::new($false))
if ($exit -ne 0) { throw "guardian_linked_namespace_runtime_failed_or_unavailable:$exit" }
$rows = @($lines | ForEach-Object { $_ | ConvertFrom-Json })
foreach ($name in @('linked_missing_envelope_rejected','linked_noncanonical_envelope_rejected','linked_noncanonical_base64_rejected',
    'linked_invalid_base64_rejected','linked_canonical_zero_signature_rejected','linked_rfc_signature_is_not_production_root',
    'preexisting_mapped_writer_rejected','preexisting_writable_section_without_view_rejected')) {
  $row = @($rows | Where-Object { $_.name -ceq $name })
  if ($row.Count -ne 1 -or $row[0].state -cne 'PASS') { throw "guardian_linked_namespace_required_case_failed:$name" }
}
$null = Get-GuardianCryptoLink $CryptoBuild
