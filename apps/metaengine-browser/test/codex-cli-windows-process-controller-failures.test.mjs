import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createCodexCliWindowsProcessController } from '../src/codex-cli-windows-process-controller.mjs';
import { withOwnedCodexCliProcess } from './fixtures/with-owned-codex-cli-process.mjs';

// Generated protocol doubles only: no Windows process, PowerShell, Job Object,
// executable hash or native cleanup is qualified by these tests.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-controller-protocol-'));
  const helperPath = path.join(directory, 'fixture-helper.ps1'), helperBytes = 'protocol double, never executed';
  fs.writeFileSync(helperPath, helperBytes);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
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
  let input = ''; helper.stdin.on('data', chunk => { input += chunk.toString(); });
  let kills = 0;
  helper.kill = () => { kills++; return true; };
  const calls = [];
  childProcess.spawn = (...args) => { calls.push(args); return helper; };
  syncBuiltinESMExports();
  const controller = createCodexCliWindowsProcessController({
    helperPath, expectedHelperSha256: createHash('sha256').update(helperBytes).digest('hex'), powershellPath: path.resolve('fixture-powershell.exe'),
  });
  const spec = { executablePath: path.resolve('fixture-worker.exe'), cwd: path.resolve('fixture-worktree'),
    expectedExecutableSha256: 'a'.repeat(64), args: [], env: {}, timeoutMs: 10000,
    runId: '11111111-1111-4111-8111-111111111111' };
  const frame = value => helper.stdout.write(JSON.stringify(value) + '\n');
  return { helper, spec, calls, frame, get input() { return input; }, get kills() { return kills; }, spawn: () => controller.spawn(spec) };
}

function nativeReady(f) {
  return { type: 'ready', pid: 123, process_incarnation_id: 'pid:123:created_100ns:133333333333333333',
    executable_sha256: f.spec.expectedExecutableSha256, executable_path: f.spec.executablePath,
    tree_control_bound: true, started_suspended: true, job_bound_before_resume: true,
    process_tree_control: 'WINDOWS_JOB_OBJECT', job_id: f.spec.runId, user_sid: 'S-1-5-21-111-1001' };
}

async function readyHandle(f) {
  const pending = f.spawn(); f.frame(nativeReady(f)); return pending;
}

