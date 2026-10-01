import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

test('process restart preserves exact capacity no-effect proof until it is safely settled', async () => {
  const attemptId = 'rollover_d07ce473-31aa-4dad-a2f9-b62d40bf03e3';
  let stored = {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 2,
    cycle_seq: 2109,
    state: 'ROLLOVER_AMBIGUOUS',
    conversation_url: 'https://chat.z.ai/c/e1ec5063-0798-46df-b401-df41813e0000',
    tab_id: 'tab_supervisor',
    paused: false,
    process_incarnation_id: 'process_pre_update',
    admission_state: 'CLOSED',
    admission_reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
    admission_generation_floor: 28,
    admission_refill_enabled: false,
    admission_supervisor_enabled: false,
    rollover_reason: 'ROLLOVER_ERROR:tab_capacity_exceeded',
    rollover_release_at: '2026-09-28T20:59:00.000Z',
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
    authority_effect: false,
  };

  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    processIncarnationId: 'process_post_update',
    clock: () => Date.parse('2026-10-01T01:30:00.000Z'),
  });

  await keepalive.init();
  const restarted = keepalive.snapshot();
  assert.equal(restarted.state, 'ROLLOVER_AMBIGUOUS');
  assert.equal(restarted.rollover_reason, 'ROLLOVER_ERROR:tab_capacity_exceeded');
  assert.equal(restarted.rollover_attempt.attempt_id, attemptId);
  assert.equal(restarted.rollover_attempt.tab_id, null);
  assert.equal(restarted.rollover_attempt.ambiguous_reason, 'ROLLOVER_ERROR:tab_capacity_exceeded');
  assert.equal(restarted.process_incarnation_id, 'process_post_update');
  assert.equal(restarted.predecessor_process_incarnation_id, 'process_pre_update');
  assert.equal(restarted.admission_generation_floor, 28);

  const settled = await keepalive.settleRolloverNoEffect({
    reason: 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT',
    expected_attempt_id: attemptId,
  });
  assert.equal(settled.state, 'PARKED');
  assert.equal(settled.rollover_attempt, null);
  assert.equal(settled.last_rollover_no_effect.attempt_id, attemptId);
  assert.equal(settled.last_rollover_no_effect.automatic_retry_allowed, false);
  assert.equal(settled.last_rollover_no_effect.authority_effect, false);
});
