import { sha256 } from './security.mjs';
import { canonicalJson } from './supervisor-advisory.mjs';

export const ADVISORY_EVIDENCE_SCHEMA = 'metaengine.advisory-evidence-envelope.v1';
export const ADVISORY_EVIDENCE_VERIFY_SCHEMA = 'metaengine.advisory-evidence-envelope-verify.v1';

const GATEWAY_PLANES = new Set([
  'VERCEL_AI_GATEWAY',
  'VERCEL_LIVE_PEER_PROJECT',
  'SUPABASE_LIVE_PEER_BROKER',
  'SUPABASE_PEER_DECISION',
  'GITHUB_MODELS_PROBE',
  'CLOUDFLARE_WORKERS_AI_PROBE',
  'LOCAL_OPEN_MODEL_PROBE'
]);

const TRANSPORTS = new Set([
  'OPENAI_COMPAT_HTTP',
  'SUPABASE_EDGE_HTTP',
  'VERCEL_FUNCTION_HTTP',
  'PROVIDER_NATIVE_HTTP',
  'LOCAL_PROCESS'
]);

const RECEIPT_KINDS = new Set([
  'PEER',
  'COMMITTEE',
  'CHALLENGE',
  'DECISION',
  'QUALIFICATION',
  'ROUTE_PLAN'
]);

const TRUST_STATE = 'HASH_BOUND_ADVISORY_UNATTESTED';
const DATA_POLICY = 'PUBLIC_OR_NON_SENSITIVE_ONLY';

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function requireString(value, code, max = 256) {
  if (typeof value !== 'string') throw new Error(code);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(code);
  return text;
}

function requireEnum(value, allowed, code) {
  const text = requireString(value, code, 96).toUpperCase();
  if (!allowed.has(text)) throw new Error(code);
  return text;
}

function requireSha256(value, code) {
  const text = requireString(value, code, 71).toLowerCase().replace(/^sha256:/, '');
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(code);
  return text;
}

function normalizeTraceId(value) {
  if (value === null || value === undefined) return null;
  const text = requireString(value, 'advisory_evidence_trace_id_invalid', 64).toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(text)) throw new Error('advisory_evidence_trace_id_invalid');
  return text;
}

function normalizeModels(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error('advisory_evidence_models_invalid');
  const models = value.map((item) => requireString(item, 'advisory_evidence_model_invalid', 160));
  if (new Set(models).size !== models.length) throw new Error('advisory_evidence_models_duplicate');
  return models;
}

function normalizeDecisionState(value) {
  if (value === null || value === undefined) return null;
  return requireString(value, 'advisory_evidence_decision_state_invalid', 96);
}

function normalizeAvailabilityQuorum(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new Error('advisory_evidence_availability_quorum_invalid');
  return value;
}

function policy() {
  return {
    advisory_only: true,
    requires_supervisor_arbitration: true,
    direct_action_allowed: false,
    executable_action: null,
    browser_authority: false,
    development_authority: false,
    sandbox_execution_authority: false,
    promotion_authority: false,
    semantic_truth_claimed: false,
    canonical: false,
    authority_effect: false
  };
}

function normalizeInput(input) {
  requireObject(input, 'advisory_evidence_input_required');
  const gatewayPlane = requireEnum(input.gateway_plane, GATEWAY_PLANES, 'advisory_evidence_gateway_plane_invalid');
  const transport = requireEnum(input.transport, TRANSPORTS, 'advisory_evidence_transport_invalid');
  const receiptKind = requireEnum(input.receipt_kind, RECEIPT_KINDS, 'advisory_evidence_receipt_kind_invalid');
  const tariffDependency = input.tariff_dependency;
  if (typeof tariffDependency !== 'boolean') throw new Error('advisory_evidence_tariff_dependency_invalid');
  const dataPolicy = input.data_policy ?? DATA_POLICY;
  if (dataPolicy !== DATA_POLICY) throw new Error('advisory_evidence_data_policy_invalid');

  return {
    task_id: requireString(input.task_id, 'advisory_evidence_task_id_invalid', 160),
    trace_id: normalizeTraceId(input.trace_id),
    request_sha256: requireSha256(input.request_sha256, 'advisory_evidence_request_hash_invalid'),
    producer: {
      gateway_plane: gatewayPlane,
      route_id: requireString(input.route_id, 'advisory_evidence_route_id_invalid', 256),
      transport,
      source_receipt_schema: requireString(input.source_receipt_schema, 'advisory_evidence_source_schema_invalid', 192)
    },
    result: {
      receipt_kind: receiptKind,
      object_sha256: requireSha256(input.object_sha256, 'advisory_evidence_object_hash_invalid'),
      served_models: normalizeModels(input.served_models),
      availability_quorum_met: normalizeAvailabilityQuorum(input.availability_quorum_met),
      decision_state: normalizeDecisionState(input.decision_state),
      truth_claimed: false
    },
    tariff_dependency: tariffDependency,
    data_policy: DATA_POLICY
  };
}

