const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function required(value, reason) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(reason);
  return normalized;
}

export function verifiedReleaseAuthorityGate({ desired_source_sha, release, current_authority_sha = null } = {}) {
  const desired = required(desired_source_sha, 'release_authority_desired_sha_required').toLowerCase();
  if (!GIT_SHA.test(desired)) throw new Error('release_authority_desired_sha_invalid');
  const current = current_authority_sha == null ? null : String(current_authority_sha).trim().toLowerCase();
  if (current && !GIT_SHA.test(current)) throw new Error('release_authority_current_sha_invalid');

  const target = String(release?.target_commitish || '').trim().toLowerCase();
  const artifactDigest = String(release?.artifact_sha256 || '').trim().toLowerCase().replace(/^sha256:/, '');
  const artifactSize = Number(release?.artifact_size || 0);
  const verified = release?.immutable === true
    && release?.draft === false
    && release?.verified_physical_update === true
    && release?.manifest_verified === true
    && release?.provenance_verified === true
    && release?.signature_verified === true
    && release?.freshness_verified === true
    && target === desired
    && SHA256.test(artifactDigest)
    && Number.isSafeInteger(artifactSize)
    && artifactSize > 0;

  if (!verified) {
    return Object.freeze({
      action: 'HOLD_AUTHORITY',
      reason: 'VERIFIED_IMMUTABLE_RELEASE_REQUIRED',
      desired_source_sha: desired,
      current_authority_sha: current,
      release_target_sha: target || null,
      authority_advance_allowed: false,
      release_authority: false,
      authority_effect: false,
    });
  }

  if (current === desired) {
    return Object.freeze({
      action: 'NOOP_AUTHORITY_EXACT',
      reason: 'AUTHORITY_ALREADY_BINDS_VERIFIED_RELEASE',
      desired_source_sha: desired,
      artifact_sha256: artifactDigest,
      artifact_size: artifactSize,
      authority_advance_allowed: false,
      release_authority: false,
      authority_effect: false,
    });
  }

  return Object.freeze({
    action: 'AUTHORITY_ADVANCE_CANDIDATE',
    reason: 'VERIFIED_IMMUTABLE_RELEASE_EXACT',
    desired_source_sha: desired,
    artifact_sha256: artifactDigest,
    artifact_size: artifactSize,
    release_id: required(release?.release_id, 'release_authority_release_id_required'),
    authority_advance_allowed: false,
    requires_external_authority_executor: true,
    exact_release_readback_required: true,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export const VERIFIED_RELEASE_AUTHORITY_CONTRACT = Object.freeze({
  schema: 'metaengine.verified-release-authority-gate.v1',
  git_sha_alone_is_insufficient: true,
  immutable_release_required: true,
  physical_update_proof_required: true,
  manifest_provenance_signature_freshness_required: true,
  exact_digest_size_required: true,
  planner_has_release_authority: false,
  automatic_retry_allowed: false,
});
