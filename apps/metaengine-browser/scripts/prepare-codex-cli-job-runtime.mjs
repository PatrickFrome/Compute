import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixedWindowsNativeReadEnvironment } from '../src/windows-native-read-environment.mjs';

// Explicit build/prepare only. Goal admission and the process controller must
// consume this output, never import this producer or compile a missing helper.
export const CODEX_CLI_JOB_RUNTIME_SCHEMA = 'metaengine.codex-cli.job-runtime.v1';
export const CODEX_CLI_JOB_RUNTIME_BUILD_MODE = 'PRECOMPILED_FRAMEWORK_CSHARP';
export const CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX = "[Reflection.Assembly]::Load([Convert]::FromBase64String('";
export const CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX = "')) | Out-Null";
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultTemplate = path.join(appRoot, 'scripts', 'codex-cli-job-runner.ps1');
const defaultOutput = path.join(appRoot, 'native-dist', 'codex-cli');
const run = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function extractCodexCliJobRuntimeTemplate(templateBytes) {
  if (!Buffer.isBuffer(templateBytes) || templateBytes.length < 64 || templateBytes.length > 256 * 1024) {
    throw Error('codex_job_runtime_template_size_invalid');
  }
  let text;
  try { text = utf8.decode(templateBytes); } catch { throw Error('codex_job_runtime_template_encoding_invalid'); }
  if (text.includes('\0') || !Buffer.from(text).equals(templateBytes)) throw Error('codex_job_runtime_template_encoding_invalid');
  const matches = [...text.matchAll(/^Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@(?=\r?\n|$)/gm)];
  if (matches.length !== 1 || (text.match(/\bAdd-Type\b/g) || []).length !== 1) {
    throw Error('codex_job_runtime_template_block_invalid');
  }
  const match = matches[0], csharpBytes = Buffer.from(match[1], 'utf8');
  if (!csharpBytes.length || !/\bpublic static class MetaengineCodexJob\b/.test(match[1])) {
    throw Error('codex_job_runtime_template_type_invalid');
  }
  return Object.freeze({
    prefix: Buffer.from(text.slice(0, match.index)),
    suffix: Buffer.from(text.slice(match.index + match[0].length)),
    csharpBytes,
    templateSha256: digest(templateBytes),
    csharpSha256: digest(csharpBytes),
  });
}

function verifyManagedAssembly(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 512 || bytes.length > 2 * 1024 * 1024 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw Error('codex_job_runtime_assembly_invalid');
  }
  const pe = bytes.readUInt32LE(0x3c);
  if (pe < 0x40 || pe + 256 > bytes.length || bytes.toString('binary', pe, pe + 4) !== 'PE\0\0') {
    throw Error('codex_job_runtime_assembly_invalid');
  }
  const optional = pe + 24, magic = bytes.readUInt16LE(optional);
  const directories = magic === 0x10b ? optional + 96 : magic === 0x20b ? optional + 112 : -1;
  if (directories < 0 || bytes.readUInt32LE(directories + 14 * 8) === 0 || bytes.readUInt32LE(directories + 14 * 8 + 4) === 0) {
    throw Error('codex_job_runtime_assembly_not_managed');
  }
}

export function renderCodexCliJobRuntimeHelper(templateBytes, assemblyBytes) {
  const template = extractCodexCliJobRuntimeTemplate(templateBytes);
  verifyManagedAssembly(assemblyBytes);
  const loader = CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX + assemblyBytes.toString('base64') + CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX;
  const helperBytes = Buffer.concat([template.prefix, Buffer.from(loader), template.suffix]);
  if (/\bAdd-Type\b/.test(helperBytes.toString('utf8'))) throw Error('codex_job_runtime_output_compilation_forbidden');
  return Object.freeze({ helperBytes, template });
}

async function readStableFile(file, maxBytes) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maxBytes) {
    throw Error('codex_job_runtime_input_file_invalid');
  }
  const bytes = await fs.readFile(file), after = await fs.lstat(file);
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) {
    throw Error('codex_job_runtime_input_changed');
  }
  return bytes;
}

