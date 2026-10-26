import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { inventoryUiContent } from '../../me2-ui/scripts/ui-content-inventory.mjs';
import { verifyMe2UiBundle } from '../scripts/verify-me2-ui-bundle.mjs';
import { assertOwnerSessionSoakUiIntegrity, ownerSessionSoakFailureCode,
  summarizeOwnerSessionSoakCheckpoint, withOwnerSessionSoakTerminalDiagnostics } from '../scripts/qualify-installed-owner-consumer.mjs';

const sourceHead = 'a'.repeat(40), version = '0.7.0-dev.1117000000.1';
const ports = { ui: 54001, gateway: 54002, daemon: 54003 };
const checkpoint = () => ({ schema: 'metaengine.browser.session-soak-diagnostics.v1',
  state: 'FAILED', phase: 'SHUTDOWN', elapsed_ms: 1500, sequence: 4,
  first_failure: { code: 'me2_runtime_not_settled', phase: 'ME2_READINESS' },
  cleanup_failure: { code: 'shutdown_signal_timeout', phase: 'SHUTDOWN' },
  process: { pid: 1234, exited: false, exit_code: null }, ports: { ...ports },
  readiness: { daemon: true, contract: true, ui_started: true, ui: false, gateway: true,
    mission_removed: true, primary_shell: true, r97_dom: true },
  ui_http: { status: null, outcome: 'PROBE_FAILED' }, verified_activation_count: 0,
  diagnostic_only: true, qualification_proven: false, automatic_retry_allowed: false, authority_effect: false });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-soak-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const context = { phase: 'PHYSICAL_SOAK', runnerSettled: false, runnerDeadlineMs: 150 };
  return { directory, context,
    write: row => fs.writeFile(path.join(directory, 'soak-diagnostics.json'), JSON.stringify(row)),
    read: async () => JSON.parse(await fs.readFile(path.join(directory, 'soak-terminal-diagnostics.json'), 'utf8')),
    run: (run, readRuntime) => withOwnerSessionSoakTerminalDiagnostics({ directory, sourceHead, version, ports, context, readRuntime, run }),
  };
}

test('checkpoint projection keeps first/cleanup causes and drops secrets, raw logs and unknown nested fields', () => {
  const row = checkpoint(), secret = 'PRIVATE_CREDENTIAL_AND_PATH';
  row.private = row.stdout = row.stderr = row.url = secret;
  row.first_failure.details = secret; row.cleanup_failure.command = secret;
  row.process.command = secret; row.ports.private = secret;
  row.readiness.raw_health = secret; row.ui_http.body = secret;
  row.me2_failure = { schema: 'metaengine.browser.me2.integration.v1', event: 'ME2_CONTRACT_MISMATCH', reason: secret };
  const projected = summarizeOwnerSessionSoakCheckpoint(Buffer.from('\uFEFF' + JSON.stringify(row)));
  assert.equal(projected.readback, 'AVAILABLE');
  assert.equal(projected.checkpoint.elapsed_ms, 1500); assert.equal(projected.checkpoint.sequence, 4);
  assert.deepEqual(projected.checkpoint.first_failure, { code: 'me2_runtime_not_settled', phase: 'ME2_READINESS' });
  assert.deepEqual(projected.checkpoint.cleanup_failure, { code: 'shutdown_signal_timeout', phase: 'SHUTDOWN' });
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|raw_health|stdout|stderr|command/);
  row.first_failure.code = 'me2_runtime_not_settled:' + secret;
  row.me2_failure.event = secret; row.ui_http.outcome = secret; row.process.pid = secret;
  const unknown = summarizeOwnerSessionSoakCheckpoint(Buffer.from(JSON.stringify(row))).checkpoint;
  assert.equal(unknown.first_failure, null); assert.equal(unknown.me2_failure, null);
  assert.equal(unknown.ui_http.outcome, 'UNKNOWN'); assert.equal(unknown.process.pid, null);
  assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE/);
});

