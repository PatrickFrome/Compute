import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISORY_EVIDENCE_SCHEMA,
  createAdvisoryEvidenceEnvelope,
  createCommitteeAdvisoryEvidence,
  verifyAdvisoryEvidenceEnvelope
} from '../lib/advisory-evidence-envelope.mjs';
import { toSupervisorAdvisory } from '../lib/supervisor-advisory.mjs';

const MODELS = [
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
];

const base = {
  task_id: 'task-multi-gateway-001',
  trace_id: '0123456789abcdef0123456789abcdef',
  request_sha256: '1'.repeat(64),
  gateway_plane: 'VERCEL_AI_GATEWAY',
  route_id: 'committee:free:v1',
  transport: 'OPENAI_COMPAT_HTTP',
  source_receipt_schema: 'metaengine.model-gateway.free-committee.v1',
  receipt_kind: 'COMMITTEE',
  object_sha256: '2'.repeat(64),
  served_models: MODELS.slice(0, 2),
  availability_quorum_met: true,
  decision_state: null,
  tariff_dependency: true,
  data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY'
};

function committeeReceipt() {
  const providers = ['minimax', 'poolside', 'inclusionai'];
  const members = MODELS.map((model, index) => ({
    member_id: `member-${index + 1}`,
    status: 'SUCCESS',
    provider_family: providers[index],
    requested_model: model,
    served_model: model,
    answer: `answer-${index + 1}`,
    response_sha256: String(index + 3).repeat(64),
    started_at: '2026-08-29T11:00:00.000Z',
    completed_at: '2026-08-29T11:00:01.000Z',
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  }));
  const zeroSpendEvidence = {
    models: MODELS.map((model, index) => ({
      model,
      owned_by: providers[index],
      zdr: 'unknown',
      no_training: 'unknown',
      zero_price: true
    })),
    privacy: {
      all_zdr: false,
      all_no_training: false,
      classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN'
    }
  };
  return {
    schema: 'metaengine.model-gateway.free-committee.v1',
    task_id: 'task-committee-evidence',
    committee_size: 3,
    quorum_required: 2,
    successful_members: 3,
    quorum_met: true,
    committee_status: 'QUORUM_MET',
    providers,
    models_requested: [...MODELS],
    members,
    synthesis_performed: false,
    synthesis: null,
    started_at: '2026-08-29T11:00:00.000Z',
    completed_at: '2026-08-29T11:00:01.000Z',
    request_sha256: 'b'.repeat(64),
    zero_spend_verified: true,
    zero_spend_evidence: zeroSpendEvidence,
    privacy_classification: zeroSpendEvidence.privacy.classification,
    confidential_data_supported: false,
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  };
}

test('Vercel and Supabase rails normalize into one advisory evidence schema', () => {
  const vercel = createAdvisoryEvidenceEnvelope(base);
  const supabase = createAdvisoryEvidenceEnvelope({
    ...base,
    gateway_plane: 'SUPABASE_LIVE_PEER_BROKER',
    route_id: 'metaengine/structured-auto',
    transport: 'SUPABASE_EDGE_HTTP',
    source_receipt_schema: 'metaengine.live-peer-broker.receipt.v11',
    receipt_kind: 'PEER',
    object_sha256: '3'.repeat(64),
    served_models: ['llama32'],
    availability_quorum_met: null,
    decision_state: 'QUALIFIED'
  });

  assert.equal(vercel.schema, ADVISORY_EVIDENCE_SCHEMA);
  assert.equal(supabase.schema, ADVISORY_EVIDENCE_SCHEMA);
  assert.equal(vercel.producer.gateway_plane, 'VERCEL_AI_GATEWAY');
  assert.equal(supabase.producer.gateway_plane, 'SUPABASE_LIVE_PEER_BROKER');
  assert.equal(vercel.policy.direct_action_allowed, false);
  assert.equal(supabase.policy.direct_action_allowed, false);
  assert.equal(vercel.policy.browser_authority, false);
  assert.equal(supabase.policy.promotion_authority, false);
});

test('same evidence input is deterministic and hash bound', () => {
  const a = createAdvisoryEvidenceEnvelope(base);
  const b = createAdvisoryEvidenceEnvelope({ ...base });
  assert.deepEqual(a, b);
  assert.match(a.evidence_id, /^advisory_evidence_sha256_[0-9a-f]{64}$/);
  assert.match(a.envelope_sha256, /^[0-9a-f]{64}$/);
  assert.equal(verifyAdvisoryEvidenceEnvelope(a).valid, true);
});

