param(
  [ValidateSet('PipeIo', 'Status', 'Lifetime', 'LaunchDiagnostic', 'ChildOwnership')]
  [string]$Probe = 'PipeIo',
  [string]$OutputDir = (Join-Path ([IO.Path]::GetTempPath()) ('metaengine-guardian-io-' + [guid]::NewGuid().ToString('N'))),
  [string]$VcVarsPath = $env:ME2_VCVARS_PATH,
  [string]$ExpectedHead = '',
  [switch]$RequireStopBeforePhysicalEffect,
  [switch]$RequireOwnedChildJoin
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'guardian_io_probe_requires_windows' }
if ($RequireStopBeforePhysicalEffect -and $Probe -ne 'LaunchDiagnostic') { throw 'guardian_strong_stop_requires_launch_diagnostic' }
if ($RequireOwnedChildJoin -and $Probe -ne 'LaunchDiagnostic' -and $Probe -ne 'ChildOwnership') { throw 'guardian_owned_child_join_requires_ownership_diagnostic' }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceDir = Join-Path $root 'native\browser-guardian-scm'
$head = (& git -C $root rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') { throw 'guardian_io_probe_source_head_invalid' }
if ($ExpectedHead -and $head -cne $ExpectedHead) { throw 'guardian_io_probe_source_head_mismatch' }
$tree = (& git -C $root rev-parse 'HEAD^{tree}' | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $tree -notmatch '^[0-9a-f]{40}$') { throw 'guardian_io_probe_source_tree_invalid' }
$spec = switch ($Probe) {
  'PipeIo' { @{ source = 'browser-guardian-scm-io-runtime-probe.cpp'; name = 'io'; schema = 'metaengine.browser-guardian.scm-io-runtime-proof.v1' } }
  'Status' { @{ source = 'browser-guardian-scm-status-runtime-probe.cpp'; name = 'status'; schema = 'metaengine.browser-guardian.scm-status-suite-proof.v1' } }
  'Lifetime' { @{ source = 'browser-guardian-pipe-io-lifetime-runtime.cpp'; name = 'lifetime'; schema = 'metaengine.browser-guardian.scm-lifetime-runtime-proof.v1' } }
  'LaunchDiagnostic' { @{ source = 'browser-guardian-effect-interleaving-diagnostic.cpp'; name = 'launch-diagnostic'; schema = 'metaengine.browser-guardian.effect-interleaving-diagnostic.v1' } }
  'ChildOwnership' { @{ source = 'browser-guardian-scm-child-ownership-runtime-probe.cpp'; name = 'child-ownership'; schema = 'metaengine.browser-guardian.scm-child-ownership-runtime-proof.v1' } }
}
$probeRelative = 'test/native/' + $spec.source
$reviewedPaths = @('native/browser-guardian-scm', $probeRelative, 'test/browser-guardian-scm-io-runtime.ps1')
$sourceStatus = (& git -C $root status --porcelain -- $reviewedPaths | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceStatus) { throw 'guardian_io_probe_requires_clean_source' }

$probeSource = Join-Path $root $probeRelative
$sources = @($probeSource) + @(
  'browser-guardian-update-actuator.cpp',
  'browser-guardian-owner-enrollment-observer.cpp',
  'browser-guardian-owner-enrollment-store.cpp',
  'browser-guardian-owner-enrollment-reconciler.cpp',
  'browser-guardian-enrollment-ticket-client.cpp'
) | ForEach-Object {
  if ([IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $sourceDir $_ }
}
if ($Probe -eq 'LaunchDiagnostic' -or $Probe -eq 'ChildOwnership') {
  # These diagnostics include the actual actuator implementation in their TU.
  $sources = @($sources | Where-Object { $_ -ne (Join-Path $sourceDir 'browser-guardian-update-actuator.cpp') })
}
foreach ($source in $sources) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "guardian_io_probe_source_missing:$source" }
}
$serviceSource = Join-Path $sourceDir 'browser-guardian-scm-service.cpp'
$inputs = @($sources) + @($serviceSource, (Join-Path $sourceDir 'browser-guardian-update-actuator.cpp')) + @(Get-ChildItem -LiteralPath $sourceDir -Filter '*.hpp' | ForEach-Object { $_.FullName })
$sourceHashes = @{}
foreach ($inputPath in $inputs) { $sourceHashes[$inputPath] = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash }
$inputDigests = @($inputs | Sort-Object -Unique | ForEach-Object {
  [ordered]@{ path = $_.Substring($root.Length + 1).Replace('\', '/'); sha256 = $sourceHashes[$_].ToLowerInvariant() }
})

if ($VcVarsPath) {
  if (-not [IO.Path]::IsPathRooted($VcVarsPath) -or -not (Test-Path -LiteralPath $VcVarsPath -PathType Leaf)) {
    throw 'guardian_io_probe_explicit_vcvars_missing'
  }
  $vcvars = (Resolve-Path -LiteralPath $VcVarsPath).Path
} else {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) { throw 'guardian_io_probe_vswhere_missing' }
  $vsRoot = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
  if (-not $vsRoot) { throw 'guardian_io_probe_cpp_toolchain_missing' }
  $vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
  if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf)) { throw 'guardian_io_probe_vcvars_missing' }
}

