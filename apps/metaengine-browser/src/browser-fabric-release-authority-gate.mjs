export const BROWSER_FABRIC_RELEASE_GATE_SCHEMA = 'metaengine.browser-fabric.release-authority-gate.v1';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

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

/**
 * Pure promotion gate. It never changes live authority. A caller may only turn
 * its positive result into a separately journaled promotion effect.
 */
export function evaluateBrowserFabricReleaseAuthorityGate({
  candidate_sha,
  current_authority_sha,
  trusted_release,
  immutable_release_evidence,
  provenance_evidence,
} = {}) {
  const candidate = String(candidate_sha || '').toLowerCase();
  const current = String(current_authority_sha || '').toLowerCase();
  if (!GIT_SHA.test(candidate) || !GIT_SHA.test(current)) return hold('AUTHORITY_GIT_SHA_INVALID');
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

  const release = trusted_release;
  if (!release || release.schema !== 'metaengine.trusted-dev-release.v1') return hold('VERIFIED_RELEASE_REQUIRED');
  if (String(release.git_sha || '').toLowerCase() !== candidate) return hold('RELEASE_SOURCE_SHA_MISMATCH');
  if (!SHA256.test(String(release.installer_sha256 || '').toLowerCase())) return hold('RELEASE_INSTALLER_DIGEST_INVALID');
  if (!SHA256.test(String(release.manifest_sha256 || '').toLowerCase())) return hold('RELEASE_MANIFEST_DIGEST_INVALID');
  if (!SHA256.test(String(release.dev_yml_sha256 || '').toLowerCase())) return hold('RELEASE_FEED_DIGEST_INVALID');
  if (!SHA256.test(String(release.installed_executable_sha256 || '').toLowerCase())
      || release.target_present_proof_supported !== true) {
    return hold('RELEASE_INSTALLED_EXE_BINDING_REQUIRED');
  }
  if (release.authority_effect !== false) return hold('RELEASE_EVIDENCE_AUTHORITY_DRIFT');

  const immutable = immutable_release_evidence;
  if (!immutable
      || immutable.enabled !== true
      || immutable.tag_locked !== true
      || immutable.assets_locked !== true
      || immutable.attestation_verified !== true) {
    return hold('IMMUTABLE_RELEASE_PROOF_REQUIRED');
  }
  if (String(immutable.release_tag || '') !== String(release.tag || '')) return hold('IMMUTABLE_RELEASE_TAG_MISMATCH');
  if (String(immutable.commit_sha || '').toLowerCase() !== candidate) return hold('IMMUTABLE_RELEASE_COMMIT_MISMATCH');
  if (String(immutable.manifest_sha256 || '').toLowerCase() !== String(release.manifest_sha256).toLowerCase()) {
    return hold('IMMUTABLE_RELEASE_MANIFEST_MISMATCH');
  }

  const provenance = provenance_evidence;
  if (!provenance
      || provenance.verified !== true
      || provenance.builder_trusted !== true
      || provenance.source_sha !== candidate
      || String(provenance.subject_sha256 || '').toLowerCase() !== String(release.installer_sha256).toLowerCase()) {
    return hold('SLSA_PROVENANCE_PROOF_REQUIRED');
  }

  return Object.freeze({
    schema: BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
    action: 'AUTHORITY_ADVANCE_CANDIDATE',
    reason: 'VERIFIED_IMMUTABLE_RELEASE_EXACT',
    candidate_sha: candidate,
    release_tag: release.tag,
    release_version: release.version,
    installer_sha256: release.installer_sha256,
    installed_executable_sha256: release.installed_executable_sha256,
    manifest_sha256: release.manifest_sha256,
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
    promotion_unit: 'IMMUTABLE_VERIFIED_RELEASE',
    direct_authority_mutation_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
