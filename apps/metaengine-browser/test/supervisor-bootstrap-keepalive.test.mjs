import assert from 'node:assert/strict';
import test from 'node:test';

import { SupervisorBootstrapKeepalive } from '../src/supervisor-bootstrap-keepalive.mjs';

function harness({ seed = null } = {}) {
  let durable = seed == null ? null : { schema: 'metaengine.supervisor-keepalive.state.v1',
    supervisor_id: 'METAENGINE_SUPERVISOR', ...structuredClone(seed) };
  let uuid = 0;
  const keepalive = new SupervisorBootstrapKeepalive({
    loadState: async () => durable == null ? null : structuredClone(durable),
    saveState: async (value) => { durable = structuredClone(value); },
    clock: () => Date.parse('2026-09-16T01:00:00.000Z'),
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
    processIncarnationId: 'process_bootstrap_test',
  });
  return { keepalive };
}

test('bootstrap preparation persists exactly one unbound wake intent without weakening normal canWake', async () => {
  const { keepalive } = harness();
  await keepalive.init();
  await keepalive.enqueueWake('RESEARCH_ACCELERATOR_DUE', { key: 'bootstrap' });

  assert.equal(keepalive.snapshot().state, 'RECOVERING');
  assert.equal(keepalive.snapshot().conversation_url, null);
  assert.equal(keepalive.canWake(), false);

  const prepared = await keepalive.prepareBootstrapWake();
  assert.equal(prepared.ok, true);
  assert.equal(prepared.tab_id, null);
  assert.equal(prepared.pending.cycle_seq, 1);
  assert.equal(keepalive.snapshot().state, 'WAKE_PENDING');
  assert.equal(keepalive.canWake(), false);

  const duplicate = await keepalive.prepareBootstrapWake();
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.suppressed, true);
});

test('bootstrap preparation remains fenced while admission is closed', async () => {
  const { keepalive } = harness();
  await keepalive.init();
  await keepalive.applyAdmissionClosed({
    authoritative: true,
    state: 'CLOSED',
    continuous_service_allowed: false,
    refill_enabled: false,
    supervisor_admission_enabled: false,
    generation_floor: 28,
    reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
  });
  await keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'closed' });

  const prepared = await keepalive.prepareBootstrapWake();
  assert.equal(prepared.ok, false);
  assert.equal(prepared.suppressed, true);
  assert.equal(keepalive.snapshot().pending_wake, null);
});

test('clean restarted bootstrap queues one fresh intent without replaying retired research or changing cadence', async () => {
  const { keepalive } = harness({ seed: { process_incarnation_id: 'process_predecessor', state: 'RECOVERING',
    last_research_wake_at: '2026-09-16T00:59:59.000Z', queued_wakes: [{ reason: 'RESEARCH_ACCELERATOR_DUE',
      key: 'RESEARCH_ACCELERATOR_DUE:predecessor', metadata: {}, queued_at: '2026-09-16T00:59:59.000Z',
      process_incarnation_id: 'process_predecessor' }] } });
  await keepalive.init();
  assert.equal(keepalive.snapshot().queued_wakes.length, 0);
  assert.equal(await keepalive.ensureBootstrapWake(), true);
  assert.equal(await keepalive.ensureBootstrapWake(), false);
  const queued = keepalive.snapshot();
  assert.equal(queued.queued_wakes.length, 1);
  assert.equal(queued.queued_wakes[0].reason, 'SUPERVISOR_RECOVERY_REQUIRED');
  assert.equal(queued.queued_wakes[0].process_incarnation_id, 'process_bootstrap_test');
  assert.equal(queued.last_research_wake_at, '2026-09-16T00:59:59.000Z');
  assert.equal(queued.predecessor_queued_wake_count, 1);
  assert.equal(keepalive.canWake(), false, 'only the existing bootstrap preparation may admit an unbound wake');
  assert.equal((await keepalive.prepareBootstrapWake()).ok, true);
});

for (const [name, patch] of Object.entries({
  paused: { paused: true },
  closed: { admission_state: 'CLOSED' },
  bound: { conversation_url: 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000028', tab_id: 'tab_existing' },
  previous_target: { tab_id: 'tab_previous' },
  unknown_send: { state: 'WAKE_PENDING', pending_wake: { wake_id: 'wake_existing', reason: 'CONTINUE_DEVELOPMENT',
    cycle_seq: 1, supervisor_epoch: 1, process_incarnation_id: 'process_bootstrap_test' } },
  active: { state: 'ACTIVE', active_wake: { wake_id: 'wake_existing', reason: 'CONTINUE_DEVELOPMENT',
    cycle_seq: 1, supervisor_epoch: 1, process_incarnation_id: 'process_bootstrap_test' } },
  rollover: { state: 'ROLLOVER_PENDING', rollover_attempt: { attempt_id: 'rollover_existing' } },
  parked: { parked_reason: 'MANUAL_MAINTENANCE_FENCE' },
  recent_unsent: { last_unsent_attempt_at: '2026-09-16T00:59:59.000Z' },
  existing_queue: { queued_wakes: [{ reason: 'WORKER_RESULT_READY', key: 'WORKER_RESULT_READY:worker',
    process_incarnation_id: 'process_bootstrap_test', metadata: {}, queued_at: '2026-09-16T00:59:59.000Z' }] },
})) test(`fresh startup wake preserves ${name} fencing and existing journal`, async () => {
  const { keepalive } = harness({ seed: { state: 'RECOVERING', process_incarnation_id: 'process_bootstrap_test', ...patch } });
  await keepalive.init();
  const before = keepalive.snapshot();
  assert.equal(await keepalive.ensureBootstrapWake(), false);
  assert.deepEqual(keepalive.snapshot(), before);
});