test('diagnostic input bounds and false-authority flags reject untrusted checkpoints', () => {
  for (const [bytes, readback] of [[Buffer.alloc(32769), 'OVERSIZED'], [Buffer.from('{partial'), 'INVALID'],
    [Buffer.from(JSON.stringify({ ...checkpoint(), qualification_proven: true })), 'INVALID']]) {
    assert.deepEqual(summarizeOwnerSessionSoakCheckpoint(bytes), { readback, checkpoint: null });
  }
});

test('real execFile timeout still writes terminal state without reclassifying ambiguous termination', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await f.write({ ...checkpoint(), state: 'RUNNING', phase: 'ME2_READINESS', first_failure: null, cleanup_failure: null });
  f.context.firstObservationFailure = 'RUNTIME_STATUS_UNAVAILABLE';
  f.context.lastObservationFailure = 'NATIVE_WINDOW_UNVERIFIED';
  f.context.runtime = { state: 'READY', runtime_ready: true, host_pid: 1235,
    children: [{ name: 'api', pid: 1236 }, { name: 'edge', pid: 1237 }], database_url: 'PRIVATE_DATABASE_URL' };
  let original, wrapped;
  await assert.rejects(f.run(async () => {
    const task = promisify(execFile)(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 150, maxBuffer: 1024 });
    f.context.runner = task.child;
    try { await task; }
    catch (error) {
      original = error; original.cmd = 'PRIVATE_COMMAND'; original.stderr = 'PRIVATE_STDERR';
      wrapped = new Error('installed_owner_consumer_' + ownerSessionSoakFailureCode(error), { cause: error });
      throw wrapped;
    } finally { f.context.runnerSettled = true; }
  }), error => error === wrapped && error.cause === original);
  const terminal = await f.read();
  assert.equal(original.killed, true);
  assert.equal(terminal.state, 'FAILED');
  assert.equal(terminal.failure_code, 'session_soak_process_terminated_or_timed_out');
  assert.equal(terminal.runner.killed, true); assert.equal(terminal.runner.exited, true);
  assert.equal(terminal.runner.deadline_ms, 150);
  assert.equal(terminal.checkpoint.state, 'RUNNING');
  assert.equal(terminal.observer.first_failure, 'RUNTIME_STATUS_UNAVAILABLE');
  assert.equal(terminal.observer.last_failure, 'NATIVE_WINDOW_UNVERIFIED');
  assert.equal(terminal.runtime_readback, 'LAST_OBSERVATION');
  assert.deepEqual(terminal.ports, ports);
  assert.equal(terminal.qualification_proven, false); assert.equal(terminal.automatic_retry_allowed, false);
  assert.ok(Buffer.byteLength(JSON.stringify(terminal)) < 32768);
  assert.doesNotMatch(JSON.stringify(terminal), /PRIVATE/);
});

test('post-run validation failure remains FAILED even when PowerShell checkpoint says PASSED', async t => {
  const f = await fixture(t);
  await f.write({ ...checkpoint(), state: 'PASSED', phase: 'COMPLETE', first_failure: null, cleanup_failure: null });
  const original = new Error('installed_owner_consumer_session_soak_ui_integrity_changed');
  await assert.rejects(f.run(async () => { f.context.phase = 'POST_EXIT_INTEGRITY'; throw original; }), error => error === original);
  const terminal = await f.read();
  assert.equal(terminal.state, 'FAILED'); assert.equal(terminal.checkpoint.state, 'PASSED');
  assert.equal(terminal.failure_code, 'session_soak_ui_integrity_changed');
  assert.equal(terminal.consumer_phase, 'POST_EXIT_INTEGRITY'); assert.equal(terminal.qualification_proven, false);
});

