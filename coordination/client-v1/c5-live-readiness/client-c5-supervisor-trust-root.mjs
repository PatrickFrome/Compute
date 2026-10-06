import crypto from 'node:crypto';

import {
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';

export const CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA = 'metaengine.client-v1.c5-supervisor-trust-root.v2';
export const CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA = 'metaengine.client-v1.c5-supervisor-trust-root-signature.v2';
export const CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA = 'metaengine.client-v1.c5-supervisor-trust-root-verification.v2';
export const CLIENT_C5_SUPERVISOR_TRUST_ROOT_RESOLUTION_SCHEMA = 'metaengine.client-v1.c5-supervisor-trust-root-resolution.v2';

const SHA256_RE = /^[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ED25519_SIGNATURE_BASE64URL_RE = /^[A-Za-z0-9_-]{86}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const KEY_ROLES = new Set(['ROOT', 'SUPERVISOR_READBACK']);
const KEY_STATES = new Set(['ACTIVE', 'RETIRED', 'REVOKED']);
const PIN_MODES = new Set(['CONTROLLED_TEST_VECTOR', 'LIVE_DEVELOPMENT_PIN']);
const MANIFEST_KEYS = Object.freeze([
  'schema', 'version', 'generation', 'issued_at', 'expires_at',
  'previous_manifest_sha256', 'root_signature_threshold', 'usage',
  'keys', 'automatic_retry_allowed', 'authority_effect',
]);
const KEY_KEYS = Object.freeze([
  'key_id', 'role', 'alg', 'public_key_spki_base64', 'public_key_spki_sha256',
  'state', 'valid_from', 'valid_until', 'retired_at', 'revoked_at', 'invalid_since',
]);
const SIGNATURE_ENVELOPE_KEYS = Object.freeze([
  'schema', 'manifest_sha256', 'signatures',
]);
const SIGNATURE_KEYS = Object.freeze(['key_id', 'alg', 'signature']);

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const exactKeys = (value, keys) => {
  const row = object(value);
  if (!row) return false;
  const actual = Object.keys(row);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
};
const parseUtc = (value) => {
  if (typeof value !== 'string' || !UTC_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

export function clientC5SupervisorTrustRootDigest(manifest) {
  return sha256ClientC5(stableClientC5Json(manifest));
}

export function clientC5SupervisorTrustRootSigningBytes(manifest) {
  return Buffer.from(stableClientC5Json(manifest), 'utf8');
}

function decodeSpki(entry) {
  try {
    const der = Buffer.from(entry.public_key_spki_base64, 'base64');
    if (!der.length || der.toString('base64') !== entry.public_key_spki_base64) return null;
    if (sha256ClientC5(der) !== entry.public_key_spki_sha256) return null;
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return null;
    return key;
  } catch {
    return null;
  }
}

function normalizeKeyEntry(value) {
  const row = object(value);
  if (
    !exactKeys(row, KEY_KEYS)
    || !SAFE_ID_RE.test(String(row.key_id || ''))
    || !KEY_ROLES.has(row.role)
    || row.alg !== 'EdDSA'
    || typeof row.public_key_spki_base64 !== 'string'
    || !SHA256_RE.test(String(row.public_key_spki_sha256 || ''))
    || !KEY_STATES.has(row.state)
  ) throw new Error('client_c5_supervisor_trust_root_key_invalid');

  const validFrom = parseUtc(row.valid_from);
  const validUntil = parseUtc(row.valid_until);
  const retiredAt = row.retired_at === null ? null : parseUtc(row.retired_at);
  const revokedAt = row.revoked_at === null ? null : parseUtc(row.revoked_at);
  const invalidSince = row.invalid_since === null ? null : parseUtc(row.invalid_since);

  if (
    validFrom === null
    || validUntil === null
    || validUntil <= validFrom
    || (retiredAt !== null && (retiredAt <= validFrom || retiredAt > validUntil))
    || (revokedAt !== null && (revokedAt <= validFrom || revokedAt > validUntil))
    || (invalidSince !== null && (invalidSince < validFrom || invalidSince > validUntil))
  ) throw new Error('client_c5_supervisor_trust_root_key_time_invalid');

  if (row.state === 'ACTIVE' && (retiredAt !== null || revokedAt !== null || invalidSince !== null)) {
    throw new Error('client_c5_supervisor_trust_root_key_state_invalid');
  }
  if (row.state === 'RETIRED' && (retiredAt === null || revokedAt !== null || invalidSince !== null)) {
    throw new Error('client_c5_supervisor_trust_root_key_state_invalid');
  }
  if (
    row.state === 'REVOKED'
    && (
      revokedAt === null
      || invalidSince === null
      || invalidSince > revokedAt
    )
  ) throw new Error('client_c5_supervisor_trust_root_key_state_invalid');

  const key = decodeSpki(row);
  if (!key) throw new Error('client_c5_supervisor_trust_root_public_key_invalid');

  return Object.freeze({
    ...structuredClone(row),
    _valid_from_ms: validFrom,
    _valid_until_ms: validUntil,
    _retired_at_ms: retiredAt,
    _revoked_at_ms: revokedAt,
    _invalid_since_ms: invalidSince,
    _key_object: key,
  });
}

export function normalizeClientC5SupervisorTrustRoot(value, { now = new Date(), require_unexpired = true } = {}) {
  const row = object(value);
  if (
    !exactKeys(row, MANIFEST_KEYS)
    || row.schema !== CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA
    || !SEMVER_RE.test(String(row.version || ''))
    || !Number.isSafeInteger(row.generation)
    || row.generation <= 0
    || row.usage !== 'CLIENT_C5_SUPERVISOR_READBACK'
    || !Array.isArray(row.keys)
    || row.keys.length < 2
    || row.automatic_retry_allowed !== false
    || row.authority_effect !== false
  ) throw new Error('client_c5_supervisor_trust_root_invalid');

  const issuedAt = parseUtc(row.issued_at);
  const expiresAt = parseUtc(row.expires_at);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (
    issuedAt === null
    || expiresAt === null
    || expiresAt <= issuedAt
    || !Number.isFinite(nowMs)
    || issuedAt > nowMs
    || (require_unexpired && expiresAt <= nowMs)
  ) throw new Error('client_c5_supervisor_trust_root_time_invalid');

  if (
    (row.generation === 1 && row.previous_manifest_sha256 !== null)
    || (row.generation > 1 && !SHA256_RE.test(String(row.previous_manifest_sha256 || '')))
  ) throw new Error('client_c5_supervisor_trust_root_lineage_invalid');

  const entries = row.keys.map(normalizeKeyEntry);
  const ids = entries.map((entry) => entry.key_id);
  if (new Set(ids).size !== ids.length || [...ids].sort().some((id, index) => id !== ids[index])) {
    throw new Error('client_c5_supervisor_trust_root_key_order_invalid');
  }

  const activeRoots = entries.filter((entry) => entry.role === 'ROOT' && entry.state === 'ACTIVE');
  const activeSupervisors = entries.filter((entry) => entry.role === 'SUPERVISOR_READBACK' && entry.state === 'ACTIVE');
  if (
    !Number.isSafeInteger(row.root_signature_threshold)
    || row.root_signature_threshold <= 0
    || row.root_signature_threshold > activeRoots.length
    || activeSupervisors.length < 1
  ) throw new Error('client_c5_supervisor_trust_root_threshold_invalid');

  return Object.freeze({
    manifest: Object.freeze(structuredClone(row)),
    digest: clientC5SupervisorTrustRootDigest(row),
    issued_at_ms: issuedAt,
    expires_at_ms: expiresAt,
    keys: Object.freeze(entries),
  });
}

function normalizeSignatureEnvelope(value, manifestDigest) {
  const row = object(value);
  if (
    !exactKeys(row, SIGNATURE_ENVELOPE_KEYS)
    || row.schema !== CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA
    || row.manifest_sha256 !== manifestDigest
    || !Array.isArray(row.signatures)
    || row.signatures.length < 1
  ) throw new Error('client_c5_supervisor_trust_root_signature_envelope_invalid');

  const seen = new Set();
  const signatures = row.signatures.map((signature) => {
    if (
      !exactKeys(signature, SIGNATURE_KEYS)
      || !SAFE_ID_RE.test(String(signature.key_id || ''))
      || signature.alg !== 'EdDSA'
      || typeof signature.signature !== 'string'
      || !ED25519_SIGNATURE_BASE64URL_RE.test(signature.signature)
      || seen.has(signature.key_id)
    ) throw new Error('client_c5_supervisor_trust_root_signature_invalid');
    seen.add(signature.key_id);
    const bytes = Buffer.from(signature.signature, 'base64url');
    if (bytes.length !== 64 || bytes.toString('base64url') !== signature.signature) {
      throw new Error('client_c5_supervisor_trust_root_signature_encoding_invalid');
    }
    return Object.freeze({
      ...structuredClone(signature),
      _signature_bytes: bytes,
    });
  });

  return Object.freeze(signatures);
}

function keyOperationalForRootSignature(entry, atMs) {
  return entry.role === 'ROOT'
    && entry.state === 'ACTIVE'
    && atMs >= entry._valid_from_ms
    && atMs < entry._valid_until_ms;
}

function verifyThreshold({ normalized, signatures, keySource, threshold, atMs }) {
  let verified = 0;
  const accepted = [];
  for (const signature of signatures) {
    const entry = keySource.get(signature.key_id);
    if (!entry || !keyOperationalForRootSignature(entry, atMs)) continue;
    try {
      if (crypto.verify(
        null,
        clientC5SupervisorTrustRootSigningBytes(normalized.manifest),
        entry._key_object,
        signature._signature_bytes,
      )) {
        verified += 1;
        accepted.push(signature.key_id);
      }
    } catch {
      // Fail closed by not counting the signature.
    }
  }
  return {
    ok: verified >= threshold,
    verified,
    accepted: Object.freeze(accepted.sort()),
  };
}

function externalPinnedRootEntries(
  normalized,
  pinnedPublicKeys,
  expectedPinnedSpkiSha256 = {},
  requireExpectedPin = false,
) {
  const map = new Map();
  for (const entry of normalized.keys) {
    if (entry.role !== 'ROOT') continue;
    const supplied = pinnedPublicKeys && Object.hasOwn(pinnedPublicKeys, entry.key_id)
      ? pinnedPublicKeys[entry.key_id]
      : null;
    if (!supplied) continue;
    if (
      requireExpectedPin
      && (
        !Object.hasOwn(expectedPinnedSpkiSha256, entry.key_id)
        || expectedPinnedSpkiSha256[entry.key_id] !== entry.public_key_spki_sha256
      )
    ) continue;
    try {
      const key = supplied && supplied.type === 'public' && supplied.asymmetricKeyType
        ? supplied
        : crypto.createPublicKey(supplied);
      const der = key.export({ type: 'spki', format: 'der' });
      if (
        key.asymmetricKeyType === 'ed25519'
        && sha256ClientC5(der) === entry.public_key_spki_sha256
      ) {
        map.set(entry.key_id, Object.freeze({ ...entry, _key_object: key }));
      }
    } catch {
      // Ignore malformed or mismatched externally supplied public keys.
    }
  }
  return map;
}

function manifestKeyMap(normalized) {
  return new Map(normalized.keys.map((entry) => [entry.key_id, entry]));
}

function receipt(action, normalized, extra = {}) {
  return Object.freeze({
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA,
    action,
    manifest_sha256: normalized.digest,
    generation: normalized.manifest.generation,
    version: normalized.manifest.version,
    expires_at: normalized.manifest.expires_at,
    root_signature_threshold: normalized.manifest.root_signature_threshold,
    trusted_supervisor_key_count: normalized.keys.filter(
      (entry) => entry.role === 'SUPERVISOR_READBACK' && entry.state === 'ACTIVE',
    ).length,
    trust_root_verified: action === 'TRUST_ROOT_ACCEPTED',
    bootstrap_material_verified: false,
    live_development_pin_verified: false,
    production_bootstrap_proven: false,
    live_effect_authorized: false,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

export function verifyClientC5SupervisorTrustRootBootstrap({
  manifest,
  signature_envelope,
  pinned_root_public_keys = {},
  expected_pinned_root_spki_sha256 = {},
  pin_mode = 'CONTROLLED_TEST_VECTOR',
  now = new Date(),
} = {}) {
  if (!PIN_MODES.has(pin_mode)) {
    return Object.freeze({
      schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA,
      action: 'HOLD_TRUST_ROOT',
      reason: 'TRUST_ROOT_PIN_MODE_INVALID',
      trust_root_verified: false,
      bootstrap_material_verified: false,
      live_development_pin_verified: false,
      production_bootstrap_proven: false,
      live_effect_authorized: false,
      canonical_c2_promotion_authorized: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  let normalized;
  try {
    normalized = normalizeClientC5SupervisorTrustRoot(manifest, { now });
  } catch (error) {
    return Object.freeze({
      schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA,
      action: 'HOLD_TRUST_ROOT',
      reason: error.message,
      trust_root_verified: false,
      bootstrap_material_verified: false,
      live_development_pin_verified: false,
      production_bootstrap_proven: false,
      live_effect_authorized: false,
      canonical_c2_promotion_authorized: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  if (normalized.manifest.generation !== 1 || normalized.manifest.previous_manifest_sha256 !== null) {
    return receipt('HOLD_TRUST_ROOT', normalized, { reason: 'BOOTSTRAP_GENERATION_INVALID' });
  }

  let signatures;
  try {
    signatures = normalizeSignatureEnvelope(signature_envelope, normalized.digest);
  } catch (error) {
    return receipt('HOLD_TRUST_ROOT', normalized, { reason: error.message });
  }

  const liveDevelopment = pin_mode === 'LIVE_DEVELOPMENT_PIN';
  const pinned = externalPinnedRootEntries(
    normalized,
    pinned_root_public_keys,
    expected_pinned_root_spki_sha256,
    liveDevelopment,
  );
  const threshold = verifyThreshold({
    normalized,
    signatures,
    keySource: pinned,
    threshold: normalized.manifest.root_signature_threshold,
    atMs: normalized.issued_at_ms,
  });
  if (!threshold.ok) {
    return receipt('HOLD_TRUST_ROOT', normalized, {
      reason: liveDevelopment
        ? 'LIVE_DEVELOPMENT_PIN_THRESHOLD_NOT_MET'
        : 'CONTROLLED_BOOTSTRAP_THRESHOLD_NOT_MET',
      verified_root_signature_count: threshold.verified,
      verified_root_key_ids: threshold.accepted,
    });
  }

  return receipt('TRUST_ROOT_ACCEPTED', normalized, {
    reason: liveDevelopment
      ? 'LIVE_DEVELOPMENT_PIN_MATERIAL_EXACT'
      : 'CONTROLLED_BOOTSTRAP_EXACT',
    verified_root_signature_count: threshold.verified,
    verified_root_key_ids: threshold.accepted,
    bootstrap_material_verified: true,
    live_development_pin_verified: liveDevelopment,
    production_bootstrap_proven: false,
  });
}

export function verifyClientC5SupervisorTrustRootTransition({
  current_manifest,
  candidate_manifest,
  candidate_signature_envelope,
  now = new Date(),
} = {}) {
  let current;
  let candidate;
  try {
    current = normalizeClientC5SupervisorTrustRoot(current_manifest, {
      now,
      require_unexpired: false,
    });
    candidate = normalizeClientC5SupervisorTrustRoot(candidate_manifest, { now });
  } catch (error) {
    return Object.freeze({
      schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA,
      action: 'HOLD_TRUST_ROOT',
      reason: error.message,
      trust_root_verified: false,
      bootstrap_material_verified: false,
      live_development_pin_verified: false,
      production_bootstrap_proven: false,
      live_effect_authorized: false,
      canonical_c2_promotion_authorized: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  if (
    candidate.manifest.generation !== current.manifest.generation + 1
    || candidate.manifest.previous_manifest_sha256 !== current.digest
    || candidate.issued_at_ms <= current.issued_at_ms
  ) {
    return receipt('HOLD_TRUST_ROOT', candidate, { reason: 'TRUST_ROOT_LINEAGE_OR_ROLLBACK_INVALID' });
  }

  let signatures;
  try {
    signatures = normalizeSignatureEnvelope(candidate_signature_envelope, candidate.digest);
  } catch (error) {
    return receipt('HOLD_TRUST_ROOT', candidate, { reason: error.message });
  }

  const oldThreshold = verifyThreshold({
    normalized: candidate,
    signatures,
    keySource: manifestKeyMap(current),
    threshold: current.manifest.root_signature_threshold,
    atMs: candidate.issued_at_ms,
  });
  if (!oldThreshold.ok) {
    return receipt('HOLD_TRUST_ROOT', candidate, {
      reason: 'OLD_ROOT_THRESHOLD_NOT_MET',
      old_verified_root_signature_count: oldThreshold.verified,
      old_verified_root_key_ids: oldThreshold.accepted,
    });
  }

  const newThreshold = verifyThreshold({
    normalized: candidate,
    signatures,
    keySource: manifestKeyMap(candidate),
    threshold: candidate.manifest.root_signature_threshold,
    atMs: candidate.issued_at_ms,
  });
  if (!newThreshold.ok) {
    return receipt('HOLD_TRUST_ROOT', candidate, {
      reason: 'NEW_ROOT_THRESHOLD_NOT_MET',
      old_verified_root_signature_count: oldThreshold.verified,
      new_verified_root_signature_count: newThreshold.verified,
      old_verified_root_key_ids: oldThreshold.accepted,
      new_verified_root_key_ids: newThreshold.accepted,
    });
  }

  return receipt('TRUST_ROOT_ACCEPTED', candidate, {
    reason: 'OLD_AND_NEW_ROOT_THRESHOLDS_EXACT',
    previous_manifest_sha256: current.digest,
    old_verified_root_signature_count: oldThreshold.verified,
    new_verified_root_signature_count: newThreshold.verified,
    old_verified_root_key_ids: oldThreshold.accepted,
    new_verified_root_key_ids: newThreshold.accepted,
  });
}

export function resolveClientC5SupervisorReadbackKey({
  manifest,
  key_id,
  evidence_issued_at,
  now = new Date(),
} = {}) {
  let normalized;
  try {
    normalized = normalizeClientC5SupervisorTrustRoot(manifest, { now });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error.message,
      key: null,
      key_id: String(key_id || ''),
      authority_effect: false,
    });
  }

  const issuedAt = parseUtc(evidence_issued_at);
  if (issuedAt === null) {
    return Object.freeze({
      ok: false,
      reason: 'EVIDENCE_ISSUED_AT_INVALID',
      key: null,
      key_id: String(key_id || ''),
      authority_effect: false,
    });
  }

  if (issuedAt < normalized.issued_at_ms) {
    return Object.freeze({
      ok: false,
      reason: 'SUPERVISOR_READBACK_EVIDENCE_PREDATES_TRUST_ROOT',
      key: null,
      key_id: String(key_id || ''),
      authority_effect: false,
    });
  }

  const entry = normalized.keys.find((candidate) => candidate.key_id === key_id);
  if (!entry || entry.role !== 'SUPERVISOR_READBACK') {
    return Object.freeze({
      ok: false,
      reason: 'SUPERVISOR_READBACK_KEY_NOT_FOUND',
      key: null,
      key_id: String(key_id || ''),
      authority_effect: false,
    });
  }

  if (issuedAt < entry._valid_from_ms || issuedAt >= entry._valid_until_ms) {
    return Object.freeze({
      ok: false,
      reason: 'SUPERVISOR_READBACK_KEY_OUTSIDE_CRYPTOPERIOD',
      key: null,
      key_id: entry.key_id,
      authority_effect: false,
    });
  }
  if (entry.state === 'RETIRED' && issuedAt >= entry._retired_at_ms) {
    return Object.freeze({
      ok: false,
      reason: 'SUPERVISOR_READBACK_KEY_RETIRED',
      key: null,
      key_id: entry.key_id,
      authority_effect: false,
    });
  }
  if (entry.state === 'REVOKED' && issuedAt >= entry._invalid_since_ms) {
    return Object.freeze({
      ok: false,
      reason: 'SUPERVISOR_READBACK_KEY_REVOKED_OR_COMPROMISED',
      key: null,
      key_id: entry.key_id,
      authority_effect: false,
    });
  }

  return Object.freeze({
    ok: true,
    reason: entry.state === 'ACTIVE'
      ? 'SUPERVISOR_READBACK_KEY_ACTIVE'
      : 'SUPERVISOR_READBACK_HISTORICAL_SIGNATURE_ALLOWED',
    key: entry._key_object,
    key_id: entry.key_id,
    key_state: entry.state,
    public_key_spki_sha256: entry.public_key_spki_sha256,
    trust_root_manifest_sha256: normalized.digest,
    trust_root_generation: normalized.manifest.generation,
    evidence_issued_at,
    authority_effect: false,
  });
}

export function buildClientC5SupervisorTrustResolutionReceipt({
  pin_mode,
  bootstrap_receipt,
  transition_receipt,
  resolved_key,
} = {}) {
  const liveDevelopment = pin_mode === 'LIVE_DEVELOPMENT_PIN';
  if (
    !PIN_MODES.has(pin_mode)
    || bootstrap_receipt?.schema !== CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA
    || bootstrap_receipt?.action !== 'TRUST_ROOT_ACCEPTED'
    || bootstrap_receipt?.bootstrap_material_verified !== true
    || bootstrap_receipt?.production_bootstrap_proven !== false
    || transition_receipt?.schema !== CLIENT_C5_SUPERVISOR_TRUST_ROOT_RECEIPT_SCHEMA
    || transition_receipt?.action !== 'TRUST_ROOT_ACCEPTED'
    || resolved_key?.ok !== true
    || resolved_key?.key_state !== 'ACTIVE'
    || !SHA256_RE.test(String(resolved_key?.public_key_spki_sha256 || ''))
  ) throw new Error('client_c5_supervisor_trust_resolution_material_invalid');

  if (liveDevelopment && bootstrap_receipt.live_development_pin_verified !== true) {
    throw new Error('client_c5_live_development_pin_not_verified');
  }
  if (!liveDevelopment && bootstrap_receipt.live_development_pin_verified !== false) {
    throw new Error('client_c5_controlled_pin_state_invalid');
  }

  return Object.freeze({
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_RESOLUTION_SCHEMA,
    trust_root_kind: pin_mode,
    bootstrap_manifest_sha256: bootstrap_receipt.manifest_sha256,
    candidate_manifest_sha256: transition_receipt.manifest_sha256,
    bootstrap_generation: bootstrap_receipt.generation,
    candidate_generation: transition_receipt.generation,
    old_root_threshold_verified: true,
    new_root_threshold_verified: true,
    supervisor_key_id: resolved_key.key_id,
    supervisor_key_state: resolved_key.key_state,
    supervisor_public_key_spki_sha256: resolved_key.public_key_spki_sha256,
    evidence_issued_at: resolved_key.evidence_issued_at,
    supervisor_key_resolved: true,
    bootstrap_material_verified: true,
    live_development_pin_verified: liveDevelopment,
    production_bootstrap_proven: false,
    live_effect_authorized: false,
    client_c5_live_useful_work_verified: false,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function clientC5SupervisorTrustRootContract() {
  return Object.freeze({
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
    canonical_owner: 'C2_FIRST_SERIAL_CODING_LOOP',
    monotonic_generation_required: true,
    expiry_required: true,
    root_signature_threshold_required: true,
    initial_bootstrap_requires_external_pinned_root: true,
    live_development_pin_digest_required: true,
    raw_material_cannot_claim_production_bootstrap: true,
    transition_requires_old_root_threshold: true,
    transition_requires_new_root_threshold: true,
    supervisor_keys_separate_from_root_role: true,
    key_lifecycle_states: Object.freeze(['ACTIVE', 'RETIRED', 'REVOKED']),
    historical_signature_time_binding_required: true,
    revoked_key_invalid_since_required: true,
    revoked_key_rejected_at_or_after_invalid_since: true,
    retired_key_rejected_at_or_after_retirement_time: true,
    private_key_material_allowed: false,
    live_effect_authorized: false,
    canonical_c2_promotion_authorized: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
