import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyEnvelope } = require('../src/advisory-evidence-verifier.cjs');

const FIXED_DIGEST = 'b5cba0627de9c6c41cfb51e2fd724d66c0f8199c0091b7b9d4866497115741c9';

function fixture() {
  return {
    schema: 'metaengine.advisory-evidence-envelope.v1',
    subject: {
      kind: 'MODEL_ADVISORY_TASK',
      task_id: 'task-cross-plane-001',
      trace_id: '0123456789abcdef0123456789abcdef',
      request_sha256: '1'.repeat(64),
    },
    producer: {
      gateway_plane: 'VERCEL_AI_GATEWAY',
      route_id: 'committee:free:v1',
      transport: 'OPENAI_COMPAT_HTTP',
      source_receipt_schema: 'metaengine.supervisor.advisory-committee.v1',
    },
    result: {
      receipt_kind: 'COMMITTEE',
      object_sha256: '2'.repeat(64),
      served_models: ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free'],
      availability_quorum_met: true,
      decision_state: 'QUORUM_MET',
      truth_claimed: false,
    },
    trust: {
      state: 'HASH_BOUND_ADVISORY_UNATTESTED',
      source_receipt_hash_bound: true,
      source_receipt_attested: false,
      persisted_readback_verified: false,
    },
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    confidential_data_supported: false,
    policy: {
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
      authority_effect: false,
    },
    canonical: false,
    authority_effect: false,
    evidence_id: `advisory_evidence_sha256_${FIXED_DIGEST}`,
    envelope_sha256: FIXED_DIGEST,
  };
}

test('independent Browser verifier accepts the fixed F1 wire fixture', () => {
  const receipt = verifyEnvelope(fixture());
  assert.equal(receipt.valid, true);
  assert.equal(receipt.envelope_sha256, FIXED_DIGEST);
  assert.equal(receipt.gateway_plane, 'VERCEL_AI_GATEWAY');
  assert.equal(receipt.receipt_kind, 'COMMITTEE');
  assert.equal(receipt.trust_state, 'HASH_BOUND_ADVISORY_UNATTESTED');
  assert.equal(receipt.direct_action_allowed, false);
  assert.equal(receipt.browser_authority, false);
  assert.equal(receipt.promotion_authority, false);
  assert.equal(receipt.authority_effect, false);
});

test('Supabase rail identity is accepted without changing authority semantics', () => {
  const value = fixture();
  value.producer.gateway_plane = 'SUPABASE_LIVE_PEER_BROKER';
  value.producer.route_id = 'metaengine/structured-auto';
  value.producer.transport = 'SUPABASE_EDGE_HTTP';
  value.producer.source_receipt_schema = 'metaengine.live-peer-broker.receipt.v11';
  value.result.receipt_kind = 'PEER';
  value.result.served_models = ['llama32'];
  value.result.availability_quorum_met = null;
  value.result.decision_state = 'QUALIFIED';
  delete value.evidence_id;
  delete value.envelope_sha256;
  const { canonicalJson } = require('../src/advisory-evidence-verifier.cjs');
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
  value.evidence_id = `advisory_evidence_sha256_${digest}`;
  value.envelope_sha256 = digest;
  const receipt = verifyEnvelope(value);
  assert.equal(receipt.valid, true);
  assert.equal(receipt.gateway_plane, 'SUPABASE_LIVE_PEER_BROKER');
  assert.equal(receipt.browser_authority, false);
});

test('digest mutation and hidden fields fail closed', () => {
  const changed = fixture();
  changed.result.object_sha256 = '3'.repeat(64);
  assert.throws(() => verifyEnvelope(changed), /digest_mismatch/);

  const extra = fixture();
  extra.policy.hidden_capability = true;
  assert.throws(() => verifyEnvelope(extra), /policy_shape_invalid/);
});

test('truth authority and trust escalation are independently rejected', () => {
  const truth = fixture();
  truth.result.truth_claimed = true;
  assert.throws(() => verifyEnvelope(truth), /truth_claim_forbidden/);

  const browser = fixture();
  browser.policy.browser_authority = true;
  assert.throws(() => verifyEnvelope(browser), /authority_escalation_forbidden/);

  const promoted = fixture();
  promoted.policy.promotion_authority = true;
  assert.throws(() => verifyEnvelope(promoted), /authority_escalation_forbidden/);

  const attested = fixture();
  attested.trust.source_receipt_attested = true;
  assert.throws(() => verifyEnvelope(attested), /trust_escalation_forbidden/);
});

test('unknown gateway rail and unsafe data policy fail closed', () => {
  const rail = fixture();
  rail.producer.gateway_plane = 'UNBOUNDED_PROVIDER';
  assert.throws(() => verifyEnvelope(rail), /gateway_plane_invalid/);

  const policy = fixture();
  policy.data_policy = 'CONFIDENTIAL_ALLOWED';
  assert.throws(() => verifyEnvelope(policy), /data_policy_invalid/);
});
