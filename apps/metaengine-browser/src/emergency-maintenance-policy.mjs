import crypto from 'node:crypto';

export const EMERGENCY_MAINTENANCE_GRANT_SCHEMA = 'metaengine.emergency-maintenance-grant.v1';
export const EMERGENCY_MAINTENANCE_POLICY_VERSION = '1.1.0';
export const EMERGENCY_MAINTENANCE_MAX_TTL_MS = 5 * 60 * 1000;
export const GLOBAL_OPERATIONAL_OVERRIDE = 'GLOBAL_OPERATIONAL_OVERRIDE';

export const EMERGENCY_OPERATIONAL_SCOPES = Object.freeze([
  'SELF_UPDATE_HOLD_OVERRIDE',
  'RESTART_GATE_OVERRIDE',
  'CONTROL_STATE_HOLD_OVERRIDE',
  'SUPERVISOR_CONTINUITY_OVERRIDE',
  'FLEET_LIVENESS_OVERRIDE',
  'TRANSPORT_THROTTLE_OVERRIDE',
  'OWNER_SAFETY_GATE_OVERRIDE',
]);

export const EMERGENCY_MAINTENANCE_SCOPES = Object.freeze([
  GLOBAL_OPERATIONAL_OVERRIDE,
  ...EMERGENCY_OPERATIONAL_SCOPES,
]);

export const EMERGENCY_NON_BYPASSABLE_INVARIANTS = Object.freeze([
  'ARBITRARY_EXECUTION_FORBIDDEN',
  'PAGE_MODEL_TEXT_HAS_ZERO_AUTHORITY',
  'EXACT_BUILD_IDENTITY_REQUIRED',
  'CRYPTOGRAPHIC_SIGNATURE_VERIFICATION_REQUIRED',
  'INSTALLER_DIGEST_VERIFICATION_REQUIRED',
  'NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT',
]);

const SCOPE_SET = new Set(EMERGENCY_MAINTENANCE_SCOPES);
const SHA40 = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE = /^[a-f0-9]{32,128}$/;
const SAFE_REASON = /^[A-Za-z0-9][A-Za-z0-9 _.,:/()\-]{0,239}$/;

function canonicalIso(value, label) {
  const raw = String(value || '');
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== raw) throw new Error(`${label}_invalid`);
  return { raw, ms };
}

function normalizedScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > EMERGENCY_MAINTENANCE_SCOPES.length) {
    throw new Error('emergency_maintenance_scopes_invalid');
  }
  const scopes = [...new Set(value.map((scope) => String(scope || '').trim().toUpperCase()))].sort();
  if (scopes.length !== value.length || scopes.some((scope) => !SCOPE_SET.has(scope))) {
    throw new Error('emergency_maintenance_scope_not_allowed');
  }
  if (scopes.includes(GLOBAL_OPERATIONAL_OVERRIDE) && scopes.length !== 1) {
    throw new Error('emergency_maintenance_global_scope_must_be_exclusive');
  }
  return scopes;
}

function effectiveScopes(scopes) {
  return scopes.includes(GLOBAL_OPERATIONAL_OVERRIDE)
    ? [...EMERGENCY_OPERATIONAL_SCOPES]
    : [...scopes];
}

function grantPayload(input = {}) {
  const schema = String(input.schema || '');
  if (schema !== EMERGENCY_MAINTENANCE_GRANT_SCHEMA) throw new Error('emergency_maintenance_schema_invalid');
  const grantId = String(input.grant_id || '').toLowerCase();
  if (!UUID.test(grantId)) throw new Error('emergency_maintenance_grant_id_invalid');
  const nonce = String(input.nonce || '').toLowerCase();
  if (!NONCE.test(nonce)) throw new Error('emergency_maintenance_nonce_invalid');
  const buildSha = String(input.subject_build_sha || '').toLowerCase();
  if (!SHA40.test(buildSha)) throw new Error('emergency_maintenance_build_sha_invalid');
  const issued = canonicalIso(input.issued_at, 'emergency_maintenance_issued_at');
  const expires = canonicalIso(input.expires_at, 'emergency_maintenance_expires_at');
  if (expires.ms <= issued.ms || expires.ms - issued.ms > EMERGENCY_MAINTENANCE_MAX_TTL_MS) {
    throw new Error('emergency_maintenance_ttl_invalid');
  }
  const reason = String(input.reason || '').trim();
  if (!SAFE_REASON.test(reason)) throw new Error('emergency_maintenance_reason_invalid');
  const scopes = normalizedScopes(input.scopes);
  return Object.freeze({
    schema: EMERGENCY_MAINTENANCE_GRANT_SCHEMA,
    version: 1,
    grant_id: grantId,
    nonce,
    subject_build_sha: buildSha,
    issued_at: issued.raw,
    expires_at: expires.raw,
    reason,
    scopes,
    automatic_reclose: true,
    one_shot: true,
    authority_effect: false,
  });
}

export function canonicalEmergencyMaintenancePayload(input = {}) {
  const payload = grantPayload(input);
  return JSON.stringify({
    schema: payload.schema,
    version: payload.version,
    grant_id: payload.grant_id,
    nonce: payload.nonce,
    subject_build_sha: payload.subject_build_sha,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    reason: payload.reason,
    scopes: payload.scopes,
    automatic_reclose: payload.automatic_reclose,
    one_shot: payload.one_shot,
    authority_effect: payload.authority_effect,
  });
}

