// W11 Wave 2: read-only NEGATIVE provenance conformance.
// A caller's JSON receipt, verified flag, or Host observation is not an issuer,
// signature verification, native readback, or process-code attestation.
// This module deliberately has no success/authentication capability.
import { verifyReleaseEvidenceIdentity } from './operator-release-evidence-identity.mjs';
import { reduceHostProcessObservation, OPERATOR_HOST_SOURCE, OPERATOR_HOST_EVIDENCE_SCHEMA } from './operator-host-incarnation-core.mjs';
import { PROOF_SCHEMA as EXISTING_RELEASE_ATTESTATION_SCHEMA } from '../../scripts/release-attestation-verification.mjs';

export const RELEASE_WITNESS_PROVENANCE_SCHEMA = 'metaengine.operator.release-witness-provenance.v1';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FRESH_MS = 30_000;
const HOST_FRESH_MS = 10_000;
const SAFE_FLAGS = Object.freeze([
  'verified', 'signature_verified', 'cryptographic_verification',
  'trusted', 'issuer_trusted', 'authenticated', 'signer_identity_verified',
]);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const time = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const output = (state, reasons, identityState) => Object.freeze({
  schema: RELEASE_WITNESS_PROVENANCE_SCHEMA,
  state,
  identity_consistency: identityState,
  authenticity: 'UNKNOWN',
  trusted_issuer_proven: false,
  trusted_runtime_proven: false,
  provenance_cryptographically_verified: false,
  release_ready: false,
  installed_runtime_proven: false,
  authority_effect: false,
  scheduler_authority: false,
  automatic_retry_allowed: false,
  remote_fallback_allowed: false,
  reasons: Object.freeze([...new Set(reasons)].sort()),
});

