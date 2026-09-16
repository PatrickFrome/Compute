import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { persistSelfUpdateSessionContinuity, loadSelfUpdateSessionContinuity } from '../src/self-update-session-continuity.mjs';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';
import {
  probeUpdatedSuccessorQualification,
  recordAcceptedSignedSupervisorHeartbeat,
  startSuccessorQualificationReprobeLoop,
} from '../src/self-update-successor-qualification.mjs';
import {
  reconcileStaleSelfUpdateSessionContinuity,
  recoverStuckSelfUpdateContinuity,
} from '../src/self-update-continuity-watchdog.mjs';
import {
  shouldResumeSuccessorQualification,
  selfUpdateRecoveryDiagnosticSnapshot,
} from '../src/self-update-successor-recovery.mjs';
import { readSelfUpdateTransaction } from '../src/self-update-transaction-journal.mjs';
import {
  beginSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';
import { attemptSelfUpdateOldParentHandoff, readSelfUpdateOldParentHandoff } from '../src/self-update-old-parent-handoff.mjs';
import { SelfUpdateRuntime as SelfUpdateRuntimeV8 } from '../src/self-update-runtime-v8.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';

const UNRESOLVED_PRIOR = 'self_update_transaction_unresolved_prior:SUCCESSOR_BOOTED';

async function fixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-qualification-repair-'));
  let version = '0.6.3-dev.152.0';
  let locked = true;
  const app = {
    isPackaged: true,
    getPath: (name) => { assert.equal(name, 'userData'); return userData; },
    getVersion: () => version,
    hasSingleInstanceLock: () => locked,
    setVersion: (value) => { version = String(value); },
    setLocked: (value) => { locked = value === true; },
  };
  return { app, userData };
}

function receipt(target) {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target,
    available_version: target,
    metadata_verified: true,
    publisher_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    authority_effect: false,
  };
}

function capsuleRow(currentVersion, targetVersion) {
  return {
    schema: 'metaengine.self-update-session-continuity.v1',
    current_version: currentVersion,
    target_version: targetVersion,
    created_at: new Date().toISOString(),
    tabs: [],
    lifecycle: null,
    persisted_chat_text: false,
    persisted_tab_titles: false,
    persisted_credentials: false,
    authority_effect: false,
  };
}

// The exact updater snapshot a live stuck successor posts: ERROR with the
// self-referential unresolved-prior error, continuity projecting a stale
// (strictly older) leftover capsule target.
function stuckSuccessorHeartbeat(version, { continuityState = 'TARGET_VERSION_MISMATCH', capsuleTarget = '0.6.3-dev.151.9', updaterState = 'ERROR', updaterError = UNRESOLVED_PRIOR } = {}) {
  return {
    shell_version: version,
    self_update_session_continuity: { state: continuityState, target_version: capsuleTarget, authority_effect: false },
    self_update: {
      state: updaterState,
      current_version: version,
      last_error: updaterError,
      host_resilience: {
        state: 'ACTIVE',
        sentinel_worker_healthy: true,
        sentinel: {
          lifecycle: 'ARMED',
          worker_ready: true,
          worker_heartbeat_age_ms: 500,
          authority_effect: false,
        },
      },
    },
  };
}

async function bootSuccessor(app, target = '0.6.3-dev.152.1') {
  await persistPreInstallReceipt(app, receipt(target));
  app.setVersion(target);
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser', '--updated'], primaryInstance: true });
  return target;
}

async function seedPendingRecovery(app, target) {
  const transaction = await readSelfUpdateTransaction(app);
  assert.equal(transaction?.state, 'SUCCESSOR_BOOTED');
  const resume = shouldResumeSuccessorQualification({
    updatedLaunch: false,
    startupInspection: {
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'TARGET_INSTALLED',
      transaction_state: 'SUCCESSOR_BOOTED',
      transaction_id: transaction.transaction_id,
      target_git_sha: transaction.resolved_git_sha || null,
      current_version: target,
      target_version: target,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
  });
  assert.equal(resume, true);
  return selfUpdateRecoveryDiagnosticSnapshot();
}

function manualTimers() {
  const queue = [];
  const setTimer = (fn) => {
    const handle = { fn, unref: () => {}, ref: () => {} };
    queue.push(handle);
    return handle;
  };
  const pending = () => queue.length;
  const fireNext = () => {
    const handle = queue.shift();
    if (handle) handle.fn();
  };
  return { setTimer, fireNext, pending };
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), `timed out waiting for ${label}`);
}

