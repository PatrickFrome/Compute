import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISORY_EVIDENCE_SCHEMA,
  createAdvisoryEvidenceEnvelope,
  verifyAdvisoryEvidenceEnvelope
} from '../lib/advisory-evidence-envelope.mjs';

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
  served_models: ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free'],
  availability_quorum_met: true,
  decision_state: null,
  tariff_dependency: true,
  data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY'
};

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
