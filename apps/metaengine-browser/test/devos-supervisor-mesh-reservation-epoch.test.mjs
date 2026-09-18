import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorMesh } from '../src/supervisor-mesh.mjs';

function makeMesh() {
  let durable = null;
  let now = Date.parse('2026-08-30T14:47:00Z');
  let uuidSeq = 0;
  return new SupervisorMesh({
    loadState: async () => durable,
    saveState: async (state) => { durable = structuredClone(state); },
    clock: () => now++,
    uuid: () => `epoch-test-${++uuidSeq}`,
  });
}

const tabs = [
  { tab_id: 'tab_primary', url: 'https://chatgpt.com/c/11111111-1111-1111-1111-111111111111', selected: true },
  { tab_id: 'tab_standby', url: 'https://chatgpt.com/c/22222222-2222-2222-2222-222222222222', selected: false },
];

test('reservation-driven coordinator reassignment advances mesh epoch before fencing', async () => {
  const mesh = makeMesh();
  await mesh.init();
  await mesh.reconcile({ tabs, fleetAgents: [] });

  const before = mesh.snapshot();
  assert.ok(before.coordinator_supervisor_id, 'reconcile must elect a coordinator');
  const previousCoordinator = before.coordinator_supervisor_id;

  const reservation = await mesh.reserveCoordination({
    eventKey: 'epoch-reassignment-test',
    reason: 'CONTINUE_DEVELOPMENT',
    excludeSupervisorIds: [previousCoordinator],
  });
  assert.equal(reservation.ok, true);

  const after = mesh.snapshot();
  assert.notEqual(after.coordinator_supervisor_id, previousCoordinator, 'reservation must target the eligible standby');
  assert.equal(after.coordinator_supervisor_id, reservation.deliveries[0].supervisor_id);
  assert.equal(
    after.mesh_epoch,
    before.mesh_epoch + 1,
    'every coordinator ownership change must advance the monotonic fencing generation',
  );
});
