import { persistRevalidatedFleetTarget } from './fleet-target-persistence.mjs';

export const FLEET_STATE_TARGET_REVALIDATION_VERSION = '1.1.0';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export async function persistFleetStateTargetRevalidation({ state, agent_id, observeLocalTarget, saveState, updated_at = null } = {}) {
  if (!state || state.schema !== 'metaengine.browser.fleet-state.v1' || !Array.isArray(state.agents)) {
    throw new Error('fleet_state_revalidation_state_invalid');
  }
  if (typeof saveState !== 'function') throw new Error('fleet_state_revalidation_save_invalid');
  if (updated_at != null && (!String(updated_at) || Number.isNaN(Date.parse(String(updated_at))))) {
    throw new Error('fleet_state_revalidation_updated_at_invalid');
  }

  const agentId = String(agent_id || '').toLowerCase();
  const index = state.agents.findIndex((row) => String(row?.agent_id || '').toLowerCase() === agentId);
  if (!agentId || index < 0) throw new Error('fleet_state_revalidation_agent_not_found');

  const candidateState = clone(state);
  const originalAgent = clone(candidateState.agents[index]);
  const nextAgent = await persistRevalidatedFleetTarget({
    agent: originalAgent,
    observeLocalTarget,
    saveAgent: async (candidateAgent) => {
      if (candidateAgent.lifecycle_state !== 'BOUND_UNVERIFIED' || candidateAgent.transport_proof !== null || candidateAgent.authority_effect !== false) {
        throw new Error('fleet_state_revalidation_candidate_unsafe');
      }
      candidateState.agents[index] = clone(candidateAgent);
    },
  });

  candidateState.agents[index] = clone(nextAgent);
  if (updated_at != null) {
    candidateState.updated_at = String(updated_at);
    candidateState.agents[index].updated_at = String(updated_at);
  }
  await saveState(clone(candidateState));
  return Object.freeze(clone(candidateState));
}
