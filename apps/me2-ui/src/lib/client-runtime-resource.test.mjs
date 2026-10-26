import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientRuntimeResource } from './client-runtime-resource.ts';

// These are renderer contract inputs, not receipts from a running Owner.
const observation = () => ({
  connection: {
    schema: 'metaengine.client.connection-status.v1', local_runtime_ready: true,
    admin_ready: true, cloud_control_state: 'CONNECTED', authority_effect: false,
  },
  work: {
    schema: 'metaengine.client.work-readiness.v1', observed_at: new Date().toISOString(),
    state: 'READY', reason: null, label: 'Ready for work', detail: 'Results require independent review.',
    execution_ready: true, readiness_scope: 'CHAT_DISPATCH', heartbeat_fresh: true,
    capabilities: {
      chat_dispatch: { ready: true, reason: null },
      coding_execution: { ready: false, reason: 'CODING_BACKEND_NOT_EXECUTABLE' },
      host_continuity: { ready: false, reason: 'GUARDIAN_CONTINUITY_NOT_PROVEN' },
      continuous_autonomy: { ready: false, reason: 'CODING_BACKEND_NOT_EXECUTABLE' },
    },
    continuous_autonomy_ready: false, generation_floor: 28, local_generation_floor: 28,
    proven_agent_count: 1, useful_work_verified: false, verified_self_improvement: false,
    recovery_effect_exposed: false, scheduler_authority: false,
    automatic_retry_allowed: false, authority_effect: false,
  },
});

function resource(t, read) {
  const timers = new Map();
  let id = 0;
  const value = createClientRuntimeResource({
    read, isVisible: () => true, onVisibilityChange: () => () => {},
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    cancel: timer => timers.delete(timer),
  });
  const stop = value.subscribe(() => {});
  t.after(stop);
  return value;
}

test('a fresh READY work read cannot override an unavailable local Owner read', async t => {
  const next = observation();
  next.connection.local_runtime_ready = false;
  const value = resource(t, async () => next);
  await value.refresh();
  assert.deepEqual(value.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
});

test('loss of local Owner clears a previously ready observation', async t => {
  const next = observation();
  const value = resource(t, async () => structuredClone(next));
  await value.refresh();
  assert.equal(value.getSnapshot().readback.work.execution_ready, true);
  next.connection.local_runtime_ready = false;
  await value.refresh();
  assert.deepEqual(value.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
  next.connection.local_runtime_ready = true;
  next.work.observed_at = new Date().toISOString();
  await value.refresh();
  assert.equal(value.getSnapshot().state, 'LIVE');
  assert.equal(value.getSnapshot().readback.work.execution_ready, true);
});

test('an explanatory BLOCKED observation remains visible when local Owner is unavailable', async t => {
  const next = observation();
  next.connection.local_runtime_ready = false;
  Object.assign(next.work, {
    state: 'BLOCKED', execution_ready: false, heartbeat_fresh: false,
    reason: 'LOCAL_RUNTIME_NOT_READY', label: 'Waiting for local runtime',
  });
  next.work.capabilities.chat_dispatch = { ready: false, reason: 'LOCAL_RUNTIME_NOT_READY' };
  const value = resource(t, async () => next);
  await value.refresh();
  assert.equal(value.getSnapshot().state, 'LIVE');
  assert.equal(value.getSnapshot().readback.work.reason, 'LOCAL_RUNTIME_NOT_READY');
  assert.equal(value.getSnapshot().readback.work.execution_ready, false);
});

test('an IPC failure remains unavailable and cannot be hidden by prior valid readiness', async t => {
  let fail = false;
  const value = resource(t, async () => {
    if (fail) throw new Error('owner_connection_lost');
    return observation();
  });
  await value.refresh();
  assert.equal(value.getSnapshot().state, 'LIVE');
  fail = true;
  await value.refresh();
  assert.deepEqual(value.getSnapshot(), { state: 'UNAVAILABLE', readback: null });
});
