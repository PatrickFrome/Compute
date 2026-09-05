import { canonicalFabricJson, fabricSha256 } from './browser-fabric-effect-ledger.mjs';
import { BROWSER_FABRIC_PROVENANCE_EVIDENCE_SCHEMA } from './browser-fabric-release-authority-gate.mjs';

export const BROWSER_FABRIC_UPDATE_TRUST_SCHEMA = 'metaengine.browser-fabric.update-trust.v2';
export const BROWSER_FABRIC_TUF_RECEIPT_SCHEMA = 'metaengine.browser-fabric.tuf-role-verification-receipt.v1';
export const BROWSER_FABRIC_PROVENANCE_RECEIPT_SCHEMA = 'metaengine.browser-fabric.provenance-verification-receipt.v1';
export const BROWSER_FABRIC_TRANSPARENCY_RECEIPT_SCHEMA = 'metaengine.browser-fabric.transparency-verification-receipt.v1';
export const BROWSER_FABRIC_PLATFORM_SIGNATURE_RECEIPT_SCHEMA = 'metaengine.browser-fabric.platform-signature-verification-receipt.v1';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
const SIGSTORE_PROFILE = 'SIGSTORE_BUNDLE_SIGNATURE_IDENTITY_TLOG_V1';
const PLATFORM_PROFILE = 'PLATFORM_SIGNATURE_CHAIN_V1';

const TUF_RECEIPT_KEYS = Object.freeze([
  'schema', 'verifier_id', 'verified_at', 'evidence_sha256', 'role',
  'signed_sha256', 'signed_size', 'metadata_version', 'expires_at',
  'trusted_root_sha256', 'signature_threshold_verified',
  'root_rotation_verified', 'authority_effect',
]);
const PROVENANCE_RECEIPT_KEYS = Object.freeze([
  'schema', 'verifier_id', 'verified_at', 'evidence_sha256', 'predicate_type',
  'builder_id', 'builder_trusted', 'subject_name', 'subject_sha256',
  'subject_size', 'source_sha', 'authority_effect',
]);
const TRANSPARENCY_RECEIPT_KEYS = Object.freeze([
  'schema', 'verifier_id', 'verified_at', 'evidence_sha256',
  'verification_profile', 'bundle_sha256', 'log_id', 'subject_sha256',
  'integrated_time_ms', 'authority_effect',
]);
const PLATFORM_RECEIPT_KEYS = Object.freeze([
  'schema', 'verifier_id', 'verified_at', 'evidence_sha256',
  'verification_profile', 'subject_sha256', 'subject_size',
  'signer_identity', 'authority_effect',
]);

function fail(reason, details = {}) {
  return Object.freeze({
    ok: false,
    schema: BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
    reason,
    verified_immutable_release_exact: false,
    release_authority: false,
    authority_effect: false,
    automatic_retry_allowed: false,
    ...details,
  });
}