test('heartbeat tolerates the pending-prior updater error and a strictly-older capsule mismatch', async () => {
  const { app, userData } = await fixture();
  const target = await bootSuccessor(app);
  await seedPendingRecovery(app, target);
  await persistSelfUpdateSessionContinuity(userData, capsuleRow('0.6.3-dev.152.0', '0.6.3-dev.151.9'));

  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target),
    acceptedAtMs: Date.now(),
  });
  assert.equal(result.state, 'HEARTBEAT_HEALTHY');
  assert.equal(result.signed_heartbeat_accepted, true);
  assert.equal(result.authority_effect, false);

  const probe = await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 60_000 });
  // Capsule file is still on disk — that must remain the probe's own blocker.
  assert.equal(probe.state, 'PENDING_CONTINUITY');
  await fs.rm(userData, { recursive: true, force: true });
});

test('heartbeat still rejects any other updater error, FAILED state, and equal/newer mismatched capsules', async () => {
  const { app, userData } = await fixture();
  const target = await bootSuccessor(app);
  await seedPendingRecovery(app, target);

  const otherError = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target, { updaterError: 'downloaded_version_binding_mismatch' }),
    acceptedAtMs: Date.now(),
  });
  assert.equal(otherError.state, 'HEARTBEAT_UPDATER_UNHEALTHY');
  assert.equal(otherError.updater_error, 'downloaded_version_binding_mismatch');

  const failedState = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target, { updaterState: 'FAILED' }),
    acceptedAtMs: Date.now(),
  });
  assert.equal(failedState.state, 'HEARTBEAT_UPDATER_UNHEALTHY');

  const newerMismatch = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target, { capsuleTarget: '0.6.3-dev.153.0' }),
    acceptedAtMs: Date.now(),
  });
  assert.equal(newerMismatch.state, 'QUARANTINED');
  assert.equal(newerMismatch.reason, 'session_continuity_target_version_mismatch');
  const quarantinedTxn = await readSelfUpdateTransaction(app);
  assert.equal(quarantinedTxn.state, 'QUARANTINED');
  await fs.rm(userData, { recursive: true, force: true });
});

test('heartbeat accepts continuity NONE — a restarted successor has nothing left to restore', async () => {
  const { app, userData } = await fixture();
  const target = await bootSuccessor(app);
  await seedPendingRecovery(app, target);

  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target, { continuityState: 'NONE', capsuleTarget: null, updaterState: 'CURRENT', updaterError: null }),
    acceptedAtMs: Date.now(),
  });
  assert.equal(result.state, 'HEARTBEAT_HEALTHY');

  const probe = await probeUpdatedSuccessorQualification({ app, uptimeMs: () => 60_000 });
  assert.equal(probe.state, 'QUALIFIED');
  const transaction = await readSelfUpdateTransaction(app);
  assert.equal(transaction.state, 'QUALIFIED');
  await fs.rm(userData, { recursive: true, force: true });
});

test('re-probe loop heals the full live deadlock: stale capsule archived, then transaction qualified', async () => {
  const { app, userData } = await fixture();
  const target = await bootSuccessor(app);
  await seedPendingRecovery(app, target);
  // Leftover capsule from an older, already-superseded attempt (H1 evidence).
  await persistSelfUpdateSessionContinuity(userData, capsuleRow('0.6.3-dev.151.8', '0.6.3-dev.151.9'));
  // Updater stuck in the self-referential unresolved-prior error (H2 evidence).
  const heartbeat = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target),
    acceptedAtMs: Date.now(),
  });
  assert.equal(heartbeat.state, 'HEARTBEAT_HEALTHY');

  const events = [];
  const timers = manualTimers();
  const loop = startSuccessorQualificationReprobeLoop({
    app,
    setTimer: timers.setTimer,
    probe: (args) => probeUpdatedSuccessorQualification({ ...args, uptimeMs: () => 60_000 }),
    onResult: (row) => events.push(row),
  });
  assert.equal(globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__, loop);

  // Tick 1: capsule still present -> PENDING_CONTINUITY + durable supersede.
  timers.fireNext();
  await waitFor(() => events.some((row) => row.state === 'CONTINUITY_RECONCILED'), 'tick1 reconcile');
  assert.equal(events.find((row) => row.state === 'PENDING_CONTINUITY')?.state, 'PENDING_CONTINUITY');
  assert.equal(events.find((row) => row.state === 'CONTINUITY_RECONCILED')?.reconcile.state, 'SUPERSEDED');
  assert.equal(await loadSelfUpdateSessionContinuity(userData), null);
  const names = await fs.readdir(userData);
  assert.ok(names.some((name) => name.includes('continuity-superseded-')), 'supersede sidecar must exist');

  // Tick 2: capsule gone + accepted heartbeat still fresh -> QUALIFIED + stop.
  const accepted = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: stuckSuccessorHeartbeat(target),
    acceptedAtMs: Date.now(),
  });
  assert.equal(accepted.state, 'HEARTBEAT_HEALTHY');
  timers.fireNext();
  await waitFor(() => events.some((row) => row.state === 'LOOP_STOPPED'), 'tick2 stop');
  assert.equal(events.find((row) => row.state === 'QUALIFIED')?.state, 'QUALIFIED');
  assert.match(events.find((row) => row.state === 'LOOP_STOPPED')?.reason, /terminal:QUALIFIED/);
  assert.equal(timers.pending(), 0, 'no further ticks are scheduled');
  assert.equal(globalThis.__METAENGINE_SELF_UPDATE_QUALIFICATION_REPROBE__, undefined);

  const transaction = await readSelfUpdateTransaction(app);
  assert.equal(transaction.state, 'QUALIFIED');
  await fs.rm(userData, { recursive: true, force: true });
});

