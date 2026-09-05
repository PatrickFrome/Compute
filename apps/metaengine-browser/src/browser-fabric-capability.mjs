import crypto from 'node:crypto';
import { canonicalFabricJson, fabricSha256 } from './browser-fabric-effect-ledger.mjs';

export const BROWSER_FABRIC_CAPABILITY_SCHEMA = 'metaengine.browser-fabric.capability.v1';
export const BROWSER_FABRIC_CAPABILITY_ALG = 'EdDSA';
export const BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS = 5 * 60 * 1000;

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ED25519_SIGNATURE_BASE64URL = /^[A-Za-z0-9_-]{86}$/;
const ENVELOPE_KEYS = Object.freeze(['alg', 'key_id', 'claims', 'signature']);
const REQUIRED_SAFE_FIELDS = Object.freeze([
  'capability_id', 'issuer', 'audience', 'subject_device', 'effect_id', 'task_id',
  'browser_context_id', 'target_id', 'target_incarnation', 'action', 'idempotency_key', 'nonce',
]);
const EXACT_BINDING_FIELDS = Object.freeze([
  'audience', 'subject_device', 'effect_id', 'task_id', 'claim_generation',
  'browser_context_id', 'target_id', 'target_incarnation', 'action',
  'idempotency_key', 'policy_hash', 'plan_digest', 'nonce', 'max_uses',
  'retry_budget', 'delegation_depth', 'parent_capability_digest',
]);

