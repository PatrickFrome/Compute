import assert from 'node:assert/strict';
import test from 'node:test';

import { createRsiExperienceLesson } from '../src/rsi-open-ended-search-policy.mjs';
import {
  createRsiGroupMember,
  createRsiGroupExperiencePool,
  createRsiGroupTransferPlan,
  createRsiGroupTransferReceipt,
  finalizeRsiGroupTransfer,
  verifyRsiGroupTransferResult,
} from '../src/rsi-group-experience-exchange.mjs';
import {
  createRsiRetrievalPolicyState,
  verifyRsiRetrievalPolicyState,
  createRsiMemoryDiagnostic,
  verifyRsiMemoryDiagnostic,
  createRsiAdaptiveRetrievalPlan,
  verifyRsiAdaptiveRetrievalPlan,
  createRsiRetrievalFeedback,
  applyRsiRetrievalFeedback,
  rsiAdaptiveRetrievalTrustRootSnapshot,
} from '../src/rsi-adaptive-experience-retrieval.mjs';

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;
const candidateId = (char) => `candidate_sha256_${char.repeat(64)}`;

function member(char, modelFamily) {
  return createRsiGroupMember({
    member_id: `member.${char}`,
    candidate_id: candidateId(char),
    candidate_sha: sha(char),
    mutation_surface: 'BROWSER_RUNTIME',
    model_family: modelFamily,
    environment_family: 'WINDOWS_BROWSER',
    lineage_id: `lineage.${char}`,
    archive_generation: Number(char) + 10,
    external_identity_verified: true,
    authored_by_candidate: false,
  });
}

function lesson(char, mechanism, family) {
  return createRsiExperienceLesson({
    source_candidate_id: candidateId(char),
    source_candidate_sha: sha(char),
    mutation_surface: 'BROWSER_RUNTIME',
    failure_class: 'TRANSPORT_AMBIGUITY',
    mechanism_tags: [mechanism],
    challenge_families: [family],
    recommendation_codes: ['PRESERVE_EXTERNAL_EVIDENCE'],
    evidence_digest: d(char),
    evidence_refs: [`RUN_${char}`],
    external_verifier: true,
    authored_by_candidate: false,
  });
}

function fixture() {
  const pool = createRsiGroupExperiencePool({
    group_id: 'group.retrieval.fixture',
    members: [
      member('1', 'GPT_5_6_SOL'),
      member('2', 'GLM_5'),
    ],
    experience_lessons: [
      lesson('1', 'RESULT_READBACK', 'COMMAND_LIVENESS'),
      lesson('2', 'CROSS_MODEL_TRANSFER', 'COMMAND_LIVENESS'),
    ],
  });
  const transferPlan = createRsiGroupTransferPlan({
    pool,
    target: {
      target_id: 'target.retrieval.8',
      candidate_id: candidateId('8'),
      candidate_sha: sha('8'),
      mutation_surface: 'BROWSER_RUNTIME',
      model_family: 'GPT_5_6_SOL',
      environment_family: 'WINDOWS_BROWSER',
      context_tags: ['COMMAND_LIVENESS', 'RESULT_READBACK'],
      external_identity_verified: true,
      authored_by_candidate: false,
    },
    max_items: 2,
    max_items_per_source: 1,
  });
  const receipts = transferPlan.selected_items.map((item, index) => createRsiGroupTransferReceipt({
    plan: transferPlan,
    pool,
    item_id: item.item_id,
    outcome: index === 0 ? 'TRANSFER_VERIFIED' : 'NEGATIVE_TRANSFER',
    target_holdout_digest: index === 0 ? d('4') : d('5'),
    evaluator_root_digest: d('6'),
    target_hard_invariants_pass: index === 0,
    net_benefit_verified: index === 0,
    measured_delta: index === 0 ? 0.15 : -0.1,
    evidence_refs: [`TARGET_RUN_${index}`],
    external_transfer_evaluator: true,
    authored_by_candidate: false,
  }));
  const transferResult = finalizeRsiGroupTransfer({
    plan: transferPlan,
    pool,
    receipts,
  });
  verifyRsiGroupTransferResult(transferResult, transferPlan, pool);
  return { pool, transferPlan, transferResult };
}

function singleArmState() {
  return createRsiRetrievalPolicyState({
    state_id: 'retrieval.state.1',
    update_seq: 1,
    arms: [{
      policy_id: 'FAILURE_FIRST',
      attempts: 4,
      useful_episodes: 3,
      harmful_episodes: 0,
      external_metrics_verified: true,
      authored_by_candidate: false,
    }],
  });
}

