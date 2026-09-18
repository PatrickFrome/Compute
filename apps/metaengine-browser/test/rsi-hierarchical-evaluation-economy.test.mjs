import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiAgentArchitectureGenome,
  createRsiAgentArchitectureTriageReceipt,
  selectRsiArchitecturesForFullEvaluation,
} from '../src/rsi-agent-architecture-search.mjs';
import {
  RsiHierarchicalEvaluationLedger,
  createRsiEvaluationStageReceipt,
  createRsiHierarchicalEvaluationPlan,
  rsiHierarchicalEvaluationTrustRootSnapshot,
  verifyRsiEvaluationStageReceipt,
  verifyRsiHierarchicalEvaluationPlan,
} from '../src/rsi-hierarchical-evaluation-economy.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;

function genome(index) {
  const id = `eval.arch.${index}`;
  const promptChar = (index % 9 + 1).toString();
  return createRsiAgentArchitectureGenome({
    genome_id: id,
    parent_genome_digest: null,
    nodes: [
      { node_id: `${id}.input`, type: 'INPUT_CONTEXT', max_iterations: 1 },
      { node_id: `${id}.model`, type: 'MODEL_CALL', model_role: index % 2 === 0 ? 'FAST' : 'DEEP', prompt_digest: d(promptChar), max_iterations: 1 },
      { node_id: `${id}.output`, type: 'OUTPUT', max_iterations: 1 },
    ],
    edges: [
      { from: `${id}.input`, to: `${id}.model` },
      { from: `${id}.model`, to: `${id}.output` },
    ],
    budget: {
      max_model_calls: 2 + index,
      max_total_tokens: 4000 + index * 1000,
      max_parallelism: 2,
      max_wall_time_ms: 30_000,
    },
    external_builder: true,
    authored_by_candidate: false,
  });
}

function searchDecision(count = 8) {
  const candidates = [];
  for (let index = 1; index <= count; index += 1) {
    const g = genome(index);
    const receipt = createRsiAgentArchitectureTriageReceipt({
      genome: g,
      structural_novelty_score: Math.min(1, index / count),
      cheap_judge_score: Math.max(0.05, 0.95 - index * 0.05),
      estimated_eval_cost: g.budget,
      evidence_digest: d(((index + 1) % 9 + 1).toString()),
      evidence_refs: [`TRIAGE_RUN_${index}`],
      external_triage_judge: true,
      authored_by_candidate: false,
    });
    candidates.push({ genome: g, triage_receipt: receipt });
  }
  return selectRsiArchitecturesForFullEvaluation({
    candidates,
    full_eval_slots: count,
    exploration_slots: 1,
    search_round_id: 'rsi-eval-round-1',
  });
}

function planFixture(count = 8) {
  return createRsiHierarchicalEvaluationPlan({
    architecture_search_decision: searchDecision(count),
    evaluator_root_digest: d('a'),
    workload_root_digest: d('b'),
    hidden_holdout_digest: d('c'),
    final_candidate_cap: 2,
  });
}

function receipt(plan, stageId, entrant, {
  score = 0.5,
  uncertainty = 0.05,
  novelty = 0.5,
  hard = true,
  workload = null,
  external = true,
  authored = false,
} = {}) {
  const stage = plan.stages.find((row) => row.stage_id === stageId);
  return createRsiEvaluationStageReceipt({
    plan,
    stage_id: stageId,
    genome_id: entrant.genome_id,
    genome_digest: entrant.genome_digest,
    performance_score: score,
    uncertainty_radius: uncertainty,
    novelty_score: novelty,
    hard_invariants_pass: hard,
    resource_units_consumed: stage.resource_units,
    stage_workload_digest: workload || d(String(stage.ordinal)),
    evidence_digest: d(String((stage.ordinal + 3) % 9 + 1)),
    evidence_refs: [`EVAL_${stageId}_${entrant.genome_id}`],
    external_evaluator: external,
    authored_by_candidate: authored,
  });
}

