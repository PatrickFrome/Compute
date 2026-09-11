import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextCoordinatorEpoch,
  bindCoordinationFence,
  assertCoordinationFenceCurrent,
} from '../src/supervisor-mesh-epoch-fence.mjs';

test('coordinator replacement monotonically advances mesh epoch', () => {
  assert.deepEqual(
    nextCoordinatorEpoch({ currentEpoch: 7, currentCoordinatorId: 'sup_a', nextCoordinatorId: 'sup_b' }),
    { mesh_epoch: 8, coordinator_supervisor_id: 'sup_b', changed: true, authority_effect: false },
  );
  assert.equal(
    nextCoordinatorEpoch({ currentEpoch: 8, currentCoordinatorId: 'sup_b', nextCoordinatorId: 'sup_b' }).mesh_epoch,
    8,
  );
});

test('coordination fence binds epoch, coordinator, event and delivery', () => {
  const fence = bindCoordinationFence({
    meshEpoch: 11,
    coordinatorSupervisorId: 'sup_primary',
    eventId: 'mesh_evt_1',
    deliveryId: 'delivery_1',
  });
  assert.equal(fence.mesh_epoch, 11);
  assert.equal(fence.coordinator_supervisor_id, 'sup_primary');
  assert.equal(fence.event_id, 'mesh_evt_1');
  assert.equal(fence.delivery_id, 'delivery_1');
  assert.equal(fence.authority_effect, false);
});

test('stale generation or coordinator fails closed', () => {
  const fence = bindCoordinationFence({
    meshEpoch: 11,
    coordinatorSupervisorId: 'sup_primary',
    eventId: 'mesh_evt_1',
    deliveryId: 'delivery_1',
  });
  assert.equal(assertCoordinationFenceCurrent(fence, {
    mesh_epoch: 11,
    coordinator_supervisor_id: 'sup_primary',
  }), true);
  assert.throws(() => assertCoordinationFenceCurrent(fence, {
    mesh_epoch: 12,
    coordinator_supervisor_id: 'sup_primary',
  }), /supervisor_mesh_fence_epoch_stale/);
  assert.throws(() => assertCoordinationFenceCurrent(fence, {
    mesh_epoch: 11,
    coordinator_supervisor_id: 'sup_standby',
  }), /supervisor_mesh_fence_coordinator_stale/);
});
