import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

function harness() {
  let stored = null;
  let now = Date.parse('2026-09-14T10:00:00.000Z');
  let seq = 0;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    processIncarnationId: 'process_parking_test',
    minWakeIntervalMs: 30000,
  });
  return {
    keepalive,
    advance(ms) { now += ms; },
  };
}

const openAdmission = (generationFloor) => ({
  authoritative: true,
  state: 'OPEN',
  continuous_service_allowed: true,
  refill_enabled: true,
  supervisor_admission_enabled: true,
  generation_floor: generationFloor,
  reason: 'AUTHORITATIVE_OPEN',
});

const closedAdmission = (generationFloor) => ({
  authoritative: true,
  state: 'CLOSED',
  continuous_service_allowed: false,
  refill_enabled: false,
  supervisor_admission_enabled: false,
  generation_floor: generationFloor,
  reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
});

test('closing admission retires queued wake and reopening never replays it', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tab_id: 'tab_supervisor',
  });
  await h.keepalive.applyAdmissionOpen(openAdmission(28));
  await h.keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'stale-before-fence' });

  let snapshot = h.keepalive.snapshot();
  assert.equal(snapshot.admission_state, 'OPEN');
  assert.equal(snapshot.queued_wakes.length, 1);
  assert.equal(snapshot.queued_wakes[0].metadata.key, 'stale-before-fence');

  await h.keepalive.applyAdmissionClosed(closedAdmission(28));
  snapshot = h.keepalive.snapshot();
  assert.equal(snapshot.state, 'PARKED');
  assert.equal(snapshot.admission_state, 'CLOSED');
  assert.equal(snapshot.queued_wakes.length, 0);
  assert.equal(snapshot.parked_queued_wake_count, 1);
  assert.deepEqual(snapshot.parked_wake_reasons, ['CONTINUE_DEVELOPMENT']);
  assert.equal(h.keepalive.canWake(), false);

  const suppressed = await h.keepalive.enqueueWake('CI_TERMINAL', { key: 'during-fence' });
  assert.equal(suppressed.queued_wakes.length, 0);
  assert.equal(suppressed.suppressed_wake_count, 1);
  assert.equal(suppressed.last_suppressed_wake_reason, 'CI_TERMINAL');

  h.advance(31_000);
  await h.keepalive.applyAdmissionOpen(openAdmission(29));
  snapshot = h.keepalive.snapshot();
  assert.equal(snapshot.state, 'WAITING');
  assert.equal(snapshot.admission_state, 'OPEN');
  assert.equal(snapshot.queued_wakes.length, 0);
  assert.equal(h.keepalive.nextQueuedWake(), null);

  await h.keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'fresh-after-reopen' });
  const queued = h.keepalive.nextQueuedWake();
  assert.equal(queued.metadata.key, 'fresh-after-reopen');
  const prepared = await h.keepalive.prepareNextWake();
  assert.equal(prepared.ok, true);
  assert.equal(prepared.pending.reason, 'CONTINUE_DEVELOPMENT');
  assert.equal(prepared.pending.process_incarnation_id, 'process_parking_test');
});

test('closed admission remains monotonic across unavailable readback', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.applyAdmissionClosed(closedAdmission(31));
  await h.keepalive.applyAdmissionUnavailable('DB_READBACK_TIMEOUT');
  const snapshot = h.keepalive.snapshot();
  assert.equal(snapshot.admission_state, 'CLOSED');
  assert.equal(snapshot.state, 'PARKED');
  assert.equal(snapshot.admission_generation_floor, 31);
  assert.equal(snapshot.admission_refill_enabled, false);
  assert.equal(snapshot.admission_supervisor_enabled, false);
});
