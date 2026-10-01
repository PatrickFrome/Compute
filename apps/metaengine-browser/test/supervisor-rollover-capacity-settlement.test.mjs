import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

const URL = 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function harness(seed = null) {
  let stored = seed == null ? null : structuredClone(seed);
  let seq = 0;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    processIncarnationId: 'process_test_current',
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    clock: () => Date.parse('2026-10-01T01:00:00.000Z'),
  });
  return { keepalive, state: () => structuredClone(stored) };
}

const OPEN = Object.freeze({
  authoritative: true,
  state: 'OPEN',
  reason: null,
  workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
  generation_floor: 28,
  refill_enabled: true,
  supervisor_admission_enabled: true,
  continuous_service_allowed: true,
  automatic_retry_allowed: false,
  authority_effect: false,
});

test('capacity no-effect settlement clears only an unbound rollover attempt', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: URL, tab_id: 'tab_old' });
  await h.keepalive.applyAdmissionOpen(OPEN);
  await h.keepalive.requestRollover('CAPACITY_TEST', { autoRelease: true });
  const attempt = await h.keepalive.beginRolloverAttempt();
  const before = h.keepalive.snapshot();

  const settled = await h.keepalive.settleRolloverNoEffect({
    reason: 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT',
    expected_attempt_id: attempt.attempt_id,
  });

  assert.equal(settled.state, 'ROLLOVER_REQUIRED');
  assert.equal(settled.rollover_attempt, null);
  assert.equal(settled.supervisor_epoch, before.supervisor_epoch);
  assert.equal(settled.cycle_seq, before.cycle_seq);
  assert.equal(settled.last_rollover_no_effect.attempt_id, attempt.attempt_id);
  assert.equal(settled.last_rollover_no_effect.proof, 'TAB_REGISTRY_CAPACITY_GUARD_BEFORE_TAB_ID_ALLOCATION');
  assert.equal(settled.last_rollover_no_effect.automatic_retry_allowed, false);
  assert.equal(settled.last_rollover_no_effect.authority_effect, false);

  const bound = await h.keepalive.beginRolloverAttempt();
  await h.keepalive.bindRolloverAttemptTab('tab_allocated');
  await assert.rejects(
    () => h.keepalive.settleRolloverNoEffect({
      reason: 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT',
      expected_attempt_id: bound.attempt_id,
    }),
    /keepalive_rollover_no_effect_tab_already_bound/,
  );
  assert.equal(h.keepalive.snapshot().state, 'ROLLOVER_PENDING');
});

test('the exact live false-ambiguity signature parks under CLOSED admission', async () => {
  const attemptId = 'rollover_d07ce473-31aa-4dad-a2f9-b62d40bf03e3';
  const h = harness({
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 2,
    cycle_seq: 2109,
    state: 'ROLLOVER_AMBIGUOUS',
    conversation_url: 'https://chat.z.ai/c/e1ec5063-0798-46df-b401-df41813e0000',
    tab_id: 'tab_supervisor',
    paused: false,
    process_incarnation_id: 'process_test_current',
    admission_state: 'CLOSED',
    admission_reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
    admission_generation_floor: 28,
    admission_refill_enabled: false,
    admission_supervisor_enabled: false,
    rollover_reason: 'ROLLOVER_ERROR:tab_capacity_exceeded',
    rollover_release_at: '2026-09-28T20:59:09.000Z',
    rollover_attempt: {
      attempt_id: attemptId,
      supervisor_epoch: 2,
      previous_conversation: 'https://chat.z.ai/c/e1ec5063-0798-46df-b401-df41813e0000',
      started_at: '2026-09-28T20:59:09.703Z',
      tab_id: null,
      ambiguous_at: '2026-09-28T20:59:09.706Z',
      ambiguous_reason: 'ROLLOVER_ERROR:tab_capacity_exceeded',
      automatic_retry_allowed: false,
    },
  });

  await h.keepalive.init();
  const settled = await h.keepalive.settleRolloverNoEffect({
    reason: 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT',
    expected_attempt_id: attemptId,
  });

  assert.equal(settled.state, 'PARKED');
  assert.equal(settled.rollover_attempt, null);
  assert.equal(settled.rollover_reason, null);
  assert.equal(settled.rollover_release_at, null);
  assert.equal(settled.admission_generation_floor, 28);
  assert.equal(settled.last_rollover_no_effect.attempt_id, attemptId);
  assert.equal(settled.last_rollover_no_effect.automatic_retry_allowed, false);
});

test('other ambiguous rollover reasons remain fenced', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: URL, tab_id: 'tab_old' });
  await h.keepalive.applyAdmissionOpen(OPEN);
  await h.keepalive.requestRollover('OTHER', { autoRelease: true });
  const attempt = await h.keepalive.beginRolloverAttempt();
  await h.keepalive.markRolloverAmbiguous('ROLLOVER_ERROR:renderer_failed_after_registry_allocation');

  await assert.rejects(
    () => h.keepalive.settleRolloverNoEffect({
      reason: 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT',
      expected_attempt_id: attempt.attempt_id,
    }),
    /keepalive_rollover_no_effect_proof_invalid/,
  );
  assert.equal(h.keepalive.snapshot().state, 'ROLLOVER_AMBIGUOUS');
  assert.equal(h.keepalive.snapshot().rollover_attempt.attempt_id, attempt.attempt_id);
});
