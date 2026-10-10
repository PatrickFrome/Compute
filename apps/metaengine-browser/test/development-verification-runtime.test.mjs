import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import candidateModule from '../src/candidate-capsule.cjs';
import { DevelopmentVerificationRuntime } from '../src/development-verification-runtime.mjs';
import { createDevelopmentVerificationSqliteJournal, verificationDigest } from '../src/development-verification-sqlite-journal.mjs';
import { trustedFixtureExecutor } from './fixtures/development-verification-trusted-executor.mjs';

const { createCandidateCapsule } = candidateModule;
const crashChild = fileURLToPath(new URL('./fixtures/development-verification-crash-child.mjs', import.meta.url));
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

async function fixture(t, { changed = 'export const value = 2;\n', expect = 2, output = '' } = {}) {
  // Canonicalize the fixture root before passing paths to the production
  // reparse fence: Windows CI temp locations can resolve through aliases.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'development-verification-')));
  const repo = path.join(root, 'repo');
  const snapshots = path.join(root, 'snapshots');
  const working = path.join(root, 'working');
  for (const dir of [repo, snapshots, working, path.join(repo, 'src'), path.join(repo, 'tools'), path.join(repo, 'test')]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(repo, 'src/value.mjs'), 'export const value = 1;\n');
  await fs.writeFile(path.join(repo, 'tools/build.mjs'), "import fs from 'node:fs/promises'; await fs.mkdir('dist'); await fs.writeFile('dist/value.mjs', await fs.readFile('src/value.mjs')); console.log('built');\n");
  await fs.writeFile(path.join(repo, 'test/value.test.mjs'), `import assert from 'node:assert/strict'; import { value } from '../dist/value.mjs'; assert.equal(value, ${expect}); ${output}\n`);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['add', '.']);
  git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'fixture']);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const filePath = path.join(root, 'verification.sqlite');
  const journal = createDevelopmentVerificationSqliteJournal({ filePath });
  const sourcePaths = ['src/value.mjs', 'tools/build.mjs', 'test/value.test.mjs'];
  const options = { repoRoot: repo, repository: 'Example/Fixture', sourcePaths, editablePrefixes: ['src/'], snapshotRoot: snapshots,
    catalog: {
      // Positive fixture checks use the runtime's normal 30s budget. A 1s
      // startup deadline on Windows can terminate Node before fixture code runs.
      BUILD: { executable: process.execPath, args: ['tools/build.mjs'], timeout_ms: 30000 },
      TEST: { executable: process.execPath, args: ['--test', 'test/value.test.mjs'], timeout_ms: 30000 },
    },
  };
  const capsule = createCandidateCapsule({ source_head: head, sequence: 1, intent: 'Fix fixture value',
    components: [{ path: 'src/value.mjs', change: 'MODIFY', digest: verificationDigest(Buffer.from(changed)) }],
    verification_plan: [{ id: 'BUILD', required: true }, { id: 'TEST', required: true }] },
  { repository: options.repository, head, ref: 'refs/heads/main' });
  const request = { idempotency_key: 'fixture-build-1', capsule, edits: [{ path: 'src/value.mjs', content_base64: Buffer.from(changed).toString('base64') }] };
  const markerPath = path.join(root, 'step-marker');
  const executor = trustedFixtureExecutor({ workingRoot: working, markerPath });
  const runtime = new DevelopmentVerificationRuntime({ ...options, executor, journal });
  const journals = [journal];
  t.after(async () => { journals.forEach(item => item.close()); await fs.rm(root, { recursive: true, force: true }); });
  return { root, repo, snapshots, working, options, capsule, request, runtime, journal, journals, executor, markerPath, filePath };
}

