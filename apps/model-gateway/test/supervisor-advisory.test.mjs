import test from 'node:test';
import assert from 'node:assert/strict';
import { toSupervisorAdvisory, validateCommitteeReceipt } from '../lib/supervisor-advisory.mjs';

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

function receipt(overrides = {}) {
  const members = [
    member(1, 'minimax', 'minimax/minimax-m3-free'),
    member(2, 'poolside', 'poolside/laguna-s-2.1-free'),
    member(3, 'inclusionai', 'inclusionai/ling-3.0-flash-fin-free')
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
    models_requested: members.map((x) => x.requested_model),
    members,
    synthesis_performed: false,
    synthesis: null,
    started_at: '2026-08-29T04:50:00.000Z',
    completed_at: '2026-08-29T04:50:01.000Z',
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
  source.members[0] = member(1, 'minimax', 'minimax/minimax-m3-free', { status: 'FAILED' });
  source.members[1] = member(2, 'poolside', 'poolside/laguna-s-2.1-free', { status: 'FAILED' });
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