export function createAdvisoryEvidenceEnvelope(input) {
  const normalized = normalizeInput(input);
  const core = {
    schema: ADVISORY_EVIDENCE_SCHEMA,
    subject: {
      kind: 'MODEL_ADVISORY_TASK',
      task_id: normalized.task_id,
      trace_id: normalized.trace_id,
      request_sha256: normalized.request_sha256
    },
    producer: normalized.producer,
    result: normalized.result,
    trust: {
      state: TRUST_STATE,
      source_receipt_hash_bound: true,
      source_receipt_attested: false,
      persisted_readback_verified: false
    },
    tariff_dependency: normalized.tariff_dependency,
    data_policy: normalized.data_policy,
    confidential_data_supported: false,
    policy: policy(),
    canonical: false,
    authority_effect: false
  };
  const envelopeSha256 = sha256(canonicalJson(core));
  return Object.freeze({
    ...core,
    evidence_id: `advisory_evidence_sha256_${envelopeSha256}`,
    envelope_sha256: envelopeSha256
  });
}

export function verifyAdvisoryEvidenceEnvelope(envelope) {
  requireObject(envelope, 'advisory_evidence_envelope_required');
  if (envelope.schema !== ADVISORY_EVIDENCE_SCHEMA) throw new Error('advisory_evidence_schema_invalid');
  requireObject(envelope.subject, 'advisory_evidence_subject_required');
  requireObject(envelope.producer, 'advisory_evidence_producer_required');
  requireObject(envelope.result, 'advisory_evidence_result_required');
  requireObject(envelope.trust, 'advisory_evidence_trust_required');
  requireObject(envelope.policy, 'advisory_evidence_policy_required');

  if (envelope.subject.kind !== 'MODEL_ADVISORY_TASK') throw new Error('advisory_evidence_subject_kind_invalid');
  if (envelope.trust.state !== TRUST_STATE || envelope.trust.source_receipt_hash_bound !== true || envelope.trust.source_receipt_attested !== false || envelope.trust.persisted_readback_verified !== false) {
    throw new Error('advisory_evidence_trust_escalation_forbidden');
  }
  if (envelope.result.truth_claimed !== false) throw new Error('advisory_evidence_truth_claim_forbidden');

  const expectedPolicy = policy();
  if (canonicalJson(envelope.policy) !== canonicalJson(expectedPolicy)) throw new Error('advisory_evidence_policy_escalation_forbidden');
  if (envelope.canonical !== false || envelope.authority_effect !== false || envelope.confidential_data_supported !== false) {
    throw new Error('advisory_evidence_authority_forbidden');
  }

  const expected = createAdvisoryEvidenceEnvelope({
    task_id: envelope.subject.task_id,
    trace_id: envelope.subject.trace_id,
    request_sha256: envelope.subject.request_sha256,
    gateway_plane: envelope.producer.gateway_plane,
    route_id: envelope.producer.route_id,
    transport: envelope.producer.transport,
    source_receipt_schema: envelope.producer.source_receipt_schema,
    receipt_kind: envelope.result.receipt_kind,
    object_sha256: envelope.result.object_sha256,
    served_models: envelope.result.served_models,
    availability_quorum_met: envelope.result.availability_quorum_met,
    decision_state: envelope.result.decision_state,
    tariff_dependency: envelope.tariff_dependency,
    data_policy: envelope.data_policy
  });

  if (canonicalJson(envelope) !== canonicalJson(expected)) throw new Error('advisory_evidence_envelope_tampered');

  return Object.freeze({
    schema: ADVISORY_EVIDENCE_VERIFY_SCHEMA,
    valid: true,
    evidence_id: expected.evidence_id,
    envelope_sha256: expected.envelope_sha256,
    task_id: expected.subject.task_id,
    gateway_plane: expected.producer.gateway_plane,
    receipt_kind: expected.result.receipt_kind,
    trust_state: TRUST_STATE,
    advisory_only: true,
    direct_action_allowed: false,
    browser_authority: false,
    promotion_authority: false,
    canonical: false,
    authority_effect: false
  });
}

export const ADVISORY_EVIDENCE_GATEWAY_PLANES = Object.freeze([...GATEWAY_PLANES].sort());