test('validated committee plus supervisor advisory produces downstream evidence without authority', () => {
  const committee = committeeReceipt();
  const advisory = toSupervisorAdvisory(committee);
  const envelope = createCommitteeAdvisoryEvidence({
    committeeReceipt: committee,
    supervisorAdvisory: advisory,
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
  const verified = verifyAdvisoryEvidenceEnvelope(envelope);

  assert.equal(envelope.subject.task_id, committee.task_id);
  assert.equal(envelope.result.receipt_kind, 'COMMITTEE');
  assert.deepEqual(envelope.result.served_models, MODELS);
  assert.equal(envelope.result.availability_quorum_met, true);
  assert.equal(envelope.result.decision_state, 'QUORUM_MET');
  assert.equal(envelope.trust.state, 'HASH_BOUND_ADVISORY_UNATTESTED');
  assert.equal(verified.valid, true);
  assert.equal(verified.direct_action_allowed, false);
  assert.equal(verified.browser_authority, false);
});

test('committee evidence rejects advisory subject or authority drift', () => {
  const committee = committeeReceipt();
  const advisory = toSupervisorAdvisory(committee);
  assert.throws(() => createCommitteeAdvisoryEvidence({
    committeeReceipt: committee,
    supervisorAdvisory: { ...advisory, task_id: 'other-task' }
  }), /subject_mismatch/);
  assert.throws(() => createCommitteeAdvisoryEvidence({
    committeeReceipt: committee,
    supervisorAdvisory: { ...advisory, direct_action_allowed: true }
  }), /supervisor_authority_invalid/);
});

test('multi-gateway evidence can never claim truth or action authority', () => {
  const envelope = structuredClone(createAdvisoryEvidenceEnvelope(base));
  envelope.result.truth_claimed = true;
  assert.throws(() => verifyAdvisoryEvidenceEnvelope(envelope), /truth_claim_forbidden/);

  const authority = structuredClone(createAdvisoryEvidenceEnvelope(base));
  authority.policy.direct_action_allowed = true;
  assert.throws(() => verifyAdvisoryEvidenceEnvelope(authority), /policy_escalation_forbidden/);

  const promoted = structuredClone(createAdvisoryEvidenceEnvelope(base));
  promoted.policy.promotion_authority = true;
  assert.throws(() => verifyAdvisoryEvidenceEnvelope(promoted), /policy_escalation_forbidden/);
});

test('self-reported evidence cannot upgrade itself to attested or persisted trust', () => {
  const attested = structuredClone(createAdvisoryEvidenceEnvelope(base));
  attested.trust.source_receipt_attested = true;
  assert.throws(() => verifyAdvisoryEvidenceEnvelope(attested), /trust_escalation_forbidden/);

  const persisted = structuredClone(createAdvisoryEvidenceEnvelope(base));
  persisted.trust.persisted_readback_verified = true;
  assert.throws(() => verifyAdvisoryEvidenceEnvelope(persisted), /trust_escalation_forbidden/);
});

test('receipt mutation, unknown rails, duplicate models and unsafe policy fail closed', () => {
  const mutated = structuredClone(createAdvisoryEvidenceEnvelope(base));
  mutated.result.object_sha256 = '4'.repeat(64);
  assert.throws(() => verifyAdvisoryEvidenceEnvelope(mutated), /tampered/);

  assert.throws(() => createAdvisoryEvidenceEnvelope({ ...base, gateway_plane: 'MAGIC_ROUTER' }), /gateway_plane_invalid/);
  assert.throws(() => createAdvisoryEvidenceEnvelope({ ...base, served_models: ['llama32', 'llama32'] }), /models_duplicate/);
  assert.throws(() => createAdvisoryEvidenceEnvelope({ ...base, data_policy: 'SECRET_OK' }), /data_policy_invalid/);
});

test('tariff dependency is evidence, not a free-route inference', () => {
  const freeRemote = createAdvisoryEvidenceEnvelope({ ...base, tariff_dependency: true });
  const provedLocal = createAdvisoryEvidenceEnvelope({
    ...base,
    gateway_plane: 'LOCAL_OPEN_MODEL_PROBE',
    route_id: 'local-qualified-peer',
    transport: 'LOCAL_PROCESS',
    receipt_kind: 'QUALIFICATION',
    served_models: ['local/model'],
    tariff_dependency: false
  });
  assert.equal(freeRemote.tariff_dependency, true);
  assert.equal(provedLocal.tariff_dependency, false);
  assert.equal(provedLocal.policy.authority_effect, false);
});