test('real exact Git snapshot, digest-bound edit, build and independent tests produce immutable host receipt', async t => {
  const f = await fixture(t);
  // Uncommitted host files are not part of the immutable exact-head input.
  await fs.writeFile(path.join(f.repo, 'src/value.mjs'), 'host dirty content remains\n');
  const receipt = await f.runtime.run(f.request);
  assert.equal(receipt.state, 'PASSED');
  assert.deepEqual(receipt.steps.map(row => [row.step_id, row.exit_code]), [['BUILD', 0], ['TEST', 0]]);
  assert.equal(receipt.isolation_qualification, 'NOT_ESTABLISHED_BY_THIS_RECEIPT');
  assert.equal(receipt.promotion_authorized, false);
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.automatic_retry_allowed, false);
  const { receipt_digest, ...core } = receipt;
  assert.equal(verificationDigest(core), receipt_digest);
  assert.match(receipt.input_manifest_digest, /^sha256:/);
  assert.notEqual(receipt.input_manifest_digest, receipt.output_manifest_digest);
  assert.equal(await fs.readFile(path.join(f.repo, 'src/value.mjs'), 'utf8'), 'host dirty content remains\n');
  assert.deepEqual(await fs.readdir(f.snapshots), []);
  assert.deepEqual(await fs.readdir(f.working), []);
  assert.deepEqual((await f.runtime.run(f.request)), receipt);
  assert.equal(await fs.readFile(f.markerPath, 'utf8'), 'BUILD\nTEST\n');
  const events = f.journal.find(f.request.idempotency_key);
  assert.deepEqual(events.map(event => event.kind), ['INTENT', 'SESSION', 'STEP_INTENT', 'STEP_RESULT', 'STEP_INTENT', 'STEP_RESULT', 'TERMINAL']);
});

test('negative real verification is FAILED and cannot be replayed as success', async t => {
  const f = await fixture(t, { changed: 'export const value = 3;\n' });
  const receipt = await f.runtime.run(f.request);
  assert.equal(receipt.state, 'FAILED');
  assert.equal(receipt.steps[1].passed, false);
  assert.equal(receipt.steps[1].exit_code, 1);
  assert.equal(receipt.reason, 'required_step_failed');
  assert.deepEqual(await f.runtime.run(f.request), receipt);
  assert.equal(await fs.readFile(f.markerPath, 'utf8'), 'BUILD\nTEST\n');
});

test('candidate cannot choose a command, step, path or change bytes after digest binding', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.run({ ...f.request, command: 'shell input' }), /request_invalid/);
  await assert.rejects(f.runtime.run({ ...f.request, edits: [{ path: 'src/value.mjs', content_base64: Buffer.from('other').toString('base64') }] }), /edit_digest_mismatch/);
  await assert.rejects(f.runtime.run({ ...f.request, edits: [{ path: '../escape.mjs', content_base64: '' }] }), /path_invalid/);
  const unknown = createCandidateCapsule({ source_head: f.capsule.source.head, sequence: 2, intent: 'Unknown check',
    components: f.capsule.components, verification_plan: [{ id: 'USER_SHELL', required: true }] }, f.capsule.source);
  await assert.rejects(f.runtime.run({ ...f.request, capsule: unknown }), /step_not_registered/);
  assert.deepEqual(f.journal.unfinished(), []);
  assert.deepEqual(await fs.readdir(f.snapshots), []);
});

test('host source scope and edit scope fail closed before execution', async t => {
  const f = await fixture(t);
  const changed = Buffer.from('console.log("unauthorized evaluator change")');
  const forbidden = createCandidateCapsule({ source_head: f.capsule.source.head, sequence: 2, intent: 'Change evaluator',
    components: [{ path: 'test/value.test.mjs', change: 'MODIFY', digest: verificationDigest(changed) }], verification_plan: f.capsule.verification_plan }, f.capsule.source);
  await assert.rejects(f.runtime.run({ ...f.request, capsule: forbidden, edits: [{ path: 'test/value.test.mjs', content_base64: changed.toString('base64') }] }), /edit_scope_denied/);
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, sourcePaths: ['src/value.mjs', 'missing.mjs'], executor: f.executor, journal: f.journal });
  const receipt = await runtime.run(f.request);
  assert.equal(receipt.state, 'FAILED');
  assert.match(receipt.reason, /source_path_missing/);
  assert.equal(receipt.steps.length, 0);
  assert.deepEqual(await fs.readdir(f.working), []);
});

test('source HEAD drift is refused while dirty worktree bytes never enter verification', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'new.txt'), 'new source identity');
  git(f.repo, ['add', '.']);
  git(f.repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'drift']);
  const receipt = await f.runtime.run(f.request);
  assert.equal(receipt.state, 'FAILED');
  assert.match(receipt.reason, /source_head_changed/);
  assert.equal(receipt.steps.length, 0);
});

