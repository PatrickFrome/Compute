import { revalidateFleetTargetFromLocalBrowser } from './fleet-target-local-observer.mjs';

export const FLEET_TARGET_PERSISTENCE_VERSION = '1.0.0';

export async function persistRevalidatedFleetTarget({ agent, observeLocalTarget, saveAgent } = {}) {
  if (!agent || typeof agent !== 'object') throw new Error('fleet_target_persistence_agent_invalid');
  if (typeof saveAgent !== 'function') throw new Error('fleet_target_persistence_save_invalid');

  const result = revalidateFleetTargetFromLocalBrowser({ agent, observeLocalTarget });
  if (result.lifecycle_state !== 'BOUND_UNVERIFIED' || result.transport_proof !== null || result.authority_effect !== false) {
    throw new Error('fleet_target_persistence_result_unsafe');
  }

  const next = Object.freeze({
    ...structuredClone(agent),
    lifecycle_state: 'BOUND_UNVERIFIED',
    target_id: result.target_id,
    generation_epoch: result.generation_epoch,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });

  await saveAgent(structuredClone(next));
  return next;
}