// The reviewed PowerShell build driver invokes only the fixed Framework csc,
// checks its Microsoft signature and loads the result only to inspect Run's
// signature. No worker request is read and no job is started during preparation.
const compilerScript = String.raw`param([Parameter(Mandatory=$true)][string]$RequestPath)
$buildClock = [Diagnostics.Stopwatch]::StartNew()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSModuleAutoLoadingPreference = 'None'
Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Management\Microsoft.PowerShell.Management.psd1' -ErrorAction Stop
Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1' -ErrorAction Stop
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSEdition -ne 'Desktop' -or [Environment]::Version.Major -ne 4) { throw 'codex_job_runtime_framework_required' }
$request = [IO.File]::ReadAllText($RequestPath) | ConvertFrom-Json
$system = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
$windows = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
if (-not [String]::Equals($PSHOME, (Join-Path $system 'WindowsPowerShell\v1.0'), [StringComparison]::OrdinalIgnoreCase)) { throw 'codex_job_runtime_powershell_path_invalid' }
$framework = Join-Path $windows 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (-not [String]::Equals($compiler, [string]$request.compiler_path, [StringComparison]::OrdinalIgnoreCase)) { throw 'codex_job_runtime_compiler_path_invalid' }
$signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $compiler
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') { throw 'codex_job_runtime_compiler_signature_invalid' }
function Get-Digest([string]$File) {
  $stream = [IO.File]::OpenRead($File); $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
if ((Get-Digest $compiler) -ne [string]$request.compiler_sha256 -or (Get-Digest ([string]$request.source_path)) -ne [string]$request.csharp_sha256) { throw 'codex_job_runtime_build_input_changed' }
$arguments = @('/nologo', '/noconfig', '/nostdlib+', '/target:library', '/platform:anycpu', '/optimize+', '/debug-', '/codepage:65001', '/utf8output')
foreach ($name in @('mscorlib.dll', 'System.dll', 'System.Core.dll')) { $arguments += '/reference:' + (Join-Path $framework $name) }
$arguments += '/out:' + [string]$request.assembly_path
$arguments += [string]$request.source_path
function Quote-CompilerArgument([string]$Value) {
  # CommandLineToArgvW quoting: escape quotes and their preceding backslashes,
  # then double trailing backslashes before adding the closing quote.
  return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $compiler
$start.Arguments = (($arguments | ForEach-Object { Quote-CompilerArgument ([string]$_) }) -join ' ')
$start.WorkingDirectory = $system
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
$start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
$started = $false
try {
  if ($buildClock.ElapsedMilliseconds -ge 150000) { throw 'codex_job_runtime_compile_budget_exhausted' }
  if (-not $process.Start()) { throw 'codex_job_runtime_compiler_start_failed' }
  $started = $true
  $process.StandardInput.Close()
  # Drain both pipes concurrently; neither a GUI-subsystem executable nor a
  # full output pipe may turn invocation into an unobserved background build.
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $wait = [int][Math]::Max(0, [Math]::Min(120000, 150000 - $buildClock.ElapsedMilliseconds))
  $exited = $process.WaitForExit($wait)
  if (-not $exited) {
    $process.Kill()
    if (-not $process.WaitForExit(5000)) { throw 'codex_job_runtime_compiler_termination_timeout' }
  }
  if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout, $stderr), 5000)) { throw 'codex_job_runtime_compiler_output_timeout' }
  [Console]::Out.Write($stdout.GetAwaiter().GetResult())
  [Console]::Error.Write($stderr.GetAwaiter().GetResult())
  if (-not $exited) { throw 'codex_job_runtime_compile_timeout' }
  if ($process.ExitCode -ne 0) { throw ('codex_job_runtime_compile_failed_exit_' + $process.ExitCode) }
} finally {
  try {
    if ($started -and -not $process.HasExited) {
      $process.Kill()
      if (-not $process.WaitForExit(5000)) { throw 'codex_job_runtime_compiler_termination_timeout' }
    }
  } finally { $process.Dispose() }
}
if ((Get-Digest $compiler) -ne [string]$request.compiler_sha256 -or (Get-Digest ([string]$request.source_path)) -ne [string]$request.csharp_sha256) { throw 'codex_job_runtime_build_input_changed' }
$assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes([string]$request.assembly_path))
$type = $assembly.GetType('MetaengineCodexJob', $true, $false)
$types = [Type[]]@([string], [string[]], [string], [string], [uint32], [string], [string])
$method = $type.GetMethod('Run', [Reflection.BindingFlags]'Public,Static', $null, $types, $null)
if ($null -eq $method -or $method.ReturnType -ne [void]) { throw 'codex_job_runtime_entrypoint_invalid' }
$proof = [ordered]@{
  assembly_sha256 = Get-Digest ([string]$request.assembly_path)
  compiler_executable_sha256 = Get-Digest $compiler
  compiler_file_version = [Diagnostics.FileVersionInfo]::GetVersionInfo($compiler).FileVersion
  compiler_signature_status = [string]$signature.Status
  compiler_signer_subject = [string]$signature.SignerCertificate.Subject
  framework_runtime = [string][Environment]::Version
  powershell_version = [string]$PSVersionTable.PSVersion
  entrypoint = 'MetaengineCodexJob.Run'
}
[IO.File]::WriteAllText([string]$request.proof_path, ($proof | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
`;

