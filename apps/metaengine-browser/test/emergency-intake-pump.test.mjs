import assert from 'node:assert/strict';
import test from 'node:test';
import { EmergencyPreemptionCore } from '../src/emergency-preemption-core.mjs';
import { EmergencyIntakePump } from '../src/emergency-intake-pump.mjs';

const id = '00000000-0000-4000-8000-000000000123';
const leasedDisarm = () => ({
  leased_count: 1,
  wake_reason: 'WAKE_BROADCAST',
  command: { command_id: id, action: 'DISARM', payload: {}, command_lane: 'EMERGENCY' },
});

test('idle emergency cycle has no dependency on the general scheduler', async () => {
  const preemption = new EmergencyPreemptionCore({ applyLocalAuthority: async () => ({ confirmed: true }) });
  const pump = new EmergencyIntakePump({
    nextEmergency: async () => ({ leased_count: 0, command: null, wake_reason: 'WAKE_TIMEOUT' }),
    preemption,
    completeEmergency: async () => ({ confirmed: true }),
  });
  const out = await pump.cycle();
  assert.equal(out.state, 'IDLE');
  assert.equal(out.general_scheduler_dependency, false);
  assert.equal(out.second_general_scheduler, false);
  assert.equal(out.command_leasing_authority, false);
});

test('leased DISARM closes local authority and completes without touching a general scheduler', async () => {
  const order = [];
  const preemption = new EmergencyPreemptionCore({
    applyLocalAuthority: async () => { order.push('authority'); return { confirmed: true }; },
  });
  const controller = new AbortController();
  controller.signal.addEventListener('abort', () => order.push('abort'));
  preemption.bindActiveOperation({ operation_id: 'nav:active', abort_controller: controller });
  const pump = new EmergencyIntakePump({
    nextEmergency: async () => leasedDisarm(),
    preemption,
    completeEmergency: async (_command, receipt) => {
      order.push('complete');
      assert.equal(receipt.in_flight_effect_cancelled, false);
      return { confirmed: true };
    },
  });
  const out = await pump.cycle();
  assert.deepEqual(order, ['authority', 'abort', 'complete']);
  assert.equal(out.state, 'COMPLETED');
  assert.equal(out.completion_confirmed, true);
  assert.equal(out.general_scheduler_dependency, false);
  assert.equal(out.transport_delivery_is_authority, false);
});

test('pump rejects a non-emergency command even if upstream route misbehaves', async () => {
  const preemption = new EmergencyPreemptionCore({ applyLocalAuthority: async () => ({ confirmed: true }) });
  const pump = new EmergencyIntakePump({
    nextEmergency: async () => ({
      leased_count: 1,
      command: { command_id: id, action: 'NAVIGATE', payload: {}, command_lane: 'TAB_MUTATION' },
    }),
    preemption,
    completeEmergency: async () => ({ confirmed: true }),
  });
  await assert.rejects(() => pump.cycle(), /non_emergency_rejected/);
});

test('completion failure preserves the same receipt for result-only replay', async () => {
  let authorityCalls = 0;
  let completionCalls = 0;
  const preemption = new EmergencyPreemptionCore({
    applyLocalAuthority: async () => { authorityCalls += 1; return { confirmed: true }; },
  });
  const pump = new EmergencyIntakePump({
    nextEmergency: async () => leasedDisarm(),
    preemption,
    completeEmergency: async () => {
      completionCalls += 1;
      if (completionCalls === 1) throw new Error('network_lost_after_local_effect');
      return { confirmed: true };
    },
  });
  const first = await pump.cycle();
  assert.equal(first.state, 'RESULT_PENDING');
  assert.equal(authorityCalls, 1);
  const replay = await pump.retryCompletion();
  assert.equal(replay.state, 'COMPLETED');
  assert.equal(replay.result_replayed_without_effect_retry, true);
  assert.equal(authorityCalls, 1);
  assert.equal(completionCalls, 2);
});

test('unconfirmed durable completion remains pending instead of claiming terminal success', async () => {
  const preemption = new EmergencyPreemptionCore({ applyLocalAuthority: async () => ({ confirmed: true }) });
  const pump = new EmergencyIntakePump({
    nextEmergency: async () => leasedDisarm(),
    preemption,
    completeEmergency: async () => ({ confirmed: false }),
  });
  const out = await pump.cycle();
  assert.equal(out.state, 'RESULT_PENDING');
  assert.equal(out.completion_confirmed, false);
  assert.equal(out.automatic_effect_retry_allowed, false);
});