$resolvedOut = [IO.Path]::GetFullPath($OutputDir)
# Never delete or reuse preexisting output: the runner cannot remove another
# process's files or execute a stale probe after a failed compilation.
if (Test-Path -LiteralPath $resolvedOut) { throw 'guardian_io_probe_output_preexists' }
New-Item -ItemType Directory -Path $resolvedOut | Out-Null
$exe = Join-Path $resolvedOut ('guardian-scm-' + $spec.name + '-runtime-probe.exe')
$quotedSources = ($sources | ForEach-Object { '"' + $_ + '"' }) -join ' '
$compile = 'call "{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE {1} /Fe:"{2}" /link advapi32.lib bcrypt.lib shell32.lib ole32.lib userenv.lib wtsapi32.lib winhttp.lib' -f $vcvars,$quotedSources,$exe
Push-Location $resolvedOut
try {
  & $env:ComSpec /d /s /c $compile | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "guardian_io_probe_compile_exit_$LASTEXITCODE" }
} finally { Pop-Location }
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'guardian_io_probe_executable_missing' }

if ($Probe -eq 'Status') {
  $exitCode = 0
  $caseProofs = @()
  foreach ($caseName in @('status', 'checkpoint', 'before-start', 'start-pending', 'worker-join', 'teardown')) {
    $caseRaw = (& $exe $caseName | Out-String).Trim()
    $caseExit = $LASTEXITCODE
    if ($caseExit -eq 0 -and $caseRaw) {
      $caseProof = $caseRaw | ConvertFrom-Json
      if ($caseProof.schema -ne 'metaengine.browser-guardian.scm-status-runtime-proof.v1' -or $caseProof.ok -ne $true `
          -or $caseProof.case -cne $caseName -or $caseProof.windows_kernel_exercised -ne $true `
          -or $caseProof.scm_rpc_instrumented -ne $true -or $caseProof.production_worker_exercised -ne $false) {
        throw "guardian_status_case_proof_invalid:$caseName"
      }
      $caseProofs += $caseProof
    } else {
      $exitCode = 1
      $caseProofs += [pscustomobject]@{ case = $caseName; ok = $false; exit_code = $caseExit; native_output = $caseRaw }
    }
  }
  $proof = [pscustomobject]@{ schema = $spec.schema; ok = ($exitCode -eq 0); cases = $caseProofs }
} else {
  $probeArguments = @()
  if ($RequireStopBeforePhysicalEffect) { $probeArguments += '--require-stop-before-physical-effect' }
  if ($RequireOwnedChildJoin) { $probeArguments += '--require-owned-child-join' }
  $raw = (& $exe @probeArguments | Out-String).Trim()
  $exitCode = $LASTEXITCODE
  if (-not $raw) { throw 'guardian_io_probe_output_missing' }
}
if ($Probe -eq 'Lifetime') {
  $expected = 'guardian_pipe_io_runtime=PASS; real_cases=5; injected_cancel_delay_cases=1; service_installed=false; loaded_code_attested=false'
  $proof = [pscustomobject]@{
    schema = $spec.schema
    ok = ($exitCode -eq 0 -and $raw -ceq $expected)
    native_output = $raw
    installer_dispatch_exercised = $false
    scm_installation_exercised = $false
  }
} elseif ($Probe -eq 'PipeIo' -or $Probe -eq 'LaunchDiagnostic' -or $Probe -eq 'ChildOwnership') { $proof = $raw | ConvertFrom-Json }
if ($proof.schema -ne $spec.schema) {
  throw 'guardian_io_probe_proof_invalid'
}
foreach ($inputPath in $inputs) {
  if ((Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -cne $sourceHashes[$inputPath]) {
    throw "guardian_io_probe_input_changed:$inputPath"
  }
}
$afterHead = (& git -C $root rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $afterHead -cne $head) { throw 'guardian_io_probe_checkout_changed' }
$evidence = [ordered]@{
  schema = 'metaengine.browser-guardian.scm-io-runtime-evidence.v1'
  source_head = $head
  source_tree = $tree
  source_inputs = $inputDigests
  exe_sha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  os = [Environment]::OSVersion.VersionString
  runtime_exit_code = $exitCode
  diagnostic_only = ($Probe -eq 'LaunchDiagnostic' -or $Probe -eq 'ChildOwnership')
  stronger_contract_assertion_requested = [bool]$RequireStopBeforePhysicalEffect
  owned_child_join_required = [bool]$RequireOwnedChildJoin
  runtime = $proof
  installer_dispatch_exercised = $false
  scm_installation_exercised = $false
  authority_effect = $false
}
$json = $evidence | ConvertTo-Json -Depth 8
$proofPath = Join-Path $resolvedOut ('guardian-scm-' + $spec.name + '-runtime-evidence.json')
[IO.File]::WriteAllText($proofPath, $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Output $json
if ($exitCode -ne 0 -or $proof.ok -ne $true) { throw "guardian_io_probe_runtime_failed_exit_$exitCode" }
if ($Probe -eq 'ChildOwnership' -and $RequireOwnedChildJoin) {
  if ($proof.original_child_ownership_satisfied -ne $true -or $proof.require_owned_child_join -ne $true `
      -or $proof.actual_service_main_exercised -ne $true -or $proof.actual_launcher_exercised -ne $true `
      -or $proof.windows_kernel_exercised -ne $true -or $proof.child_cleanup_proven -ne $true `
      -or $proof.helper_rescue_termination_used -ne $false) {
    throw 'guardian_original_child_ownership_not_qualified'
  }
}
