import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX,
  CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX,
  CODEX_CLI_JOB_RUNTIME_SCHEMA,
  CODEX_CLI_JOB_RUNTIME_BUILD_MODE,
  extractCodexCliJobRuntimeTemplate,
  renderCodexCliJobRuntimeHelper,
  prepareCodexCliJobRuntime,
  cleanupCodexCliJobRuntimeBuild,
} from '../scripts/prepare-codex-cli-job-runtime.mjs';

const templateUrl = new URL('../scripts/codex-cli-job-runner.ps1', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const readTemplate = () => fs.readFile(templateUrl);
const removeDirectory = fs.rm;

async function ownedBuildResources(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'metaengine-job-build-cleanup-test-'));
  const buildRoot = path.join(root, 'build'), lockPath = path.join(root, '.prepare.lock');
  await fs.mkdir(buildRoot);
  await fs.writeFile(path.join(buildRoot, 'compiler-proof.json'), '{}');
  const lock = await fs.open(lockPath, 'wx');
  t.after(async () => { await lock.close(); await removeDirectory(root, { recursive: true, force: true }); });
  return { buildRoot, buildStat: await fs.lstat(buildRoot), lock, lockPath, lockStat: await lock.stat() };
}

test('build cleanup retries transient Windows locks and physically removes only the captured directory', async t => {
  const resources = await ownedBuildResources(t);
  const codes = ['EBUSY', 'EPERM', 'ENOTEMPTY'];
  let attempts = 0;
  t.mock.method(fs, 'rm', async (target, options) => {
    assert.equal(target, resources.buildRoot);
    const code = codes[attempts++];
    if (code) throw Object.assign(Error('transient directory lock'), { code });
    return removeDirectory(target, options);
  });
  await cleanupCodexCliJobRuntimeBuild(resources);
  assert.equal(attempts, 4);
  await assert.rejects(fs.access(resources.buildRoot), { code: 'ENOENT' });
  await assert.rejects(fs.access(resources.lockPath), { code: 'ENOENT' });
});

test('build cleanup stops after six busy attempts, fails closed and releases the owned preparation lock', async t => {
  const resources = await ownedBuildResources(t);
  const busy = Object.assign(Error('directory remains busy'), { code: 'EBUSY' });
  let attempts = 0;
  t.mock.method(fs, 'rm', async () => { attempts++; throw busy; });
  await assert.rejects(cleanupCodexCliJobRuntimeBuild(resources), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, 'codex_job_runtime_cleanup_failed');
    assert.equal(error.cause, busy);
    assert.deepEqual(error.errors, [busy]);
    return true;
  });
  assert.equal(attempts, 6);
  assert.equal(await fs.readFile(path.join(resources.buildRoot, 'compiler-proof.json'), 'utf8'), '{}');
  await assert.rejects(fs.access(resources.lockPath), { code: 'ENOENT' });
});

test('build cleanup rechecks directory identity after a busy attempt and preserves a replacement directory', async t => {
  const resources = await ownedBuildResources(t);
  let attempts = 0;
  t.mock.method(fs, 'rm', async target => {
    attempts++;
    await fs.rename(target, target + '-original');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'replacement.txt'), 'must remain');
    throw Object.assign(Error('directory busy before replacement'), { code: 'EBUSY' });
  });
  await assert.rejects(cleanupCodexCliJobRuntimeBuild(resources), error => {
    assert.equal(error.cause.message, 'codex_job_runtime_build_cleanup_refused');
    return true;
  });
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(path.join(resources.buildRoot, 'replacement.txt'), 'utf8'), 'must remain');
  assert.equal(await fs.readFile(path.join(resources.buildRoot + '-original', 'compiler-proof.json'), 'utf8'), '{}');
  await assert.rejects(fs.access(resources.lockPath), { code: 'ENOENT' });
});

test('build cleanup preserves the primary compiler failure and both independent cleanup failures', async t => {
  const resources = await ownedBuildResources(t);
  const compilerCause = Object.assign(Error('compiler diagnostics'), { stderr: 'physical compiler failure' });
  const primaryError = Error('codex_job_runtime_build_failed', { cause: compilerCause });
  const removalError = Object.assign(Error('unexpected removal error'), { code: 'EIO' });
  let attempts = 0;
  t.mock.method(fs, 'rm', async () => { attempts++; throw removalError; });
  await fs.rename(resources.lockPath, resources.lockPath + '-original');
  await fs.writeFile(resources.lockPath, 'replacement lock');
  await assert.rejects(cleanupCodexCliJobRuntimeBuild({ ...resources, primaryError }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, 'codex_job_runtime_build_and_cleanup_failed');
    assert.equal(error.cause, primaryError);
    assert.equal(error.cause.cause, compilerCause);
    assert.equal(error.errors.length, 3);
    assert.equal(error.errors[0], primaryError);
    assert.equal(error.errors[1], removalError);
    assert.equal(error.errors[2].message, 'codex_job_runtime_build_lock_cleanup_refused');
    return true;
  });
  assert.equal(attempts, 1, 'unrelated filesystem failures must not be retried');
  assert.equal(await fs.readFile(resources.lockPath, 'utf8'), 'replacement lock');
});

