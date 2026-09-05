export const BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_SCHEMA = 'metaengine.browser-fabric.effect-domain-policy.v1';
export const BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_VERSION = '1.0.0';

// Existing effect families only. Adding a value here is an architecture change,
// not a runtime discovery path: it requires an RFC, threat model, one-attempt
// journal contract, independent readback and exact-head/physical gates.
export const BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS = Object.freeze([
  'PROCESS',
  'MACHINE_COPY',
  'SCM_CONFIG',
  'SESSION_BROKER',
  'SELF_UPDATE',
  'BROWSER_SEND',
  'TAB_CREATE',
  'RELEASE_PROMOTION',
  'TRANSPORT_PROMOTION',
]);

const EXISTING = new Set(BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS);
const DOMAIN = /^[A-Z][A-Z0-9_]{1,63}$/;

function decision(allowed, reason, domain, extra = {}) {
  return Object.freeze({
    schema: BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_SCHEMA,
    version: BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_VERSION,
    domain,
    allowed,
    reason,
    new_effect_domain_allowed: false,
    rfc_required_for_new_domain: true,
    threat_model_required_for_new_domain: true,
    one_attempt_journal_required: true,
    independent_readback_required: true,
    physical_gate_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

/**
 * 0-72h audit freeze: only already-recognized physical effect families may be
 * represented in the Fabric. The policy is intentionally not extensible from
 * config/env/queue input. A code review changing the frozen registry is the
 * explicit architecture boundary.
 */
export function evaluateBrowserFabricEffectDomain(domain, { existing_domain_proof = null } = {}) {
  const normalized = String(domain || '').trim().toUpperCase();
  if (!DOMAIN.test(normalized)) return decision(false, 'EFFECT_DOMAIN_INVALID', normalized || null);
  if (!EXISTING.has(normalized)) return decision(false, 'NEW_EFFECT_DOMAIN_FROZEN', normalized);

  if (existing_domain_proof != null) {
    if (!existing_domain_proof
        || existing_domain_proof.domain !== normalized
        || existing_domain_proof.one_attempt_journal !== true
        || existing_domain_proof.independent_readback !== true
        || existing_domain_proof.automatic_retry_allowed !== false) {
      return decision(false, 'EXISTING_EFFECT_DOMAIN_PROOF_INVALID', normalized);
    }
  }

  return decision(true, 'EXISTING_EFFECT_DOMAIN_RECOGNIZED', normalized, {
    existing_effect_domain: true,
  });
}

export function browserFabricEffectDomainPolicyContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_SCHEMA,
    version: BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_VERSION,
    frozen_existing_domains: BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS,
    runtime_domain_registration_allowed: false,
    environment_domain_registration_allowed: false,
    queue_domain_registration_allowed: false,
    rfc_required_for_new_domain: true,
    threat_model_required_for_new_domain: true,
    one_attempt_journal_required: true,
    independent_readback_required: true,
    physical_gate_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