test('failure terminal re-reads current runtime state and labels a stale observation when the read fails', async t => {
  for (const unavailable of [false, true]) {
    const f = await fixture(t), original = new Error('installed_owner_consumer_session_soak_physical_failed');
    f.context.runtime = { state: 'READY', runtime_ready: true, host_pid: 1234, private: 'PRIVATE_OLD' };
    await assert.rejects(f.run(async () => { throw original; }, async () => {
      if (unavailable) throw new Error('PRIVATE_READ_FAILURE');
      return { state: 'STOPPED', runtime_ready: false, children_stopped: true, host_pid: 1234, private: 'PRIVATE_NEW' };
    }), error => error === original);
    const terminal = await f.read();
    assert.equal(terminal.runtime_readback, unavailable ? 'LAST_OBSERVATION' : 'TERMINAL');
    assert.equal(terminal.runtime.state, unavailable ? 'READY' : 'STOPPED');
    assert.doesNotMatch(JSON.stringify(terminal), /PRIVATE/);
  }
});

test('missing and oversized checkpoint files still yield parent terminal diagnostics', async t => {
  for (const oversized of [false, true]) {
    const f = await fixture(t);
    if (oversized) await fs.writeFile(path.join(f.directory, 'soak-diagnostics.json'), 'PRIVATE'.repeat(6000));
    const original = new Error('installed_owner_consumer_session_soak_physical_failed');
    await assert.rejects(f.run(async () => { throw original; }), error => error === original);
    const terminal = await f.read();
    assert.equal(terminal.readback, oversized ? 'OVERSIZED' : 'MISSING');
    assert.equal(terminal.checkpoint, null); assert.equal(terminal.state, 'FAILED');
    assert.doesNotMatch(JSON.stringify(terminal), /PRIVATE/);
  }
});

test('diagnostic write failure cannot replace the original error or turn a successful run into a qualification', async t => {
  const f = await fixture(t), original = new Error('installed_owner_consumer_session_soak_attestation_missing');
  await fs.mkdir(path.join(f.directory, 'soak-terminal-diagnostics.json'));
  await assert.rejects(f.run(async () => { throw original; }), error => error === original);
  const success = await fixture(t), result = Object.freeze({ existing_success_receipt: true });
  assert.equal(await success.run(async () => { success.context.phase = 'COMPLETE'; return result; }), result);
  const terminal = await success.read();
  assert.equal(terminal.state, 'PASSED'); assert.equal(terminal.diagnostic_only, true);
  assert.equal(terminal.qualification_proven, false);
});

test('post-exit UI comparison rejects same-size mutation blessed by a rewritten self-hashed manifest', async t => {
  const f = await fixture(t), root = path.join(f.directory, 'ui');
  const put = async (name, value) => {
    const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value);
  };
  await put('package.json', '{"name":"fixture","version":"1.0.0"}'); await put('server.js', 'AAAA');
  await put('.next/BUILD_ID', 'build-fixture'); await put('.next/static/chunk.js', 'AAAA');
  for (const name of ['next', 'react', 'react-dom']) await put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
  await put('node_modules/next/dist/server/lib/start-server.js', 'module.exports = {};');
  const manifest = () => ({ schema: 'me2.ui-bundle-manifest.v1', git_sha: sourceHead,
    build_id: 'build-fixture', ...inventoryUiContent(root) });
  await put('me2-ui-manifest.json', JSON.stringify(manifest()));
  const before = verifyMe2UiBundle(root, sourceHead);
  assert.equal(assertOwnerSessionSoakUiIntegrity(before, verifyMe2UiBundle(root, sourceHead)).post_exit_ui_integrity_verified, true);
  await put('.next/static/chunk.js', 'BBBB');
  await put('me2-ui-manifest.json', JSON.stringify(manifest()));
  const selfRehashed = verifyMe2UiBundle(root, sourceHead);
  assert.equal(before.installed_size_bytes, selfRehashed.installed_size_bytes);
  assert.throws(() => assertOwnerSessionSoakUiIntegrity(before, selfRehashed), /session_soak_ui_integrity_changed/);
});