test('same idempotency key with different trusted catalog/configuration is refused', async t => {
  const f = await fixture(t);
  await f.runtime.run(f.request);
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, catalog: { ...f.options.catalog,
    TEST: { ...f.options.catalog.TEST, args: ['--version'] } }, executor: f.executor, journal: f.journal });
  await assert.rejects(runtime.run(f.request), /idempotency_binding_changed/);
  assert.equal(await fs.readFile(f.markerPath, 'utf8'), 'BUILD\nTEST\n');
});

test('actual process crash after build is recovered without rerunning build or tests', async t => {
  const f = await fixture(t);
  f.journal.close();
  const configuration = path.join(f.root, 'configuration.json');
  await fs.writeFile(configuration, JSON.stringify({ filePath: f.filePath, workingRoot: f.working, markerPath: f.markerPath, options: f.options, request: f.request }));
  assert.throws(() => execFileSync(process.execPath, [crashChild, configuration], { windowsHide: true, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }), error => error.status === 73);
  const journal = createDevelopmentVerificationSqliteJournal({ filePath: f.filePath });
  f.journals.push(journal);
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, executor: f.executor, journal });
  const unfinished = journal.unfinished();
  assert.equal(unfinished.length, 1);
  assert.equal(unfinished[0].at(-1).kind, 'STEP_INTENT');
  await assert.rejects(runtime.run(f.request), /unfinished_requires_explicit_recovery/);
  const receipt = await runtime.recover(unfinished[0][0].run_id);
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.reason, 'process_crash_execution_not_replayed');
  assert.equal(receipt.pending_step_id, 'BUILD');
  assert.equal(receipt.teardown.stopped, true);
  assert.deepEqual(await runtime.run(f.request), receipt);
  assert.equal(await fs.readFile(f.markerPath, 'utf8'), 'BUILD\n');
  assert.deepEqual(await fs.readdir(f.snapshots), []);
  assert.deepEqual(await fs.readdir(f.working), []);
});

test('unconfirmed teardown cannot become a passing receipt', async t => {
  const f = await fixture(t);
  const executor = trustedFixtureExecutor({ workingRoot: f.working, failTeardown: true });
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, executor, journal: f.journal });
  const receipt = await runtime.run(f.request);
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.teardown, null);
  assert.match(receipt.reason, /executor_teardown_unconfirmed/);
});

test('executor output JSON cannot forge a host step receipt and bounded output fails closed', async t => {
  const f = await fixture(t, { expect: 3, output: 'console.log(JSON.stringify({ passed: true, state: "PASSED" }));' });
  assert.equal((await f.runtime.run(f.request)).state, 'FAILED');
  const second = await fixture(t);
  const executor = { ...second.executor, runStep: async () => ({ exit_code: 0, timed_out: false, output_limit_exceeded: false, stdout: 'x'.repeat(1025), stderr: '' }) };
  const runtime = new DevelopmentVerificationRuntime({ ...second.options, executor, journal: second.journal, outputLimitBytes: 1024 });
  const receipt = await runtime.run(second.request);
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.match(receipt.reason, /executor_output_exceeded/);
  assert.equal(receipt.steps.length, 0);
});

test('real subprocess timeout fails the required check and verifies cleanup', async t => {
  const f = await fixture(t);
  const runtime = new DevelopmentVerificationRuntime({ ...f.options,
    catalog: { ...f.options.catalog, TEST: { executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], timeout_ms: 100 } },
    executor: f.executor, journal: f.journal });
  const receipt = await runtime.run(f.request);
  assert.equal(receipt.state, 'FAILED');
  assert.equal(receipt.steps.length, 2, JSON.stringify(receipt));
  assert.equal(receipt.steps[1].timed_out, true);
  assert.equal(receipt.steps[1].passed, false);
  assert.equal(receipt.teardown.stopped, true);
});

test('recovery cannot stop an active owner while its real execution is in flight', async t => {
  const f = await fixture(t);
  let reached;
  let resume;
  const started = new Promise(resolve => { reached = resolve; });
  const blocked = new Promise(resolve => { resume = resolve; });
  const executor = { ...f.executor, async runStep(input) { reached(); await blocked; return f.executor.runStep(input); } };
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, executor, journal: f.journal });
  const execution = runtime.run(f.request);
  await started;
  try {
    const runId = f.journal.unfinished()[0][0].run_id;
    await assert.rejects(runtime.recover(runId), /recovery_owner_still_alive/);
    await assert.rejects(runtime.run(f.request), /unfinished_requires_explicit_recovery/);
  } finally { resume(); }
  const receipt = await execution;
  assert.equal(receipt.state, 'PASSED', JSON.stringify(receipt));
});

