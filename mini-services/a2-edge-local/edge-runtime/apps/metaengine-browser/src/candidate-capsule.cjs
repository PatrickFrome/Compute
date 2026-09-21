'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const CANDIDATE_CAPSULE_SCHEMA = 'metaengine.development-plane.candidate-capsule.v1';
const CANDIDATE_CAPSULE_VERSION = '1.0.0';
const VERIFY_RECEIPT_SCHEMA = 'metaengine.development-plane.candidate-verify-receipt.v1';
const MAX_CAPSULE_BYTES = 256 * 1024;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const HEAD_RE = /^[0-9a-f]{40}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const CHANGE_TYPES = new Set(['CREATE', 'MODIFY', 'DELETE']);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedText(value, name, max) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error(`candidate_${name}_invalid`);
  return text;
}

function normalizedDigest(value, name = 'digest') {
  const digest = String(value || '').toLowerCase();
  if (!SHA256_RE.test(digest)) throw new Error(`candidate_${name}_invalid`);
  return digest;
}

function normalizedPath(value) {
  const raw = String(value || '');
  if (!raw || raw.length > 240 || raw.includes('\\') || raw.startsWith('/') || raw.includes('\0')) throw new Error('candidate_component_path_invalid');
  const normalized = path.posix.normalize(raw);
  if (normalized !== raw || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error('candidate_component_path_invalid');
  return normalized;
}

function normalizedId(value, name) {
  const id = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_.:-]{0,63}$/.test(id)) throw new Error(`candidate_${name}_invalid`);
  return id;
}

function normalizeSource(source) {
  if (!plainObject(source)) throw new Error('candidate_source_invalid');
  const repository = normalizedText(source.repository, 'source_repository', 160);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('candidate_source_repository_invalid');
  const head = String(source.head || '').toLowerCase();
  if (!HEAD_RE.test(head)) throw new Error('candidate_source_head_invalid');
  const ref = source.ref == null ? null : normalizedText(source.ref, 'source_ref', 240);
  return { repository, head, ref };
}

function normalizeComponents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) throw new Error('candidate_components_invalid');
  const seen = new Set();
  const rows = value.map((row) => {
    if (!plainObject(row)) throw new Error('candidate_component_invalid');
    const componentPath = normalizedPath(row.path);
    if (seen.has(componentPath)) throw new Error('candidate_component_duplicate');
    seen.add(componentPath);
    const change = String(row.change || '').toUpperCase();
    if (!CHANGE_TYPES.has(change)) throw new Error('candidate_component_change_invalid');
    return { path: componentPath, change, digest: normalizedDigest(row.digest, 'component_digest') };
  });
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.change.localeCompare(b.change) || a.digest.localeCompare(b.digest));
}