test('retrieval policy state is external-metrics-only and candidate cannot edit its statistics', () => {
  const state = singleArmState();
  verifyRsiRetrievalPolicyState(state);
  assert.equal(state.selection_rule, 'SEEDED_THOMPSON_SAMPLING');
  assert.equal(state.exact_replay_seed_required, true);
  assert.equal(state.external_metrics_only, true);
  assert.equal(state.candidate_can_edit_statistics, false);
  assert.equal(state.candidate_can_select_policy, false);
  assert.equal(state.arms[0].posterior_alpha, 4);
  assert.equal(state.authority_effect, false);

  assert.throws(() => createRsiRetrievalPolicyState({
    state_id: 'retrieval.bad',
    arms: [{
      policy_id: 'FAILURE_FIRST',
      attempts: 1,
      useful_episodes: 1,
      harmful_episodes: 0,
      external_metrics_verified: false,
      authored_by_candidate: true,
    }],
  }), /external_metrics_required/);
});

test('slow-timescale diagnostic is structured external evidence, not trusted free-form reflection', () => {
  const diagnostic = createRsiMemoryDiagnostic({
    diagnostic_id: 'diag.failure-recurrence.1',
    code: 'FAILURE_RECURRENCE',
    context_tags: ['COMMAND_LIVENESS'],
    evidence_digest: d('7'),
    evidence_refs: ['DIAG_RUN_1'],
    external_diagnostician: true,
    authored_by_candidate: false,
  });
  verifyRsiMemoryDiagnostic(diagnostic);
  assert.equal(diagnostic.freeform_reflection_trusted, false);
  assert.equal(diagnostic.raw_model_transcript_present, false);
  assert.equal(diagnostic.diagnostic_is_routing_authority, false);
  assert.equal(diagnostic.authority_effect, false);

  assert.throws(() => createRsiMemoryDiagnostic({
    diagnostic_id: 'diag.fake',
    code: 'FAILURE_RECURRENCE',
    context_tags: [],
    evidence_digest: d('8'),
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_diagnostician: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('adaptive retrieval consumes verified positive transfer only and excludes negative transfer memory from positive context', () => {
  const { pool, transferPlan, transferResult } = fixture();
  assert.equal(transferResult.verified_transfer_count, 1);
  assert.equal(transferResult.negative_transfer_count, 1);

  const plan = createRsiAdaptiveRetrievalPlan({
    policy_state: singleArmState(),
    pool,
    transfer_plan: transferPlan,
    transfer_result: transferResult,
    diagnostics: [createRsiMemoryDiagnostic({
      diagnostic_id: 'diag.failure-recurrence.2',
      code: 'FAILURE_RECURRENCE',
      context_tags: ['RESULT_READBACK'],
      evidence_digest: d('9'),
      evidence_refs: ['DIAG_RUN_2'],
      external_diagnostician: true,
      authored_by_candidate: false,
    })],
    episode_id: 'episode.100',
    max_items: 4,
  });
  verifyRsiAdaptiveRetrievalPlan(plan);
  assert.equal(plan.selected_policy_id, 'FAILURE_FIRST');
  assert.equal(plan.selected_item_count, 1);
  assert.equal(plan.selected_items[0].retrieval_state, 'VERIFIED_TRANSFER_ONLY');
  assert.equal(plan.selected_items[0].candidate_can_include_unverified_memory, false);
  assert.equal(plan.verified_transfer_memory_only, true);
  assert.equal(plan.negative_transfer_memory_not_injected_as_positive_context, true);
  assert.equal(plan.freeform_reflection_trusted, false);
  assert.equal(plan.retrieval_is_evaluation_authority, false);
  assert.equal(plan.retrieval_is_promotion_authority, false);
  assert.equal(plan.authority_effect, false);
});

test('seeded Thompson policy selection is deterministic for exact same state, episode and evidence', () => {
  const { pool, transferPlan, transferResult } = fixture();
  const state = createRsiRetrievalPolicyState({
    state_id: 'retrieval.state.multi',
    update_seq: 7,
    arms: [
      {
        policy_id: 'FAILURE_FIRST',
        attempts: 10,
        useful_episodes: 6,
        harmful_episodes: 1,
        external_metrics_verified: true,
        authored_by_candidate: false,
      },
      {
        policy_id: 'CROSS_MODEL_TRANSFER',
        attempts: 6,
        useful_episodes: 4,
        harmful_episodes: 1,
        external_metrics_verified: true,
        authored_by_candidate: false,
      },
      {
        policy_id: 'DIVERSITY_BALANCED',
        attempts: 2,
        useful_episodes: 1,
        harmful_episodes: 0,
        external_metrics_verified: true,
        authored_by_candidate: false,
      },
    ],
  });
  const input = {
    policy_state: state,
    pool,
    transfer_plan: transferPlan,
    transfer_result: transferResult,
    diagnostics: [],
    episode_id: 'episode.deterministic',
    max_items: 2,
  };
  const left = createRsiAdaptiveRetrievalPlan(input);
  const right = createRsiAdaptiveRetrievalPlan(input);
  assert.equal(left.plan_digest, right.plan_digest);
  assert.equal(left.selected_policy_id, right.selected_policy_id);
  assert.deepEqual(left.sampled_arms, right.sampled_arms);
  assert.deepEqual(left.selected_items, right.selected_items);
});

test('external feedback advances only the selected policy statistics and keeps authority zero', () => {
  const { pool, transferPlan, transferResult } = fixture();
  const state = singleArmState();
  const plan = createRsiAdaptiveRetrievalPlan({
    policy_state: state,
    pool,
    transfer_plan: transferPlan,
    transfer_result: transferResult,
    episode_id: 'episode.feedback.1',
    max_items: 2,
  });
  const feedback = createRsiRetrievalFeedback({
    plan,
    useful_retrieval: true,
    harmful_regression: false,
    evidence_digest: d('a'),
    evidence_refs: ['OUTCOME_RUN_1'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  const next = applyRsiRetrievalFeedback({ state, feedback });
  assert.equal(next.update_seq, state.update_seq + 1);
  assert.equal(next.arms[0].attempts, state.arms[0].attempts + 1);
  assert.equal(next.arms[0].useful_episodes, state.arms[0].useful_episodes + 1);
  assert.equal(next.arms[0].harmful_episodes, state.arms[0].harmful_episodes);
  assert.equal(next.candidate_can_edit_statistics, false);
  assert.equal(next.authority_effect, false);
});

test('candidate-authored feedback cannot update the fast-timescale policy state', () => {
  const { pool, transferPlan, transferResult } = fixture();
  const state = singleArmState();
  const plan = createRsiAdaptiveRetrievalPlan({
    policy_state: state,
    pool,
    transfer_plan: transferPlan,
    transfer_result: transferResult,
    episode_id: 'episode.feedback.bad',
  });
  assert.throws(() => createRsiRetrievalFeedback({
    plan,
    useful_retrieval: true,
    harmful_regression: false,
    evidence_digest: d('b'),
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_evaluator: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('tampered adaptive plan cannot turn retrieval into evaluator or promotion authority', () => {
  const { pool, transferPlan, transferResult } = fixture();
  const plan = createRsiAdaptiveRetrievalPlan({
    policy_state: singleArmState(),
    pool,
    transfer_plan: transferPlan,
    transfer_result: transferResult,
    episode_id: 'episode.tamper',
  });
  assert.throws(() => verifyRsiAdaptiveRetrievalPlan({
    ...plan,
    retrieval_is_promotion_authority: true,
  }), /plan_promotion_authority_invalid|plan_policy_invalid/);
  assert.throws(() => verifyRsiAdaptiveRetrievalPlan({
    ...plan,
    candidate_can_include_unverified_memory: true,
  }), /plan_policy_invalid/);
});

test('adaptive retrieval trust root freezes two-timescale learning outside candidate authority', () => {
  const root = rsiAdaptiveRetrievalTrustRootSnapshot();
  assert.equal(root.fast_timescale_policy_learning, true);
  assert.equal(root.slow_timescale_structured_diagnostics, true);
  assert.equal(root.selection_rule, 'SEEDED_THOMPSON_SAMPLING');
  assert.equal(root.exact_replay_seed_required, true);
  assert.equal(root.verified_transfer_memory_only, true);
  assert.equal(root.external_metrics_only, true);
  assert.equal(root.candidate_can_edit_statistics, false);
  assert.equal(root.candidate_can_select_policy, false);
  assert.equal(root.candidate_can_author_diagnostics, false);
  assert.equal(root.candidate_can_include_unverified_memory, false);
  assert.equal(root.freeform_reflection_trusted, false);
  assert.equal(root.retrieval_is_evaluation_authority, false);
  assert.equal(root.retrieval_is_promotion_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.retrieval_root_digest, /^sha256:[0-9a-f]{64}$/);
});
