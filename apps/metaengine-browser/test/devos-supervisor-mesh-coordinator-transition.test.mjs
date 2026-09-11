import test from 'node:test';
import assert from 'node:assert/strict';
import { SupervisorMesh } from '../src/supervisor-mesh.mjs';

function makeMesh() {
  let durable = null;
  let now = Date.parse('2026-08-30T16:00:00Z');
  let uuidSeq = 0;
  return new SupervisorMesh({
    loadState: async () => durable,
    saveState: async (state) => { durable = structuredClone(state); },
    clock: () => now++,
    uuid: () => `transition-test-${++uuidSeq}`,
  });
}

const primary = { tab_id: 'tab_primary', url: 'https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', selected: true };
const standby = { tab_id: 'tab_standby', url: 'https://chatgpt.com/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', selected: false };

test('stable coordinator does not consume a new fencing generation', async () => {
  const mesh = makeMesh();
  await mesh.init();
  await mesh.reconcile({ tabs: [primary, standby], fleetAgents: [] });
  const before = mesh.snapshot();

  await mesh.reconcile({ tabs: [primary, standby], fleetAgents: [] });
  const after = mesh.snapshot();

  assert.equal(after.coordinator_supervisor_id, before.coordinator_supervisor_id);
  assert.equal(after.mesh_epoch, before.mesh_epoch, 'same owner must preserve the current fencing generation');
});

test('reconcile-driven coordinator loss advances mesh epoch exactly once', async () => {
  const mesh = makeMesh();
  await mesh.init();
  await mesh.reconcile({ tabs: [primary, standby], fleetAgents: [] });
  const before = mesh.snapshot();
  const previousCoordinator = before.coordinator_supervisor_id;
  assert.ok(previousCoordinator);

  const survivorTabs = previousCoordinator === mesh.eligibleSupervisors()[0].supervisor_id
    ? [standby]
    : [primary];
  await mesh.reconcile({ tabs: survivorTabs, fleetAgents: [] });
  const after = mesh.snapshot();

  assert.notEqual(after.coordinator_supervisor_id, previousCoordinator);
  assert.ok(after.coordinator_supervisor_id, 'an eligible standby must take ownership');
  assert.equal(after.mesh_epoch, before.mesh_epoch + 1, 'ownership loss/re-election must consume exactly one new generation');
});

test('ambiguous delivery handoff advances generation and cannot retain the ambiguous owner', async () => {
  const mesh = makeMesh();
  await mesh.init();
  await mesh.reconcile({ tabs: [primary, standby], fleetAgents: [] });

  const reservation = await mesh.reserveCoordination({ eventKey: 'ambiguous-handoff', reason: 'CONTINUE_DEVELOPMENT' });
  assert.equal(reservation.ok, true);
  const delivery = reservation.deliveries[0];
  const reserved = mesh.snapshot();
  assert.equal(reserved.coordinator_supervisor_id, delivery.supervisor_id);

  await mesh.markDeliveryAmbiguous(delivery.supervisor_id, delivery.pending.delivery_id, 'SEND_EFFECT_UNKNOWN');
  const after = mesh.snapshot();

  assert.notEqual(after.coordinator_supervisor_id, delivery.supervisor_id, 'ambiguous owner must be excluded from immediate coordinator ownership');
  assert.equal(after.mesh_epoch, reserved.mesh_epoch + 1, 'ambiguous-owner handoff must advance the fencing generation exactly once');
  const ambiguous = after.supervisors.find((row) => row.supervisor_id === delivery.supervisor_id)?.ambiguous_delivery;
  assert.ok(ambiguous, 'ambiguous effect must remain durable and must not be normalized into NO_EFFECT');
});