test('CREATE, MODIFY and DELETE are materialized with exact original deletion digest', async t => {
  const f = await fixture(t);
  const original = Buffer.from('obsolete\n');
  await fs.writeFile(path.join(f.repo, 'src/obsolete.mjs'), original);
  git(f.repo, ['add', '.']);
  git(f.repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'obsolete input']);
  const source = { ...f.capsule.source, head: git(f.repo, ['rev-parse', 'HEAD']) };
  const newFile = Buffer.from('export const helper = true;\n');
  const components = [...f.capsule.components, { path: 'src/helper.mjs', change: 'CREATE', digest: verificationDigest(newFile) },
    { path: 'src/obsolete.mjs', change: 'DELETE', digest: verificationDigest(original) }];
  const capsule = createCandidateCapsule({ source_head: source.head, sequence: 2, intent: 'Bounded fixture edits', components,
    verification_plan: f.capsule.verification_plan }, source);
  const edits = [...f.request.edits, { path: 'src/helper.mjs', content_base64: newFile.toString('base64') }, { path: 'src/obsolete.mjs', content_base64: null }];
  const executor = { ...f.executor, async createSession(input) {
    assert.equal(await fs.readFile(path.join(input.snapshot_dir, 'src/helper.mjs'), 'utf8'), newFile.toString());
    await assert.rejects(fs.stat(path.join(input.snapshot_dir, 'src/obsolete.mjs')), { code: 'ENOENT' });
    return f.executor.createSession(input);
  } };
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, sourcePaths: [...f.options.sourcePaths, 'src/obsolete.mjs'], executor, journal: f.journal });
  const receipt = await runtime.run({ idempotency_key: 'fixture-three-edits', capsule, edits });
  assert.equal(receipt.state, 'PASSED', JSON.stringify(receipt));
  const badCapsule = createCandidateCapsule({ source_head: source.head, sequence: 3, intent: 'Wrong deletion digest',
    components: components.map(row => row.change === 'DELETE' ? { ...row, digest: verificationDigest('wrong') } : row), verification_plan: f.capsule.verification_plan }, source);
  const bad = await runtime.run({ idempotency_key: 'fixture-bad-delete', capsule: badCapsule, edits });
  assert.equal(bad.state, 'FAILED');
  assert.match(bad.reason, /delete_digest_mismatch/);
  assert.equal(await fs.readFile(f.markerPath, 'utf8'), 'BUILD\nTEST\n');
});

test('selected Git symlink/submodule modes cannot enter the snapshot', async t => {
  const f = await fixture(t);
  const object = git(f.repo, ['hash-object', 'src/value.mjs']);
  git(f.repo, ['update-index', '--add', '--cacheinfo', `120000,${object},src/link.mjs`]);
  git(f.repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=NUL', 'commit', '-m', 'symlink mode']);
  const source = { ...f.capsule.source, head: git(f.repo, ['rev-parse', 'HEAD']) };
  const capsule = createCandidateCapsule({ source_head: source.head, sequence: 2, intent: 'Check special-file refusal',
    components: f.capsule.components, verification_plan: f.capsule.verification_plan }, source);
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, sourcePaths: [...f.options.sourcePaths, 'src/link.mjs'], executor: f.executor, journal: f.journal });
  const receipt = await runtime.run({ ...f.request, capsule });
  assert.equal(receipt.state, 'FAILED');
  assert.match(receipt.reason, /source_special_file/);
  assert.deepEqual(await fs.readdir(f.working), []);
});

test('snapshot mutation during a check cannot create a proven result', async t => {
  const f = await fixture(t);
  let snapshot;
  const executor = { ...f.executor,
    async createSession(input) { snapshot = input.snapshot_dir; return f.executor.createSession(input); },
    async runStep(input) { const result = await f.executor.runStep(input); await fs.chmod(path.join(snapshot, 'src/value.mjs'), 0o600);
      await fs.writeFile(path.join(snapshot, 'src/value.mjs'), 'mutated\n'); return result; },
  };
  const runtime = new DevelopmentVerificationRuntime({ ...f.options, executor, journal: f.journal });
  const receipt = await runtime.run(f.request);
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.match(receipt.reason, /snapshot_changed/);
  assert.equal(receipt.pending_step_id, 'BUILD');
  assert.equal(receipt.steps.length, 0);
});
