'use strict';

const crypto = require('node:crypto');

const ADVISORY_EVIDENCE_SCHEMA = 'metaengine.advisory-evidence-envelope.v1';
const VERIFY_SCHEMA = 'metaengine.development-plane.advisory-evidence-verify.v1';
const TRUST_STATE = 'HASH_BOUND_ADVISORY_UNATTESTED';
const DATA_POLICY = 'PUBLIC_OR_NON_SENSITIVE_ONLY';

const GATEWAY_PLANES = new Set([
  'VERCEL_AI_GATEWAY',
  'VERCEL_LIVE_PEER_PROJECT',
  'SUPABASE_LIVE_PEER_BROKER',
  'SUPABASE_PEER_DECISION',
  'GITHUB_MODELS_PROBE',
  'CLOUDFLARE_WORKERS_AI_PROBE',
  'LOCAL_OPEN_MODEL_PROBE',
]);

const TRANSPORTS = new Set([
  'OPENAI_COMPAT_HTTP',
  'SUPABASE_EDGE_HTTP',
  'VERCEL_FUNCTION_HTTP',
  'PROVIDER_NATIVE_HTTP',
  'LOCAL_PROCESS',
]);

const RECEIPT_KINDS = new Set([
  'PEER',
  'COMMITTEE',
  'CHALLENGE',
  'DECISION',
  'QUALIFICATION',
  'ROUTE_PLAN',
]);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('advisory_evidence_non_finite_number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (plainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('advisory_evidence_unsupported_value');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireString(value, code, max) {
  if (typeof value !== 'string') throw new Error(code);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(code);
  return text;
}

function requireSha256(value, code) {
  const text = requireString(value, code, 71).toLowerCase().replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(code);
  return text;
}

