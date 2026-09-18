import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiProxyCalibrationPolicy,
  createRsiProxyHoldoutPair,
  createRsiProxyReliabilitySnapshot,
} from '../src/rsi-proxy-reliability-calibration.mjs';
import {
  createRsiDisagreementCommitteeMember,
  createRsiDisagreementCommittee,
  verifyRsiDisagreementCommittee,
  createRsiAcquisitionCandidate,
  createRsiCommitteePrediction,
  createRsiActiveEvaluationBatch,
  verifyRsiActiveEvaluationBatch,
  rsiDisagreementAcquisitionTrustRootSnapshot,
} from '../src/rsi-disagreement-acquisition.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;
const sha = (char) => char.repeat(40);
const cid = (char) => `candidate_sha256_${char.repeat(64)}`;

function proxyPolicy(id, proxyChar, overrides = {}) {
  return createRsiProxyCalibrationPolicy({
    policy_id: `proxy.policy.${id}`,
    proxy_stage: 'LLM_JUDGE_TRIAGE',
    proxy_identity_digest: d(proxyChar),
    full_holdout_digest: d('f'),
    intervention_suite_digest: d(id === 'a' ? 'd' : 'e'),
    min_pairs: 4,
    proxy_pass_threshold: 0.5,
    holdout_pass_threshold: 0.5,
    calibrated_min_concordance: 0.7,
    degraded_min_concordance: 0.55,
    max_false_positive_upper: 0.65,
    max_brier: 0.25,
    recent_window: 4,
    drift_brier_delta: 0.2,
    external_policy_owner: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

function pair(policy, index, proxy, holdout, evaluatorChar = '9') {
  return createRsiProxyHoldoutPair({
    pair_id: `${policy.policy_id}.pair.${index}`,
    policy,
    sequence: index,
    candidate_id: `candidate_sha256_${index.toString(16).padStart(64, '0')}`,
    candidate_sha: index.toString(16).padStart(40, '0'),
    proxy_score: proxy,
    holdout_score: holdout,
    proxy_receipt_digest: d('1'),
    holdout_receipt_digest: d('2'),
    evaluator_root_digest: d(evaluatorChar),
    intervention_case: true,
    evidence_refs: [`PAIR_${policy.policy_id}_${index}`],
    external_evaluator: true,
    authored_by_candidate: false,
  });
}

function calibratedSnapshot(policy) {
  const rows = [
    pair(policy, 1, 0.1, 0.1),
    pair(policy, 2, 0.3, 0.3),
    pair(policy, 3, 0.7, 0.7),
    pair(policy, 4, 0.9, 0.9),
  ];
  return createRsiProxyReliabilitySnapshot({ policy, pairs: rows });
}

function unreliableSnapshot(policy) {
  const rows = [
    pair(policy, 1, 0.9, 0.1),
    pair(policy, 2, 0.7, 0.3),
    pair(policy, 3, 0.3, 0.7),
    pair(policy, 4, 0.1, 0.9),
  ];
  return createRsiProxyReliabilitySnapshot({ policy, pairs: rows });
}

function member(id, family, proxyChar, snapshotMode = 'calibrated') {
  const policy = proxyPolicy(id, proxyChar);
  const snapshot = snapshotMode === 'unreliable' ? unreliableSnapshot(policy) : calibratedSnapshot(policy);
  return createRsiDisagreementCommitteeMember({
    member_id: `committee.member.${id}`,
    predictor_family: family,
    predictor_identity_digest: d(proxyChar),
    proxy_policy: policy,
    proxy_snapshot: snapshot,
    external_member_owner: true,
    authored_by_candidate: false,
  });
}

function committee(members = [
  member('a', 'GPT_5_6_SOL_JUDGE', 'a'),
  member('b', 'GLM_5_JUDGE', 'b'),
]) {
  return createRsiDisagreementCommittee({
    committee_id: 'committee.rsi.active-eval.1',
    members,
    full_holdout_digest: d('f'),
    evaluator_root_digest: d('9'),
    external_committee_owner: true,
    authored_by_candidate: false,
  });
}

function candidate(char, { surface = 'BROWSER_RUNTIME', novelty = 0.5, cost = 10 } = {}) {
  return createRsiAcquisitionCandidate({
    candidate_id: cid(char),
    candidate_sha: sha(char),
    mutation_surface: surface,
    novelty_score: novelty,
    estimated_full_eval_cost_units: cost,
    low_fidelity_eligibility_digest: d(char === 'f' ? 'e' : char),
    external_candidate_registry: true,
    authored_by_candidate: false,
  });
}

function prediction(comm, memberId, cand, pass, score = pass, ev = 'c') {
  return createRsiCommitteePrediction({
    committee: comm,
    member_id: memberId,
    candidate: cand,
    predicted_holdout_score: score,
    predicted_pass_probability: pass,
    evidence_digest: d(ev),
    evidence_refs: [`PRED_${memberId}_${cand.candidate_sha.slice(0, 4)}`],
    external_predictor: true,
    authored_by_candidate: false,
  });
}

function matrix(comm, candidates, probabilitiesByCandidate) {
  const out = [];
  for (const cand of candidates) {
    const probs = probabilitiesByCandidate[cand.candidate_id];
    for (let index = 0; index < comm.members.length; index += 1) {
      out.push(prediction(
        comm,
        comm.members[index].member_id,
        cand,
        probs[index],
        probs[index],
        index % 2 === 0 ? 'c' : 'd',
      ));
    }
  }
  return out;
}

test('committee weights are derived from V1.22 calibration instead of candidate claims', () => {
  const calibrated = member('a', 'GPT_5_6_SOL_JUDGE', 'a');
  const unreliable = member('b', 'GLM_5_JUDGE', 'b', 'unreliable');

  assert.equal(calibrated.reliability_state, 'CALIBRATED');
  assert.equal(calibrated.reliability_weight, 1);
  assert.equal(calibrated.candidate_can_edit_member_weight, false);
  assert.equal(unreliable.reliability_state, 'UNRELIABLE');
  assert.equal(unreliable.reliability_weight, 0);
  assert.equal(unreliable.drift_detected, false);
  assert.equal(unreliable.authority_effect, false);
});

test('committee requires distinct predictor identities and exposes disagreement only with calibrated family diversity', () => {
  const comm = committee();
  verifyRsiDisagreementCommittee(comm);
  assert.equal(comm.active_member_count, 2);
  assert.equal(comm.active_predictor_family_count, 2);
  assert.equal(comm.diversity_sufficient_for_disagreement, true);
  assert.equal(comm.unreliable_members_have_zero_weight, true);
  assert.equal(comm.disagreement_is_compute_allocation_only, true);
  assert.equal(comm.candidate_can_choose_committee, false);
  assert.equal(comm.candidate_can_choose_member_weights, false);
  assert.equal(comm.authority_effect, false);

  const duplicateIdentity = member('c', 'OTHER_JUDGE', 'a');
  assert.throws(() => createRsiDisagreementCommittee({
    committee_id: 'committee.duplicate',
    members: [member('a', 'GPT_5_6_SOL_JUDGE', 'a'), duplicateIdentity],
    full_holdout_digest: d('f'),
    evaluator_root_digest: d('9'),
    external_committee_owner: true,
    authored_by_candidate: false,
  }), /predictor_duplicate/);
});

test('active evaluation selects high-disagreement candidates for scarce full holdout slots', () => {
  const comm = committee();
  const a = candidate('1', { novelty: 0.4, cost: 10 });
  const b = candidate('2', { novelty: 0.3, cost: 10 });
  const c = candidate('3', { novelty: 0.9, cost: 12, surface: 'AGENT_ORCHESTRATION' });
  const candidates = [a, b, c];

  const predictions = matrix(comm, candidates, {
    [a.candidate_id]: [0.95, 0.05],
    [b.candidate_id]: [0.85, 0.82],
    [c.candidate_id]: [0.45, 0.42],
  });

  const batch = createRsiActiveEvaluationBatch({
    committee: comm,
    candidates,
    predictions,
    batch_id: 'active-eval.batch.1',
    full_eval_slots: 2,
    disagreement_slots: 1,
    promise_slots: 1,
    diversity_slots: 0,
    external_acquisition_owner: true,
    authored_by_candidate: false,
  });
  verifyRsiActiveEvaluationBatch(batch);

  const aDecision = batch.decisions.find((row) => row.candidate_id === a.candidate_id);
  const bDecision = batch.decisions.find((row) => row.candidate_id === b.candidate_id);
  assert.equal(aDecision.selected_for_full_holdout, true);
  assert.equal(aDecision.selection_lane, 'DISAGREEMENT');
  assert.ok(aDecision.weighted_stddev > bDecision.weighted_stddev);
  assert.equal(bDecision.selected_for_full_holdout, true);
  assert.equal(bDecision.selection_lane, 'PROMISE');
  assert.equal(batch.committee_trusted_for_disagreement, true);
  assert.equal(batch.fallback_mode, 'CALIBRATED_DISAGREEMENT');
  assert.equal(batch.selected_count, 2);
  assert.equal(batch.authority_effect, false);
});

test('diversity lane preserves an unconventional mutation surface even when its mean score is lower', () => {
  const comm = committee();
  const a = candidate('1', { surface: 'BROWSER_RUNTIME', novelty: 0.2 });
  const b = candidate('2', { surface: 'BROWSER_RUNTIME', novelty: 0.1 });
  const c = candidate('3', { surface: 'RSI_IMPROVER', novelty: 0.99 });
  const candidates = [a, b, c];
  const predictions = matrix(comm, candidates, {
    [a.candidate_id]: [0.9, 0.88],
    [b.candidate_id]: [0.8, 0.79],
    [c.candidate_id]: [0.3, 0.32],
  });

  const batch = createRsiActiveEvaluationBatch({
    committee: comm,
    candidates,
    predictions,
    batch_id: 'active-eval.batch.diversity',
    full_eval_slots: 2,
    disagreement_slots: 0,
    promise_slots: 1,
    diversity_slots: 1,
    external_acquisition_owner: true,
    authored_by_candidate: false,
  });
  const cDecision = batch.decisions.find((row) => row.candidate_id === c.candidate_id);
  assert.equal(cDecision.selected_for_full_holdout, true);
  assert.equal(cDecision.selection_lane, 'DIVERSITY');
});

test('unreliable or collapsed committee disables disagreement and falls back instead of pretending uncertainty is calibrated', () => {
  const comm = committee([
    member('a', 'GPT_5_6_SOL_JUDGE', 'a'),
    member('b', 'GLM_5_JUDGE', 'b', 'unreliable'),
  ]);
  assert.equal(comm.active_member_count, 1);
  assert.equal(comm.diversity_sufficient_for_disagreement, false);

  const a = candidate('1', { novelty: 0.9 });
  const b = candidate('2', { novelty: 0.4 });
  const candidates = [a, b];
  const predictions = matrix(comm, candidates, {
    [a.candidate_id]: [0.2, 0.95],
    [b.candidate_id]: [0.8, 0.05],
  });

  const batch = createRsiActiveEvaluationBatch({
    committee: comm,
    candidates,
    predictions,
    batch_id: 'active-eval.batch.fallback',
    full_eval_slots: 1,
    disagreement_slots: 1,
    promise_slots: 0,
    diversity_slots: 0,
    external_acquisition_owner: true,
    authored_by_candidate: false,
  });
  assert.equal(batch.committee_trusted_for_disagreement, false);
  assert.equal(batch.fallback_mode, 'DIVERSITY_PROMISE_WITHOUT_DISAGREEMENT');
  assert.equal(batch.selected_count, 1);
  const selected = batch.decisions.find((row) => row.selected_for_full_holdout);
  assert.equal(selected.selection_lane, 'FALLBACK');
  assert.equal(selected.request_is_evaluation_result, false);
  assert.equal(selected.request_is_scheduler_task, false);
});

test('full committee prediction matrix is mandatory so a predictor cannot selectively abstain on inconvenient candidates', () => {
  const comm = committee();
  const a = candidate('1');
  const b = candidate('2');
  const candidates = [a, b];
  const predictions = [
    prediction(comm, comm.members[0].member_id, a, 0.5),
    prediction(comm, comm.members[1].member_id, a, 0.5),
    prediction(comm, comm.members[0].member_id, b, 0.5),
  ];
  assert.throws(() => createRsiActiveEvaluationBatch({
    committee: comm,
    candidates,
    predictions,
    batch_id: 'active-eval.batch.incomplete',
    full_eval_slots: 1,
    disagreement_slots: 1,
    promise_slots: 0,
    diversity_slots: 0,
    external_acquisition_owner: true,
    authored_by_candidate: false,
  }), /prediction_matrix_incomplete/);
});

test('candidate cannot self-author acquisition identity or prediction', () => {
  assert.throws(() => createRsiAcquisitionCandidate({
    candidate_id: cid('1'),
    candidate_sha: sha('1'),
    mutation_surface: 'BROWSER_RUNTIME',
    novelty_score: 1,
    estimated_full_eval_cost_units: 1,
    low_fidelity_eligibility_digest: d('1'),
    external_candidate_registry: false,
    authored_by_candidate: true,
  }), /external_origin_required/);

  const comm = committee();
  const a = candidate('1');
  assert.throws(() => createRsiCommitteePrediction({
    committee: comm,
    member_id: comm.members[0].member_id,
    candidate: a,
    predicted_holdout_score: 1,
    predicted_pass_probability: 1,
    evidence_digest: d('1'),
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_predictor: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('same durable committee/predictions/slots produce deterministic acquisition decisions', () => {
  const comm = committee();
  const a = candidate('1', { novelty: 0.4 });
  const b = candidate('2', { novelty: 0.8 });
  const c = candidate('3', { novelty: 0.2 });
  const candidates = [a, b, c];
  const predictions = matrix(comm, candidates, {
    [a.candidate_id]: [0.9, 0.1],
    [b.candidate_id]: [0.6, 0.5],
    [c.candidate_id]: [0.7, 0.7],
  });
  const input = {
    committee: comm,
    candidates,
    predictions,
    batch_id: 'active-eval.batch.deterministic',
    full_eval_slots: 2,
    disagreement_slots: 1,
    promise_slots: 0,
    diversity_slots: 1,
    external_acquisition_owner: true,
    authored_by_candidate: false,
  };
  const left = createRsiActiveEvaluationBatch(input);
  const right = createRsiActiveEvaluationBatch(input);
  assert.equal(left.batch_digest, right.batch_digest);
  assert.deepEqual(left.decisions, right.decisions);
});

test('acquisition decisions are requests for the existing scheduler/evaluator only, never tasks, leases or truth', () => {
  const comm = committee();
  const a = candidate('1');
  const b = candidate('2');
  const candidates = [a, b];
  const predictions = matrix(comm, candidates, {
    [a.candidate_id]: [0.9, 0.1],
    [b.candidate_id]: [0.8, 0.8],
  });
  const batch = createRsiActiveEvaluationBatch({
    committee: comm,
    candidates,
    predictions,
    batch_id: 'active-eval.batch.authority',
    full_eval_slots: 1,
    disagreement_slots: 1,
    promise_slots: 0,
    diversity_slots: 0,
    external_acquisition_owner: true,
    authored_by_candidate: false,
  });
  for (const row of batch.decisions) {
    assert.equal(row.request_is_scheduler_task, false);
    assert.equal(row.request_is_lease, false);
    assert.equal(row.request_is_evaluation_result, false);
    assert.equal(row.request_is_promotion_authority, false);
    assert.equal(row.existing_scheduler_admission_required, true);
    assert.equal(row.authority_effect, false);
  }
  assert.equal(batch.active_learning_acquisition_only, true);
  assert.equal(batch.low_fidelity_disagreement_is_not_truth, true);
  assert.equal(batch.full_hidden_holdout_is_required, true);
  assert.equal(batch.candidate_can_self_schedule, false);
});

test('trust root records calibrated query-by-committee as evaluation allocation only', () => {
  const root = rsiDisagreementAcquisitionTrustRootSnapshot();
  assert.equal(root.mechanism, 'CALIBRATED_QUERY_BY_COMMITTEE_FOR_FULL_HOLDOUT_ALLOCATION');
  assert.equal(root.minimum_active_committee_members, 2);
  assert.equal(root.minimum_active_predictor_families, 2);
  assert.equal(root.unreliable_members_have_zero_weight, true);
  assert.equal(root.v1_22_proxy_calibration_required, true);
  assert.equal(root.full_prediction_matrix_required, true);
  assert.equal(root.disagreement_lane, true);
  assert.equal(root.promise_lane, true);
  assert.equal(root.diversity_lane, true);
  assert.equal(root.unreliable_committee_fallback, true);
  assert.equal(root.full_hidden_holdout_required, true);
  assert.equal(root.candidate_can_choose_committee, false);
  assert.equal(root.candidate_can_choose_queries, false);
  assert.equal(root.candidate_can_self_schedule, false);
  assert.equal(root.active_learning_signal_is_promotion_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.disagreement_root_digest, /^sha256:[0-9a-f]{64}$/);
});
