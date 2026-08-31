import { assertTrustedFleetTransportProofInput } from './fleet-transport-local-observer.mjs';

export const FLEET_TRUSTED_TRANSPORT_PROMOTION_VERSION = '1.0.0';

export function createFleetTrustedTransportPromotion({ provisioner } = {}) {
  if (!provisioner || typeof provisioner.markTransportProven !== 'function') {
    throw new Error('fleet_trusted_transport_provisioner_invalid');
  }

  const promoteFromTrustedLocalProof = async ({ agent_id, proof_input } = {}) => {
    const proof = assertTrustedFleetTransportProofInput(proof_input);
    return provisioner.markTransportProven({
      agent_id,
      tab_id: proof.tab_id,
      target_id: proof.target_id,
      generation_epoch: proof.generation_epoch,
      conversation_url: proof.conversation_url,
    });
  };

  return Object.freeze({
    schema: 'metaengine.browser.fleet-trusted-transport-promotion.v1',
    promoteFromTrustedLocalProof,
    authority_source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
    raw_transport_promotion_exposed: false,
  });
}
