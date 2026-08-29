import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, toSupervisorAdvisory, validateCommitteeReceipt } from '../lib/supervisor-advisory.mjs';

const MODELS = [
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
];

function member(index, provider, model, { status = 'SUCCESS', answer = `answer-${index}` } = {}) {
  if (status === 'FAILED') {
    return {
      member_id: `committee-${index}`,
      status: 'FAILED',
      provider_family: provider,
      requested_model: model,
      served_model: null,
      error: 'gateway_http_403',
      upstream_status: 403,
      started_at: '2026-08-29T04:50:00.000Z',
      completed_at: '2026-08-29T04:50:01.000Z',
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      authority_effect: false
    };
  }
  return {
    member_id: `committee-${index}`,
    status: 'SUCCESS',
    provider_family: provider,
    requested_model: model,
    served_model: model,
    answer,
    response_sha256: 'a'.repeat(64),
    started_at: '2026-08-29T04:50:00.000Z',
    completed_at: '2026-08-29T04:50:01.000Z',
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  };
}

function zeroSpendEvidence() {
  return {
    models: MODELS.map((model, index) => ({
      model,
      owned_by: ['MiniMax', 'Poolside', 'InclusionAI'][index],
      zdr: 'none',
      no_training: index === 2 ? 'all' : 'none',
      zero_price: true
    })),
    privacy: {
      all_zdr: false,
      all_no_training: false,
      classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN'
    }
  };
}

function receipt(overrides = {}) {
  const members = [
    member(1, 'minimax', MODELS[0]),
    member(2, 'poolside', MODELS[1]),
    member(3, 'inclusionai', MODELS[2])
  ];
  return {
    schema: 'metaengine.model-gateway.free-committee.v1',
    task_id: 'task-1',
    committee_size: 3,
    quorum_required: 2,
    successful_members: 3,
    quorum_met: true,
    committee_status: 'QUORUM_MET',
    providers: ['minimax', 'poolside', 'inclusionai'],
    models_requested: [...MODELS],
    members,
    synthesis_performed: false,
    synthesis: null,
    started_at: '2026-08-29T04:50:00.000Z',
    completed_at: '2026-08-29T04:50:01.000Z',
    request_sha256: 'b'.repeat(64),
    zero_spend_verified: true,
    zero_spend_evidence: zeroSpendEvidence(),
    privacy_classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN',
    confidential_data_supported: false,
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false,
    ...overrides
  };
}

test('supervisor advisory preserves raw answers but denies direct action and consensus claims', () => {
  const source = receipt();
  const advisory = toSupervisorAdvisory(source);
  assert.equal(advisory.schema, 'metaengine.supervisor.advisory-committee.v1');
  assert.equal(advisory.quorum_met, true);
  assert.equal(advisory.zero_spend_verified, true);
  assert.equal(advisory.request_sha256, source.request_sha256);
  assert.match(advisory.zero_spend_evidence_sha256, /^[0-9a-f]{64}$/);
  assert.equal(advisory.availability_quorum_only, true);
  assert.equal(advisory.semantic_consensus_evaluated, false);
  assert.equal(advisory.semantic_consensus, null);
  assert.equal(advisory.synthesis_performed, false);
  assert.equal(advisory.requires_supervisor_arbitration, true);
  assert.equal(advisory.direct_action_allowed, false);
  assert.equal(advisory.executable_action, null);
  assert.equal(advisory.authority_effect, false);
  assert.match(advisory.committee_receipt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(advisory.members[0].answer, 'answer-1');
  assert.match(advisory.members[0].answer_sha256, /^[0-9a-f]{64}$/);
});

test('adapter independently rejects authority or synthesis escalation', () => {
  assert.throws(() => toSupervisorAdvisory(receipt({ authority_effect: true })), /committee_authority_forbidden/);
  assert.throws(() => toSupervisorAdvisory(receipt({ synthesis_performed: true })), /committee_synthesis_forbidden/);
  assert.throws(() => toSupervisorAdvisory(receipt({ synthesis: { winner: 1 } })), /committee_synthesis_must_be_null/);

  const memberAuthority = receipt();
  memberAuthority.members[1].authority_effect = true;
  assert.throws(() => toSupervisorAdvisory(memberAuthority), /committee_member_authority_forbidden/);
});

test('adapter rejects inconsistent quorum instead of trusting producer metadata', () => {
  const source = receipt();
  source.members[0] = member(1, 'minimax', MODELS[0], { status: 'FAILED' });
  source.members[1] = member(2, 'poolside', MODELS[1], { status: 'FAILED' });
  assert.throws(() => validateCommitteeReceipt(source), /committee_success_count_mismatch/);

  source.successful_members = 1;
  assert.throws(() => validateCommitteeReceipt(source), /committee_quorum_mismatch/);
});

test('adapter rejects provider/model and served-model provenance drift', () => {
  const providerDrift = receipt();
  providerDrift.members[0].provider_family = 'poolside';
  assert.throws(() => toSupervisorAdvisory(providerDrift), /provider_order_mismatch/);

  const servedDrift = receipt();
  servedDrift.members[0].served_model = 'minimax/minimax-m2.7-free';
  assert.throws(() => toSupervisorAdvisory(servedDrift), /served_model_mismatch/);
});

test('adapter requires pricing/privacy evidence to be bound into the advisory receipt hash', () => {
  assert.throws(() => toSupervisorAdvisory(receipt({ zero_spend_verified: false })), /zero_spend_verification_required/);
  assert.throws(() => toSupervisorAdvisory(receipt({ zero_spend_evidence: null })), /zero_spend_evidence_required/);
  const priceDrift = receipt();
  priceDrift.zero_spend_evidence.models[1].zero_price = false;
  assert.throws(() => toSupervisorAdvisory(priceDrift), /zero_price_evidence_required/);
  const privacyDrift = receipt({ privacy_classification: 'CATALOG_ZDR_AND_NO_TRAINING' });
  assert.throws(() => toSupervisorAdvisory(privacyDrift), /privacy_classification_mismatch/);
});

test('canonical JSON makes committee receipt hashing stable across object key order', () => {
  const left = { z: 1, a: { y: 2, x: [3, { b: true, a: null }] } };
  const right = { a: { x: [3, { a: null, b: true }], y: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
});
