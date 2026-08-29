'use strict';

const crypto = require('node:crypto');

const BACKEND_BINDING_SCHEMA = 'metaengine.development-plane.verification-sandbox-backend-binding.v1';
const BACKEND_OBSERVATION_SCHEMA = 'metaengine.development-plane.verification-sandbox-backend-observation.v1';
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const PLAN_ID_RE = /^sandbox_plan_sha256_[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const HEAD_RE = /^[0-9a-f]{40}$/;

const PROVIDER_REQUIREMENTS = Object.freeze({
  VERCEL_SANDBOX: Object.freeze({
    isolation_class: 'FIRECRACKER_MICROVM',
    provider_control_plane: 'VERCEL_SANDBOX_API',
    session_id_pattern: /^sbx_[A-Za-z0-9_-]{3,128}$/,
  }),
  CLOUDFLARE_SANDBOX: Object.freeze({
    isolation_class: 'DEDICATED_VM',
    provider_control_plane: 'CLOUDFLARE_SANDBOX_API',
    session_id_pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/,
  }),
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
  if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) throw new Error('backend_binding_number_invalid');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('backend_binding_value_invalid');
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireDigest(value, label) {
  const digest = String(value || '').toLowerCase();
  if (!DIGEST_RE.test(digest)) throw new Error(`${label}_invalid`);
  return digest;
}

function requireString(value, label, max = 512) {
  const text = String(value || '');
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label}_invalid`);
  return text;
}

function normalizeIso(value, label) {
  const text = requireString(value, label, 64);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) throw new Error(`${label}_invalid`);
  return text;
}

function normalizePlan(plan) {
  if (!plainObject(plan)) throw new Error('backend_binding_plan_invalid');
  const planId = String(plan.plan_id || '').toLowerCase();
  const digest = String(plan.digest || '').toLowerCase();
  const candidateId = String(plan.candidate?.candidate_id || '').toLowerCase();
  const sourceHead = String(plan.candidate?.source_head || '').toLowerCase();
  if (!PLAN_ID_RE.test(planId) || !DIGEST_RE.test(digest) || !CANDIDATE_ID_RE.test(candidateId) || !HEAD_RE.test(sourceHead)) {
    throw new Error('backend_binding_plan_identity_invalid');
  }
  if (plan.mode !== 'PREPARE_ONLY' || plan.authority_effect !== false || plan.policy?.execution_authority !== false || plan.policy?.promotion_authority !== false) {
    throw new Error('backend_binding_plan_authority_invalid');
  }
  if (plan.isolation?.backend_bound !== false || plan.isolation?.execution_authority !== false) throw new Error('backend_binding_plan_backend_state_invalid');
  if (plan.filesystem?.source_read_only !== true || plan.filesystem?.host_repository_mounted !== false) throw new Error('backend_binding_plan_filesystem_invalid');
  if (plan.network?.deny_by_default !== true || plan.network?.inbound_exposure !== false || plan.network?.credential_brokering !== false) throw new Error('backend_binding_plan_network_invalid');
  if (!Array.isArray(plan.network?.allowed_hosts) || plan.network.allowed_hosts.length !== 0 || !Array.isArray(plan.network?.allowed_cidrs) || plan.network.allowed_cidrs.length !== 0) {
    throw new Error('backend_binding_plan_network_not_closed');
  }
  const core = { ...plan };
  delete core.plan_id;
  delete core.digest;
  const expected = sha256(stableStringify(core));
  if (planId !== `sandbox_plan_sha256_${expected}` || digest !== `sha256:${expected}`) throw new Error('backend_binding_plan_digest_mismatch');
  return {
    plan_id: planId,
    digest,
    candidate_id: candidateId,
    source_head: sourceHead,
    requested_backend: plan.isolation?.requested_backend || null,
    resources: structuredClone(plan.resources),
    network: structuredClone(plan.network),
  };
}

function providerRequirements(provider) {
  const key = String(provider || '').trim().toUpperCase();
  const requirements = PROVIDER_REQUIREMENTS[key];
  if (!requirements) throw new Error('backend_binding_provider_invalid');
  return { provider: key, requirements };
}

function createBackendBindingCandidate({ plan, provider } = {}) {
  const boundPlan = normalizePlan(plan);
  const { provider: normalizedProvider, requirements } = providerRequirements(provider || boundPlan.requested_backend);
  if (boundPlan.requested_backend && normalizedProvider !== boundPlan.requested_backend) throw new Error('backend_binding_provider_plan_mismatch');

  const core = {
    schema: BACKEND_BINDING_SCHEMA,
    state: 'CANDIDATE_UNOBSERVED',
    plan: boundPlan,
    backend: {
      provider: normalizedProvider,
      required_isolation_class: requirements.isolation_class,
      provider_control_plane: requirements.provider_control_plane,
      session_identity_required: true,
      immutable_runtime_identity_required: true,
      immutable_image_digest_required: true,
    },
    materialization: {
      strategy: 'CONTENT_DIGEST_UPLOAD',
      host_repository_mounted: false,
      source_read_only: true,
      input_manifest_digest_required: true,
      mutable_provider_source_clone: false,
    },
    network: {
      policy: 'DENY_ALL_FOR_INITIAL_VERIFICATION',
      allowed_domains: [],
      allowed_cidrs: [],
      exposed_ports: [],
      credential_brokering: false,
      environment_secret_injection: false,
      observed_policy_receipt_required: true,
    },
    lifecycle: {
      ephemeral: true,
      persistent: false,
      snapshot_restore_allowed: false,
      stop_required: true,
      teardown_receipt_required: true,
      max_wall_time_seconds: boundPlan.resources.wall_time_seconds,
    },
    evidence: {
      provider_session_observation_required: true,
      input_manifest_digest_required: true,
      output_manifest_digest_required: true,
      verification_receipts_required: true,
      teardown_receipt_required: true,
      trusted_control_plane_provenance_required_before_binding: true,
    },
    policy: {
      provider_name_is_not_trust: true,
      self_reported_observation_is_not_trust: true,
      backend_bound: false,
      execution_authorized: false,
      promotion_authorized: false,
      authority_effect: false,
    },
    authority_effect: false,
  };
  const digestHex = sha256(stableStringify(core));
  return Object.freeze({ ...core, binding_candidate_id: `backend_binding_sha256_${digestHex}`, digest: `sha256:${digestHex}` });
}

function validateBackendObservation(binding, observation) {
  if (!plainObject(binding) || !plainObject(observation)) throw new Error('backend_observation_invalid');
  const bindingCore = { ...binding };
  delete bindingCore.binding_candidate_id;
  delete bindingCore.digest;
  const expectedBindingDigest = sha256(stableStringify(bindingCore));
  if (binding.binding_candidate_id !== `backend_binding_sha256_${expectedBindingDigest}` || binding.digest !== `sha256:${expectedBindingDigest}`) throw new Error('backend_binding_candidate_tampered');
  if (binding.state !== 'CANDIDATE_UNOBSERVED' || binding.policy?.backend_bound !== false || binding.policy?.execution_authorized !== false || binding.policy?.promotion_authorized !== false || binding.authority_effect !== false) throw new Error('backend_binding_candidate_authority_invalid');
  if (!PLAN_ID_RE.test(String(binding.plan?.plan_id || '')) || !DIGEST_RE.test(String(binding.plan?.digest || '')) || !CANDIDATE_ID_RE.test(String(binding.plan?.candidate_id || '')) || !HEAD_RE.test(String(binding.plan?.source_head || ''))) throw new Error('backend_binding_candidate_plan_invalid');
  const { provider, requirements } = providerRequirements(binding.backend.provider);
  if (String(observation.schema || '') !== BACKEND_OBSERVATION_SCHEMA) throw new Error('backend_observation_schema_invalid');
  if (String(observation.provider || '').toUpperCase() !== provider) throw new Error('backend_observation_provider_mismatch');
  const sessionId = requireString(observation.session_id, 'backend_observation_session_id', 160);
  if (!requirements.session_id_pattern.test(sessionId)) throw new Error('backend_observation_session_id_invalid');
  if (observation.isolation_class !== requirements.isolation_class) throw new Error('backend_observation_isolation_class_invalid');
  const runtimeDigest = requireDigest(observation.runtime_digest, 'backend_observation_runtime_digest');
  const imageDigest = requireDigest(observation.image_digest, 'backend_observation_image_digest');
  const inputDigest = requireDigest(observation.input_manifest_digest, 'backend_observation_input_manifest_digest');
  const outputDigest = requireDigest(observation.output_manifest_digest, 'backend_observation_output_manifest_digest');
  const teardownDigest = requireDigest(observation.teardown_receipt_digest, 'backend_observation_teardown_receipt_digest');
  const createdAt = normalizeIso(observation.created_at, 'backend_observation_created_at');
  const stoppedAt = normalizeIso(observation.stopped_at, 'backend_observation_stopped_at');
  if (Date.parse(stoppedAt) < Date.parse(createdAt)) throw new Error('backend_observation_lifecycle_invalid');
  if (observation.network_policy?.deny_by_default !== true || observation.network_policy?.allowed_domains?.length !== 0 || observation.network_policy?.allowed_cidrs?.length !== 0 || observation.network_policy?.exposed_ports?.length !== 0) {
    throw new Error('backend_observation_network_invalid');
  }
  if (observation.secrets?.environment_secret_injection !== false || observation.secrets?.credential_brokering !== false) throw new Error('backend_observation_secret_policy_invalid');
  if (observation.materialization?.host_repository_mounted !== false || observation.materialization?.source_read_only !== true) throw new Error('backend_observation_materialization_invalid');
  if (observation.teardown?.stopped !== true || observation.teardown?.persistent_state_deleted !== true) throw new Error('backend_observation_teardown_invalid');

  const normalized = {
    schema: 'metaengine.development-plane.verification-sandbox-backend-observation-verify.v1',
    structurally_valid: true,
    binding_candidate_id: binding.binding_candidate_id,
    plan_id: binding.plan.plan_id,
    provider,
    session_id: sessionId,
    isolation_class: requirements.isolation_class,
    runtime_digest: runtimeDigest,
    image_digest: imageDigest,
    input_manifest_digest: inputDigest,
    output_manifest_digest: outputDigest,
    teardown_receipt_digest: teardownDigest,
    created_at: createdAt,
    stopped_at: stoppedAt,
    trust_state: 'PROVIDER_OBSERVED_UNATTESTED',
    backend_bound: false,
    execution_authorized: false,
    promotion_authorized: false,
    authority_effect: false,
  };
  const observationDigest = sha256(stableStringify({ binding_candidate_id: binding.binding_candidate_id, observation }));
  return Object.freeze({ ...normalized, observation_digest: `sha256:${observationDigest}` });
}

module.exports = Object.freeze({
  BACKEND_BINDING_SCHEMA,
  BACKEND_OBSERVATION_SCHEMA,
  PROVIDER_REQUIREMENTS,
  createBackendBindingCandidate,
  validateBackendObservation,
  stableStringify,
});
