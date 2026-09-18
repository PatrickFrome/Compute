import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fenceReservedCoordination,
  assertFencedReservationCurrent,
} from '../src/supervisor-mesh-fenced-reservation.mjs';

function reservation(supervisorId = 'sup_primary') {
  return {
    ok: true,
    event_id: 'mesh_evt_1',
    deliveries: [{
      supervisor_id: supervisorId,
      tab_id: 'tab_1',
      pending: {
        event_id: 'mesh_evt_1',
        delivery_id: 'delivery_1',
      },
      authority_effect: false,
    }],
    authority_effect: false,
  };
}

const snapshot = {
  mesh_epoch: 9,
  coordinator_supervisor_id: 'sup_primary',
};

test('reserved wake is bound to exact mesh epoch and coordinator generation', () => {
  const fenced = fenceReservedCoordination(reservation(), snapshot);
  assert.equal(fenced.coordination_fence.mesh_epoch, 9);
  assert.equal(fenced.coordination_fence.coordinator_supervisor_id, 'sup_primary');
  assert.equal(fenced.coordination_fence.event_id, 'mesh_evt_1');
  assert.equal(fenced.coordination_fence.delivery_id, 'delivery_1');
  assert.equal(fenced.deliveries[0].coordination_fence.delivery_id, 'delivery_1');
  assert.equal(assertFencedReservationCurrent(fenced, snapshot), true);
});

test('reservation for non-coordinator fails closed', () => {
  assert.throws(
    () => fenceReservedCoordination(reservation('sup_standby'), snapshot),
    /supervisor_mesh_fenced_reservation_not_coordinator/,
  );
});

test('epoch advance invalidates a previously reserved wake before follow-on handling', () => {
  const fenced = fenceReservedCoordination(reservation(), snapshot);
  assert.throws(
    () => assertFencedReservationCurrent(fenced, { ...snapshot, mesh_epoch: 10 }),
    /supervisor_mesh_fence_epoch_stale/,
  );
});

test('coordinator replacement invalidates a previously reserved wake', () => {
  const fenced = fenceReservedCoordination(reservation(), snapshot);
  assert.throws(
    () => assertFencedReservationCurrent(fenced, { ...snapshot, coordinator_supervisor_id: 'sup_new' }),
    /supervisor_mesh_fence_coordinator_stale/,
  );
});
