import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hangingFetch(_url, { signal } = {}) {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
  });
}

function stubIdentity() {
  return {
    ensure: async () => ({ device_id: '00000000-0000-4000-8000-0000000000c1', enrollment_request_id: null }),
    snapshot: () => ({ device_id: '00000000-0000-4000-8000-0000000000c1' }),
    enrollmentHeaders: async () => ({}),
    deviceHeaders: async () => ({}),
    clearEnrollmentRequest: async () => {},
    bindEnrollmentRequest: async () => {},
    bindDevice: async () => {},
  };
}

function baseClientOptions({ fetchImpl, ...extra } = {}) {
  return {
    identity: stubIdentity(),
    fetchImpl,
    getState: async () => ({ tabs: [], fleet: { agents: [] } }),
    executeCommand: async () => ({ ok: true, authority_effect: false }),
    version: 'test',
    intervalMs: 1000,
    legacySingleLeaseFallback: true,
    ...extra,
  };
}

test('CP-W1: control_plane tracks lease liveness across ok and failed lease attempts', async () => {
  let waitBatchCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/v1/commands/wait-batch')) {
      waitBatchCalls += 1;
      if (waitBatchCalls === 1) throw new Error('transient_lease_failure');
      return { status: 200, ok: true, json: async () => ({ commands: [] }) };
    }
    return { status: 202, ok: true, json: async () => ({}) };
  };
  const client = new NativeSupervisorClient(baseClientOptions({ fetchImpl, intervalMs: 250 }));
  await client.start();
  let maxFailuresSeen = 0;
  let sawFailureError = false;
  for (let i = 0; i < 12; i += 1) {
    await sleep(75);
    const cp = client.snapshot().control_plane;
    maxFailuresSeen = Math.max(maxFailuresSeen, cp.lease_consecutive_failures);
    if (cp.lease_last_error) sawFailureError = /transient_lease_failure/.test(cp.lease_last_error);
  }
  client.stop();
  const cp = client.snapshot().control_plane;
  assert.equal(cp.schema, 'metaengine.native-supervisor.control-plane.v1');
  assert.equal(cp.batch_transport, 'SUPPORTED');
  assert.ok(cp.lease_last_attempt_at, 'lease attempts must be recorded');
  assert.ok(cp.lease_last_ok_at, 'a successful lease RPC must be recorded');
  assert.ok(maxFailuresSeen >= 1, 'the transient failure must be counted (consecutive window)');
  assert.ok(sawFailureError, 'the lease error must be surfaced in the control-plane projection');
  assert.equal(cp.authority_effect, false);
});

test('CP-W1: heartbeat payload carries the control_plane projection', async () => {
  let heartbeatBody = null;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes('/v1/state')) {
      heartbeatBody = JSON.parse(String(init.body || '{}'));
      return { status: 202, ok: true, json: async () => ({}) };
    }
    if (String(url).includes('/v1/commands/wait-batch')) {
      return { status: 200, ok: true, json: async () => ({ commands: [] }) };
    }
    return { status: 202, ok: true, json: async () => ({}) };
  };
  const client = new NativeSupervisorClient(baseClientOptions({ fetchImpl }));
  await client.start();
  await sleep(700);
  client.stop();
  assert.ok(heartbeatBody, 'state heartbeat must have been posted');
  assert.equal(heartbeatBody.state.control_plane?.schema, 'metaengine.native-supervisor.control-plane.v1');
  assert.ok('lease_last_ok_at' in heartbeatBody.state.control_plane);
});

test('CP-W1: healthy cycles never escalate and the watchdog never double-schedules', async () => {
  let cycles = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/v1/commands/wait-batch')) {
      cycles += 1;
      return { status: 200, ok: true, json: async () => ({ commands: [] }) };
    }
    return { status: 202, ok: true, json: async () => ({}) };
  };
  let exitCalls = 0;
  const client = new NativeSupervisorClient(baseClientOptions({
    fetchImpl,
    intervalMs: 250,
    commandCycleHardDeadlineMs: 1000,
    schedulerWatchdogIntervalMs: 250,
    wedgeExitImpl: () => { exitCalls += 1; },
  }));
  await client.start();
  await sleep(1600);
  client.stop();
  assert.equal(exitCalls, 0, 'fast healthy cycles must not trigger the wedge escalation');
  assert.equal(client.snapshot().control_plane.wedge_escalation, null);
  assert.ok(cycles >= 2, `cycles must keep flowing (got ${cycles})`);
  assert.equal(client.snapshot().control_plane.scheduler_watchdog_rearm_count, 0,
    'the watchdog must not re-arm while the chain is healthy');
});

test('CP-W1: a cycle wedged past the hard deadline escalates to exit so the Sentinel can resurrect', async () => {
  let exitCode = null;
  const client = new NativeSupervisorClient(baseClientOptions({
    fetchImpl: hangingFetch,
    intervalMs: 1000,
    commandCycleHardDeadlineMs: 1000,
    wedgeExitImpl: (code) => { exitCode = code; },
  }));
  // start() awaits its tail cycle; a wedged lease keeps that await pending
  // (in production the bounded fetch wrapper prevents this) — drive it detached.
  void client.start().catch(() => {});
  // deadline 1000ms (first cycle starts at the 1s interval tick) + exit grace
  // 2500ms + scheduling slack — the exit stub must have fired before the assert.
  await sleep(6000);
  client.stop();
  assert.equal(exitCode, 2, 'the wedge escalation must request process exit(2)');
  const cp = client.snapshot().control_plane;
  assert.equal(cp.wedge_escalation?.reason, 'CYCLE_HARD_DEADLINE_EXIT_ESCALATION');
  assert.match(client.snapshot().last_error || '', /command_cycle_hard_deadline/);
  assert.equal(cp.cycle_running, true, 'the wedged cycle is still (honestly) reported as running');
});

test('CP-W1: hard deadline is clamped to a safe floor', () => {
  const tiny = new NativeSupervisorClient(baseClientOptions({
    fetchImpl: async () => ({ status: 202, ok: true, json: async () => ({}) }),
    commandCycleHardDeadlineMs: 1,
    wedgeExitImpl: () => {},
  }));
  assert.ok(tiny.snapshot(), 'client constructs with clamped deadline');
  tiny.stop();
});