test('successful build cleanup retains the exact primary failure without wrapping or replacing it', async t => {
  const resources = await ownedBuildResources(t);
  const primaryError = Error('original failed build');
  await assert.rejects(cleanupCodexCliJobRuntimeBuild({ ...resources, primaryError }), error => error === primaryError);
  await assert.rejects(fs.access(resources.buildRoot), { code: 'ENOENT' });
  await assert.rejects(fs.access(resources.lockPath), { code: 'ENOENT' });
});

test('build cleanup accepts an already removed build directory and still releases its owned lock', async t => {
  const resources = await ownedBuildResources(t);
  await removeDirectory(resources.buildRoot, { recursive: true });
  await cleanupCodexCliJobRuntimeBuild(resources);
  await assert.rejects(fs.access(resources.lockPath), { code: 'ENOENT' });
});

// Only a header fixture for the byte-transform tests below. The Windows test
// compiles and reflects the actual reviewed class; this buffer proves no CLR run.
function managedHeaderFixture() {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ', 0); bytes.writeUInt32LE(0x80, 0x3c); bytes.write('PE\0\0', 0x80, 'binary');
  bytes.writeUInt16LE(0x10b, 0x80 + 24);
  bytes.writeUInt32LE(0x2000, 0x80 + 24 + 96 + 14 * 8);
  bytes.writeUInt32LE(72, 0x80 + 24 + 96 + 14 * 8 + 4);
  return bytes;
}

test('precompilation preserves exact C# and all protocol text outside the single Add-Type block, with LF or CRLF', async () => {
  const original = (await readTemplate()).toString('utf8').replace(/\r\n/g, '\n');
  for (const ending of ['\n', '\r\n']) {
    const bytes = Buffer.from(original.replaceAll('\n', ending));
    const extracted = extractCodexCliJobRuntimeTemplate(bytes);
    const start = bytes.indexOf(Buffer.from("Add-Type -TypeDefinition @'" + ending));
    const sourceStart = start + Buffer.byteLength("Add-Type -TypeDefinition @'" + ending);
    const sourceEnd = bytes.indexOf(Buffer.from(ending + "'@"), sourceStart);
    assert.deepEqual(extracted.csharpBytes, bytes.subarray(sourceStart, sourceEnd));
    assert.equal(extracted.templateSha256, hash(bytes));
    assert.equal(extracted.csharpSha256, hash(bytes.subarray(sourceStart, sourceEnd)));
    const assembly = managedHeaderFixture();
    const { helperBytes } = renderCodexCliJobRuntimeHelper(bytes, assembly);
    assert.deepEqual(helperBytes.subarray(0, extracted.prefix.length), extracted.prefix);
    assert.deepEqual(helperBytes.subarray(-extracted.suffix.length), extracted.suffix);
    const loader = helperBytes.subarray(extracted.prefix.length, helperBytes.length - extracted.suffix.length).toString();
    assert.equal(loader, CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX + assembly.toString('base64') + CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX);
    assert.doesNotMatch(helperBytes.toString(), /\bAdd-Type\b/);
    assert.match(helperBytes.toString(), /\[MetaengineCodexJob\]::Run/);
  }
});