test('re-probe loop stops immediately when the transaction is no longer pending', async () => {
  const { app, userData } = await fixture();
  const target = await bootSuccessor(app);
  await seedPendingRecovery(app, target);
  const transaction = await readSelfUpdateTransaction(app);
  await transitionSelfUpdateTransaction(app, 'QUALIFIED', { requireTargetVersion: target });

  const events = [];
  const timers = manualTimers();
  startSuccessorQualificationReprobeLoop({
    app,
    setTimer: timers.setTimer,
    probe: (args) => probeUpdatedSuccessorQualification({ ...args, uptimeMs: () => 60_000 }),
    onResult: (row) => events.push(row),
  });
  await timers.fireNext();
  await waitFor(() => events.some((row) => row.state === 'LOOP_STOPPED'), 'not-pending stop');
  assert.equal(events.find((row) => row.state === 'NOT_PENDING')?.state, 'NOT_PENDING');
  assert.equal(events.filter((row) => row.state === 'LOOP_STOPPED').length, 1);
  assert.equal(timers.pending(), 0);
  assert.ok(transaction.transaction_id);
  await fs.rm(userData, { recursive: true, force: true });
});

test('reconcile keeps future-target and non-comparable capsules fail-closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-reconcile-'));
  await persistSelfUpdateSessionContinuity(dir, capsuleRow('0.6.3-dev.152.1', '0.6.3-dev.153.0'));
  const future = await reconcileStaleSelfUpdateSessionContinuity({ userDataPath: dir, currentVersion: '0.6.3-dev.152.1' });
  assert.equal(future.state, 'FUTURE_TARGET');
  assert.equal((await loadSelfUpdateSessionContinuity(dir))?.target_version, '0.6.3-dev.153.0');

  await fs.rm(dir, { recursive: true, force: true });
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-reconcile-2'));
  await persistSelfUpdateSessionContinuity(dir2, capsuleRow('0.6.3-dev.152.1', '0.7.0'));
  const unknown = await reconcileStaleSelfUpdateSessionContinuity({ userDataPath: dir2, currentVersion: '0.6.3-dev.152.1' });
  assert.equal(unknown.state, 'COMPARISON_UNAVAILABLE');
  assert.equal((await loadSelfUpdateSessionContinuity(dir2))?.target_version, '0.7.0');

  const dir3 = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-reconcile-3'));
  const cleared = await reconcileStaleSelfUpdateSessionContinuity({ userDataPath: dir3, currentVersion: '0.6.3-dev.152.1' });
  assert.equal(cleared.state, 'CLEARED');
  await fs.rm(dir2, { recursive: true, force: true });
  await fs.rm(dir3, { recursive: true, force: true });
});

test('watchdog recovery archives a strictly-older mismatched capsule without relaunching', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-watchdog-supersede-'));
  await persistSelfUpdateSessionContinuity(dir, capsuleRow('0.6.3-dev.151.8', '0.6.3-dev.151.9'));
  const calls = [];
  const result = await recoverStuckSelfUpdateContinuity({
    userDataPath: dir,
    currentVersion: '0.6.3-dev.152.1',
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(['exit', code]),
  });
  assert.equal(result.state, 'TARGET_VERSION_MISMATCH');
  assert.equal(result.reconcile_state, 'SUPERSEDED');
  assert.equal(result.recovered, false);
  assert.deepEqual(calls, []);
  assert.equal(await loadSelfUpdateSessionContinuity(dir), null);
  const names = await fs.readdir(dir);
  assert.ok(names.some((name) => name.includes('continuity-superseded-')));
  await fs.rm(dir, { recursive: true, force: true });
});