test('plan precommits a low-to-high fidelity schedule with no optional stopping or candidate budget control', () => {
  const plan = planFixture();
  verifyRsiHierarchicalEvaluationPlan(plan);
  assert.equal(plan.entrant_count, 8);
  assert.deepEqual(plan.stages.map((stage) => stage.stage_id), [
    'MICRO_CONTRACTS',
    'TARGETED_SHARD',
    'DEEP_SHARD',
    'FULL_HOLDOUT',
  ]);
  assert.deepEqual(plan.stages.map((stage) => stage.resource_units), [1, 4, 12, 32]);
  assert.deepEqual(plan.stages.map((stage) => stage.survivor_cap), [4, 2, 2, 2]);
  assert.deepEqual(plan.stages.map((stage) => stage.exploitation_slots), [2, 1, 1, 2]);
  assert.equal(plan.scheduling_policy, 'PRECOMMITTED_SUCCESSIVE_HALVING_WITH_BOUNDED_RESCUE_V1');
  assert.equal(plan.optional_stopping_allowed, false);
  assert.equal(plan.adaptive_stage_budget_after_results_allowed, false);
  assert.equal(plan.candidate_can_choose_stage, false);
  assert.equal(plan.candidate_can_choose_budget, false);
  assert.equal(plan.candidate_can_choose_workload, false);
  assert.equal(plan.candidate_can_choose_rescue, false);
  assert.equal(plan.full_hidden_holdout_required_before_archive_admission, true);
  assert.equal(plan.statistical_confirmation_required_for_promotion_review, true);
  assert.equal(plan.statistical_risk_spent_before_confirmation, false);
  assert.equal(plan.authority_effect, false);
});

test('stage receipt requires exact precommitted resource and external evaluator origin', () => {
  const plan = planFixture();
  const entrant = plan.entrants[0];
  const valid = receipt(plan, 'MICRO_CONTRACTS', entrant);
  verifyRsiEvaluationStageReceipt(valid, plan);
  assert.equal(valid.resource_units_consumed, 1);
  assert.equal(valid.external_evaluator, true);
  assert.equal(valid.authored_by_candidate, false);
  assert.equal(valid.cheap_stage_is_final_verdict, false);
  assert.equal(valid.authority_effect, false);

  assert.throws(() => createRsiEvaluationStageReceipt({
    plan,
    stage_id: 'MICRO_CONTRACTS',
    genome_id: entrant.genome_id,
    genome_digest: entrant.genome_digest,
    performance_score: 0.9,
    uncertainty_radius: 0.1,
    novelty_score: 0.5,
    hard_invariants_pass: true,
    resource_units_consumed: 2,
    stage_workload_digest: d('1'),
    evidence_digest: d('4'),
    evidence_refs: ['BAD_RESOURCE'],
    external_evaluator: true,
    authored_by_candidate: false,
  }), /resource_mismatch/);

  assert.throws(() => receipt(plan, 'MICRO_CONTRACTS', entrant, {
    external: false,
    authored: true,
  }), /external_origin_required/);
});

test('micro stage preserves top evidence, one uncertain candidate and one novelty escape hatch while hard failures terminate', () => {
  const plan = planFixture();
  const ledger = new RsiHierarchicalEvaluationLedger({ plan });
  const rows = plan.entrants.map((entrant, index) => {
    const configs = [
      { score: 0.95, uncertainty: 0.02, novelty: 0.10 },
      { score: 0.90, uncertainty: 0.02, novelty: 0.20 },
      { score: 0.82, uncertainty: 0.25, novelty: 0.30 },
      { score: 0.20, uncertainty: 0.01, novelty: 1.00 },
      { score: 0.50, uncertainty: 0.02, novelty: 0.40 },
      { score: 0.40, uncertainty: 0.02, novelty: 0.50 },
      { score: 0.30, uncertainty: 0.02, novelty: 0.60 },
      { score: 0.99, uncertainty: 0.01, novelty: 0.90, hard: false },
    ][index];
    return receipt(plan, 'MICRO_CONTRACTS', entrant, configs);
  });
  const result = ledger.evaluateStage({ stage_id: 'MICRO_CONTRACTS', receipts: rows });
  assert.equal(result.entrant_count, 8);
  assert.equal(result.survivor_count, 4);
  assert.equal(result.hard_invariant_reject_count, 1);
  assert.equal(result.resource_units_spent, 8);
  assert.equal(result.uncertainty_rescue_count, 1);
  assert.equal(result.novelty_rescue_count, 1);

  const uncertain = result.decisions.find((row) => row.genome_digest === plan.entrants[2].genome_digest);
  const novel = result.decisions.find((row) => row.genome_digest === plan.entrants[3].genome_digest);
  const hardFail = result.decisions.find((row) => row.genome_digest === plan.entrants[7].genome_digest);
  assert.equal(uncertain.uncertainty_rescue, true);
  assert.equal(uncertain.advances, true);
  assert.equal(novel.novelty_rescue, true);
  assert.equal(novel.advances, true);
  assert.equal(hardFail.state, 'REJECT_HARD_INVARIANT');
  assert.equal(hardFail.advances, false);
  assert.equal(hardFail.cheap_stage_rejection_is_promotion_rejection, false);

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.next_stage_id, 'TARGETED_SHARD');
  assert.equal(snapshot.active_genome_digests.length, 4);
  assert.equal(snapshot.statistical_risk_spent, false);
});

