import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../lib/security.mjs';
import { canonicalJson, toSupervisorAdvisory } from '../lib/supervisor-advisory.mjs';
import { verifyChallengeReadback, verifyCommitteeAdvisoryReadback } from '../lib/readback-verifier.mjs';

const MODELS = [
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
];
const PROVIDERS = ['minimax', 'poolside', 'inclusionai'];

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

function committeeMember(index, status = 'SUCCESS') {
  if (status === 'FAILED') {
    return {
      member_id: `committee-${index + 1}`,
      status: 'FAILED',
      provider_family: PROVIDERS[index],
      requested_model: MODELS[index],
      served_model: null,
      error: 'gateway_http_403',
      upstream_status: 403,
      started_at: '2026-08-29T05:00:00.000Z',
      completed_at: '2026-08-29T05:00:01.000Z',
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      authority_effect: false
    };
  }
  return {
    member_id: `committee-${index + 1}`,
    status: 'SUCCESS',
    provider_family: PROVIDERS[index],
    requested_model: MODELS[index],
    served_model: MODELS[index],
    answer: `proposal-${index + 1}`,
    response_sha256: String(index + 1).repeat(64),
    started_at: '2026-08-29T05:00:00.000Z',
    completed_at: '2026-08-29T05:00:01.000Z',
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  };
}

function committeeReceipt({ taskId = 'readback-task:propose', statuses = ['SUCCESS', 'SUCCESS', 'SUCCESS'] } = {}) {
  const members = statuses.map((status, index) => committeeMember(index, status));
  const successes = members.filter((member) => member.status === 'SUCCESS').length;
  return {
    schema: 'metaengine.model-gateway.free-committee.v1',
    task_id: taskId,
    committee_size: 3,
    quorum_required: 2,
    successful_members: successes,
    quorum_met: successes >= 2,
    committee_status: successes >= 2 ? 'QUORUM_MET' : 'QUORUM_FAILED',
    providers: [...PROVIDERS],
    models_requested: [...MODELS],
    members,
    synthesis_performed: false,
    synthesis: null,
    started_at: '2026-08-29T05:00:00.000Z',
    completed_at: '2026-08-29T05:00:01.000Z',
    request_sha256: 'b'.repeat(64),
    zero_spend_verified: true,
    zero_spend_evidence: zeroSpendEvidence(),
    privacy_classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN',
    confidential_data_supported: false,
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  };
}

function challengeRound(round1) {
  const successes = round1.members.filter((member) => member.status === 'SUCCESS');
  const assignments = successes.map((challenger, index) => {
    const target = successes[(index + 1) % successes.length];
    return {
      challenger_member_id: challenger.member_id,
      challenger_model: challenger.requested_model,
      challenger_provider: challenger.provider_family,
      target_member_id: target.member_id,
      target_model: target.requested_model,
      target_provider: target.provider_family
    };
  });
  const challenges = assignments.map((assignment, index) => {
    const target = successes.find((member) => member.member_id === assignment.target_member_id);
    const critique = `critique-${index + 1}-of-${assignment.target_member_id}`;
    return {
      challenge_id: `challenge-${index + 1}`,
      status: 'SUCCESS',
      challenger_member_id: assignment.challenger_member_id,
      challenger_provider: assignment.challenger_provider,
      challenger_model: assignment.challenger_model,
      served_model: assignment.challenger_model,
      target_member_id: assignment.target_member_id,
      target_provider: assignment.target_provider,
      target_model: assignment.target_model,
      target_answer_sha256: sha256(target.answer),
      critique,
      critique_sha256: sha256(critique),
      response_sha256: String(index + 4).repeat(64),
      started_at: '2026-08-29T05:00:02.000Z',
      completed_at: '2026-08-29T05:00:03.000Z',
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      authority_effect: false
    };
  });
  return {
    schema: 'metaengine.model-gateway.free-committee-challenge-round.v1',
    task_id: 'readback-task:rebut',
    source_round1_receipt_sha256: sha256(canonicalJson(round1)),
    assignments,
    challenges,
    successful_challenges: challenges.length,
    target_coverage_complete: true,
    challenge_status: 'COMPLETE',
    semantic_consensus_evaluated: false,
    synthesis_performed: false,
    started_at: '2026-08-29T05:00:02.000Z',
    completed_at: '2026-08-29T05:00:03.000Z',
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  };
}

function completeChallengeReceipt() {
  const round1 = committeeReceipt();
  const round1Advisory = toSupervisorAdvisory(round1);
  const round2 = zeroSpendEvidence();
  const challenges = challengeRound(round1);
  const core = {
    schema: 'metaengine.model-gateway.free-committee-challenge.v1',
    task_id: 'readback-task',
    request_sha256: round1.request_sha256,
    topology: 'SPARSE_RING_TARGETED_FALSIFICATION_V1',
    round1,
    round1_advisory: round1Advisory,
    round2_zero_spend_evidence: round2,
    round2_zero_spend_evidence_sha256: sha256(canonicalJson(round2)),
    challenge_round: challenges,
    challenge_round_sha256: sha256(canonicalJson(challenges)),
    challenge_status: 'COMPLETE',
    target_coverage_complete: true,
    semantic_consensus_evaluated: false,
    semantic_consensus: null,
    synthesis_performed: false,
    requires_supervisor_arbitration: true,
    direct_action_allowed: false,
    executable_action: null,
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    confidential_data_supported: false,
    canonical: false,
    authority_effect: false
  };
  return { ...core, receipt_sha256: sha256(canonicalJson(core)) };
}

