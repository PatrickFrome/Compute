import { sha256Canonical, stableValue } from './sovereign-effect-ledger.mjs';

const SHA256 = /^[0-9a-f]{64}$/;

function required(value, reason) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(reason);
  return normalized;
}

function exactInt(value, reason, { min = 0 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) throw new Error(reason);
  return normalized;
}

export function capabilityMaterial(value = {}) {
  const material = {
    schema: 'metaengine.effect-capability.v1',
    capability_id: required(value.capability_id, 'capability_id_required'),
    issuer: required(value.issuer, 'capability_issuer_required'),
    audience: required(value.audience, 'capability_audience_required'),
    subject: required(value.subject, 'capability_subject_required'),
    device_id: required(value.device_id, 'capability_device_required'),
    task_id: required(value.task_id, 'capability_task_required'),
    claim_generation: exactInt(value.claim_generation, 'capability_claim_generation_invalid', { min: 1 }),
    browser_context_id: required(value.browser_context_id, 'capability_browser_context_required'),
    target_id: required(value.target_id, 'capability_target_required'),
    target_incarnation: required(value.target_incarnation, 'capability_target_incarnation_required'),
    action: required(value.action, 'capability_action_required').toUpperCase(),
    idempotency_key: required(value.idempotency_key, 'capability_idempotency_key_required'),
    policy_hash: required(value.policy_hash, 'capability_policy_hash_required').toLowerCase(),
    not_before_ms: exactInt(value.not_before_ms, 'capability_not_before_invalid', { min: 0 }),
    expires_at_ms: exactInt(value.expires_at_ms, 'capability_expiry_invalid', { min: 1 }),
    restrictions: stableValue(value.restrictions ?? {}),
  };
  if (!SHA256.test(material.policy_hash)) throw new Error('capability_policy_hash_invalid');
  if (material.expires_at_ms <= material.not_before_ms) throw new Error('capability_window_invalid');
  return Object.freeze(material);
}

export function capabilityDigest(value) {
  return sha256Canonical(capabilityMaterial(value));
}

export async function verifyEffectCapability({ capability, signature, verifier, expected, now_ms = Date.now() } = {}) {
  const material = capabilityMaterial(capability);
  if (typeof verifier !== 'function') throw new Error('capability_verifier_required');
  const expectedValues = expected && typeof expected === 'object' ? expected : {};

  for (const field of [
    'audience',
    'subject',
    'device_id',
    'task_id',
    'claim_generation',
    'browser_context_id',
    'target_id',
    'target_incarnation',
    'action',
    'idempotency_key',
    'policy_hash',
  ]) {
    if (Object.hasOwn(expectedValues, field)) {
      const actual = field === 'action' ? String(material[field]).toUpperCase() : material[field];
      const wanted = field === 'action' ? String(expectedValues[field]).toUpperCase() : expectedValues[field];
      if (actual !== wanted) throw new Error(`capability_binding_drift:${field}`);
    }
  }

  const now = exactInt(now_ms, 'capability_now_invalid', { min: 0 });
  if (now < material.not_before_ms) throw new Error('capability_not_yet_valid');
  if (now >= material.expires_at_ms) throw new Error('capability_expired');

  const digest = sha256Canonical(material);
  const verified = await verifier({ material, digest, signature });
  if (verified !== true) throw new Error('capability_signature_invalid');

  return Object.freeze({
    material,
    digest,
    signature_verified: true,
    audience_bound: true,
    location_implies_trust: false,
    queue_delivery_authorizes: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export const EFFECT_CAPABILITY_CONTRACT = Object.freeze({
  schema: 'metaengine.effect-capability-contract.v1',
  audience_bound: true,
  subject_device_bound: true,
  task_claim_generation_bound: true,
  browser_context_target_incarnation_bound: true,
  action_deadline_idempotency_policy_bound: true,
  cryptographic_verifier_required: true,
  location_implies_trust: false,
  queue_delivery_authorizes: false,
  authority_effect: false,
});