test('build extraction rejects missing, ambiguous, malformed and invalid UTF-8 templates with LF and CRLF', async () => {
  const original = (await readTemplate()).toString('utf8').replace(/\r\n/g, '\n');
  for (const ending of ['\n', '\r\n']) {
    const text = original.replaceAll('\n', ending), templateBytes = Buffer.from(text);
    for (const changed of [
      text.replace('Add-Type -TypeDefinition', 'Other-Command -TypeDefinition'),
      text + ending + text,
      text + ending + 'Add-Type -AssemblyName arbitrary' + ending,
      text.replace(/\r?\n'@(?=\r?\n|$)/, ending + 'missing-terminator'),
      text.replace('public static class MetaengineCodexJob', 'public static class DifferentJob'),
    ]) {
      const changedBytes = Buffer.from(changed);
      assert.equal(changedBytes.equals(templateBytes), false, 'each negative must change the actual template bytes');
      assert.throws(() => extractCodexCliJobRuntimeTemplate(changedBytes), /codex_job_runtime_template_/);
    }
  }
  assert.throws(() => extractCodexCliJobRuntimeTemplate(Buffer.alloc(100, 0xff)), /encoding_invalid/);
  assert.throws(() => extractCodexCliJobRuntimeTemplate(Buffer.alloc(256 * 1024 + 1)), /size_invalid/);
});

test('the output loader refuses non-PE, unmanaged or truncated assembly bytes', async () => {
  const template = await readTemplate(), native = managedHeaderFixture(), corrupt = managedHeaderFixture();
  native.writeUInt32LE(0, 0x80 + 24 + 96 + 14 * 8);
  corrupt.writeUInt32LE(0xfffffff0, 0x3c);
  for (const bytes of [Buffer.from('uncompiled source'), native, corrupt, Buffer.alloc(2 * 1024 * 1024 + 1)]) {
    assert.throws(() => renderCodexCliJobRuntimeHelper(template, bytes), /codex_job_runtime_assembly_/);
  }
});

test('instrumented fixture C# is prepared through the same exact-byte transformation', async () => {
  const original = await readTemplate();
  const instrumented = Buffer.from(original.toString().replace('IntPtr job=IntPtr.Zero', 'Console.Error.WriteLine("NATIVE_RUN_ENTER");\n    IntPtr job=IntPtr.Zero'));
  const plain = extractCodexCliJobRuntimeTemplate(original), changed = extractCodexCliJobRuntimeTemplate(instrumented);
  assert.notEqual(changed.csharpSha256, plain.csharpSha256);
  assert.match(changed.csharpBytes.toString(), /NATIVE_RUN_ENTER/);
  assert.deepEqual(changed.prefix, plain.prefix);
  assert.deepEqual(changed.suffix, plain.suffix);
  assert.equal(renderCodexCliJobRuntimeHelper(instrumented, managedHeaderFixture()).template.csharpSha256, changed.csharpSha256);
});

test('source preparation refuses a non-Windows host without creating an output or pretending compilation succeeded', {
  skip: process.platform === 'win32',
}, async () => {
  const outputDirectory = path.join(os.tmpdir(), 'metaengine-unbuilt-job-runtime-' + process.pid);
  await assert.rejects(prepareCodexCliJobRuntime({ outputDirectory }), /windows_x64_build_required/);
  await assert.rejects(fs.access(outputDirectory), { code: 'ENOENT' });
});

test('normal packaging prepares once before copying only the manifest into ASAR and the compiled helper outside', async () => {
  const config = JSON.parse(await fs.readFile(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
  assert.ok(config.files.some(row => row.from === 'native-dist/codex-cli/asar' && row.to === '.'
    && JSON.stringify(row.filter) === JSON.stringify(['native-coding-job-runtime.json'])));
  assert.deepEqual(config.extraResources.find(row => row.to === 'native-coding/codex-cli-job-runner.ps1'), {
    from: 'native-dist/codex-cli/codex-cli-job-runner.ps1', to: 'native-coding/codex-cli-job-runner.ps1',
  });
  assert.ok(!config.extraResources.some(row => row.from === 'scripts/codex-cli-job-runner.ps1'));
  const hook = await fs.readFile(new URL('../scripts/electron-builder-before-pack.cjs', import.meta.url), 'utf8');
  assert.equal((hook.match(/await prepareCodexCliJobRuntime\(/g) || []).length, 1);
  assert.match(hook, /fs\.readFileSync\(jobRuntime\.manifestPath\)/);
  assert.match(hook, /fs\.writeFileSync\(packagedJobManifest, jobManifestBytes\)/);
  const controller = await fs.readFile(new URL('../src/codex-cli-windows-process-controller.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(controller, /prepare-codex-cli-job-runtime|prepareCodexCliJobRuntime|Add-Type|csc\.exe/);
});

test('Windows preparation compiles the real class once, publishes pinned self-contained bytes and retains old outputs on a rejected build', {
  skip: process.platform !== 'win32', timeout: 400000,
}, async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'metaengine-codex-job-producer-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const helperSourcePath = path.join(root, 'template.ps1'), outputDirectory = path.join(root, 'prepared');
  const template = await readTemplate();
  await fs.writeFile(helperSourcePath, template);
  const result = await prepareCodexCliJobRuntime({ helperSourcePath, outputDirectory });
  const helper = await fs.readFile(result.helperPath), manifestBytes = await fs.readFile(result.manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, CODEX_CLI_JOB_RUNTIME_SCHEMA);
  assert.equal(manifest.build_mode, CODEX_CLI_JOB_RUNTIME_BUILD_MODE);
  assert.equal(manifest.template_sha256, hash(template));
  assert.equal(manifest.csharp_sha256, extractCodexCliJobRuntimeTemplate(template).csharpSha256);
  assert.equal(manifest.helper_sha256, hash(helper));
  assert.equal(manifest.compiler_signature_status, 'Valid');
  assert.match(manifest.compiler_signer_subject, /Microsoft Corporation/);
  assert.match(manifest.compiler_executable_sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.runtime_compilation, false);
  assert.equal(manifest.release_authority, false);
  const loadStart = helper.indexOf(CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX) + CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX.length;
  const loadEnd = helper.indexOf(CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX, loadStart);
  const assembly = Buffer.from(helper.subarray(loadStart, loadEnd).toString(), 'base64');
  assert.equal(hash(assembly), manifest.assembly_sha256);
  assert.deepEqual(renderCodexCliJobRuntimeHelper(template, assembly).helperBytes, helper);
  assert.deepEqual((await fs.readdir(outputDirectory)).sort(), ['codex-cli-job-runner.ps1', 'manifest.json']);
  // C# remains valid when PowerShell continuation operators are moved to the
  // next line. The real Desktop parser must reject this previously published
  // envelope defect before replacing either accepted output, for LF and CRLF.
  for (const ending of ['\n', '\r\n']) {
    const invalid = template.toString().replace(/\r\n/g, '\n').replace(/ -or\n/g, '\n    -or ').replaceAll('\n', ending);
    assert.notEqual(invalid, template.toString());
    assert.equal(extractCodexCliJobRuntimeTemplate(Buffer.from(invalid)).csharpBytes.toString().replace(/\r\n/g, '\n'),
      extractCodexCliJobRuntimeTemplate(template).csharpBytes.toString().replace(/\r\n/g, '\n'));
    await fs.writeFile(helperSourcePath, invalid);
    await assert.rejects(prepareCodexCliJobRuntime({ helperSourcePath, outputDirectory }), error => {
      assert.equal(error.message, 'codex_job_runtime_build_failed');
      assert.match(String(error.cause?.stderr ?? ''), /codex_job_runtime_powershell_syntax_invalid/);
      return true;
    });
    assert.deepEqual(await fs.readFile(result.helperPath), helper, 'PowerShell parse failure must retain the accepted helper');
    assert.deepEqual(await fs.readFile(result.manifestPath), manifestBytes, 'PowerShell parse failure must retain its manifest');
    await assert.rejects(fs.access(path.join(outputDirectory, '.prepare.lock')), { code: 'ENOENT' });
  }
  await fs.writeFile(helperSourcePath, template.toString().replace('public static void Run(', 'public static void WrongEntrypoint('));
  await assert.rejects(prepareCodexCliJobRuntime({ helperSourcePath, outputDirectory }), /codex_job_runtime_build_failed/);
  assert.deepEqual(await fs.readFile(result.helperPath), helper, 'failed build must not replace the accepted helper');
  assert.deepEqual(await fs.readFile(result.manifestPath), manifestBytes, 'failed build must not replace its manifest');
  await assert.rejects(fs.access(path.join(outputDirectory, '.prepare.lock')), { code: 'ENOENT' });
  await fs.writeFile(helperSourcePath, template.toString().replace('public static class MetaengineCodexJob', 'public static class MetaengineCodexJob INVALID_SYNTAX'));
  await assert.rejects(prepareCodexCliJobRuntime({ helperSourcePath, outputDirectory }), error => {
    assert.equal(error.message, 'codex_job_runtime_build_failed');
    const diagnostics = String(error.cause?.stdout ?? '') + '\n' + String(error.cause?.stderr ?? '');
    assert.match(diagnostics, /error CS\d{4}/, 'the actual compiler must emit its C# syntax diagnostic');
    assert.match(diagnostics, /codex_job_runtime_compile_failed_exit_[1-9]\d*/);
    return true;
  });
  assert.deepEqual(await fs.readFile(result.helperPath), helper, 'compiler failure must retain the accepted helper');
  assert.deepEqual(await fs.readFile(result.manifestPath), manifestBytes, 'compiler failure must retain its manifest');
  await assert.rejects(fs.access(path.join(outputDirectory, '.prepare.lock')), { code: 'ENOENT' });
});
