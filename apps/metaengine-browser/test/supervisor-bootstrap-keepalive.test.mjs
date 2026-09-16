import assert from 'node:assert/strict';
import test from 'node:test';

import { SupervisorBootstrapKeepalive } from '../src/supervisor-bootstrap-keepalive.mjs';

function harness() {
  let durable = null;
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