function fail(reason) {
  return Object.freeze({
    ok: false,
    reason,
    execution_authorized: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function safe(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function hash(value) {
  return typeof value === 'string' && SHA256.test(value);
}

function exactClaimKeys(claims) {
  const expected = new Set([
    'schema', 'capability_id', 'issuer', 'audience', 'subject_device', 'effect_id',
    'task_id', 'claim_generation', 'browser_context_id', 'target_id',
    'target_incarnation', 'action', 'issued_at', 'not_before', 'deadline',
    'idempotency_key', 'policy_hash', 'plan_digest', 'nonce', 'max_uses',
    'retry_budget', 'delegation_depth', 'parent_capability_digest',
  ]);
  return claims && typeof claims === 'object' && !Array.isArray(claims)
    && Object.keys(claims).length === expected.size
    && Object.keys(claims).every((key) => expected.has(key));
}

export function fabricCapabilitySigningBytes(claims) {
  return Buffer.from(canonicalFabricJson(claims), 'utf8');
}

export function fabricCapabilityDigest(envelope) {
  return fabricSha256(canonicalFabricJson({
    alg: envelope?.alg,
    key_id: envelope?.key_id,
    claims: envelope?.claims,
    signature: envelope?.signature,
  }));
}

function normalizeTime(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function decodeEd25519Signature(value) {
  if (typeof value !== 'string' || !ED25519_SIGNATURE_BASE64URL.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 64 || decoded.toString('base64url') !== value) return null;
  return decoded;
}

function claimViolation(claims) {
  if (!exactClaimKeys(claims) || claims.schema !== BROWSER_FABRIC_CAPABILITY_SCHEMA) return 'CAPABILITY_SCHEMA_INVALID';
  const invalidField = REQUIRED_SAFE_FIELDS.find((key) => !safe(claims[key]));
  if (invalidField) return `CAPABILITY_FIELD_INVALID:${invalidField}`;
  if (!Number.isSafeInteger(claims.claim_generation) || claims.claim_generation <= 0) {
    return 'CAPABILITY_CLAIM_GENERATION_INVALID';
  }
  if (!hash(claims.policy_hash) || !hash(claims.plan_digest)) return 'CAPABILITY_DIGEST_BINDING_INVALID';
  if (claims.max_uses !== 1 || claims.retry_budget !== 0) return 'CAPABILITY_USE_OR_RETRY_BUDGET_INVALID';
  if (claims.delegation_depth !== 0 || claims.parent_capability_digest !== null) {
    return 'CAPABILITY_DELEGATION_NOT_SUPPORTED';
  }
  return [claims.action, claims.audience, claims.target_id].includes('*')
    ? 'CAPABILITY_WILDCARD_FORBIDDEN'
    : null;
}

function timeViolation(claims, now, maxTtlMs) {
  const issued = normalizeTime(claims.issued_at);
  const notBefore = normalizeTime(claims.not_before);
  const deadline = normalizeTime(claims.deadline);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (![issued, notBefore, deadline, nowMs].every(Number.isFinite)) return 'CAPABILITY_TIME_INVALID';
  if (!Number.isSafeInteger(maxTtlMs)
      || maxTtlMs <= 0
      || maxTtlMs > BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS) return 'CAPABILITY_MAX_TTL_POLICY_INVALID';
  if (notBefore < issued || deadline <= notBefore) return 'CAPABILITY_TIME_ORDER_INVALID';
  if (deadline - issued > maxTtlMs) return 'CAPABILITY_TTL_EXCEEDED';
  if (nowMs < notBefore) return 'CAPABILITY_NOT_YET_VALID';
  return nowMs >= deadline ? 'CAPABILITY_EXPIRED' : null;
}

function bindingViolation(claims, expected) {
  const mismatch = EXACT_BINDING_FIELDS.find((key) => !Object.hasOwn(expected, key) || claims[key] !== expected[key]);
  return mismatch ? `CAPABILITY_BINDING_MISMATCH:${mismatch}` : null;
}

function signatureVerification(claims, key, signature) {
  try {
    return crypto.verify(null, fabricCapabilitySigningBytes(claims), key, signature)
      ? null
      : 'CAPABILITY_SIGNATURE_INVALID';
  } catch {
    return 'CAPABILITY_SIGNATURE_VERIFICATION_ERROR';
  }
}

function verifiedCapability(envelope, claims) {
  const capabilityDigest = fabricCapabilityDigest(envelope);
  return Object.freeze({
    ok: true,
    reason: 'CAPABILITY_EXACT_AND_VERIFIED',
    capability_digest: capabilityDigest,
    ledger_material: Object.freeze({
      capability_id: claims.capability_id,
      capability_digest: capabilityDigest,
      verified: true,
      audience: claims.audience,
      subject_device: claims.subject_device,
      task_id: claims.task_id,
      claim_generation: claims.claim_generation,
      browser_context_id: claims.browser_context_id,
      target_id: claims.target_id,
      target_incarnation: claims.target_incarnation,
      action: claims.action,
      deadline: claims.deadline,
      idempotency_key: claims.idempotency_key,
      policy_hash: claims.policy_hash,
      plan_digest: claims.plan_digest,
      nonce: claims.nonce,
      max_uses: claims.max_uses,
      retry_budget: claims.retry_budget,
      delegation_depth: claims.delegation_depth,
      parent_capability_digest: claims.parent_capability_digest,
      effect_id: claims.effect_id,
      issuer: claims.issuer,
      key_id: envelope.key_id,
    }),
    execution_authorized: true,
    audience_bound: true,
    subject_and_device_bound: true,
    exact_target_bound: true,
    short_lived: true,
    single_use_ledger_reservation_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

/**
 * Verify a detached, audience-bound Ed25519 capability. The verifier is pure
 * policy enforcement: it performs no queue, Browser, WTS, SCM, filesystem, or
 * network effect and cannot mint capabilities.
 */
export function verifyBrowserFabricCapability({
  envelope,
  trusted_public_keys = {},
  expected = {},
  now = new Date(),
  max_ttl_ms = BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS,
} = {}) {
  if (!envelope || envelope.alg !== BROWSER_FABRIC_CAPABILITY_ALG) return fail('CAPABILITY_ALGORITHM_INVALID');
  const envelopeKeys = Object.keys(envelope);
  if (envelopeKeys.length !== ENVELOPE_KEYS.length
      || !envelopeKeys.every((key) => ENVELOPE_KEYS.includes(key))) return fail('CAPABILITY_ENVELOPE_INVALID');
  if (!safe(envelope.key_id)) {
    return fail('CAPABILITY_ENVELOPE_INVALID');
  }
  const signature = decodeEd25519Signature(envelope.signature);
  if (!signature) return fail('CAPABILITY_SIGNATURE_ENCODING_INVALID');
  const claims = envelope.claims;
  const claimsInvalid = claimViolation(claims);
  if (claimsInvalid) return fail(claimsInvalid);
  const timeInvalid = timeViolation(claims, now, max_ttl_ms);
  if (timeInvalid) return fail(timeInvalid);
  const bindingInvalid = bindingViolation(claims, expected);
  if (bindingInvalid) return fail(bindingInvalid);

  const key = trusted_public_keys
    && Object.hasOwn(trusted_public_keys, envelope.key_id)
    && trusted_public_keys[envelope.key_id];
  if (!key) return fail('CAPABILITY_KEY_UNTRUSTED');
  const signatureInvalid = signatureVerification(claims, key, signature);
  return signatureInvalid ? fail(signatureInvalid) : verifiedCapability(envelope, claims);
}

export function browserFabricCapabilityContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_CAPABILITY_SCHEMA,
    algorithm: BROWSER_FABRIC_CAPABILITY_ALG,
    short_lived: true,
    max_ttl_ms: BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS,
    binds_subject_device: true,
    binds_task: true,
    binds_claim_generation: true,
    binds_browser_context: true,
    binds_target_incarnation: true,
    binds_action: true,
    binds_deadline: true,
    binds_idempotency_key: true,
    binds_policy_hash: true,
    binds_plan_digest: true,
    binds_nonce: true,
    maximum_uses: 1,
    retry_budget: 0,
    delegated_capabilities_allowed: false,
    wildcard_authority_forbidden: true,
    strict_ed25519_signature_encoding_required: true,
    caller_cannot_expand_max_ttl: true,
    exact_deadline_is_expired: true,
    single_use_ledger_reservation_required: true,
    queue_delivery_authority: false,
    signer_private_key_runtime_required: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
