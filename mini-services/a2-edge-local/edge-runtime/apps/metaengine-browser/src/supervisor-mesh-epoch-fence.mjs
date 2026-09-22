export function nextCoordinatorEpoch({ currentEpoch, currentCoordinatorId, nextCoordinatorId }) {
  const epoch = Math.max(1, Number(currentEpoch) || 1);
  const current = currentCoordinatorId ? String(currentCoordinatorId) : null;
  const next = nextCoordinatorId ? String(nextCoordinatorId) : null;
  return {
    mesh_epoch: next !== current ? epoch + 1 : epoch,
    coordinator_supervisor_id: next,
    changed: next !== current,
    authority_effect: false,
  };
}

export function bindCoordinationFence({ meshEpoch, coordinatorSupervisorId, eventId, deliveryId }) {
  const epoch = Math.max(1, Number(meshEpoch) || 1);
  const coordinator = String(coordinatorSupervisorId || '').trim();
  const event = String(eventId || '').trim();
  const delivery = String(deliveryId || '').trim();
  if (!coordinator) throw new Error('supervisor_mesh_fence_coordinator_required');
  if (!event) throw new Error('supervisor_mesh_fence_event_required');
  if (!delivery) throw new Error('supervisor_mesh_fence_delivery_required');
  return Object.freeze({
    schema: 'metaengine.supervisor-mesh.fence.v1',
    mesh_epoch: epoch,
    coordinator_supervisor_id: coordinator,
    event_id: event,
    delivery_id: delivery,
    authority_effect: false,
  });
}

export function assertCoordinationFenceCurrent(fence, snapshot) {
  if (!fence || fence.schema !== 'metaengine.supervisor-mesh.fence.v1') {
    throw new Error('supervisor_mesh_fence_invalid');
  }
  const epoch = Math.max(1, Number(snapshot?.mesh_epoch) || 1);
  const coordinator = snapshot?.coordinator_supervisor_id ? String(snapshot.coordinator_supervisor_id) : null;
  if (Number(fence.mesh_epoch) !== epoch) throw new Error('supervisor_mesh_fence_epoch_stale');
  if (String(fence.coordinator_supervisor_id) !== String(coordinator || '')) {
    throw new Error('supervisor_mesh_fence_coordinator_stale');
  }
  return true;
}