test('D1: cancelled watchdog recovery aborts before effects at both await points', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-watchdog-abort-'));
  await persistSelfUpdateSessionContinuity(dir, capsuleRow('0.6.3-dev.152.0', '0.6.3-dev.152.1'));
  const calls = [];
  // Abort while the capsule load is in flight.
  const abortedEarly = await recoverStuckSelfUpdateContinuity({
    userDataPath: dir,
    currentVersion: '0.6.3-dev.152.1',
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(['exit', code]),
    shouldAbort: () => true,
  });
  assert.equal(abortedEarly.state, 'ABORTED');
  assert.equal(abortedEarly.recovered, false);
  assert.deepEqual(calls, []);
  assert.ok((await loadSelfUpdateSessionContinuity(dir))?.target_version, 'capsule must be untouched');

  // Abort after the durable quarantine write but before relaunch+exit: the
  // flag flips observable at the second check (first check passes).
  let lateAbortChecks = 0;
  const abortedLate = await recoverStuckSelfUpdateContinuity({
    userDataPath: dir,
    currentVersion: '0.6.3-dev.152.1',
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(['exit', code]),
    shouldAbort: () => (lateAbortChecks += 1) >= 2,
  });
  assert.equal(abortedLate.state, 'QUARANTINED_ABORTED');
  assert.equal(abortedLate.recovered, false);
  assert.deepEqual(calls, [], 'no process effects after cancellation');
  assert.equal(await loadSelfUpdateSessionContinuity(dir), null, 'quarantine sidecar is durable');
  await fs.rm(dir, { recursive: true, force: true });
});

test('D1: old-parent handoff honors cancellation before and after the durable intent write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-old-parent-abort-'));
  let current = '0.6.6-dev.8.1';
  const app = {
    getPath: (name) => { assert.equal(name, 'userData'); return dir; },
    getVersion: () => current,
  };
  await beginSelfUpdateTransaction(app, {
    version: '0.6.6-dev.9.1',
    available_version: '0.6.6-dev.9.1',
    metadata_verified: true,
    restart_gate_safe: true,
    resolved_git_sha: 'b'.repeat(40),
    authority_effect: false,
  });
  await transitionSelfUpdateTransaction(app, 'INSTALLING', { requireTargetVersion: '0.6.6-dev.9.1' });
  await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED', { requireTargetVersion: '0.6.6-dev.9.1' });

  const calls = [];
  const abortedBeforeWrite = await attemptSelfUpdateOldParentHandoff({
    app,
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(['exit', code]),
    shouldAbort: () => true,
  });
  assert.equal(abortedBeforeWrite.state, 'HANDOFF_ABORTED');
  assert.equal(abortedBeforeWrite.recovered, false);
  assert.deepEqual(calls, []);

  // Abort flips observable exactly at the second check — after the durable
  // intent write, before the relaunch/exit effect tail.
  let abortChecks = 0;
  const abortedAfterWrite = await attemptSelfUpdateOldParentHandoff({
    app,
    relaunch: () => calls.push('relaunch'),
    exit: (code) => calls.push(['exit', code]),
    shouldAbort: () => (abortChecks += 1) >= 2,
  });
  assert.equal(abortedAfterWrite.state, 'HANDOFF_INTENT_ABORTED');
  assert.equal(abortedAfterWrite.recovered, false);
  assert.deepEqual(calls, [], 'no process effects after cancellation');
  const handoffNames = (await fs.readdir(dir)).filter((name) => name.includes('old-parent-handoff') || name.includes('handoff'));
  assert.ok(handoffNames.length >= 1, 'the durable intent write is preserved for audit');
  await fs.rm(dir, { recursive: true, force: true });
});

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
  }
  setFeedURL() {}
  async checkForUpdates() { this.checks += 1; }
  async downloadUpdate() { this.downloads += 1; }
  quitAndInstall() { this.installs += 1; }
}

