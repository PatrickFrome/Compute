import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createCodexCliWindowsProcessController } from '../src/codex-cli-windows-process-controller.mjs';

// Generated protocol doubles only: no Windows process, PowerShell, Job Object,
// executable hash or native cleanup is qualified by these tests.
function fixture(t) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalSpawn = childProcess.spawn;
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  t.after(() => {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', platform);
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const helper = new EventEmitter();
  helper.stdin = new PassThrough(); helper.stdout = new PassThrough(); helper.stderr = new PassThrough();
  let kills = 0;
  helper.kill = () => { kills++; return true; };
  const calls = [];
  childProcess.spawn = (...args) => { calls.push(args); return helper; };
  syncBuiltinESMExports();
  const controller = createCodexCliWindowsProcessController({
    helperPath: path.resolve('fixture-helper.ps1'), powershellPath: path.resolve('fixture-powershell.exe'),
  });
  const spec = { executablePath: path.resolve('fixture-worker.exe'), cwd: path.resolve('fixture-worktree'),
    expectedExecutableSha256: 'a'.repeat(64), args: [], env: {}, timeoutMs: 10000,
    runId: '11111111-1111-4111-8111-111111111111' };
  const frame = value => helper.stdout.write(JSON.stringify(value) + '\n');
  return { helper, spec, calls, frame, get kills() { return kills; }, spawn: () => controller.spawn(spec) };
}

async function pendingRejection(f, expected) {
  let settled = false;
  const pending = f.spawn();
  pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, { message: 'codex_cli_process_' + expected });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][2].shell, false);
  assert.equal(f.calls[0][2].windowsHide, true);
  assert.deepEqual(f.calls[0][2].stdio, ['pipe', 'pipe', 'pipe']);
  return { rejected, async assertStillPending() { await Promise.resolve(); assert.equal(settled, false); } };
}

test('startup timeout retains its exact reason and waits for helper close at the unchanged default deadline', async t => {
  const f = fixture(t), pending = await pendingRejection(f, 'CONTROLLER_STARTUP_TIMEOUT');
  t.mock.timers.tick(29999); assert.equal(f.kills, 0); await pending.assertStillPending();
  t.mock.timers.tick(1); assert.equal(f.kills, 1); await pending.assertStillPending();
  f.helper.emit('close', null); await pending.rejected;
});

for (const [name, reason, trigger, kills] of [
  ['invalid protocol', 'CONTROLLER_PROTOCOL_INVALID', f => f.helper.stdout.write('not-json\n'), 1],
  ['native error frame', 'NATIVE_JOB_FAILED', f => f.frame({ type: 'error', reason: 'private helper detail' }), 0],
  ['spawn error', 'CONTROLLER_SPAWN_FAILED', f => f.helper.emit('error', Object.assign(Error('private spawn detail'), { code: 'ENOENT' })), 0],
  ['input failure', 'CONTROLLER_INPUT_FAILED', f => f.helper.stdin.emit('error', Error('private input detail')), 1],
]) test(`pre-ready ${name} retains its fixed reason without settling before close`, async t => {
  const f = fixture(t), pending = await pendingRejection(f, reason);
  trigger(f); assert.equal(f.kills, kills); await pending.assertStillPending();
  f.helper.emit('close', 1); await pending.rejected;
});

test('close without a proven startup cause retains the unproven-exit fallback', async t => {
  const f = fixture(t), pending = await pendingRejection(f, 'CONTROLLER_EXIT_UNPROVEN');
  await pending.assertStillPending(); f.helper.emit('close', 0); await pending.rejected;
  assert.equal(f.kills, 0);
});

test('a valid ready and exit protocol still waits for helper close before confirmed completion', async t => {
  const f = fixture(t), pending = f.spawn();
  f.frame({ type: 'ready', pid: 123, process_incarnation_id: 'pid:123:created_100ns:133333333333333333',
    executable_sha256: f.spec.expectedExecutableSha256, executable_path: f.spec.executablePath,
    tree_control_bound: true, started_suspended: true, job_bound_before_resume: true,
    process_tree_control: 'WINDOWS_JOB_OBJECT', job_id: f.spec.runId, user_sid: 'S-1-5-21-111-1001' });
  const handle = await pending;
  let completed = false; handle.completion.then(() => { completed = true; });
  await handle.resume(''); f.frame({ type: 'resumed' });
  f.frame({ type: 'exit', exit_code: 0, reason: null, tree_cleanup_confirmed: true });
  await Promise.resolve(); assert.equal(completed, false);
  f.helper.emit('close', 0);
  assert.deepEqual(await handle.completion, { exit_code: 0, signal: null, reason: null,
    tree_cleanup_confirmed: true, process_tree_control: 'WINDOWS_JOB_OBJECT' });
  t.mock.timers.tick(30000); assert.equal(f.kills, 0);
});
