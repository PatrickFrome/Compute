'use strict';

const crypto = require('node:crypto');

const SANDBOX_PLAN_SCHEMA = 'metaengine.development-plane.verification-sandbox-plan.v1';
const SANDBOX_PLAN_VERSION = '1.0.0';
const SANDBOX_PLAN_VERIFY_SCHEMA = 'metaengine.development-plane.verification-sandbox-plan-verify.v1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const HEAD_RE = /^[0-9a-f]{40}$/;
const BACKENDS = new Set(['CLOUDFLARE_SANDBOX', 'VERCEL_SANDBOX', 'FIRECRACKER', 'GVISOR', 'KATA']);
const DEFAULT_RESOURCES = Object.freeze({
  wall_time_seconds: 300,
  memory_bytes: 2 * 1024 * 1024 * 1024,
  pids: 96,
  disk_bytes: 2 * 1024 * 1024 * 1024,
  output_bytes: 16 * 1024 * 1024,
});
const RESOURCE_LIMITS = Object.freeze({
  wall_time_seconds: [1, 900],
  memory_bytes: [64 * 1024 * 1024, 8 * 1024 * 1024 * 1024],
  pids: [1, 256],
  disk_bytes: [64 * 1024 * 1024, 16 * 1024 * 1024 * 1024],
  output_bytes: [1024, 64 * 1024 * 1024],
});

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
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) throw new Error('sandbox_plan_number_invalid');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('sandbox_plan_value_invalid');
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeBackend(value) {
  if (value == null) return null;
  const backend = String(value).trim().toUpperCase();
  if (!BACKENDS.has(backend)) throw new Error('sandbox_backend_invalid');
  return backend;
}

function normalizeResources(value) {
  if (value == null) return { ...DEFAULT_RESOURCES };
  if (!plainObject(value)) throw new Error('sandbox_resources_invalid');
  const allowed = Object.keys(RESOURCE_LIMITS);
  const actual = Object.keys(value);
  if (actual.some((key) => !allowed.includes(key))) throw new Error('sandbox_resource_unknown');
  const out = { ...DEFAULT_RESOURCES };
  for (const key of actual) {
    const n = Number(value[key]);
    const [min, max] = RESOURCE_LIMITS[key];
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`sandbox_resource_${key}_invalid`);
    out[key] = n;
  }
  return out;
}

function normalizeCandidateBinding(capsule, verification) {
  if (!plainObject(capsule) || !plainObject(verification)) throw new Error('sandbox_candidate_binding_invalid');
  const candidateId = String(capsule.candidate_id || '').toLowerCase();
  const digest = String(capsule.digest || '').toLowerCase();
  const sourceHead = String(capsule.source?.head || '').toLowerCase();
  if (!CANDIDATE_ID_RE.test(candidateId) || !DIGEST_RE.test(digest) || !HEAD_RE.test(sourceHead)) throw new Error('sandbox_candidate_identity_invalid');
  if (verification.ok !== true || verification.source_current !== true || verification.promotion_authorized !== false || verification.authority_effect !== false) {
    throw new Error('sandbox_candidate_verification_required');
  }
  if (String(verification.candidate_id || '').toLowerCase() !== candidateId || String(verification.digest || '').toLowerCase() !== digest || String(verification.source_head || '').toLowerCase() !== sourceHead) {
    throw new Error('sandbox_candidate_verification_mismatch');
  }
  const sequence = Number(capsule.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('sandbox_candidate_sequence_invalid');
  if (!Array.isArray(capsule.verification_plan) || capsule.verification_plan.length < 1 || capsule.verification_plan.length > 32) throw new Error('sandbox_verification_plan_invalid');
  const verificationPlan = capsule.verification_plan.map((row) => {
    if (!plainObject(row) || row.required !== true || !/^[A-Z][A-Z0-9_.:-]{0,63}$/.test(String(row.id || ''))) throw new Error('sandbox_verification_step_invalid');
    return { id: String(row.id), required: true };
  });
  verificationPlan.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { candidate_id: candidateId, digest, source_head: sourceHead, sequence, verification_plan: verificationPlan };
}

function corePolicy() {
  return {
    candidate_only: true,
    prepare_only: true,
    execution_authority: false,
    arbitrary_command_authority: false,
    browser_actuation_authority: false,
    direct_promote_current: false,
    promotion_authority: false,
    signed_attestation_authority: false,
    authority_effect: false,
  };
}

function createVerificationSandboxPlan({ capsule, candidate_verification, requested_backend = null, resources = null } = {}) {
  const candidate = normalizeCandidateBinding(capsule, candidate_verification);
  const core = {
    schema: SANDBOX_PLAN_SCHEMA,
    version: SANDBOX_PLAN_VERSION,
    mode: 'PREPARE_ONLY',
    candidate,
    isolation: {
      requested_backend: normalizeBackend(requested_backend),
      backend_bound: false,
      backend_identity: null,
      accepted_backends: [...BACKENDS].sort(),
      required_boundary: 'VM_OR_STRONGER_OR_USERSPACE_KERNEL',
      execution_authority: false,
    },
    filesystem: {
      materialization_strategy: 'IMMUTABLE_SNAPSHOT',
      source_read_only: true,
      host_repository_mounted: false,
      writable_layer: 'PRIVATE_DIRECTORY',
      output_allowlist: ['evidence/'],
      allow_special_files: false,
    },
    network: {
      deny_by_default: true,
      inbound_exposure: false,
      allowed_hosts: [],
      allowed_cidrs: [],
      credential_brokering: false,
    },
    resources: normalizeResources(resources),
    evidence_contract: {
      sandbox_identity_receipt_required: true,
      input_manifest_digest_required: true,
      verification_receipts_required: true,
      output_manifest_digest_required: true,
      teardown_receipt_required: true,
    },
    policy: corePolicy(),
    authority_effect: false,
  };
  const digestHex = sha256(stableStringify(core));
  return Object.freeze({ ...core, plan_id: `sandbox_plan_sha256_${digestHex}`, digest: `sha256:${digestHex}` });
}

function verifyVerificationSandboxPlan(plan, capsule, candidateVerification) {
  if (!plainObject(plan)) throw new Error('sandbox_plan_invalid');
  const expected = createVerificationSandboxPlan({
    capsule,
    candidate_verification: candidateVerification,
    requested_backend: plan.isolation?.requested_backend ?? null,
    resources: plan.resources,
  });
  if (stableStringify(plan) !== stableStringify(expected)) throw new Error('sandbox_plan_tampered');
  return Object.freeze({
    schema: SANDBOX_PLAN_VERIFY_SCHEMA,
    ok: true,
    plan_id: expected.plan_id,
    digest: expected.digest,
    candidate_id: expected.candidate.candidate_id,
    mode: 'PREPARE_ONLY',
    backend_bound: false,
    execution_authorized: false,
    promotion_authorized: false,
    authority_effect: false,
  });
}

module.exports = Object.freeze({
  SANDBOX_PLAN_SCHEMA,
  SANDBOX_PLAN_VERSION,
  SANDBOX_PLAN_VERIFY_SCHEMA,
  createVerificationSandboxPlan,
  verifyVerificationSandboxPlan,
  stableStringify,
});
