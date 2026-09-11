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

export const BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP = Object.freeze({
  PROCESS: Object.freeze({ journal_owner: 'GUARDIAN_EFFECT_JOURNAL', actuator_owner: 'GUARDIAN_PROCESS_ACTUATOR', reconcile_owner: 'GUARDIAN_PROCESS_RECONCILER' }),
  MACHINE_COPY: Object.freeze({ journal_owner: 'GUARDIAN_EFFECT_JOURNAL', actuator_owner: 'GUARDIAN_MACHINE_COPY_ACTUATOR', reconcile_owner: 'GUARDIAN_MACHINE_RECONCILER' }),
  SCM_CONFIG: Object.freeze({ journal_owner: 'GUARDIAN_EFFECT_JOURNAL', actuator_owner: 'GUARDIAN_SCM_ACTUATOR', reconcile_owner: 'GUARDIAN_SCM_RECONCILER' }),
  SESSION_BROKER: Object.freeze({ journal_owner: 'SESSION_BROKER_EFFECT_JOURNAL', actuator_owner: 'GUARDIAN_WTS_ACTUATOR', reconcile_owner: 'SESSION_BROKER_RECONCILER' }),
  SELF_UPDATE: Object.freeze({ journal_owner: 'SELF_UPDATE_TRANSACTION_JOURNAL', actuator_owner: 'ELECTRON_UPDATER_ACTUATOR', reconcile_owner: 'SELF_UPDATE_RECONCILER' }),
  BROWSER_SEND: Object.freeze({ journal_owner: 'DEVOS_EFFECT_DELIVERY_JOURNAL', actuator_owner: 'BROWSER_SEND_ACTUATOR', reconcile_owner: 'DEVOS_DELIVERY_RECONCILER' }),
  TAB_CREATE: Object.freeze({ journal_owner: 'SENTINEL_ACTION_JOURNAL', actuator_owner: 'BROWSER_TAB_PROVISIONER', reconcile_owner: 'BROWSER_FLEET_RECONCILER' }),
  RELEASE_PROMOTION: Object.freeze({ journal_owner: 'RELEASE_PROMOTION_JOURNAL', actuator_owner: 'RELEASE_PUBLISHER', reconcile_owner: 'RELEASE_PROMOTION_RECONCILER' }),
  TRANSPORT_PROMOTION: Object.freeze({ journal_owner: 'TRANSPORT_PROMOTION_LEASE', actuator_owner: 'TRANSPORT_PROOF_PROMOTER', reconcile_owner: 'TRANSPORT_PROMOTION_RECONCILER' }),
});

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
  if (existing_domain_proof == null) {
    return decision(false, 'EXISTING_EFFECT_DOMAIN_PROOF_REQUIRED', normalized);
  }

  const ownership = BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP[normalized];
  if (existing_domain_proof.domain !== normalized
      || existing_domain_proof.one_attempt_journal !== true
      || existing_domain_proof.independent_readback !== true
      || existing_domain_proof.automatic_retry_allowed !== false
      || existing_domain_proof.journal_owner !== ownership.journal_owner
      || existing_domain_proof.actuator_owner !== ownership.actuator_owner
      || existing_domain_proof.reconcile_owner !== ownership.reconcile_owner) {
    return decision(false, 'EXISTING_EFFECT_DOMAIN_PROOF_INVALID', normalized);
  }

  return decision(true, 'EXISTING_EFFECT_DOMAIN_RECOGNIZED', normalized, {
    existing_effect_domain: true,
    ownership: BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP[normalized],
  });
}

export function browserFabricEffectDomainPolicyContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_SCHEMA,
    version: BROWSER_FABRIC_EFFECT_DOMAIN_POLICY_VERSION,
    frozen_existing_domains: BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS,
    frozen_effect_domain_ownership: BROWSER_FABRIC_EFFECT_DOMAIN_OWNERSHIP,
    one_journal_owner_per_domain: true,
    one_actuator_owner_per_domain: true,
    one_reconcile_owner_per_domain: true,
    runtime_ownership_proof_required: true,
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