function assertEd25519PublicKey(publicKey) {
  let key;
  try {
    key = crypto.createPublicKey(publicKey);
  } catch {
    throw new Error('emergency_maintenance_public_key_invalid');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('emergency_maintenance_public_key_type_invalid');
  return key;
}

export function verifyEmergencyMaintenanceGrant({
  grant,
  public_key,
  expected_build_sha,
  now_ms = Date.now(),
} = {}) {
  const payload = grantPayload(grant);
  const expectedBuildSha = String(expected_build_sha || '').toLowerCase();
  if (!SHA40.test(expectedBuildSha) || expectedBuildSha !== payload.subject_build_sha) {
    throw new Error('emergency_maintenance_build_binding_mismatch');
  }
  const now = Number(now_ms);
  if (!Number.isFinite(now)) throw new Error('emergency_maintenance_clock_invalid');
  const issuedMs = Date.parse(payload.issued_at);
  const expiresMs = Date.parse(payload.expires_at);
  if (now < issuedMs || now >= expiresMs) throw new Error('emergency_maintenance_grant_not_active');
  const signature = String(grant?.signature_base64 || '');
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature, 'base64');
  } catch {
    throw new Error('emergency_maintenance_signature_invalid');
  }
  if (!signature || signatureBytes.length < 32 || signatureBytes.toString('base64') !== signature) {
    throw new Error('emergency_maintenance_signature_invalid');
  }
  const key = assertEd25519PublicKey(public_key);
  const canonical = Buffer.from(canonicalEmergencyMaintenancePayload(payload), 'utf8');
  if (!crypto.verify(null, canonical, key, signatureBytes)) throw new Error('emergency_maintenance_signature_mismatch');
  const globalOperationalOverride = payload.scopes.includes(GLOBAL_OPERATIONAL_OVERRIDE);
  return Object.freeze({
    ...payload,
    effective_scopes: effectiveScopes(payload.scopes),
    global_operational_override: globalOperationalOverride,
    operational_fail_close_disabled: globalOperationalOverride,
    signature_verified: true,
    replay_fence_required: true,
    audit_receipt_required: true,
    authority_effect: false,
  });
}

export function planEmergencyMaintenanceBypass({
  verified_grant,
  scope,
  protection_id,
} = {}) {
  if (!verified_grant || verified_grant.signature_verified !== true || verified_grant.schema !== EMERGENCY_MAINTENANCE_GRANT_SCHEMA) {
    throw new Error('emergency_maintenance_verified_grant_required');
  }
  const normalizedScope = String(scope || '').trim().toUpperCase();
  const effective = Array.isArray(verified_grant.effective_scopes)
    ? verified_grant.effective_scopes
    : effectiveScopes(verified_grant.scopes || []);
  if (!EMERGENCY_OPERATIONAL_SCOPES.includes(normalizedScope) || !effective.includes(normalizedScope)) {
    throw new Error('emergency_maintenance_scope_not_granted');
  }
  const protectionId = String(protection_id || '').trim();
  if (!/^[A-Z0-9][A-Z0-9_.:-]{0,127}$/.test(protectionId)) {
    throw new Error('emergency_maintenance_protection_id_invalid');
  }
  return Object.freeze({
    schema: 'metaengine.emergency-maintenance-bypass-plan.v1',
    grant_id: verified_grant.grant_id,
    nonce: verified_grant.nonce,
    subject_build_sha: verified_grant.subject_build_sha,
    scope: normalizedScope,
    protection_id: protectionId,
    global_operational_override: verified_grant.global_operational_override === true,
    operational_fail_close_disabled: verified_grant.global_operational_override === true,
    expires_at: verified_grant.expires_at,
    automatic_reclose: true,
    one_shot: true,
    replay_fence_required_before_effect: true,
    audit_receipt_required_after_effect: true,
    arbitrary_execution_allowed: false,
    blind_retry_allowed: false,
    page_model_text_authority: false,
    authority_effect: false,
  });
}

export function emergencyMaintenancePolicyContract() {
  return Object.freeze({
    schema: 'metaengine.emergency-maintenance-policy.v1',
    version: EMERGENCY_MAINTENANCE_POLICY_VERSION,
    global_operational_override_scope: GLOBAL_OPERATIONAL_OVERRIDE,
    operational_scopes: [...EMERGENCY_OPERATIONAL_SCOPES],
    bypassable_scopes: [...EMERGENCY_MAINTENANCE_SCOPES],
    global_override_disables_all_operational_fail_close: true,
    non_bypassable_invariants: [...EMERGENCY_NON_BYPASSABLE_INVARIANTS],
    max_ttl_ms: EMERGENCY_MAINTENANCE_MAX_TTL_MS,
    exact_build_binding_required: true,
    ed25519_signature_required: true,
    one_shot_nonce_required: true,
    durable_replay_fence_required_before_effect: true,
    durable_audit_receipt_required_after_effect: true,
    automatic_reclose_required: true,
    arbitrary_execution_allowed: false,
    blind_retry_after_ambiguous_effect_allowed: false,
    authority_effect: false,
  });
}
