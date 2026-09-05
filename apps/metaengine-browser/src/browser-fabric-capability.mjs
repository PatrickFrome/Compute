import crypto from 'node:crypto';
import { canonicalFabricJson, fabricSha256 } from './browser-fabric-effect-ledger.mjs';

export const BROWSER_FABRIC_CAPABILITY_SCHEMA = 'metaengine.browser-fabric.capability.v1';
export const BROWSER_FABRIC_CAPABILITY_ALG = 'EdDSA';
export const BROWSER_FABRIC_CAPABILITY_MAX_TTL_MS = 5 * 60 * 1000;

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

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
    'idempotency_key', 'policy_hash', 'plan_digest',
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
  if (!safe(envelope.key_id) || typeof envelope.signature !== 'string' || envelope.signature.length < 32) {
    return fail('CAPABILITY_ENVELOPE_INVALID');
  }
  const claims = envelope.claims;
  if (!exactClaimKeys(claims) || claims.schema !== BROWSER_FABRIC_CAPABILITY_SCHEMA) return fail('CAPABILITY_SCHEMA_INVALID');

  for (const key of [
    'capability_id', 'issuer', 'audience', 'subject_device', 'effect_id', 'task_id',
    'browser_context_id', 'target_id', 'target_incarnation', 'action', 'idempotency_key',
  ]) {
    if (!safe(claims[key])) return fail(`CAPABILITY_FIELD_INVALID:${key}`);
  }
  if (!Number.isSafeInteger(claims.claim_generation) || claims.claim_generation <= 0) return fail('CAPABILITY_CLAIM_GENERATION_INVALID');
  if (!hash(claims.policy_hash) || !hash(claims.plan_digest)) return fail('CAPABILITY_DIGEST_BINDING_INVALID');
  if (claims.action === '*' || claims.audience === '*' || claims.target_id === '*') return fail('CAPABILITY_WILDCARD_FORBIDDEN');

  const issued = normalizeTime(claims.issued_at);
  const notBefore = normalizeTime(claims.not_before);
  const deadline = normalizeTime(claims.deadline);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (![issued, notBefore, deadline, nowMs].every(Number.isFinite)) return fail('CAPABILITY_TIME_INVALID');
  if (notBefore < issued || deadline <= notBefore) return fail('CAPABILITY_TIME_ORDER_INVALID');
  if (deadline - issued > max_ttl_ms || max_ttl_ms <= 0) return fail('CAPABILITY_TTL_EXCEEDED');
  if (nowMs < notBefore) return fail('CAPABILITY_NOT_YET_VALID');
  if (nowMs > deadline) return fail('CAPABILITY_EXPIRED');

  const exactBindings = [
    ['audience', expected.audience],
    ['subject_device', expected.subject_device],
    ['effect_id', expected.effect_id],
    ['task_id', expected.task_id],
    ['claim_generation', expected.claim_generation],
    ['browser_context_id', expected.browser_context_id],
    ['target_id', expected.target_id],
    ['target_incarnation', expected.target_incarnation],
    ['action', expected.action],
    ['idempotency_key', expected.idempotency_key],
    ['policy_hash', expected.policy_hash],
    ['plan_digest', expected.plan_digest],
  ];
  for (const [key, value] of exactBindings) {
    if (value == null || claims[key] !== value) return fail(`CAPABILITY_BINDING_MISMATCH:${key}`);
  }

  const key = trusted_public_keys?.[envelope.key_id];
  if (!key) return fail('CAPABILITY_KEY_UNTRUSTED');
  let signature;
  try {
    signature = Buffer.from(envelope.signature, 'base64url');
  } catch {
    return fail('CAPABILITY_SIGNATURE_ENCODING_INVALID');
  }
  let verified = false;
  try {
    verified = crypto.verify(null, fabricCapabilitySigningBytes(claims), key, signature);
  } catch {
    return fail('CAPABILITY_SIGNATURE_VERIFICATION_ERROR');
  }
  if (!verified) return fail('CAPABILITY_SIGNATURE_INVALID');

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
      effect_id: claims.effect_id,
      issuer: claims.issuer,
      key_id: envelope.key_id,
    }),
    execution_authorized: true,
    audience_bound: true,
    subject_and_device_bound: true,
    exact_target_bound: true,
    short_lived: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
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
    wildcard_authority_forbidden: true,
    queue_delivery_authority: false,
    signer_private_key_runtime_required: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