test('updater holds the next install while its own prior transaction awaits qualification', async () => {
  const updater = new FakeUpdater();
  let beforeInstalls = 0;
  let priorTransaction = { state: 'SUCCESSOR_BOOTED', target_version: '0.6.3-dev.152.1' };
  let now = 1_000_000;
  const runtime = new SelfUpdateRuntimeV8({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.3-dev.152.1',
    ciTestFeedUrl: 'http://127.0.0.1:1/',
    ciTestMode: true,
    githubActions: true,
    canRestart: async () => true,
    restartGraceMs: 1_000,
    clock: () => now,
    beforeInstall: async () => { beforeInstalls += 1; },
    readPriorTransaction: async () => priorTransaction,
  });
  await runtime.start();
  updater.emit('update-available', {
    version: '0.6.3-dev.153.1',
    files: [{ url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.153.1-x64.exe', sha512: 'a'.repeat(88), size: 123 }],
    stagingPercentage: 100,
  });
  await new Promise((resolve) => setImmediate(resolve));
  updater.emit('update-downloaded', { version: '0.6.3-dev.153.1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.snapshot().state, 'READY_RESTART');

  await runtime.applyWhenSafe();
  now += 5_000;
  await runtime.applyWhenSafe();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(beforeInstalls, 0, 'install handoff must be held, not attempted');
  assert.equal(updater.installs, 0, 'no installer dispatch while prior qualification is pending');
  assert.equal(runtime.snapshot().state, 'READY_RESTART');
  assert.equal(runtime.snapshot().last_error, null, 'the hold must not poison updater health');
  assert.equal(runtime.snapshot().pending_prior_qualification, true);

  priorTransaction = { state: 'QUALIFIED', target_version: '0.6.3-dev.152.1' };
  now += 5_000;
  await runtime.applyWhenSafe();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(beforeInstalls, 1, 'install proceeds once the prior transaction converged');
  assert.equal(updater.installs, 1);
  assert.equal(runtime.snapshot().pending_prior_qualification, false);
});

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

function redeliveryHarness({ resultStatuses, command }) {
  const delivered = [];
  let posts = 0;
  let batchDelivered = false;
  const identity = {
    async ensure() { return { device_id: 'test-device', enrollment_request_id: null, public_jwk: {}, key_fingerprint_sha256: 'test-key' }; },
    snapshot() { return { device_id: 'test-device', enrollment_request_id: null, public_jwk: {}, key_fingerprint_sha256: 'test-key' }; },
    async deviceHeaders() { return { 'content-type': 'application/json' }; },
  };
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return jsonResponse(202, { accepted: true, authority_effect: false });
    if (pathname.endsWith('/v1/commands/wait-batch')) {
      if (batchDelivered) return jsonResponse(200, { commands: [] });
      batchDelivered = true;
      return jsonResponse(200, { commands: [command] });
    }
    if (pathname.endsWith('/v1/commands/result-batch')) {
      posts += 1;
      const status = resultStatuses[Math.min(posts - 1, resultStatuses.length - 1)];
      if (status !== 200) return jsonResponse(status, { error: 'transient_transport_failure' });
      const payload = JSON.parse(String(init.body || '{}'));
      delivered.push(...(payload.results || []));
      return jsonResponse(200, {
        authority_effect: false,
        results: (payload.results || []).map((row) => ({ command_id: row.command_id, accepted: true, status: row.ok === true ? 'COMPLETED' : 'FAILED' })),
      });
    }
    throw new Error(`unexpected_native_supervisor_request:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => { throw new Error('must_not_reach_generic_executor'); },
    version: '0.0.0-test',
    legacySingleLeaseFallback: false,
    commandFastlane: false,
    resultDeliveryAttempts: 3,
    resultDeliveryBackoffMs: [1, 1],
  });
  return { client, delivered, posts: () => posts };
}

test('result transport redelivers an immutable receipt after a transient 5xx', async () => {
  const harness = redeliveryHarness({
    resultStatuses: [500, 200],
    command: { command_id: '11111111-1111-4111-8111-000000000001', action: 'SET_MODE', payload: { mode: 'OBSERVE' } },
  });
  await harness.client.cycle();
  assert.equal(harness.posts(), 2, 'exactly one bounded redelivery');
  assert.equal(harness.delivered.length, 1);
  assert.equal(harness.delivered[0].ok, true);
  assert.equal(harness.client.snapshot().last_command_status, 'COMPLETED');
});

test('result transport surfaces 4xx contract violations without retry', async () => {
  const harness = redeliveryHarness({
    resultStatuses: [409],
    command: { command_id: '11111111-1111-4111-8111-000000000002', action: 'SET_MODE', payload: { mode: 'OBSERVE' } },
  });
  await assert.rejects(() => harness.client.cycle(), /native_supervisor_batch_result_http_409|native_supervisor_result_http_409/);
  assert.equal(harness.posts(), 1, '4xx must not be retried');
});

test('result transport keeps failing closed after bounded retries are exhausted', async () => {
  const harness = redeliveryHarness({
    resultStatuses: [500],
    command: { command_id: '11111111-1111-4111-8111-000000000003', action: 'SET_MODE', payload: { mode: 'OBSERVE' } },
  });
  await assert.rejects(() => harness.client.cycle(), /native_supervisor_result_http_500/);
  assert.equal(harness.posts(), 3, 'bounded attempts only — never an unbounded retry loop');
});