async function replaceOutput(file, bytes) {
  const prior = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (prior && (!prior.isFile() || prior.isSymbolicLink())) throw Error('codex_job_runtime_output_file_invalid');
  const pending = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(pending, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(pending, file);
  } finally { await fs.rm(pending, { force: true }); }
}

async function removeOwnedBuildDirectory(buildRoot, buildStat) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await fs.lstat(buildRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!current) return;
    if (!buildStat || !current.isDirectory() || current.isSymbolicLink()
        || current.dev !== buildStat.dev || current.ino !== buildStat.ino) throw Error('codex_job_runtime_build_cleanup_refused');
    try {
      await fs.rm(buildRoot, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 5) throw error;
      // Retry only our captured directory, checking its identity again after
      // every wait. Six attempts spend at most 1.5 seconds in backoff.
      await delay((attempt + 1) * 100);
    }
  }
}

// Build-only cleanup, exported for physical directory/lock failure tests.
export async function cleanupCodexCliJobRuntimeBuild({ buildRoot, buildStat, lock, lockPath, lockStat, primaryError }) {
  const errors = [];
  try { if (buildRoot) await removeOwnedBuildDirectory(buildRoot, buildStat); }
  catch (error) { errors.push(error); }
  try {
    await lock.close();
    const currentLock = await fs.lstat(lockPath);
    if (!currentLock.isFile() || currentLock.isSymbolicLink()
        || currentLock.dev !== lockStat.dev || currentLock.ino !== lockStat.ino) throw Error('codex_job_runtime_build_lock_cleanup_refused');
    await fs.unlink(lockPath);
  } catch (error) { errors.push(error); }
  if (errors.length) {
    throw new AggregateError(primaryError ? [primaryError, ...errors] : errors,
      primaryError ? 'codex_job_runtime_build_and_cleanup_failed' : 'codex_job_runtime_cleanup_failed',
      { cause: primaryError ?? errors[0] });
  }
  if (primaryError) throw primaryError;
}

