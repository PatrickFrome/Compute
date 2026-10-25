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
} from '../scripts/prepare-codex-cli-job-runtime.mjs';

const templateUrl = new URL('../scripts/codex-cli-job-runner.ps1', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const readTemplate = () => fs.readFile(templateUrl);

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

test('build extraction rejects missing, ambiguous, malformed and invalid UTF-8 templates', async () => {
  const text = (await readTemplate()).toString();
  for (const changed of [
    text.replace('Add-Type -TypeDefinition', 'Other-Command -TypeDefinition'),
    text + '\n' + text,
    text + '\nAdd-Type -AssemblyName arbitrary\n',
    text.replace("\n'@\n", '\nmissing-terminator\n'),
    text.replace('public static class MetaengineCodexJob', 'public static class DifferentJob'),
  ]) assert.throws(() => extractCodexCliJobRuntimeTemplate(Buffer.from(changed)), /codex_job_runtime_template_/);
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
  await fs.writeFile(helperSourcePath, template.toString().replace('public static void Run(', 'public static void WrongEntrypoint('));
  await assert.rejects(prepareCodexCliJobRuntime({ helperSourcePath, outputDirectory }), /codex_job_runtime_build_failed/);
  assert.deepEqual(await fs.readFile(result.helperPath), helper, 'failed build must not replace the accepted helper');
  assert.deepEqual(await fs.readFile(result.manifestPath), manifestBytes, 'failed build must not replace its manifest');
  await assert.rejects(fs.access(path.join(outputDirectory, '.prepare.lock')), { code: 'ENOENT' });
});