// Data-only access: never run a caller-supplied getter to "read" an attestation.
function field(value, key) {
  if (!object(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw Error('PROVENANCE_ACCESSOR');
  return descriptor.value;
}
function claimedFlag(value) {
  if (!object(value)) return false;
  return SAFE_FLAGS.some(key => field(value, key) === true);
}
function compare(value, expected, format, blocked, missing, tag) {
  if (value === undefined || value === null || value === '') { missing.add(tag + '_MISSING'); return; }
  if (typeof value !== 'string' || !format.test(value)) { blocked.add(tag + '_MALFORMED'); return; }
  if (typeof expected === 'string' && format.test(expected) && value !== expected) blocked.add(tag + '_MISMATCH');
}

/**
 * All arguments are untrusted observations. The only authoritative source of
 * provenance would be a separately attested in-process issuer/Host adapter,
 * which is deliberately NOT installed here. Even a valid existing-schema
 * receipt + positive Host reducer is at most structurally consistent.
 *
 * Contradictions BLOCKED. Missing evidence UNKNOWN. No AUTHENTIC/READY result.
 */
export function inspectReleaseWitnessProvenance(
  { witnesses, issuerEvidence, hostObservation } = {},
  { nowMs = Date.now(), maxAgeMs = FRESH_MS } = {},
) {
  const blocked = new Set();
  const missing = new Set();
  let identityState = 'UNKNOWN';
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(maxAgeMs)
      || maxAgeMs < 1000 || maxAgeMs > FRESH_MS) {
    return output('BLOCKED', ['PROVENANCE_POLICY_INVALID'], identityState);
  }
  try {
    const comparison = verifyReleaseEvidenceIdentity(witnesses, { nowMs, maxAgeMs });
    identityState = comparison.state;
    if (comparison.state === 'BLOCKED') blocked.add('RELEASE_IDENTITY_CONFLICT');
    else if (comparison.state !== 'MATCH') missing.add('RELEASE_IDENTITY_INCOMPLETE');

    // A self-reported verified/signed bit is an inert field, never a trust root.
    if (object(witnesses)) {
      for (const label of ['expected', 'source', 'build', 'package', 'runtime', 'owner', 'artifact']) {
        if (claimedFlag(field(witnesses, label))) missing.add('SELF_ASSERTED_VERIFICATION_IGNORED');
      }
    }
    if (issuerEvidence == null) {
      missing.add('TRUSTED_ISSUER_ABSENT');
    } else if (!object(issuerEvidence)) {
      blocked.add('ISSUER_RECEIPT_MALFORMED');
    } else {
      // Existing GitHub release attestation verifier emits a SEMANTIC receipt.
      // The receipt's true flags/hashed root can be copied by a hostile caller.
      // Do not invoke it on raw JSON or accept its receipt as signature authority.
      const schema = field(issuerEvidence, 'schema');
      if (schema !== EXISTING_RELEASE_ATTESTATION_SCHEMA) blocked.add('ISSUER_RECEIPT_SCHEMA_MISMATCH');
      const repository = field(issuerEvidence, 'repository');
      if (repository == null) missing.add('ISSUER_REPOSITORY_MISSING');
      else if (repository !== 'PatrickFrome/Compute') blocked.add('ISSUER_REPOSITORY_MISMATCH');
      const wExpected = field(witnesses, 'expected');
      const wArtifact = field(witnesses, 'artifact');
      compare(field(issuerEvidence, 'source_head'), field(wExpected, 'git_sha'), SHA40,
        blocked, missing, 'ISSUER_SOURCE');
      compare(field(issuerEvidence, 'installer_sha256'), field(wArtifact, 'sha256'), SHA256,
        blocked, missing, 'ISSUER_ARTIFACT');
      // Trusted root DIGEST is just data, never key material or proof of the root.
      const rootDigest = field(issuerEvidence, 'trusted_root_sha256');
      if (rootDigest == null) missing.add('ISSUER_ROOT_DIGEST_MISSING');
      else if (typeof rootDigest !== 'string' || !SHA256.test(rootDigest)) blocked.add('ISSUER_ROOT_DIGEST_MALFORMED');
      if (field(issuerEvidence, 'authority_effect') !== false
          || field(issuerEvidence, 'promotion_authorized') !== false
          || field(issuerEvidence, 'release_published') !== false) blocked.add('ISSUER_AUTHORITY_DRIFT');
      // Every raw receipt lacks authentic origin, including "verified: true".
      missing.add('ISSUER_ORIGIN_NOT_AUTHENTICATED');
    }

    if (hostObservation == null) {
      missing.add('TRUSTED_HOST_READBACK_ABSENT');
    } else if (!object(hostObservation)) {
      blocked.add('HOST_READBACK_MALFORMED');
    } else if (['schema','source','owner','browser','guardian','runtime_probe',
      'owner_runtime_probe','heartbeat_fence','guardian_health_observed_at','observed_at']
      .some(key => field(hostObservation, key) == null)) {
      // Absence of an OS/Guardian callback is UNKNOWN, not a forged-negative.
      // Present mismatching data cannot hide behind an incomplete witness.
      missing.add('TRUSTED_HOST_READBACK_INCOMPLETE');
      const schema = field(hostObservation, 'schema');
      const source = field(hostObservation, 'source');
      if (schema != null && schema !== OPERATOR_HOST_EVIDENCE_SCHEMA)
        blocked.add('HOST_READBACK_SCHEMA_MISMATCH');
      if (source != null && source !== OPERATOR_HOST_SOURCE)
        blocked.add('HOST_READBACK_SOURCE_MISMATCH');
      const browserIncarnation = field(field(hostObservation, 'browser'), 'process_incarnation_id');
      const expectedIncarnation = field(field(witnesses, 'runtime'), 'process_incarnation');
      if (browserIncarnation != null && expectedIncarnation != null && browserIncarnation !== expectedIncarnation)
        blocked.add('RUNTIME_INCARNATION_MISMATCH');
      const hostOwnerId = field(field(hostObservation, 'owner'), 'owner_id');
      const expectedOwnerId = field(field(witnesses, 'expected'), 'owner_id');
      if (hostOwnerId != null && expectedOwnerId != null && hostOwnerId !== expectedOwnerId)
        blocked.add('HOST_OWNER_MISMATCH');
    } else {
      // Reuse the existing Guardian/OS PID+birth/heartbeat fence, not a new
      // process authority. Its acceptance of JSON never proves who produced it.
      const host = reduceHostProcessObservation(hostObservation, {
        nowMs, maxAgeMs: Math.min(maxAgeMs, HOST_FRESH_MS),
      });
      if (host.state === 'STALE') blocked.add('HOST_RUNTIME_STALE');
      else if (host.state === 'AMBIGUOUS') blocked.add('HOST_RUNTIME_INCARNATION_AMBIGUOUS');
      else if (host.state === 'UNVERIFIED' || host.state === 'BLOCKED' || host.state === 'OFFLINE')
        blocked.add('HOST_RUNTIME_FENCE_REJECTED');
      else if (host.state !== 'AVAILABLE') missing.add('TRUSTED_HOST_READBACK_INCOMPLETE');
      else {
        const browser = field(hostObservation, 'browser');
        const owner = field(hostObservation, 'owner');
        const runtime = field(witnesses, 'runtime');
        const expected = field(witnesses, 'expected');
        const nativeBrowserIncarnation = field(browser, 'process_incarnation_id');
        const runtimeIncarnation = field(runtime, 'process_incarnation');
        const expectedIncarnation = field(expected, 'process_incarnation');
        if (typeof runtimeIncarnation === 'string' && typeof nativeBrowserIncarnation === 'string'
            && runtimeIncarnation !== nativeBrowserIncarnation) blocked.add('RUNTIME_INCARNATION_MISMATCH');
        if (typeof expectedIncarnation === 'string' && typeof nativeBrowserIncarnation === 'string'
            && expectedIncarnation !== nativeBrowserIncarnation) blocked.add('RUNTIME_INCARNATION_MISMATCH');
        if (typeof field(expected, 'owner_id') === 'string' && typeof field(owner, 'owner_id') === 'string'
            && field(expected, 'owner_id') !== field(owner, 'owner_id')) blocked.add('HOST_OWNER_MISMATCH');
        const birth = time(field(browser, 'created_at'));
        const snapshot = time(field(runtime, 'observed_at'));
        if (birth !== null && snapshot !== null && snapshot < birth)
          blocked.add('RUNTIME_SNAPSHOT_PRECEDES_PROCESS_BIRTH');
        // No trust elevation even if a forged complete Guardian/OS payload
        // passes all structural gates. Producer provenance is still missing.
        missing.add('HOST_OBSERVATION_ORIGIN_NOT_AUTHENTICATED');
      }
    }
  } catch {
    blocked.add('PROVENANCE_READBACK_INVALID');
  }
  if (blocked.size) return output('BLOCKED', [...blocked], identityState);
  // This guard has no privileged issuer/Host path by design.
  return output('UNKNOWN', [...missing], identityState);
}
