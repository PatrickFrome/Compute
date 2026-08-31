export const FLEET_SUPERVISOR_PROMOTION_GATE_VERSION = '1.1.0';

function text(value) {
  return String(value ?? '').trim();
}

function expectedEffectKey(agentId) {
  return `fleet.transport-promotion:${agentId}`;
}

function assertLeaseDecision(decision, { agentId, leaseId, effectKey }) {
  if (!decision || typeof decision !== 'object') throw new Error('fleet_supervisor_lease_verification_required');
  if (decision.valid !== true) throw new Error(`fleet_supervisor_lease_invalid:${text(decision.reason) || 'not_valid'}`);
  if (text(decision.agent_id) !== agentId) throw new Error('fleet_supervisor_lease_agent_mismatch');
  if (text(decision.lease_id) !== leaseId) throw new Error('fleet_supervisor_lease_id_mismatch');
  if (text(decision.status) !== 'ACTIVE') throw new Error('fleet_supervisor_lease_status_mismatch');
  if (decision.released_at != null) throw new Error('fleet_supervisor_lease_released');
  if (decision.not_expired !== true) throw new Error('fleet_supervisor_lease_expired');
  if (text(decision.effect_scope) !== 'BROWSER_CLIENT_ACTUATION') throw new Error('fleet_supervisor_lease_scope_mismatch');
  if (text(decision.effect_key) !== effectKey) throw new Error('fleet_supervisor_lease_effect_key_mismatch');
  if (decision.holder_verified !== true) throw new Error('fleet_supervisor_lease_holder_unverified');
  if (decision.target_verified !== true) throw new Error('fleet_supervisor_lease_target_unverified');
  if (decision.authority_effect !== false) throw new Error('fleet_supervisor_lease_decision_authority_forbidden');
  return Object.freeze({ agent_id: agentId, lease_id: leaseId, effect_key: effectKey });
}

export function createFleetSupervisorPromotionGate({
  promoteAgentFromLiveBrowser,
  verifyActuationLease,
} = {}) {
  if (typeof promoteAgentFromLiveBrowser !== 'function') throw new Error('fleet_supervisor_promotion_required');
  if (typeof verifyActuationLease !== 'function') throw new Error('fleet_supervisor_lease_verifier_required');

  let inFlight = false;
  return Object.freeze({
    schema: 'metaengine.browser.fleet-supervisor-promotion-gate.v1',
    version: FLEET_SUPERVISOR_PROMOTION_GATE_VERSION,
    async promote({ agent_id, lease_id } = {}) {
      const agentId = text(agent_id);
      const leaseId = text(lease_id);
      if (!agentId) throw new Error('fleet_supervisor_agent_id_required');
      if (!leaseId) throw new Error('fleet_supervisor_lease_id_required');
      if (inFlight) throw new Error('fleet_supervisor_promotion_in_flight');
      const effectKey = expectedEffectKey(agentId);

      inFlight = true;
      try {
        const decision = await verifyActuationLease(Object.freeze({
          agent_id: agentId,
          lease_id: leaseId,
          effect_scope: 'BROWSER_CLIENT_ACTUATION',
          effect_key: effectKey,
          authority_effect: false,
        }));
        assertLeaseDecision(decision, { agentId, leaseId, effectKey });
        return await promoteAgentFromLiveBrowser({ agent_id: agentId });
      } finally {
        inFlight = false;
      }
    },
    raw_transport_promotion_exposed: false,
    worker_browser_authority: false,
    renderer_input_authority: false,
    automatic_retry_allowed: false,
  });
}