function requireExactKeys(value, keys, code) {
  if (!plainObject(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code);
  return value;
}

function requireEnum(value, allowed, code) {
  const text = requireString(value, code, 96).toUpperCase();
  if (!allowed.has(text)) throw new Error(code);
  return text;
}

function verifyPolicy(policy) {
  requireExactKeys(policy, [
    'advisory_only',
    'requires_supervisor_arbitration',
    'direct_action_allowed',
    'executable_action',
    'browser_authority',
    'development_authority',
    'sandbox_execution_authority',
    'promotion_authority',
    'semantic_truth_claimed',
    'canonical',
    'authority_effect',
  ], 'advisory_evidence_policy_shape_invalid');
  if (policy.advisory_only !== true || policy.requires_supervisor_arbitration !== true) throw new Error('advisory_evidence_policy_advisory_required');
  if (policy.direct_action_allowed !== false || policy.executable_action !== null) throw new Error('advisory_evidence_direct_action_forbidden');
  if (policy.browser_authority !== false || policy.development_authority !== false || policy.sandbox_execution_authority !== false || policy.promotion_authority !== false) {
    throw new Error('advisory_evidence_authority_escalation_forbidden');
  }
  if (policy.semantic_truth_claimed !== false || policy.canonical !== false || policy.authority_effect !== false) throw new Error('advisory_evidence_truth_or_canonical_forbidden');
}

function verifyEnvelope(envelope) {
  requireExactKeys(envelope, [
    'schema',
    'subject',
    'producer',
    'result',
    'trust',
    'tariff_dependency',
    'data_policy',
    'confidential_data_supported',
    'policy',
    'canonical',
    'authority_effect',
    'evidence_id',
    'envelope_sha256',
  ], 'advisory_evidence_envelope_shape_invalid');

  if (envelope.schema !== ADVISORY_EVIDENCE_SCHEMA) throw new Error('advisory_evidence_schema_invalid');
  if (envelope.canonical !== false || envelope.authority_effect !== false) throw new Error('advisory_evidence_authority_forbidden');
  if (envelope.data_policy !== DATA_POLICY || envelope.confidential_data_supported !== false) throw new Error('advisory_evidence_data_policy_invalid');
  if (typeof envelope.tariff_dependency !== 'boolean') throw new Error('advisory_evidence_tariff_dependency_invalid');

  const subject = requireExactKeys(envelope.subject, ['kind', 'task_id', 'trace_id', 'request_sha256'], 'advisory_evidence_subject_shape_invalid');
  if (subject.kind !== 'MODEL_ADVISORY_TASK') throw new Error('advisory_evidence_subject_kind_invalid');
  requireString(subject.task_id, 'advisory_evidence_task_id_invalid', 160);
  if (subject.trace_id !== null && !/^[0-9a-f]{32}$/.test(requireString(subject.trace_id, 'advisory_evidence_trace_id_invalid', 32))) throw new Error('advisory_evidence_trace_id_invalid');
  requireSha256(subject.request_sha256, 'advisory_evidence_request_hash_invalid');

  const producer = requireExactKeys(envelope.producer, ['gateway_plane', 'route_id', 'transport', 'source_receipt_schema'], 'advisory_evidence_producer_shape_invalid');
  requireEnum(producer.gateway_plane, GATEWAY_PLANES, 'advisory_evidence_gateway_plane_invalid');
  requireString(producer.route_id, 'advisory_evidence_route_id_invalid', 256);
  requireEnum(producer.transport, TRANSPORTS, 'advisory_evidence_transport_invalid');
  requireString(producer.source_receipt_schema, 'advisory_evidence_source_schema_invalid', 192);

  const result = requireExactKeys(envelope.result, ['receipt_kind', 'object_sha256', 'served_models', 'availability_quorum_met', 'decision_state', 'truth_claimed'], 'advisory_evidence_result_shape_invalid');
  requireEnum(result.receipt_kind, RECEIPT_KINDS, 'advisory_evidence_receipt_kind_invalid');
  requireSha256(result.object_sha256, 'advisory_evidence_object_hash_invalid');
  if (!Array.isArray(result.served_models) || result.served_models.length > 16) throw new Error('advisory_evidence_models_invalid');
  const servedModels = result.served_models.map((model) => requireString(model, 'advisory_evidence_model_invalid', 160));
  if (new Set(servedModels).size !== servedModels.length) throw new Error('advisory_evidence_models_duplicate');
  if (result.availability_quorum_met !== null && typeof result.availability_quorum_met !== 'boolean') throw new Error('advisory_evidence_availability_quorum_invalid');
  if (result.decision_state !== null) requireString(result.decision_state, 'advisory_evidence_decision_state_invalid', 96);
  if (result.truth_claimed !== false) throw new Error('advisory_evidence_truth_claim_forbidden');

  const trust = requireExactKeys(envelope.trust, ['state', 'source_receipt_hash_bound', 'source_receipt_attested', 'persisted_readback_verified'], 'advisory_evidence_trust_shape_invalid');
  if (trust.state !== TRUST_STATE || trust.source_receipt_hash_bound !== true || trust.source_receipt_attested !== false || trust.persisted_readback_verified !== false) {
    throw new Error('advisory_evidence_trust_escalation_forbidden');
  }

  verifyPolicy(envelope.policy);

  const core = structuredClone(envelope);
  delete core.evidence_id;
  delete core.envelope_sha256;
  const digest = sha256(canonicalJson(core));
  if (envelope.envelope_sha256 !== digest || envelope.evidence_id !== `advisory_evidence_sha256_${digest}`) throw new Error('advisory_evidence_digest_mismatch');

  return Object.freeze({
    schema: VERIFY_SCHEMA,
    valid: true,
    evidence_id: envelope.evidence_id,
    envelope_sha256: digest,
    task_id: subject.task_id,
    trace_id: subject.trace_id,
    gateway_plane: producer.gateway_plane,
    route_id: producer.route_id,
    receipt_kind: result.receipt_kind,
    trust_state: TRUST_STATE,
    source_receipt_attested: false,
    persisted_readback_verified: false,
    advisory_only: true,
    direct_action_allowed: false,
    browser_authority: false,
    development_authority: false,
    sandbox_execution_authority: false,
    promotion_authority: false,
    canonical: false,
    authority_effect: false,
  });
}

module.exports = Object.freeze({
  ADVISORY_EVIDENCE_SCHEMA,
  VERIFY_SCHEMA,
  verifyEnvelope,
  canonicalJson,
});