function skippedChallengeReceipt() {
  const round1 = committeeReceipt({ statuses: ['SUCCESS', 'FAILED', 'FAILED'] });
  const core = {
    schema: 'metaengine.model-gateway.free-committee-challenge.v1',
    task_id: 'readback-task',
    request_sha256: round1.request_sha256,
    topology: 'SPARSE_RING_TARGETED_FALSIFICATION_V1',
    round1,
    round1_advisory: toSupervisorAdvisory(round1),
    round2_zero_spend_evidence: null,
    challenge_round: null,
    challenge_status: 'SKIPPED_ROUND1_QUORUM_FAILED',
    semantic_consensus_evaluated: false,
    semantic_consensus: null,
    synthesis_performed: false,
    requires_supervisor_arbitration: true,
    direct_action_allowed: false,
    executable_action: null,
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    confidential_data_supported: false,
    canonical: false,
    authority_effect: false
  };
  return { ...core, receipt_sha256: sha256(canonicalJson(core)) };
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
}

function rehashRoot(receipt) {
  const { receipt_sha256: _old, ...core } = receipt;
  receipt.receipt_sha256 = sha256(canonicalJson(core));
  return receipt;
}

test('committee advisory survives JSONB-style key reordering and verifies all deterministic hashes', () => {
  const committee = committeeReceipt();
  const advisory = toSupervisorAdvisory(committee);
  const result = verifyCommitteeAdvisoryReadback({
    committeeReceipt: reverseKeys(committee),
    supervisorAdvisory: reverseKeys(advisory)
  });
  assert.equal(result.valid, true);
  assert.equal(result.quorum_met, true);
  assert.match(result.committee_receipt_sha256, /^[0-9a-f]{64}$/);
});

test('complete challenge receipt survives key reordering after persistence readback', () => {
  const result = verifyChallengeReadback(reverseKeys(completeChallengeReceipt()));
  assert.equal(result.valid, true);
  assert.equal(result.challenge_status, 'COMPLETE');
  assert.equal(result.target_coverage_complete, true);
  assert.equal(result.successful_challenges, 3);
});

test('readback detects changed proposal even when attacker recomputes only the outer receipt hash', () => {
  const receipt = completeChallengeReceipt();
  receipt.round1.members[0].answer = 'mutated proposal';
  rehashRoot(receipt);
  assert.throws(() => verifyChallengeReadback(receipt), /supervisor_advisory_readback_mismatch/);
});

test('readback rejects repriced Wave-2 evidence even with recomputed evidence and outer hashes', () => {
  const receipt = completeChallengeReceipt();
  receipt.round2_zero_spend_evidence.models[1].zero_price = false;
  receipt.round2_zero_spend_evidence_sha256 = sha256(canonicalJson(receipt.round2_zero_spend_evidence));
  rehashRoot(receipt);
  assert.throws(() => verifyChallengeReadback(receipt), /zero_price_required/);
});

test('readback rejects mutated critique after recomputed challenge-round and outer hashes', () => {
  const receipt = completeChallengeReceipt();
  receipt.challenge_round.challenges[0].critique = 'mutated critique';
  receipt.challenge_round_sha256 = sha256(canonicalJson(receipt.challenge_round));
  rehashRoot(receipt);
  assert.throws(() => verifyChallengeReadback(receipt), /challenge_critique_hash_mismatch/);
});

test('readback recomputes target coverage instead of trusting persisted COMPLETE status', () => {
  const receipt = completeChallengeReceipt();
  receipt.challenge_round.challenges[0].status = 'FAILED';
  receipt.challenge_round.challenges[0].served_model = null;
  receipt.challenge_round.challenges[0].error = 'transport_failure';
  delete receipt.challenge_round.challenges[0].critique;
  delete receipt.challenge_round.challenges[0].critique_sha256;
  delete receipt.challenge_round.challenges[0].response_sha256;
  receipt.challenge_round_sha256 = sha256(canonicalJson(receipt.challenge_round));
  rehashRoot(receipt);
  assert.throws(() => verifyChallengeReadback(receipt), /successful_challenge_count_mismatch|target_coverage_mismatch/);
});

test('readback rejects any authority escalation even when outer hash is recomputed', () => {
  const receipt = completeChallengeReceipt();
  receipt.direct_action_allowed = true;
  rehashRoot(receipt);
  assert.throws(() => verifyChallengeReadback(receipt), /direct_action_forbidden/);
});

test('readback accepts intentional skipped Wave-2 state only when Wave-1 quorum is actually unavailable', () => {
  const result = verifyChallengeReadback(skippedChallengeReceipt());
  assert.equal(result.valid, true);
  assert.equal(result.challenge_status, 'SKIPPED_ROUND1_QUORUM_FAILED');
  assert.equal(result.target_coverage_complete, false);
});
