import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EmergencyPreemptionCore,
  MAX_PREEMPTION_RECEIPTS,
  isPreemptiveEmergencyCommand,
} from '../src/emergency-preemption-core.mjs';

const command = (id, action = 'DISARM', payload = {}) => ({ command_id: id, action, payload });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('only DISARM and supervisor OFF qualify for the preemptive lane', () => {
  assert.equal(isPreemptiveEmergencyCommand(command(id(1), 'DISARM')), true);
  assert.equal(isPreemptiveEmergencyCommand(command(id(2), 'SET_SUPERVISOR_MODE', { mode: 'OFF' })), true);
  assert.equal(isPreemptiveEmergencyCommand(command(id(3), 'SET_SUPERVISOR_MODE', { mode: 'CONTROL' })), false);
  assert.equal(isPreemptiveEmergencyCommand(command(id(4), 'ARM')), false);
  assert.equal(isPreemptiveEmergencyCommand(command(id(5), 'NAVIGATE')), false);
});

test('local authority closes before AbortSignal is emitted and receipt never claims the old effect was cancelled', async () => {
  const order = [];
  const controller = new AbortController();
  controller.signal.addEventListener('abort', () => order.push('abort'));
  const core = new EmergencyPreemptionCore({
    applyLocalAuthority: async () => {
      order.push('authority');
      return { confirmed: true };
    },
  });
  core.bindActiveOperation({ operation_id: 'nav:1', abort_controller: controller });
  const out = await core.preemptLeasedCommand(command(id(6)));
  assert.deepEqual(order, ['authority', 'abort']);
  assert.equal(out.local_authority_closed, true);
  assert.equal(out.abort_signalled, true);
  assert.equal(out.in_flight_effect_cancelled, false);
  assert.equal(out.in_flight_effect_requires_independent_readback, true);
  assert.equal(out.automatic_effect_retry_allowed, false);
  assert.equal(out.second_scheduler, false);
  assert.equal(out.command_leasing, false);
});

test('unconfirmed authority transition fails closed before signalling abort', async () => {
  const controller = new AbortController();
  const core = new EmergencyPreemptionCore({
    applyLocalAuthority: async () => ({ confirmed: false }),
  });
  core.bindActiveOperation({ operation_id: 'nav:2', abort_controller: controller });
  await assert.rejects(() => core.preemptLeasedCommand(command(id(7))), /authority_transition_unconfirmed/);
  assert.equal(controller.signal.aborted, false);
});

test('same leased emergency command is idempotent at the local preemption boundary', async () => {
  let authorityCalls = 0;
  const controller = new AbortController();
  const core = new EmergencyPreemptionCore({
    applyLocalAuthority: async () => ({ confirmed: ++authorityCalls === 1 }),
  });
  core.bindActiveOperation({ operation_id: 'nav:3', abort_controller: controller });
  const first = await core.preemptLeasedCommand(command(id(8), 'SET_SUPERVISOR_MODE', { mode: 'OFF' }));
  const second = await core.preemptLeasedCommand(command(id(8), 'SET_SUPERVISOR_MODE', { mode: 'OFF' }));
  assert.strictEqual(second, first);
  assert.equal(authorityCalls, 1);
});

test('preemption receipt memory is bounded and carries no lease or scheduler authority', async () => {
  const core = new EmergencyPreemptionCore({ applyLocalAuthority: async () => ({ confirmed: true }) });
  for (let index = 1; index <= MAX_PREEMPTION_RECEIPTS + 8; index += 1) {
    await core.preemptLeasedCommand(command(id(100 + index)));
  }
  const snapshot = core.snapshot();
  assert.equal(snapshot.retained_receipts, MAX_PREEMPTION_RECEIPTS);
  assert.equal(snapshot.max_retained_receipts, MAX_PREEMPTION_RECEIPTS);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.authority_effect, false);
});

test('active operation binding is single-owner and exact-id cleared', () => {
  const core = new EmergencyPreemptionCore({ applyLocalAuthority: async () => ({ confirmed: true }) });
  const first = new AbortController();
  core.bindActiveOperation({ operation_id: 'op:a', abort_controller: first });
  assert.throws(() => core.bindActiveOperation({ operation_id: 'op:b', abort_controller: new AbortController() }), /active_operation_exists/);
  assert.equal(core.clearActiveOperation('op:b'), false);
  assert.equal(core.clearActiveOperation('op:a'), true);
  assert.equal(core.snapshot().active_operation_id, null);
});
