export const BROWSER_FABRIC_RELEASE_GATE_SCHEMA = 'metaengine.browser-fabric.release-authority-gate.v1';
export const BROWSER_FABRIC_IMMUTABLE_RELEASE_EVIDENCE_SCHEMA = 'metaengine.browser-fabric.immutable-release-evidence.v1';
export const BROWSER_FABRIC_PROVENANCE_EVIDENCE_SCHEMA = 'metaengine.browser-fabric.provenance-evidence.v1';
export const BROWSER_FABRIC_ANCESTRY_EVIDENCE_SCHEMA = 'metaengine.browser-fabric.source-ancestry-evidence.v1';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

function hold(reason, extra = {}) {
  return Object.freeze({
    schema: BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
    action: 'HOLD_AUTHORITY',
    reason,
    authority_advance_candidate: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function exactKeys(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === names.length && keys.every((key) => names.includes(key));
}

function validEvidenceTime(value, nowMs) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function digest(value) {
  return String(value || '').toLowerCase();
}

function trustedReleaseViolation(release, candidate) {
  if (!release || release.schema !== 'metaengine.trusted-dev-release.v1') return 'VERIFIED_RELEASE_REQUIRED';
  if (String(release.git_sha || '').toLowerCase() !== candidate) return 'RELEASE_SOURCE_SHA_MISMATCH';
  if (!SAFE_ASSET_NAME.test(String(release.installer_name || ''))) return 'RELEASE_INSTALLER_NAME_INVALID';
  if (!SHA256.test(digest(release.installer_sha256))) return 'RELEASE_INSTALLER_DIGEST_INVALID';
  if (!SHA256.test(digest(release.manifest_sha256))) return 'RELEASE_MANIFEST_DIGEST_INVALID';
  if (!SHA256.test(digest(release.dev_yml_sha256))) return 'RELEASE_FEED_DIGEST_INVALID';
  if (!SHA256.test(digest(release.installed_executable_sha256))
      || release.target_present_proof_supported !== true) return 'RELEASE_INSTALLED_EXE_BINDING_REQUIRED';
  return release.authority_effect === false ? null : 'RELEASE_EVIDENCE_AUTHORITY_DRIFT';
}

function immutableEvidenceViolation(evidence, release, candidate, nowMs) {
  const keys = [
    'schema', 'verifier_id', 'verified_at', 'enabled', 'tag_locked', 'assets_locked',
    'attestation_verified', 'release_tag', 'commit_sha', 'manifest_sha256',
    'installer_sha256', 'installed_executable_sha256', 'authority_effect',
  ];
  if (!exactKeys(evidence, keys)
      || evidence.schema !== BROWSER_FABRIC_IMMUTABLE_RELEASE_EVIDENCE_SCHEMA
      || !SAFE_ID.test(String(evidence.verifier_id || ''))
      || !validEvidenceTime(evidence.verified_at, nowMs)
      || evidence.enabled !== true
      || evidence.tag_locked !== true
      || evidence.assets_locked !== true
      || evidence.attestation_verified !== true
      || evidence.authority_effect !== false) return 'IMMUTABLE_RELEASE_PROOF_REQUIRED';
  if (evidence.release_tag !== release.tag) return 'IMMUTABLE_RELEASE_TAG_MISMATCH';
  if (String(evidence.commit_sha || '').toLowerCase() !== candidate) return 'IMMUTABLE_RELEASE_COMMIT_MISMATCH';
  if (digest(evidence.manifest_sha256) !== digest(release.manifest_sha256)) {
    return 'IMMUTABLE_RELEASE_MANIFEST_MISMATCH';
  }
  if (digest(evidence.installer_sha256) !== digest(release.installer_sha256)) {
    return 'IMMUTABLE_RELEASE_INSTALLER_MISMATCH';
  }
  return digest(evidence.installed_executable_sha256) === digest(release.installed_executable_sha256)
    ? null
    : 'IMMUTABLE_RELEASE_INSTALLED_EXE_MISMATCH';
}

function provenanceEvidenceViolation(evidence, release, candidate, nowMs) {
  const keys = [
    'schema', 'verifier_id', 'verified_at', 'verified', 'builder_trusted',
    'builder_id', 'source_sha', 'subject_name', 'subject_sha256',
    'predicate_type', 'authority_effect',
  ];
  if (!exactKeys(evidence, keys)
      || evidence.schema !== BROWSER_FABRIC_PROVENANCE_EVIDENCE_SCHEMA
      || !SAFE_ID.test(String(evidence.verifier_id || ''))
      || !SAFE_ID.test(String(evidence.builder_id || ''))
      || !validEvidenceTime(evidence.verified_at, nowMs)
      || evidence.verified !== true
      || evidence.builder_trusted !== true
      || evidence.predicate_type !== SLSA_PROVENANCE_V1
      || evidence.authority_effect !== false) return 'SLSA_PROVENANCE_PROOF_REQUIRED';
  if (String(evidence.source_sha || '').toLowerCase() !== candidate) return 'SLSA_PROVENANCE_SOURCE_MISMATCH';
  if (evidence.subject_name !== release.installer_name) return 'SLSA_PROVENANCE_SUBJECT_NAME_MISMATCH';
  return digest(evidence.subject_sha256) === digest(release.installer_sha256)
    ? null
    : 'SLSA_PROVENANCE_SUBJECT_DIGEST_MISMATCH';
}

function ancestryEvidenceViolation(evidence, current, candidate, nowMs) {
  const keys = [
    'schema', 'verifier_id', 'verified_at', 'base_sha', 'candidate_sha',
    'fast_forward_verified', 'authority_effect',
  ];
  if (!exactKeys(evidence, keys)
      || evidence.schema !== BROWSER_FABRIC_ANCESTRY_EVIDENCE_SCHEMA
      || !SAFE_ID.test(String(evidence.verifier_id || ''))
      || !validEvidenceTime(evidence.verified_at, nowMs)
      || evidence.fast_forward_verified !== true
      || evidence.authority_effect !== false) return 'SOURCE_FAST_FORWARD_PROOF_REQUIRED';
  if (String(evidence.base_sha || '').toLowerCase() !== current) return 'SOURCE_ANCESTRY_BASE_MISMATCH';
  return String(evidence.candidate_sha || '').toLowerCase() === candidate
    ? null
    : 'SOURCE_ANCESTRY_CANDIDATE_MISMATCH';
}

/**
 * Pure promotion gate. It never changes live authority. A positive result is
 * still only material for a separately journaled promotion effect.
 */
export function evaluateBrowserFabricReleaseAuthorityGate({
  candidate_sha,
  current_authority_sha,
  trusted_release,
  immutable_release_evidence,
  provenance_evidence,
  source_ancestry_evidence,
  now = new Date(),
} = {}) {
  const candidate = String(candidate_sha || '').toLowerCase();
  const current = String(current_authority_sha || '').toLowerCase();
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!GIT_SHA.test(candidate) || !GIT_SHA.test(current)) return hold('AUTHORITY_GIT_SHA_INVALID');
  if (!Number.isFinite(nowMs)) return hold('AUTHORITY_EVIDENCE_TIME_INVALID');
  if (candidate === current) return Object.freeze({
    schema: BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
    action: 'NOOP_AUTHORITY_EXACT',
    reason: 'AUTHORITY_ALREADY_EXACT',
    candidate_sha: candidate,
    authority_advance_candidate: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });

  const releaseViolation = trustedReleaseViolation(trusted_release, candidate);
  if (releaseViolation) return hold(releaseViolation);
  const immutableViolation = immutableEvidenceViolation(
    immutable_release_evidence,
    trusted_release,
    candidate,
    nowMs,
  );
  if (immutableViolation) return hold(immutableViolation);
  const provenanceViolation = provenanceEvidenceViolation(
    provenance_evidence,
    trusted_release,
    candidate,
    nowMs,
  );
  if (provenanceViolation) return hold(provenanceViolation);
  const ancestryViolation = ancestryEvidenceViolation(source_ancestry_evidence, current, candidate, nowMs);
  if (ancestryViolation) return hold(ancestryViolation);

  return Object.freeze({
    schema: BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
    action: 'AUTHORITY_ADVANCE_CANDIDATE',
    reason: 'VERIFIED_IMMUTABLE_RELEASE_AND_ANCESTRY_EXACT',
    candidate_sha: candidate,
    release_tag: trusted_release.tag,
    release_version: trusted_release.version,
    installer_sha256: digest(trusted_release.installer_sha256),
    installed_executable_sha256: digest(trusted_release.installed_executable_sha256),
    manifest_sha256: digest(trusted_release.manifest_sha256),
    immutable_evidence_verifier_id: immutable_release_evidence.verifier_id,
    provenance_verifier_id: provenance_evidence.verifier_id,
    ancestry_verifier_id: source_ancestry_evidence.verifier_id,
    authority_advance_candidate: true,
    promotion_unit: 'IMMUTABLE_VERIFIED_RELEASE',
    requires_separate_journaled_promotion_effect: true,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function browserFabricReleaseGateContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
    git_sha_alone_sufficient: false,
    trusted_release_required: true,
    installed_executable_binding_required: true,
    immutable_release_required: true,
    immutable_release_attestation_required: true,
    provenance_required: true,
    provenance_source_sha_exact: true,
    provenance_subject_name_and_digest_exact: true,
    independent_fast_forward_proof_required: true,
    typed_evidence_schemas_required: true,
    future_dated_evidence_forbidden: true,
    promotion_unit: 'IMMUTABLE_VERIFIED_RELEASE',
    direct_authority_mutation_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