test('same stage must use one workload digest and stage order cannot be skipped', () => {
  const plan = planFixture();
  const ledger = new RsiHierarchicalEvaluationLedger({ plan });
  assert.throws(() => ledger.evaluateStage({
    stage_id: 'TARGETED_SHARD',
    receipts: [],
  }), /stage_order_violation/);

  const rows = plan.entrants.map((entrant, index) => receipt(plan, 'MICRO_CONTRACTS', entrant, {
    score: 0.9 - index * 0.05,
    workload: index === 0 ? d('7') : d('1'),
  }));
  assert.throws(() => ledger.evaluateStage({
    stage_id: 'MICRO_CONTRACTS',
    receipts: rows,
  }), /stage_workload_mismatch/);
});

test('full cascade spends exponentially more resource only on survivors and requires full holdout before archive/statistical review', () => {
  const plan = planFixture();
  const ledger = new RsiHierarchicalEvaluationLedger({ plan });

  const micro = plan.entrants.map((entrant, index) => {
    const configs = [
      { score: 0.95, uncertainty: 0.02, novelty: 0.1 },
      { score: 0.90, uncertainty: 0.02, novelty: 0.2 },
      { score: 0.82, uncertainty: 0.25, novelty: 0.3 },
      { score: 0.20, uncertainty: 0.01, novelty: 1.0 },
      { score: 0.50, uncertainty: 0.02, novelty: 0.4 },
      { score: 0.40, uncertainty: 0.02, novelty: 0.5 },
      { score: 0.30, uncertainty: 0.02, novelty: 0.6 },
      { score: 0.10, uncertainty: 0.01, novelty: 0.7 },
    ][index];
    return receipt(plan, 'MICRO_CONTRACTS', entrant, configs);
  });
  const microResult = ledger.evaluateStage({ stage_id: 'MICRO_CONTRACTS', receipts: micro });
  const activeAfterMicro = microResult.decisions.filter((row) => row.advances).map((row) => plan.entrants.find((entrant) => entrant.genome_digest === row.genome_digest));

  const targeted = activeAfterMicro.map((entrant, index) => {
    const configs = [
      { score: 0.92, uncertainty: 0.02, novelty: 0.1 },
      { score: 0.70, uncertainty: 0.25, novelty: 0.2 },
      { score: 0.85, uncertainty: 0.01, novelty: 0.3 },
      { score: 0.30, uncertainty: 0.01, novelty: 0.9 },
    ][index];
    return receipt(plan, 'TARGETED_SHARD', entrant, configs);
  });
  const targetedResult = ledger.evaluateStage({ stage_id: 'TARGETED_SHARD', receipts: targeted });
  assert.equal(targetedResult.survivor_count, 2);
  assert.equal(targetedResult.resource_units_spent, 16);
  assert.equal(targetedResult.cumulative_resource_units_spent, 24);

  const activeAfterTargeted = targetedResult.decisions.filter((row) => row.advances).map((row) => plan.entrants.find((entrant) => entrant.genome_digest === row.genome_digest));
  const deep = activeAfterTargeted.map((entrant, index) => receipt(plan, 'DEEP_SHARD', entrant, {
    score: 0.88 - index * 0.04,
    uncertainty: 0.03,
    novelty: 0.4 + index * 0.1,
  }));
  const deepResult = ledger.evaluateStage({ stage_id: 'DEEP_SHARD', receipts: deep });
  assert.equal(deepResult.survivor_count, 2);
  assert.equal(deepResult.resource_units_spent, 24);
  assert.equal(deepResult.cumulative_resource_units_spent, 48);

  const activeAfterDeep = deepResult.decisions.filter((row) => row.advances).map((row) => plan.entrants.find((entrant) => entrant.genome_digest === row.genome_digest));
  const full = activeAfterDeep.map((entrant, index) => receipt(plan, 'FULL_HOLDOUT', entrant, {
    score: 0.86 - index * 0.02,
    uncertainty: 0.01,
    novelty: 0.5,
    workload: d('4'),
  }));
  const fullResult = ledger.evaluateStage({ stage_id: 'FULL_HOLDOUT', receipts: full });
  assert.equal(fullResult.full_holdout_stage, true);
  assert.equal(fullResult.survivor_count, 2);
  assert.equal(fullResult.resource_units_spent, 64);
  assert.equal(fullResult.cumulative_resource_units_spent, 112);
  assert.equal(fullResult.decisions.every((row) => row.state === 'FULL_HOLDOUT_COMPLETE'), true);

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.cascade_complete, true);
  assert.equal(snapshot.full_holdout_complete, true);
  assert.equal(snapshot.full_holdout_finalists.length, 2);
  assert.equal(snapshot.eligible_for_archive_admission_review, true);
  assert.equal(snapshot.eligible_for_statistical_confirmation, true);
  assert.equal(snapshot.statistical_confirmation_required_before_promotion_review, true);
  assert.equal(snapshot.statistical_risk_spent, false);
  assert.equal(snapshot.evaluation_economy_is_promotion_authority, false);
  assert.equal(snapshot.promotion_authority, false);
});

