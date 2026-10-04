import assert from 'node:assert/strict';
import test from 'node:test';

import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeHarness(processIncarnationId, storedRef) {
  let now = Date.parse('2026-10-04T14:30:00.000Z');
  let seq = 0;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(storedRef.value),
    saveState: async (next) => { storedRef.value = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    processIncarnationId,
    minWakeIntervalMs: 30_000,
  });
  return { keepalive, advance: (ms) => { now += ms; } };
}

async function releasedRolloverState() {
  const storedRef = { value: null };
  const predecessor = makeHarness('process_predecessor', storedRef);
  await predecessor.keepalive.init();
  await predecessor.keepalive.applyAdmissionOpen({
    authoritative: true,
    state: 'OPEN',
    continuous_service_allowed: true,
    refill_enabled: true,
    supervisor_admission_enabled: true,
    generation_floor: 28,
  });
  await predecessor.keepalive.bindConversation({ url: CONVERSATION, tab_id: 'tab_predecessor' });
  await predecessor.keepalive.requestRollover('ROLLOVER_AMBIGUOUS_NO_PROGRESS_FRESH_TAB', { autoRelease: true });
  assert.equal(predecessor.keepalive.snapshot().state, 'ROLLOVER_REQUIRED');
  assert.equal(predecessor.keepalive.snapshot().rollover_attempt, null);
  return storedRef;
}

test('process boundary recovers an unbound released rollover that never started an effect', async () => {
  const storedRef = await releasedRolloverState();

  // Reproduce the live successor state: the persisted conversation identity is
  // gone, while the released but never-started rollover intent and stale tab id
  // survive the process boundary.
  storedRef.value.conversation_url = null;
  storedRef.value.tab_id = 'tab_retired_provider';
  storedRef.value.ambiguous_history = [{
    wake_id: 'wake_historical',
    ambiguous_reason: 'TYPE_EFFECT_AMBIGUOUS',
    automatic_retry_allowed: false,
  }];

  const successor = makeHarness('process_successor', storedRef);
  const recovered = await successor.keepalive.init();

  assert.equal(recovered.state, 'RECOVERING');
  assert.equal(recovered.conversation_url, null);
  assert.equal(recovered.tab_id, null);
  assert.equal(recovered.rollover_reason, null);
  assert.equal(recovered.rollover_release_at, null);
  assert.equal(recovered.rollover_attempt, null);
  assert.equal(recovered.pending_wake, null);
  assert.equal(recovered.active_wake, null);
  assert.equal(recovered.admission_state, 'UNKNOWN');
  assert.equal(recovered.admission_reason, 'PROCESS_RESTART_REOBSERVATION_REQUIRED');
  assert.equal(recovered.predecessor_process_incarnation_id, 'process_predecessor');
  assert.equal(recovered.ambiguous_history.length, 1);
  assert.equal(recovered.ambiguous_history[0].wake_id, 'wake_historical');
  assert.equal(recovered.ambiguous_history[0].automatic_retry_allowed, false);
});

test('process boundary never converts a started rollover attempt into fresh bootstrap', async () => {
  const storedRef = await releasedRolloverState();
  const predecessor = makeHarness('process_predecessor', storedRef);
  await predecessor.keepalive.init();
  await predecessor.keepalive.applyAdmissionOpen({
    authoritative: true,
    state: 'OPEN',
    continuous_service_allowed: true,
    refill_enabled: true,
    supervisor_admission_enabled: true,
    generation_floor: 28,
  });

  const attempt = await predecessor.keepalive.beginRolloverAttempt();
  assert.ok(attempt.attempt_id);
  storedRef.value.conversation_url = null;
  storedRef.value.tab_id = 'tab_retired_provider';

  const successor = makeHarness('process_successor_2', storedRef);
  const recovered = await successor.keepalive.init();

  assert.equal(recovered.state, 'ROLLOVER_AMBIGUOUS');
  assert.ok(recovered.rollover_attempt);
  assert.equal(recovered.rollover_attempt.attempt_id, attempt.attempt_id);
  assert.equal(recovered.rollover_attempt.automatic_retry_allowed, false);
  assert.equal(recovered.rollover_reason, 'PROCESS_RESTART_WITH_UNRESOLVED_ROLLOVER_EFFECT');
});