export async function prepareCodexCliJobRuntime({ helperSourcePath = defaultTemplate, outputDirectory = defaultOutput } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('codex_job_runtime_windows_x64_build_required');
  if (typeof helperSourcePath !== 'string' || !path.isAbsolute(helperSourcePath)
      || typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory)) throw Error('codex_job_runtime_build_path_invalid');
  // Match the existing native reader's fixed Windows root. Caller environment
  // variables cannot redirect PowerShell, csc or module discovery before checks.
  const systemRoot = 'C:\\Windows';
  const environment = fixedWindowsNativeReadEnvironment();
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const framework = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const compiler = path.join(framework, 'csc.exe');
  const templateBytes = await readStableFile(helperSourcePath, 256 * 1024);
  const template = extractCodexCliJobRuntimeTemplate(templateBytes);
  const compilerBytes = await readStableFile(compiler, 32 * 1024 * 1024);
  const powershellBytes = await readStableFile(powershell, 32 * 1024 * 1024);
  const compilerSha256 = digest(compilerBytes), powershellSha256 = digest(powershellBytes);
  const references = {};
  for (const name of ['mscorlib.dll', 'System.dll', 'System.Core.dll']) references[name] = digest(await readStableFile(path.join(framework, name), 64 * 1024 * 1024));
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputStat = await fs.lstat(outputDirectory);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw Error('codex_job_runtime_output_directory_invalid');
  const outputRoot = await fs.realpath(outputDirectory);
  const lockPath = path.join(outputRoot, '.prepare.lock');
  const lock = await fs.open(lockPath, 'wx').catch(error => { if (error.code === 'EEXIST') throw Error('codex_job_runtime_prepare_busy'); throw error; });
  const lockStat = await lock.stat();
  let buildRoot, buildStat, primaryError;
  try {
    buildRoot = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'metaengine-codex-job-build-'));
    buildStat = await fs.lstat(buildRoot);
    const sourcePath = path.join(buildRoot, 'MetaengineCodexJob.cs');
    const assemblyPath = path.join(buildRoot, 'metaengine-codex-job-runtime.dll');
    const proofPath = path.join(buildRoot, 'compiler-proof.json');
    const requestPath = path.join(buildRoot, 'request.json');
    const driverPath = path.join(buildRoot, 'compile.ps1');
    await fs.writeFile(sourcePath, template.csharpBytes, { flag: 'wx' });
    await fs.writeFile(driverPath, compilerScript, { flag: 'wx' });
    await fs.writeFile(requestPath, JSON.stringify({ source_path: sourcePath, assembly_path: assemblyPath, proof_path: proofPath,
      compiler_path: compiler, compiler_sha256: compilerSha256, csharp_sha256: template.csharpSha256 }), { flag: 'wx' });
    try {
      const pending = run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driverPath, '-RequestPath', requestPath],
        { shell: false, windowsHide: true, timeout: 180000, maxBuffer: 256 * 1024, cwd: path.join(systemRoot, 'System32'), env: environment });
      pending.child?.stdin?.end();
      await pending;
    } catch (error) {
      throw Error('codex_job_runtime_build_failed', { cause: error });
    }
    const assemblyBytes = await readStableFile(assemblyPath, 2 * 1024 * 1024);
    const proof = JSON.parse((await readStableFile(proofPath, 64 * 1024)).toString('utf8'));
    if (proof.assembly_sha256 !== digest(assemblyBytes) || proof.compiler_executable_sha256 !== compilerSha256
        || proof.compiler_signature_status !== 'Valid' || proof.entrypoint !== 'MetaengineCodexJob.Run') throw Error('codex_job_runtime_compiler_proof_invalid');
    if (!(await readStableFile(helperSourcePath, 256 * 1024)).equals(templateBytes)
        || digest(await readStableFile(compiler, 32 * 1024 * 1024)) !== compilerSha256
        || digest(await readStableFile(powershell, 32 * 1024 * 1024)) !== powershellSha256) throw Error('codex_job_runtime_build_input_changed');
    for (const [name, hash] of Object.entries(references)) {
      if (digest(await readStableFile(path.join(framework, name), 64 * 1024 * 1024)) !== hash) throw Error('codex_job_runtime_reference_changed');
    }
    const { helperBytes } = renderCodexCliJobRuntimeHelper(templateBytes, assemblyBytes);
    const manifest = Object.freeze({
      schema: CODEX_CLI_JOB_RUNTIME_SCHEMA, build_mode: CODEX_CLI_JOB_RUNTIME_BUILD_MODE,
      template_sha256: template.templateSha256, csharp_sha256: template.csharpSha256,
      assembly_sha256: digest(assemblyBytes), helper_sha256: digest(helperBytes),
      compiler_executable_sha256: compilerSha256, powershell_executable_sha256: powershellSha256,
      compiler_file_version: proof.compiler_file_version, compiler_signature_status: proof.compiler_signature_status,
      compiler_signer_subject: proof.compiler_signer_subject, framework_runtime: proof.framework_runtime,
      powershell_version: proof.powershell_version, reference_assembly_sha256: references,
      runtime_compilation: false, release_authority: false,
    });
    const currentOutput = await fs.lstat(outputDirectory);
    if (currentOutput.dev !== outputStat.dev || currentOutput.ino !== outputStat.ino
        || currentOutput.isSymbolicLink() || await fs.realpath(outputDirectory) !== outputRoot) throw Error('codex_job_runtime_output_directory_changed');
    const helperPath = path.join(outputRoot, 'codex-cli-job-runner.ps1'), manifestPath = path.join(outputRoot, 'manifest.json');
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    // Publish the hash manifest last: any concurrent reader of an interrupted
    // replacement refuses mismatched bytes instead of executing an old/new mix.
    await replaceOutput(helperPath, helperBytes);
    await replaceOutput(manifestPath, manifestBytes);
    if (!(await readStableFile(helperPath, 4 * 1024 * 1024)).equals(helperBytes)
        || !(await readStableFile(manifestPath, 64 * 1024)).equals(manifestBytes)) throw Error('codex_job_runtime_output_readback_failed');
    return Object.freeze({ helperPath, manifestPath, manifest });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await cleanupCodexCliJobRuntimeBuild({ buildRoot, buildStat, lock, lockPath, lockStat, primaryError });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const ifWindows = process.argv.length === 3 && process.argv[2] === '--if-windows';
  if (process.argv.length !== 2 && !ifWindows) throw Error('codex_job_runtime_prepare_arguments_invalid');
  // npm's explicit pretest build stage also serves older full-suite workflows.
  // A non-Windows test host has no native helper to build and emits no artifact.
  // The preparation API and ordinary CLI remain Windows-only and fail closed.
  if (ifWindows && process.platform !== 'win32') {
    console.log(JSON.stringify({ schema: 'metaengine.codex-cli.job-runtime-platform.v1',
      state: 'NOT_APPLICABLE', reason: 'WINDOWS_HELPER_ON_NON_WINDOWS_TEST_HOST', runtime_prepared: false }));
  } else {
    const result = await prepareCodexCliJobRuntime();
    console.log(JSON.stringify({ schema: result.manifest.schema, build_mode: result.manifest.build_mode,
      helper_sha256: result.manifest.helper_sha256, template_sha256: result.manifest.template_sha256, release_authority: false }));
  }
}