function exactKeys(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === names.length && keys.every((key) => names.includes(key));
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function utcMillis(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceTimeValid(value, nowMs) {
  const parsed = utcMillis(value);
  return parsed !== null && parsed <= nowMs;
}

function safeIdentity(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function signedDescriptor(signed) {
  const canonical = canonicalFabricJson(signed);
  return Object.freeze({
    sha256: fabricSha256(canonical),
    size: Buffer.byteLength(canonical, 'utf8'),
  });
}

function normalizeTrustedState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = ['root_version', 'targets_version', 'snapshot_version', 'timestamp_version', 'root_sha256'];
  if (!exactKeys(value, keys)) return null;
  if (![value.root_version, value.targets_version, value.snapshot_version, value.timestamp_version].every(nonNegativeInteger)) return null;
  if (!SHA256.test(String(value.root_sha256 || '').toLowerCase())) return null;
  return Object.freeze({
    root_version: value.root_version,
    targets_version: value.targets_version,
    snapshot_version: value.snapshot_version,
    timestamp_version: value.timestamp_version,
    root_sha256: String(value.root_sha256).toLowerCase(),
  });
}

function validateTufReceipt({ receipt, role, signed, descriptor, floor, trustedRootSha, currentRootSha, nowMs }) {
  if (!exactKeys(receipt, TUF_RECEIPT_KEYS)
      || receipt.schema !== BROWSER_FABRIC_TUF_RECEIPT_SCHEMA
      || !safeIdentity(receipt.verifier_id)
      || !evidenceTimeValid(receipt.verified_at, nowMs)
      || !SHA256.test(String(receipt.evidence_sha256 || '').toLowerCase())
      || receipt.role !== role
      || String(receipt.signed_sha256 || '').toLowerCase() !== descriptor.sha256
      || receipt.signed_size !== descriptor.size
      || receipt.metadata_version !== signed.version
      || receipt.expires_at !== signed.expires_at
      || receipt.signature_threshold_verified !== true
      || receipt.authority_effect !== false) {
    return `${role.toUpperCase()}_VERIFICATION_RECEIPT_INVALID_OR_UNBOUND`;
  }

  const receiptRoot = String(receipt.trusted_root_sha256 || '').toLowerCase();
  if (!SHA256.test(receiptRoot)) return `${role.toUpperCase()}_TRUST_ROOT_BINDING_INVALID`;

  if (role === 'root') {
    if (signed.version < floor) return 'TUF_ROOT_ROLLBACK_DETECTED';
    if (signed.version === floor) {
      if (descriptor.sha256 !== trustedRootSha || receiptRoot !== trustedRootSha) return 'TUF_ROOT_TRUST_ANCHOR_MISMATCH';
      if (receipt.root_rotation_verified !== false) return 'TUF_ROOT_FALSE_ROTATION_CLAIM';
    } else {
      if (receiptRoot !== trustedRootSha || receipt.root_rotation_verified !== true) return 'TUF_ROOT_ROTATION_RECEIPT_REQUIRED';
    }
    return null;
  }

  if (signed.version < floor) return `TUF_${role.toUpperCase()}_ROLLBACK_DETECTED`;
  if (receiptRoot !== currentRootSha) return `TUF_${role.toUpperCase()}_ROOT_BINDING_MISMATCH`;
  if (receipt.root_rotation_verified !== false) return `TUF_${role.toUpperCase()}_ROOT_ROTATION_CLAIM_FORBIDDEN`;
  return null;
}

function validateTufRole({ metadata, receipt, role, floor, trustedRootSha, currentRootSha, nowMs }) {
  if (!metadata || metadata.role !== role || !metadata.signed || typeof metadata.signed !== 'object' || Array.isArray(metadata.signed)) {
    return { error: `TUF_${role.toUpperCase()}_METADATA_INVALID` };
  }
  const signed = metadata.signed;
  const expiresMs = utcMillis(signed.expires_at);
  if (!positiveInteger(signed.version) || expiresMs === null || expiresMs <= nowMs) {
    return { error: `TUF_${role.toUpperCase()}_EXPIRED_OR_VERSION_INVALID` };
  }
  const descriptor = signedDescriptor(signed);
  const error = validateTufReceipt({ receipt, role, signed, descriptor, floor, trustedRootSha, currentRootSha, nowMs });
  return error ? { error } : { role, signed, descriptor, receipt };
}

function exactMetaBinding(binding, role) {
  return binding
    && typeof binding === 'object'
    && !Array.isArray(binding)
    && exactKeys(binding, ['role', 'version', 'sha256', 'size'])
    && binding.role === role
    && positiveInteger(binding.version)
    && SHA256.test(String(binding.sha256 || '').toLowerCase())
    && positiveInteger(binding.size);
}

function exactArtifactDescriptor(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && exactKeys(value, ['sha256', 'size', 'media_type', 'source_sha'])
    && SHA256.test(String(value.sha256 || '').toLowerCase())
    && positiveInteger(value.size)
    && typeof value.media_type === 'string'
    && value.media_type.length > 0
    && value.media_type.length <= 255
    && GIT_SHA.test(String(value.source_sha || '').toLowerCase());
}

function validateProvenanceReceipt(receipt, artifact, targetPath, nowMs) {
  if (!exactKeys(receipt, PROVENANCE_RECEIPT_KEYS)
      || receipt.schema !== BROWSER_FABRIC_PROVENANCE_RECEIPT_SCHEMA
      || !safeIdentity(receipt.verifier_id)
      || !safeIdentity(receipt.builder_id)
      || !evidenceTimeValid(receipt.verified_at, nowMs)
      || !SHA256.test(String(receipt.evidence_sha256 || '').toLowerCase())
      || receipt.predicate_type !== SLSA_PROVENANCE_V1
      || receipt.builder_trusted !== true
      || receipt.subject_name !== targetPath
      || String(receipt.subject_sha256 || '').toLowerCase() !== String(artifact.sha256).toLowerCase()
      || receipt.subject_size !== artifact.size
      || String(receipt.source_sha || '').toLowerCase() !== String(artifact.source_sha).toLowerCase()
      || receipt.authority_effect !== false) {
    return 'SLSA_PROVENANCE_RECEIPT_INVALID_OR_UNBOUND';
  }
  return null;
}

function validateTransparencyReceipt(receipt, artifact, nowMs) {
  if (!exactKeys(receipt, TRANSPARENCY_RECEIPT_KEYS)
      || receipt.schema !== BROWSER_FABRIC_TRANSPARENCY_RECEIPT_SCHEMA
      || !safeIdentity(receipt.verifier_id)
      || !safeIdentity(receipt.log_id)
      || !evidenceTimeValid(receipt.verified_at, nowMs)
      || !SHA256.test(String(receipt.evidence_sha256 || '').toLowerCase())
      || receipt.verification_profile !== SIGSTORE_PROFILE
      || !SHA256.test(String(receipt.bundle_sha256 || '').toLowerCase())
      || String(receipt.subject_sha256 || '').toLowerCase() !== String(artifact.sha256).toLowerCase()
      || !Number.isSafeInteger(receipt.integrated_time_ms)
      || receipt.integrated_time_ms < 0
      || receipt.integrated_time_ms > nowMs
      || receipt.authority_effect !== false) {
    return 'TRANSPARENCY_RECEIPT_INVALID_OR_UNBOUND';
  }
  return null;
}

function validatePlatformReceipt(receipt, artifact, nowMs) {
  if (!exactKeys(receipt, PLATFORM_RECEIPT_KEYS)
      || receipt.schema !== BROWSER_FABRIC_PLATFORM_SIGNATURE_RECEIPT_SCHEMA
      || !safeIdentity(receipt.verifier_id)
      || !safeIdentity(receipt.signer_identity)
      || !evidenceTimeValid(receipt.verified_at, nowMs)
      || !SHA256.test(String(receipt.evidence_sha256 || '').toLowerCase())
      || receipt.verification_profile !== PLATFORM_PROFILE
      || String(receipt.subject_sha256 || '').toLowerCase() !== String(artifact.sha256).toLowerCase()
      || receipt.subject_size !== artifact.size
      || receipt.authority_effect !== false) {
    return 'PLATFORM_SIGNATURE_RECEIPT_INVALID_OR_UNBOUND';
  }
  return null;
}

/**
 * Composes independently-produced, typed verification receipts into immutable
 * update-trust evidence. This function performs no cryptography, I/O, release
 * mutation or runtime effect. Bare caller booleans are deliberately not part of
 * the API: every positive cryptographic fact must arrive in a receipt bound to
 * the exact canonical metadata/artifact identity and a named verifier.
 */
export function evaluateBrowserFabricUpdateTrust({
  now = new Date(),
  trusted_state,
  root,
  root_receipt,
  targets,
  targets_receipt,
  snapshot,
  snapshot_receipt,
  timestamp,
  timestamp_receipt,
  target_path,
  provenance_receipt,
  transparency_receipt,
  platform_signature_receipt,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return fail('UPDATE_TRUST_NOW_INVALID');
  const trusted = normalizeTrustedState(trusted_state);
  if (!trusted) return fail('TRUSTED_UPDATE_STATE_INVALID');

  const rootProbe = validateTufRole({
    metadata: root,
    receipt: root_receipt,
    role: 'root',
    floor: trusted.root_version,
    trustedRootSha: trusted.root_sha256,
    currentRootSha: null,
    nowMs,
  });
  if (rootProbe.error) return fail(rootProbe.error);
  const currentRootSha = rootProbe.descriptor.sha256;

  const roles = [
    ['targets', targets, targets_receipt, trusted.targets_version],
    ['snapshot', snapshot, snapshot_receipt, trusted.snapshot_version],
    ['timestamp', timestamp, timestamp_receipt, trusted.timestamp_version],
  ];
  const verified = { root: rootProbe };
  for (const [role, metadata, receipt, floor] of roles) {
    const probe = validateTufRole({ metadata, receipt, role, floor, trustedRootSha: trusted.root_sha256, currentRootSha, nowMs });
    if (probe.error) return fail(probe.error);
    verified[role] = probe;
  }

  const targetsBinding = verified.snapshot.signed?.meta?.targets;
  if (!exactMetaBinding(targetsBinding, 'targets')
      || targetsBinding.version !== verified.targets.signed.version
      || String(targetsBinding.sha256).toLowerCase() !== verified.targets.descriptor.sha256
      || targetsBinding.size !== verified.targets.descriptor.size) {
    return fail('TUF_SNAPSHOT_TARGETS_BINDING_MISMATCH');
  }

  const snapshotBinding = verified.timestamp.signed?.meta?.snapshot;
  if (!exactMetaBinding(snapshotBinding, 'snapshot')
      || snapshotBinding.version !== verified.snapshot.signed.version
      || String(snapshotBinding.sha256).toLowerCase() !== verified.snapshot.descriptor.sha256
      || snapshotBinding.size !== verified.snapshot.descriptor.size) {
    return fail('TUF_TIMESTAMP_SNAPSHOT_BINDING_MISMATCH');
  }

  const path = String(target_path || '');
  if (!path || path.includes('..') || path.startsWith('/') || path.startsWith('\\')) return fail('TUF_TARGET_PATH_INVALID');
  const artifact = verified.targets.signed?.targets?.[path];
  if (!exactArtifactDescriptor(artifact)) return fail('TUF_TARGET_DESCRIPTOR_INVALID');

  const provenanceError = validateProvenanceReceipt(provenance_receipt, artifact, path, nowMs);
  if (provenanceError) return fail(provenanceError);
  const transparencyError = validateTransparencyReceipt(transparency_receipt, artifact, nowMs);
  if (transparencyError) return fail(transparencyError);
  const platformError = validatePlatformReceipt(platform_signature_receipt, artifact, nowMs);
  if (platformError) return fail(platformError);

  const artifactSha = String(artifact.sha256).toLowerCase();
  const sourceSha = String(artifact.source_sha).toLowerCase();
  const releaseGateProvenanceEvidence = Object.freeze({
    schema: BROWSER_FABRIC_PROVENANCE_EVIDENCE_SCHEMA,
    verifier_id: provenance_receipt.verifier_id,
    verified_at: provenance_receipt.verified_at,
    verified: true,
    builder_trusted: true,
    builder_id: provenance_receipt.builder_id,
    source_sha: sourceSha,
    subject_name: path,
    subject_sha256: artifactSha,
    predicate_type: SLSA_PROVENANCE_V1,
    authority_effect: false,
  });

  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
    reason: 'TYPED_IMMUTABLE_UPDATE_TRUST_EXACT',
    verified_immutable_release_exact: true,
    target_path: path,
    source_sha: sourceSha,
    artifact_sha256: artifactSha,
    artifact_size: artifact.size,
    artifact_media_type: artifact.media_type,
    metadata_versions: Object.freeze({
      root: verified.root.signed.version,
      targets: verified.targets.signed.version,
      snapshot: verified.snapshot.signed.version,
      timestamp: verified.timestamp.signed.version,
    }),
    next_trusted_state: Object.freeze({
      root_version: verified.root.signed.version,
      targets_version: verified.targets.signed.version,
      snapshot_version: verified.snapshot.signed.version,
      timestamp_version: verified.timestamp.signed.version,
      root_sha256: currentRootSha,
    }),
    receipt_verifiers: Object.freeze({
      root: root_receipt.verifier_id,
      targets: targets_receipt.verifier_id,
      snapshot: snapshot_receipt.verifier_id,
      timestamp: timestamp_receipt.verifier_id,
      provenance: provenance_receipt.verifier_id,
      transparency: transparency_receipt.verifier_id,
      platform_signature: platform_signature_receipt.verifier_id,
    }),
    receipt_evidence_sha256: Object.freeze({
      root: String(root_receipt.evidence_sha256).toLowerCase(),
      targets: String(targets_receipt.evidence_sha256).toLowerCase(),
      snapshot: String(snapshot_receipt.evidence_sha256).toLowerCase(),
      timestamp: String(timestamp_receipt.evidence_sha256).toLowerCase(),
      provenance: String(provenance_receipt.evidence_sha256).toLowerCase(),
      transparency: String(transparency_receipt.evidence_sha256).toLowerCase(),
      platform_signature: String(platform_signature_receipt.evidence_sha256).toLowerCase(),
    }),
    release_gate_provenance_evidence: releaseGateProvenanceEvidence,
    rollback_protected: true,
    freeze_protected: true,
    mix_and_match_protected: true,
    exact_digest_size_media_type_source_binding: true,
    bare_crypto_booleans_accepted: false,
    receipts_are_authority: false,
    requires_separate_release_gate: true,
    requires_separate_journaled_promotion_effect: true,
    release_authority: false,
    authority_effect: false,
    automatic_retry_allowed: false,
  });
}

export function browserFabricUpdateTrustContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_UPDATE_TRUST_SCHEMA,
    tuf_roles_required: Object.freeze(['root', 'targets', 'snapshot', 'timestamp']),
    typed_tuf_verification_receipts_required: true,
    receipt_verifier_identity_required: true,
    receipt_evidence_digest_required: true,
    receipt_subject_binding_required: true,
    bare_signatures_verified_boolean_sufficient: false,
    trusted_root_digest_and_version_floor_required: true,
    root_rotation_receipt_required_on_advance: true,
    metadata_expiry_required: true,
    snapshot_binds_targets_digest_size_version: true,
    timestamp_binds_snapshot_digest_size_version: true,
    target_descriptor_binds_digest_size_media_type_source: true,
    typed_slsa_receipt_required: true,
    typed_transparency_receipt_required: true,
    typed_platform_signature_receipt_required: true,
    git_sha_alone_sufficient: false,
    direct_release_or_authority_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