test('missing or duplicate stage receipts fail closed instead of silently biasing a halving rung', () => {
  const plan = planFixture();
  const ledger = new RsiHierarchicalEvaluationLedger({ plan });
  const rows = plan.entrants.map((entrant, index) => receipt(plan, 'MICRO_CONTRACTS', entrant, {
    score: 0.9 - index * 0.05,
  }));
  assert.throws(() => ledger.evaluateStage({
    stage_id: 'MICRO_CONTRACTS',
    receipts: rows.slice(0, -1),
  }), /receipt_set_incomplete/);

  const duplicate = [...rows];
  duplicate[7] = rows[0];
  assert.throws(() => new RsiHierarchicalEvaluationLedger({ plan }).evaluateStage({
    stage_id: 'MICRO_CONTRACTS',
    receipts: duplicate,
  }), /receipt_duplicate|receipt_missing_candidate/);
});

test('evaluation trust root keeps cheap fidelities as scheduling evidence, never promotion truth', () => {
  const root = rsiHierarchicalEvaluationTrustRootSnapshot();
  assert.equal(root.scheduling_policy, 'PRECOMMITTED_SUCCESSIVE_HALVING_WITH_BOUNDED_RESCUE_V1');
  assert.equal(root.optional_stopping_allowed, false);
  assert.equal(root.adaptive_stage_budget_after_results_allowed, false);
  assert.equal(root.candidate_can_choose_stage, false);
  assert.equal(root.candidate_can_choose_budget, false);
  assert.equal(root.uncertainty_rescue_required_when_configured, true);
  assert.equal(root.novelty_rescue_required_when_configured, true);
  assert.equal(root.hard_invariant_failure_terminal, true);
  assert.equal(root.cheap_stage_is_final_promotion_verdict, false);
  assert.equal(root.full_hidden_holdout_required_before_archive_admission, true);
  assert.equal(root.statistical_confirmation_required_before_promotion_review, true);
  assert.equal(root.statistical_risk_spent_before_confirmation, false);
  assert.equal(root.evaluation_economy_is_promotion_authority, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.evaluation_root_digest, /^sha256:[0-9a-f]{64}$/);
});
