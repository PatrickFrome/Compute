import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorMesh } from '../src/supervisor-mesh.mjs';

test('ambiguous delivery is terminal for the same event key', async () => {
  let stored = null;
  let seq = 0;
  const mesh = new SupervisorMesh({
    loadState: async () => stored,
    saveState: async (next) => { stored = structuredClone(next); },
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  });
  await mesh.init();
  await mesh.reconcile({ tabs: [
    { tab_id: 'a', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selected: true },
    { tab_id: 'b', url: 'https://chatgpt.com/c/bbbbbbbb-1111-2222-3333-444444444444' },
  ] });
  const reserved = await mesh.reserveCoordination({ eventKey: 'effect-1', reason: 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY' });
  const d = reserved.deliveries[0];
  await mesh.markDeliveryAmbiguous(d.supervisor_id, d.pending.delivery_id, 'transport_unknown');
  const retry = await mesh.reserveCoordination({ eventKey: 'effect-1', reason: 'PRIMARY_WAKE_AMBIGUOUS_RECOVERY' });
  assert.equal(retry.ok, false);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.event.status, 'AMBIGUOUS');
});
