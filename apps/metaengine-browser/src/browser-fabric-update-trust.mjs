import { canonicalFabricJson, fabricSha256 } from './browser-fabric-effect-ledger.mjs';

export const BROWSER_FABRIC_UPDATE_TRUST_SCHEMA = 'metaengine.browser-fabric.update-trust.v1';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function fail(reason, details = {}) {
  return Object.freeze({
    ok: false,
    schema: BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
    reason,
    verified_immutable_release_exact: false,
    authority_effect: false,
    automatic_retry_allowed: false,
    ...details,
  });
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function fresh(expiresAt, nowMs) {
  if (typeof expiresAt !== 'string' || !UTC.test(expiresAt)) return false;
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

function signedDescriptor(signed) {
  const bytes = Buffer.from(canonicalFabricJson(signed), 'utf8');
  return Object.freeze({
    sha256: fabricSha256(bytes),
    size: bytes.byteLength,
  });
}

function roleEnvelope(value, role, nowMs, trustedFloor = 0) {
  if (!value || value.role !== role || value.signatures_verified !== true) return null;
  if (!value.signed || typeof value.signed !== 'object' || Array.isArray(value.signed)) return null;
  if (!positiveInteger(value.signed.version) || value.signed.version < trustedFloor) return null;
  if (!fresh(value.signed.expires_at, nowMs)) return null;
  return Object.freeze({
    role,
    version: value.signed.version,
    signed: value.signed,
    descriptor: signedDescriptor(value.signed),
  });
}

function exactMetaBinding(binding, role) {
  return binding
    && positiveInteger(binding.version)
    && SHA256.test(String(binding.sha256 || ''))
    && positiveInteger(binding.size)
    && String(binding.role || '') === role;
}

function exactArtifactDescriptor(value) {
  return value
    && SHA256.test(String(value.sha256 || '').toLowerCase())
    && positiveInteger(value.size)
    && typeof value.media_type === 'string'
    && value.media_type.length > 0
    && value.media_type.length <= 255
    && GIT_SHA.test(String(value.source_sha || '').toLowerCase());
}

/**
 * Pure verification of the evidence graph required before a Browser artifact can
 * be considered an immutable release candidate. Cryptographic role signature
 * verification is deliberately supplied as independent evidence; this module
 * verifies freshness, rollback floors, metadata hash/size bindings and exact
 * artifact/provenance/transparency identity. It performs no network, file,
 * release, Browser, SCM or WTS effect.
 */
export function evaluateBrowserFabricUpdateTrust({
  now = new Date(),
  trusted_versions = {},
  root,
  targets,
  snapshot,
  timestamp,
  target_path,
  provenance,
  transparency,
  platform_signature_verified = false,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return fail('UPDATE_TRUST_NOW_INVALID');

  const floors = {
    root: Number(trusted_versions.root || 0),
    targets: Number(trusted_versions.targets || 0),
    snapshot: Number(trusted_versions.snapshot || 0),
    timestamp: Number(trusted_versions.timestamp || 0),
  };
  if (Object.values(floors).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return fail('UPDATE_TRUST_VERSION_FLOOR_INVALID');
  }

  const rootRole = roleEnvelope(root, 'root', nowMs, floors.root);
  if (!rootRole) return fail('TUF_ROOT_INVALID_EXPIRED_OR_ROLLED_BACK');
  if (root.thresholds_verified !== true || root.rollback_protection_verified !== true) {
    return fail('TUF_ROOT_THRESHOLD_OR_ROLLBACK_PROOF_REQUIRED');
  }
  if (rootRole.version > floors.root && root.rotation_verified !== true) {
    return fail('TUF_ROOT_ROTATION_NOT_VERIFIED');
  }

  const targetsRole = roleEnvelope(targets, 'targets', nowMs, floors.targets);
  if (!targetsRole) return fail('TUF_TARGETS_INVALID_EXPIRED_OR_ROLLED_BACK');
  const snapshotRole = roleEnvelope(snapshot, 'snapshot', nowMs, floors.snapshot);
  if (!snapshotRole) return fail('TUF_SNAPSHOT_INVALID_EXPIRED_OR_ROLLED_BACK');
  const timestampRole = roleEnvelope(timestamp, 'timestamp', nowMs, floors.timestamp);
  if (!timestampRole) return fail('TUF_TIMESTAMP_INVALID_EXPIRED_OR_ROLLED_BACK');

  const targetsBinding = snapshotRole.signed?.meta?.targets;
  if (!exactMetaBinding(targetsBinding, 'targets')
      || targetsBinding.version !== targetsRole.version
      || targetsBinding.sha256 !== targetsRole.descriptor.sha256
      || targetsBinding.size !== targetsRole.descriptor.size) {
    return fail('TUF_SNAPSHOT_TARGETS_BINDING_MISMATCH');
  }

  const snapshotBinding = timestampRole.signed?.meta?.snapshot;
  if (!exactMetaBinding(snapshotBinding, 'snapshot')
      || snapshotBinding.version !== snapshotRole.version
      || snapshotBinding.sha256 !== snapshotRole.descriptor.sha256
      || snapshotBinding.size !== snapshotRole.descriptor.size) {
    return fail('TUF_TIMESTAMP_SNAPSHOT_BINDING_MISMATCH');
  }

  const path = String(target_path || '');
  if (!path || path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
    return fail('TUF_TARGET_PATH_INVALID');
  }
  const artifact = targetsRole.signed?.targets?.[path];
  if (!exactArtifactDescriptor(artifact)) return fail('TUF_TARGET_DESCRIPTOR_INVALID');
  const artifactSha = String(artifact.sha256).toLowerCase();
  const sourceSha = String(artifact.source_sha).toLowerCase();

  if (!provenance
      || provenance.verified !== true
      || provenance.builder_trusted !== true
      || String(provenance.subject_sha256 || '').toLowerCase() !== artifactSha
      || Number(provenance.subject_size) !== artifact.size
      || String(provenance.source_sha || '').toLowerCase() !== sourceSha) {
    return fail('SLSA_PROVENANCE_ARTIFACT_BINDING_MISMATCH');
  }

  if (!transparency
      || transparency.verified !== true
      || String(transparency.subject_sha256 || '').toLowerCase() !== artifactSha
      || !Number.isFinite(Number(transparency.integrated_time_ms))
      || Number(transparency.integrated_time_ms) > nowMs) {
    return fail('TRANSPARENCY_PROOF_INVALID_OR_UNBOUND');
  }

  if (platform_signature_verified !== true) return fail('PLATFORM_SIGNATURE_REQUIRED');

  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
    reason: 'IMMUTABLE_RELEASE_TRUST_CHAIN_EXACT',
    verified_immutable_release_exact: true,
    target_path: path,
    source_sha: sourceSha,
    artifact_sha256: artifactSha,
    artifact_size: artifact.size,
    artifact_media_type: artifact.media_type,
    metadata_versions: Object.freeze({
      root: rootRole.version,
      targets: targetsRole.version,
      snapshot: snapshotRole.version,
      timestamp: timestampRole.version,
    }),
    metadata_chain: Object.freeze({
      targets_sha256: targetsRole.descriptor.sha256,
      targets_size: targetsRole.descriptor.size,
      snapshot_sha256: snapshotRole.descriptor.sha256,
      snapshot_size: snapshotRole.descriptor.size,
    }),
    rollback_protected: true,
    freeze_protected: true,
    mix_and_match_protected: true,
    artifact_digest_and_size_exact: true,
    provenance_exact: true,
    transparency_exact: true,
    platform_signature_verified: true,
    cryptographic_role_verification_is_independent_evidence: true,
    authority_effect: false,
    automatic_retry_allowed: false,
  });
}

export function browserFabricUpdateTrustContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
    tuf_roles_required: Object.freeze(['root', 'targets', 'snapshot', 'timestamp']),
    metadata_signature_evidence_required: true,
    root_threshold_and_rotation_evidence_required: true,
    metadata_expiry_required: true,
    monotonic_version_floors_required: true,
    snapshot_binds_targets_digest_size_version: true,
    timestamp_binds_snapshot_digest_size_version: true,
    target_descriptor_binds_digest_size_media_type_source: true,
    slsa_provenance_exact_subject_required: true,
    transparency_exact_subject_required: true,
    platform_signature_required: true,
    git_sha_alone_sufficient: false,
    direct_release_or_authority_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
