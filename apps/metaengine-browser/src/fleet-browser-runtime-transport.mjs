import {
  createFleetTransportLocalObserver,
  deriveFleetTransportProofInputFromLocalBrowser,
} from './fleet-transport-local-observer.mjs';
import { createFleetTrustedTransportPromotion } from './fleet-trusted-transport-promotion.mjs';

export const FLEET_BROWSER_RUNTIME_TRANSPORT_VERSION = '1.0.0';

function findAgent(snapshot, agentId) {
  const id = String(agentId || '').trim();
  if (!id) throw new Error('fleet_runtime_transport_agent_id_required');
  const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  const agent = agents.find((candidate) => String(candidate?.agent_id || '') === id);
  if (!agent) throw new Error('fleet_runtime_transport_agent_not_found');
  return agent;
}

export function createFleetBrowserRuntimeTransport({ provisioner, lookupView } = {}) {
  if (!provisioner || typeof provisioner.snapshot !== 'function' || typeof provisioner.markTransportProven !== 'function') {
    throw new Error('fleet_runtime_transport_provisioner_invalid');
  }
  if (typeof lookupView !== 'function') throw new Error('fleet_runtime_transport_lookup_invalid');

  const observeLocalTransport = createFleetTransportLocalObserver({ lookupView });
  const trustedPromotion = createFleetTrustedTransportPromotion({ provisioner });

  const promoteAgentFromLiveLocalTransport = async ({ agent_id } = {}) => {
    const agent = findAgent(provisioner.snapshot(), agent_id);
    if (agent.lifecycle_state !== 'BOUND_UNVERIFIED') {
      throw new Error('fleet_runtime_transport_agent_not_bound_unverified');
    }
    if (agent.transport_proof != null) throw new Error('fleet_runtime_transport_existing_proof_forbidden');
    if (agent.authority_effect !== false || agent.automatic_retry_allowed !== false) {
      throw new Error('fleet_runtime_transport_agent_authority_invalid');
    }

    const proofInput = deriveFleetTransportProofInputFromLocalBrowser({
      agent,
      observeLocalTransport,
    });
    return trustedPromotion.promoteFromTrustedLocalProof({
      agent_id: agent.agent_id,
      proof_input: proofInput,
    });
  };

  return Object.freeze({
    schema: 'metaengine.browser.fleet-runtime-transport.v1',
    version: FLEET_BROWSER_RUNTIME_TRANSPORT_VERSION,
    promoteAgentFromLiveLocalTransport,
    authority_source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
    raw_transport_promotion_exposed: false,
    proof_input_surface_exposed: false,
  });
}