function cancellationReceipt(f) {
  const command = f.input.split('\n').find(line => line.startsWith('CANCEL_SUSPENDED '));
  assert.ok(command, 'the controller must issue its own suspended cancellation');
  const [, cancellationId, reason] = command.split(' ');
  assert.match(cancellationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  return { type: 'suspended_cancelled', run_id: f.spec.runId, job_id: f.spec.runId,
    pid: 123, process_incarnation_id: nativeReady(f).process_incarnation_id, cancellation_id: cancellationId, reason,
    exit_code: 125, never_resumed: true, process_exit_confirmed: true, handles_closed: true,
    tree_cleanup_confirmed: true, process_tree_control: 'WINDOWS_JOB_OBJECT',
    job_accounting: { active_processes: 0, total_processes: 1, total_terminated_processes: 0 } };
}

for (const mode of ['proof assertion', 'expired original deadline']) {
  test(`owned physical fixture cleans up after ${mode} before RESUME without hiding its failure`, async t => {
    const f = fixture(t);
    if (mode === 'expired original deadline') f.spec.deadlineAt = new Date(Date.now() - 1).toISOString();
    const handle = await readyHandle(f);
    const cleanupIssued = new Promise(resolve => f.helper.stdin.once('finish', resolve));
    let primaryError, settled = false;
    const owned = withOwnedCodexCliProcess({ async spawn() { return handle; } }, f.spec, async h => {
      try {
        if (mode === 'proof assertion') assert.fail('injected proof assertion before RESUME');
        else await h.resume('private prompt');
      } catch (error) { primaryError = error; throw error; }
    });
    owned.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(owned, error => error === primaryError
      && (mode === 'proof assertion' ? error.code === 'ERR_ASSERTION' : /deadline_expired_before_resume/.test(error.message)));
    await cleanupIssued;
    assert.ok(!f.input.includes('RESUME ')); assert.ok(!f.input.includes('private prompt'));
    const receipt = cancellationReceipt(f); assert.equal(receipt.reason, 'TEST_CLEANUP');
    assert.equal(settled, false);
    f.frame(receipt); await Promise.resolve(); assert.equal(settled, false);
    f.helper.emit('close', 0); await rejected;
    assert.equal((await handle.completion).tree_cleanup_confirmed, true);
    assert.equal(f.kills, 0);
  });
}

test('owned physical fixture awaits completion even after terminate rejects and reports both errors', async () => {
  const primary = new assert.AssertionError({ message: 'injected proof assertion before RESUME' });
  const cleanup = Error('injected cleanup failure');
  const completion = Promise.withResolvers(), terminating = Promise.withResolvers();
  const handle = { stdout: new PassThrough(), stderr: new PassThrough(), completion: completion.promise,
    async terminate() { terminating.resolve(); throw cleanup; } };
  let settled = false;
  const owned = withOwnedCodexCliProcess({ async spawn() { return handle; } }, {}, async () => { throw primary; });
  owned.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(owned,
    error => error instanceof AggregateError && error.cause === primary
      && error.errors.length === 2 && error.errors[0] === primary && error.errors[1] === cleanup);
  await terminating.promise; await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  completion.resolve({ tree_cleanup_confirmed: false }); await rejected;
  assert.equal((await handle.completion).tree_cleanup_confirmed, false);
});

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

test('requested suspended cancellation is identity-bound, fences resume immediately and waits for helper close0', async t => {
  const f = fixture(t), handle = await readyHandle(f);
  let completed = false; handle.completion.then(() => { completed = true; });
  const terminating = handle.terminate('CANCELLED'), repeated = handle.terminate('EXPIRED');
  await assert.rejects(handle.resume('must never be sent'), /resume_invalid/);
  assert.equal(f.input.split('\n').filter(line => line.startsWith('CANCEL_SUSPENDED ')).length, 1);
  assert.ok(!f.input.includes('RESUME '));
  const receipt = cancellationReceipt(f); f.frame(receipt);
  await Promise.resolve(); assert.equal(completed, false); assert.equal(f.kills, 0);
  f.helper.emit('close', 0); await Promise.all([terminating, repeated]);
  const { type, ...expected } = receipt;
  assert.deepEqual(await handle.completion, { ...expected, signal: null });
  t.mock.timers.tick(11000); assert.equal(f.kills, 0);
});

test('deadline refusal followed by concurrent cancel/resume cannot send RESUME or change the cancellation binding', async t => {
  const f = fixture(t); f.spec.deadlineAt = new Date(Date.now() - 1).toISOString();
  const handle = await readyHandle(f);
  await assert.rejects(handle.resume('private prompt'), /deadline_expired_before_resume/);
  const terminating = handle.terminate('EXPIRED');
  await assert.rejects(handle.resume('private prompt'), /resume_invalid/);
  f.frame(cancellationReceipt(f)); f.helper.emit('close', 0); await terminating;
  assert.equal((await handle.completion).reason, 'EXPIRED'); assert.ok(!f.input.includes('RESUME '));
  assert.ok(!f.input.includes('private prompt'));
});

test('post-RESUME cancellation retains the ordinary protocol and cannot confirm a suspended receipt', async t => {
  const f = fixture(t), handle = await readyHandle(f);
  await handle.resume(''); f.frame({ type: 'resumed' });
  const terminating = handle.terminate('CANCELLED');
  assert.ok(f.input.endsWith('CANCEL CANCELLED\n')); assert.ok(!f.input.includes('CANCEL_SUSPENDED '));
  f.frame({ type: 'exit', exit_code: 124, reason: 'CANCELLED', tree_cleanup_confirmed: true });
  f.helper.emit('close', 0); await terminating;
  assert.equal((await handle.completion).tree_cleanup_confirmed, true);
});

test('a suspended cancellation receipt before valid ready is a protocol failure, not native cleanup proof', async t => {
  const f = fixture(t), pending = await pendingRejection(f, 'CONTROLLER_PROTOCOL_INVALID');
  f.frame({ type: 'suspended_cancelled', tree_cleanup_confirmed: true });
  await pending.assertStillPending(); f.helper.emit('close', 0); await pending.rejected;
});

for (const mode of ['unsolicited receipt', 'unsolicited resumed', 'receipt after RESUME']) {
  test(`${mode} cannot establish suspended cleanup`, async t => {
    const f = fixture(t), handle = await readyHandle(f);
    if (mode === 'receipt after RESUME') await handle.resume('');
    f.frame(mode === 'unsolicited resumed' ? { type: 'resumed' } : { type: 'suspended_cancelled', tree_cleanup_confirmed: true });
    f.helper.emit('close', 0);
    assert.equal((await handle.completion).tree_cleanup_confirmed, false);
    assert.equal((await handle.completion).reason, 'CONTROLLER_PROTOCOL_INVALID');
  });
}

for (const [name, mutate] of [
  ['different cancellation ID', r => { r.cancellation_id = '22222222-2222-4222-8222-222222222222'; }],
  ['missing cancellation ID', r => { delete r.cancellation_id; }],
  ['different run ID', r => { r.run_id = '22222222-2222-4222-8222-222222222222'; }],
  ['different job ID', r => { r.job_id = '22222222-2222-4222-8222-222222222222'; }],
  ['different PID', r => { r.pid++; }],
  ['different kernel incarnation', r => { r.process_incarnation_id = 'pid:123:created_100ns:133333333333333334'; }],
  ['different reason', r => { r.reason = 'EXPIRED'; }],
  ['STILL_ACTIVE exit', r => { r.exit_code = 259; }],
  ['different exit', r => { r.exit_code = 0; }],
  ['missing exit observation', r => { delete r.process_exit_confirmed; }],
  ['resumed child', r => { r.never_resumed = false; }],
  ['unclosed handles', r => { r.handles_closed = false; }],
  ['unconfirmed cleanup', r => { r.tree_cleanup_confirmed = false; }],
  ['different tree controller', r => { r.process_tree_control = 'OTHER'; }],
  ['missing accounting', r => { delete r.job_accounting; }],
  ['active job', r => { r.job_accounting.active_processes = 1; }],
  ['empty lifetime job', r => { r.job_accounting.total_processes = 0; }],
  ['additional job process', r => { r.job_accounting.total_processes = 2; }],
  ['negative terminated count', r => { r.job_accounting.total_terminated_processes = -1; }],
  ['fractional terminated count', r => { r.job_accounting.total_terminated_processes = 0.5; }],
  ['impossible terminated count', r => { r.job_accounting.total_terminated_processes = 2; }],
  ['string accounting', r => { r.job_accounting.active_processes = '0'; }],
]) test(`suspended cancellation rejects ${name}`, async t => {
  const f = fixture(t), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
  const receipt = cancellationReceipt(f); mutate(receipt); f.frame(receipt); f.helper.emit('close', 0); await terminating;
  assert.equal((await handle.completion).tree_cleanup_confirmed, false);
  assert.equal((await handle.completion).reason, 'CONTROLLER_PROTOCOL_INVALID'); assert.equal(f.kills, 1);
});

for (const trailer of ['duplicate receipt', 'resumed', 'output', 'exit', 'error', 'blank line', 'partial bytes', 'partial whitespace']) {
  test(`valid cancellation followed by ${trailer} cannot confirm cleanup`, async t => {
    const f = fixture(t), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
    const receipt = cancellationReceipt(f);
    const suffix = trailer === 'duplicate receipt' ? JSON.stringify(receipt) + '\n'
      : trailer === 'blank line' ? '\n' : trailer === 'partial bytes' ? 'unfinished' : trailer === 'partial whitespace' ? ' '
        : JSON.stringify({ type: trailer, channel: 'stdout', data_b64: 'eA==', exit_code: 0, tree_cleanup_confirmed: true }) + '\n';
    // Same-chunk suffixes exercise parser leftovers, not only later data events.
    f.helper.stdout.write(JSON.stringify(receipt) + '\n' + suffix); f.helper.emit('close', 0); await terminating;
    assert.equal((await handle.completion).tree_cleanup_confirmed, false);
    assert.equal((await handle.completion).reason, 'CONTROLLER_PROTOCOL_INVALID');
  });
}

for (const [name, trigger, closeCode] of [
  ['helper exit1', () => {}, 1],
  ['helper killed', () => {}, null],
  ['helper error', f => f.helper.emit('error', Error('private helper detail')), 0],
  ['input failure', f => f.helper.stdin.emit('error', Error('private input detail')), 0],
  ['stderr overflow', f => f.helper.stderr.write(Buffer.alloc(65537)), 0],
  ['forced helper kill', (f, t) => { t.mock.timers.tick(11000); assert.equal(f.kills, 1); }, 0],
]) test(`valid cancellation receipt plus ${name} remains unconfirmed`, async t => {
  const f = fixture(t), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
  f.frame(cancellationReceipt(f)); trigger(f, t); f.helper.emit('close', closeCode); await terminating;
  assert.equal((await handle.completion).tree_cleanup_confirmed, false);
});

test('cancellation without any native receipt remains unconfirmed even after helper close0', async t => {
  const f = fixture(t), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
  f.helper.emit('close', 0); await terminating;
  assert.equal((await handle.completion).tree_cleanup_confirmed, false);
  assert.equal((await handle.completion).reason, 'CONTROLLER_EXIT_UNPROVEN');
});

for (const type of ['resumed', 'output', 'exit', 'error']) test(`${type} during suspended cancellation cannot replace its cleanup receipt`, async t => {
  const f = fixture(t), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
  let output = ''; handle.stdout.on('data', chunk => { output += chunk.toString(); });
  f.frame({ type, channel: 'stdout', data_b64: 'cmFu', exit_code: 0, tree_cleanup_confirmed: true });
  f.frame(cancellationReceipt(f)); f.helper.emit('close', 0); await terminating;
  assert.equal((await handle.completion).tree_cleanup_confirmed, false); assert.equal(output, '');
  assert.equal((await handle.completion).reason, type === 'error' ? 'NATIVE_JOB_FAILED' : 'CONTROLLER_PROTOCOL_INVALID');
});

test('a helper signal cannot confirm a cancellation receipt even alongside exit0', async t => {
  const f = fixture(t), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
  f.frame(cancellationReceipt(f)); f.helper.emit('close', 0, 'SIGTERM'); await terminating;
  assert.equal((await handle.completion).tree_cleanup_confirmed, false);
});

test('separate controller runs issue distinct cancellation IDs', async t => {
  const ids = [];
  for (let n = 0; n < 2; n++) await t.test(`run ${n}`, async child => {
    const f = fixture(child), handle = await readyHandle(f), terminating = handle.terminate('CANCELLED');
    const receipt = cancellationReceipt(f); ids.push(receipt.cancellation_id);
    f.frame(receipt); f.helper.emit('close', 0); await terminating;
  });
  assert.notEqual(ids[0], ids[1]);
});
