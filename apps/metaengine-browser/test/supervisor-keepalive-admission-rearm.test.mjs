import assert from 'node:assert/strict';
import test from 'node:test';

import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

const CONVERSATION_URL = 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000028';
const OPEN = Object.freeze({
  authoritative: true,
  state: 'OPEN',
  continuous_service_allowed: true,
  refill_enabled: true,
  supervisor_admission_enabled: true,
  generation_floor: 28,
});
const CLOSED = Object.freeze({
  authoritative: true,
  state: 'CLOSED',
  continuous_service_allowed: false,
  refill_enabled: false,
  supervisor_admission_enabled: false,
  generation_floor: 28,
  reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
});

function createHarness() {
  let durable = null;
  let now = Date.parse('2026-09-16T00:00:00.000Z');
  let uuidSeq = 0;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => durable == null ? null : structuredClone(durable),
    saveState: async (next) => { durable = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`,
    processIncarnationId: 'process_admission_rearm_test',
    minWakeIntervalMs: 30000,
  });
  return {
    keepalive,
    advance(ms = 1) { now += ms; },
    durable() { return durable == null ? null : structuredClone(durable); },
  };
}

async function bindOpen(harness) {
  await harness.keepalive.init();
  await harness.keepalive.bindConversation({ url: CONVERSATION_URL, tab_id: 'tab_supervisor' });
  return harness.keepalive.applyAdmissionOpen(OPEN);
}

test('authoritative OPEN re-arms the exact admission-fenced RECOVERING latch and permits one fresh cycle', async () => {
  const harness = createHarness();
  const { keepalive } = harness;
  await bindOpen(harness);

  await keepalive.applyAdmissionClosed(CLOSED);
  assert.equal(keepalive.snapshot().state, 'PARKED');
  assert.equal(keepalive.snapshot().parked_reason, 'CONTINUOUS_SERVICE_ADMISSION_FENCED');

  // Preserve the fence while paused, then model the recovery/readback gap that
  // produced the live RECOVERING + admission-fence latch.
  await keepalive.pause();
  await keepalive.applyAdmissionOpen(OPEN);
  await keepalive.resume();
  await keepalive.applyAdmissionUnavailable('AUTHORITATIVE_READBACK_UNAVAILABLE');

  const recovering = keepalive.snapshot();
  assert.equal(recovering.state, 'RECOVERING');
  assert.equal(recovering.admission_state, 'UNKNOWN');
  assert.equal(recovering.parked_reason, 'CONTINUOUS_SERVICE_ADMISSION_FENCED');

  harness.advance();
  const reopened = await keepalive.applyAdmissionOpen(OPEN);
  assert.equal(reopened.state, 'WAITING');
  assert.equal(reopened.admission_state, 'OPEN');
  assert.equal(reopened.parked_at, null);
  assert.equal(reopened.parked_reason, null);
  assert.equal(reopened.parked_queued_wake_count, 0);
  assert.deepEqual(reopened.parked_wake_reasons, []);
  assert.equal(reopened.cycle_seq, 0);

  const prepared = await keepalive.prepareWake('CONTINUE_DEVELOPMENT', { key: 'fresh-after-open' });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.pending.cycle_seq, 1);
  assert.equal(prepared.pending.reason, 'CONTINUE_DEVELOPMENT');

  const active = await keepalive.confirmWakeSent(prepared.pending.wake_id);
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.cycle_seq, 1);
  assert.equal(active.active_wake?.reason, 'CONTINUE_DEVELOPMENT');
});

test('reopen retires parked queue telemetry and never resurrects pre-fence work', async () => {
  const harness = createHarness();
  const { keepalive } = harness;
  await bindOpen(harness);

  await keepalive.enqueueWake('WORKER_RESULT_READY', { agent_id: 'agent_stale' });
  assert.equal(keepalive.snapshot().queued_wakes.length, 1);

  const parked = await keepalive.applyAdmissionClosed(CLOSED);
  assert.equal(parked.state, 'PARKED');
  assert.equal(parked.queued_wakes.length, 0);
  assert.equal(parked.parked_queued_wake_count, 1);
  assert.deepEqual(parked.parked_wake_reasons, ['WORKER_RESULT_READY']);

  const reopened = await keepalive.applyAdmissionOpen(OPEN);
  assert.equal(reopened.state, 'WAITING');
  assert.equal(reopened.queued_wakes.length, 0);
  assert.equal(reopened.parked_reason, null);
  assert.equal(reopened.parked_queued_wake_count, 0);
  assert.deepEqual(reopened.parked_wake_reasons, []);
  assert.equal(keepalive.nextQueuedWake(), null);

  const repeated = await keepalive.applyAdmissionOpen(OPEN);
  assert.equal(repeated.state, 'WAITING');
  assert.equal(repeated.queued_wakes.length, 0);
  assert.equal(repeated.cycle_seq, 0);
});

test('OPEN does not re-arm unrelated RECOVERING reasons', async () => {
  const harness = createHarness();
  const { keepalive } = harness;
  await bindOpen(harness);

  await keepalive.applyAdmissionClosed({
    ...CLOSED,
    reason: 'MANUAL_MAINTENANCE_FENCE',
  });
  await keepalive.pause();
  await keepalive.applyAdmissionOpen(OPEN);
  await keepalive.resume();
  await keepalive.applyAdmissionUnavailable('AUTHORITATIVE_READBACK_UNAVAILABLE');

  const before = keepalive.snapshot();
  assert.equal(before.state, 'RECOVERING');
  assert.equal(before.parked_reason, 'MANUAL_MAINTENANCE_FENCE');

  const after = await keepalive.applyAdmissionOpen(OPEN);
  assert.equal(after.state, 'RECOVERING');
  assert.equal(after.parked_reason, 'MANUAL_MAINTENANCE_FENCE');
  assert.equal(after.cycle_seq, 0);
});

test('OPEN preserves ambiguous wake fencing', async () => {
  const harness = createHarness();
  const { keepalive } = harness;
  await bindOpen(harness);

  const prepared = await keepalive.prepareWake('CONTINUE_DEVELOPMENT', { key: 'ambiguous' });
  assert.equal(prepared.ok, true);
  await keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'SEND_EFFECT_UNKNOWN');

  await keepalive.applyAdmissionClosed(CLOSED);
  const reopened = await keepalive.applyAdmissionOpen(OPEN);
  assert.equal(reopened.state, 'WAKE_AMBIGUOUS');
  assert.equal(reopened.pending_wake?.wake_id, prepared.pending.wake_id);
  assert.equal(reopened.pending_wake?.automatic_retry_allowed, false);
  assert.equal(reopened.cycle_seq, 0);
});

test('duplicate fresh wake cannot create a second cycle and generation floor cannot regress', async () => {
  const harness = createHarness();
  const { keepalive } = harness;
  await bindOpen(harness);
  await keepalive.applyAdmissionClosed(CLOSED);
  await keepalive.applyAdmissionOpen(OPEN);

  const first = await keepalive.prepareWake('CONTINUE_DEVELOPMENT', { key: 'dedupe' });
  assert.equal(first.ok, true);
  const duplicate = await keepalive.prepareWake('CONTINUE_DEVELOPMENT', { key: 'dedupe' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.suppressed, true);

  const active = await keepalive.confirmWakeSent(first.pending.wake_id);
  assert.equal(active.cycle_seq, 1);
  assert.equal(active.state, 'ACTIVE');
  assert.equal(keepalive.nextQueuedWake(), null);

  await assert.rejects(
    keepalive.applyAdmissionOpen({ ...OPEN, generation_floor: 27 }),
    /keepalive_admission_generation_floor_regression/,
  );
  assert.equal(keepalive.snapshot().cycle_seq, 1);
});
