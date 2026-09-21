import {
  bindCoordinationFence,
  assertCoordinationFenceCurrent,
} from './supervisor-mesh-epoch-fence.mjs';

export function fenceReservedCoordination(reservation, meshSnapshot) {
  if (!reservation?.ok || !Array.isArray(reservation.deliveries) || reservation.deliveries.length !== 1) {
    throw new Error('supervisor_mesh_fenced_reservation_invalid');
  }
  const delivery = reservation.deliveries[0];
  const eventId = String(reservation.event_id || delivery?.pending?.event_id || '').trim();
  const deliveryId = String(delivery?.pending?.delivery_id || '').trim();
  const coordinatorSupervisorId = String(meshSnapshot?.coordinator_supervisor_id || '').trim();
  if (!eventId || !deliveryId || !coordinatorSupervisorId) {
    throw new Error('supervisor_mesh_fenced_reservation_binding_required');
  }
  if (String(delivery.supervisor_id || '') !== coordinatorSupervisorId) {
    throw new Error('supervisor_mesh_fenced_reservation_not_coordinator');
  }

  const fence = bindCoordinationFence({
    meshEpoch: meshSnapshot.mesh_epoch,
    coordinatorSupervisorId,
    eventId,
    deliveryId,
  });
  assertCoordinationFenceCurrent(fence, meshSnapshot);

  return Object.freeze({
    ...structuredClone(reservation),
    deliveries: [Object.freeze({
      ...structuredClone(delivery),
      coordination_fence: fence,
      authority_effect: false,
    })],
    coordination_fence: fence,
    authority_effect: false,
  });
}

export function assertFencedReservationCurrent(fencedReservation, meshSnapshot) {
  const fence = fencedReservation?.coordination_fence;
  if (!fence) throw new Error('supervisor_mesh_fenced_reservation_fence_required');
  assertCoordinationFenceCurrent(fence, meshSnapshot);
  const delivery = fencedReservation?.deliveries?.[0];
  if (!delivery || delivery.coordination_fence?.delivery_id !== fence.delivery_id) {
    throw new Error('supervisor_mesh_fenced_reservation_delivery_mismatch');
  }
  if (String(delivery.supervisor_id || '') !== String(fence.coordinator_supervisor_id || '')) {
    throw new Error('supervisor_mesh_fenced_reservation_supervisor_mismatch');
  }
  return true;
}
