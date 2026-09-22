export const FLEET_TARGET_REVALIDATION_VERSION = '1.0.0';

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function revalidateFleetTargetBinding({
  lifecycle_state,
  bound_tab_id,
  bound_target_id,
  generation_epoch,
  observed_tab_id,
  observed_target_id,
  tab_exists,
} = {}) {
  const lifecycle = String(lifecycle_state || '');
  const boundTab = String(bound_tab_id || '');
  const observedTab = String(observed_tab_id || '');
  const boundTarget = normalized(bound_target_id);
  const observedTarget = normalized(observed_target_id);
  const generation = Number(generation_epoch);

  if (lifecycle !== 'BOUND_UNVERIFIED') throw new Error(`fleet_revalidation_state_invalid:${lifecycle}`);
  if (!boundTab || !observedTab || boundTab !== observedTab) throw new Error('fleet_revalidation_tab_binding_mismatch');
  if (tab_exists !== true) throw new Error('fleet_revalidation_tab_not_live');
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('fleet_revalidation_generation_invalid');
  if (!observedTarget) throw new Error('fleet_revalidation_target_missing');

  const targetChanged = boundTarget !== observedTarget;
  return Object.freeze({
    schema: 'metaengine.browser.fleet-target-revalidation.v1',
    tab_id: boundTab,
    prior_target_id: boundTarget || null,
    target_id: observedTarget,
    prior_generation_epoch: generation,
    generation_epoch: targetChanged ? generation + 1 : generation,
    target_changed: targetChanged,
    lifecycle_state: 'BOUND_UNVERIFIED',
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