function normalizeVerificationPlan(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error('candidate_verification_plan_invalid');
  const seen = new Set();
  const rows = value.map((row) => {
    if (!plainObject(row)) throw new Error('candidate_verification_step_invalid');
    const id = normalizedId(row.id, 'verification_step');
    if (seen.has(id)) throw new Error('candidate_verification_step_duplicate');
    seen.add(id);
    if (row.required !== true) throw new Error('candidate_verification_step_required');
    return { id, required: true };
  });
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeEvidence(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error('candidate_evidence_invalid');
  const seen = new Set();
  const rows = value.map((row) => {
    if (!plainObject(row)) throw new Error('candidate_evidence_item_invalid');
    const name = normalizedId(row.name, 'evidence_name');
    if (seen.has(name)) throw new Error('candidate_evidence_duplicate');
    seen.add(name);
    return { name, digest: normalizedDigest(row.digest, 'evidence_digest') };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePreviousCandidateId(value) {
  if (value == null) return null;
  const id = String(value).toLowerCase();
  if (!CANDIDATE_ID_RE.test(id)) throw new Error('candidate_previous_id_invalid');
  return id;
}

function policy() {
  return {
    candidate_only: true,
    executable: false,
    direct_promote_current: false,
    automatic_promotion: false,
    arbitrary_eval: false,
    page_command_authority: false,
    browser_actuation_authority: false,
    source_head_match_required: true,
    signed_attestation_required_before_promotion: true,
    monotonic_sequence_declared: true,
    rollback_protection_enforced_at_promotion: false,
    authority_effect: false,
  };
}

function normalizeCreateInput(input, source) {
  if (!plainObject(input)) throw new Error('candidate_payload_invalid');
  const currentSource = normalizeSource(source);
  const sourceHead = String(input.source_head || '').toLowerCase();
  if (!HEAD_RE.test(sourceHead) || sourceHead !== currentSource.head) throw new Error('candidate_source_head_mismatch');
  const sequence = Number(input.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('candidate_sequence_invalid');
  return {
    schema: CANDIDATE_CAPSULE_SCHEMA,
    version: CANDIDATE_CAPSULE_VERSION,
    source: currentSource,
    sequence,
    previous_candidate_id: normalizePreviousCandidateId(input.previous_candidate_id),
    intent: normalizedText(input.intent, 'intent', 2000),
    components: normalizeComponents(input.components),
    verification_plan: normalizeVerificationPlan(input.verification_plan),
    evidence: normalizeEvidence(input.evidence),
    policy: policy(),
    provenance: {
      model: 'DIGEST_BOUND_LOCAL_CANDIDATE',
      signed: false,
      slsa_build_provenance_present: false,
      github_artifact_attestation_present: false,
      in_toto_attestation_present: false,
    },
    authority_effect: false,
  };
}

function computeCoreDigest(core) {
  const encoded = stableStringify(core);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CAPSULE_BYTES) throw new Error('candidate_capsule_too_large');
  return sha256(encoded);
}

function createCandidateCapsule(input, source) {
  const core = normalizeCreateInput(input, source);
  const digestHex = computeCoreDigest(core);
  return Object.freeze({
    ...core,
    candidate_id: `candidate_sha256_${digestHex}`,
    digest: `sha256:${digestHex}`,
  });
}

function verifyCandidateCapsule(capsule, currentSource) {
  if (!plainObject(capsule)) throw new Error('candidate_capsule_invalid');
  const expectedKeys = ['authority_effect', 'candidate_id', 'components', 'digest', 'evidence', 'intent', 'policy', 'previous_candidate_id', 'provenance', 'schema', 'sequence', 'source', 'verification_plan', 'version'].sort();
  const actualKeys = Object.keys(capsule).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) throw new Error('candidate_capsule_shape_invalid');
  if (capsule.schema !== CANDIDATE_CAPSULE_SCHEMA || capsule.version !== CANDIDATE_CAPSULE_VERSION) throw new Error('candidate_capsule_version_invalid');
  const source = normalizeSource(capsule.source);
  const current = normalizeSource(currentSource);
  if (source.repository !== current.repository || source.head !== current.head) throw new Error('candidate_source_head_mismatch');
  const core = normalizeCreateInput({
    source_head: source.head,
    sequence: capsule.sequence,
    previous_candidate_id: capsule.previous_candidate_id,
    intent: capsule.intent,
    components: capsule.components,
    verification_plan: capsule.verification_plan,
    evidence: capsule.evidence,
  }, source);
  if (stableStringify(capsule.policy) !== stableStringify(core.policy)
      || stableStringify(capsule.provenance) !== stableStringify(core.provenance)
      || capsule.authority_effect !== false) throw new Error('candidate_policy_tampered');
  const digestHex = computeCoreDigest(core);
  const digest = `sha256:${digestHex}`;
  const candidateId = `candidate_sha256_${digestHex}`;
  if (String(capsule.digest || '').toLowerCase() !== digest || String(capsule.candidate_id || '').toLowerCase() !== candidateId) throw new Error('candidate_digest_mismatch');
  return Object.freeze({
    schema: VERIFY_RECEIPT_SCHEMA,
    ok: true,
    candidate_id: candidateId,
    digest,
    source_head: source.head,
    source_current: true,
    candidate_only: true,
    executable: false,
    direct_promote_current: false,
    signed_attestation_present: false,
    promotion_authorized: false,
    authority_effect: false,
  });
}

module.exports = Object.freeze({
  CANDIDATE_CAPSULE_SCHEMA,
  CANDIDATE_CAPSULE_VERSION,
  VERIFY_RECEIPT_SCHEMA,
  createCandidateCapsule,
  verifyCandidateCapsule,
  stableStringify,
});
