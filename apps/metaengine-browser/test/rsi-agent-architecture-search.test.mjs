import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiAgentArchitectureGenome,
  verifyRsiAgentArchitectureGenome,
  createRsiAgentArchitectureMutationPlan,
  verifyRsiAgentArchitectureMutationPlan,
  createRsiAgentArchitectureTriageReceipt,
  verifyRsiAgentArchitectureTriageReceipt,
  selectRsiArchitecturesForFullEvaluation,
  verifyRsiArchitectureSearchDecision,
  rsiAgentArchitectureSearchTrustRootSnapshot,
} from '../src/rsi-agent-architecture-search.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;

function genome(id, {
  modelRole = 'DEEP',
  prompt = 'a',
  maxModelCalls = 8,
  maxTokens = 20_000,
  includeMemory = true,
} = {}) {
  const nodes = [
    {
      node_id: `${id}.input`,
      type: 'INPUT_CONTEXT',
      model_role: 'NONE',
      capability_class: 'NONE',
      prompt_digest: null,
      max_iterations: 1,
    },
  ];
  if (includeMemory) {
    nodes.push({
      node_id: `${id}.memory`,
      type: 'RETRIEVE_VERIFIED_MEMORY',
      model_role: 'NONE',
      capability_class: 'NONE',
      prompt_digest: d('b'),
      max_iterations: 1,
    });
  }
  nodes.push(
    {
      node_id: `${id}.model`,
      type: 'MODEL_CALL',
      model_role: modelRole,
      capability_class: 'NONE',
      prompt_digest: d(prompt),
      max_iterations: 2,
    },
    {
      node_id: `${id}.tool`,
      type: 'TOOL_POLICY',
      model_role: 'NONE',
      capability_class: 'MUTATION_PROPOSAL',
      prompt_digest: null,
      max_iterations: 1,
      direct_tool_execution: false,
    },
    {
      node_id: `${id}.output`,
      type: 'OUTPUT',
      model_role: 'NONE',
      capability_class: 'NONE',
      prompt_digest: null,
      max_iterations: 1,
    },
  );
  const edges = includeMemory
    ? [
        { from: `${id}.input`, to: `${id}.memory` },
        { from: `${id}.memory`, to: `${id}.model` },
        { from: `${id}.model`, to: `${id}.tool` },
        { from: `${id}.tool`, to: `${id}.output` },
      ]
    : [
        { from: `${id}.input`, to: `${id}.model` },
        { from: `${id}.model`, to: `${id}.tool` },
        { from: `${id}.tool`, to: `${id}.output` },
      ];
  return createRsiAgentArchitectureGenome({
    genome_id: id,
    parent_genome_digest: null,
    nodes,
    edges,
    budget: {
      max_model_calls: maxModelCalls,
      max_total_tokens: maxTokens,
      max_parallelism: 4,
      max_wall_time_ms: 120_000,
    },
    external_builder: true,
    authored_by_candidate: false,
  });
}

test('typed architecture genome can evolve prompt/routing/memory/tool orchestration without execution authority', () => {
  const row = genome('arch.alpha');
  verifyRsiAgentArchitectureGenome(row);
  assert.equal(row.representation, 'TYPED_ACYCLIC_AGENT_GRAPH_WITH_BOUNDED_LOCAL_ITERATION');
  assert.equal(row.architecture_mutation_surface, 'PROMPTS_ROUTING_MEMORY_TOOLS_ORCHESTRATION');
  assert.equal(row.evaluator_root_mutable, false);
  assert.equal(row.promotion_root_mutable, false);
  assert.equal(row.scheduler_authority_mutable, false);
  assert.equal(row.signing_root_mutable, false);
  assert.equal(row.self_update_root_mutable, false);
  assert.equal(row.arbitrary_code_execution_surface, false);
  assert.equal(row.candidate_can_modify_meta_search_policy, false);
  assert.equal(row.nodes.find((node) => node.type === 'TOOL_POLICY').direct_tool_execution, false);
  assert.equal(row.authority_effect, false);
});

test('architecture search rejects graph cycles and direct tool execution', () => {
  assert.throws(() => createRsiAgentArchitectureGenome({
    genome_id: 'arch.cycle',
    nodes: [
      { node_id: 'cycle.input', type: 'INPUT_CONTEXT', max_iterations: 1 },
      { node_id: 'cycle.model', type: 'MODEL_CALL', model_role: 'DEEP', prompt_digest: d('1'), max_iterations: 1 },
      { node_id: 'cycle.output', type: 'OUTPUT', max_iterations: 1 },
    ],
    edges: [
      { from: 'cycle.input', to: 'cycle.model' },
      { from: 'cycle.model', to: 'cycle.output' },
      { from: 'cycle.output', to: 'cycle.model' },
    ],
    budget: { max_model_calls: 2, max_total_tokens: 1000, max_parallelism: 1, max_wall_time_ms: 1000 },
    external_builder: true,
    authored_by_candidate: false,
  }), /cycle_forbidden/);

  assert.throws(() => createRsiAgentArchitectureGenome({
    genome_id: 'arch.direct-tool',
    nodes: [
      { node_id: 'direct.input', type: 'INPUT_CONTEXT', max_iterations: 1 },
      { node_id: 'direct.tool', type: 'TOOL_POLICY', capability_class: 'MUTATION_PROPOSAL', direct_tool_execution: true, max_iterations: 1 },
      { node_id: 'direct.output', type: 'OUTPUT', max_iterations: 1 },
    ],
    edges: [
      { from: 'direct.input', to: 'direct.tool' },
      { from: 'direct.tool', to: 'direct.output' },
    ],
    budget: { max_model_calls: 1, max_total_tokens: 1000, max_parallelism: 1, max_wall_time_ms: 1000 },
    external_builder: true,
    authored_by_candidate: false,
  }), /direct_tool_execution_forbidden/);
});

test('meta-agent mutation plan is proposal-only and cannot touch evaluator, promotion, scheduler, signing or self-update roots', () => {
  const parent = genome('arch.parent');
  const plan = createRsiAgentArchitectureMutationPlan({
    parent_genome: parent,
    generation: 12,
    operations: [
      { type: 'MODIFY_NODE', target_id: 'arch.parent.model', payload_digest: d('2') },
      { type: 'ADD_NODE', target_id: 'arch.parent.reflect', payload_digest: d('3') },
    ],
    proposal_model_family: 'GPT_5_6_SOL',
    external_meta_agent: true,
    authored_by_candidate: false,
  });
  verifyRsiAgentArchitectureMutationPlan(plan, parent);
  assert.equal(plan.plan_is_materialization_authority, false);
  assert.equal(plan.plan_is_evaluation_authority, false);
  assert.equal(plan.plan_is_promotion_authority, false);
  assert.equal(plan.evaluator_root_mutation_allowed, false);
  assert.equal(plan.promotion_root_mutation_allowed, false);
  assert.equal(plan.scheduler_authority_mutation_allowed, false);
  assert.equal(plan.signing_root_mutation_allowed, false);
  assert.equal(plan.self_update_root_mutation_allowed, false);
  assert.equal(plan.arbitrary_code_execution_allowed, false);
  assert.equal(plan.authority_effect, false);
});

test('cheap judge receipt is triage evidence only and full benchmark remains mandatory', () => {
  const row = genome('arch.triage');
  const receipt = createRsiAgentArchitectureTriageReceipt({
    genome: row,
    structural_novelty_score: 0.7,
    cheap_judge_score: 0.82,
    estimated_eval_cost: {
      max_model_calls: 6,
      max_total_tokens: 15_000,
      max_parallelism: 4,
      max_wall_time_ms: 90_000,
    },
    evidence_digest: d('4'),
    evidence_refs: ['TRIAGE_RUN_1'],
    external_triage_judge: true,
    authored_by_candidate: false,
  });
  verifyRsiAgentArchitectureTriageReceipt(receipt, row);
  assert.equal(receipt.llm_judge_is_full_evaluator, false);
  assert.equal(receipt.llm_judge_is_promotion_authority, false);
  assert.equal(receipt.cheap_signal_only, true);
  assert.equal(receipt.full_benchmark_still_required, true);
  assert.equal(receipt.exploration_escape_hatch_required, true);
  assert.equal(receipt.authority_effect, false);
});

test('candidate-authored cheap judge cannot admit its own architecture', () => {
  const row = genome('arch.self-judge');
  assert.throws(() => createRsiAgentArchitectureTriageReceipt({
    genome: row,
    structural_novelty_score: 1,
    cheap_judge_score: 1,
    estimated_eval_cost: {
      max_model_calls: 1,
      max_total_tokens: 1000,
      max_parallelism: 1,
      max_wall_time_ms: 1000,
    },
    evidence_digest: d('5'),
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_triage_judge: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('Pareto cost-quality search admits strong candidates while preserving one novelty exploration slot', () => {
  const a = genome('arch.search.a', { modelRole: 'FAST', prompt: '1', maxModelCalls: 4, maxTokens: 8_000 });
  const b = genome('arch.search.b', { modelRole: 'DEEP', prompt: '2', maxModelCalls: 10, maxTokens: 40_000 });
  const c = genome('arch.search.c', { modelRole: 'DIVERSE', prompt: '3', maxModelCalls: 7, maxTokens: 25_000, includeMemory: false });

  const triage = (g, judge, novelty, costTokens) => createRsiAgentArchitectureTriageReceipt({
    genome: g,
    structural_novelty_score: novelty,
    cheap_judge_score: judge,
    estimated_eval_cost: {
      max_model_calls: Math.max(1, Math.round(costTokens / 5000)),
      max_total_tokens: costTokens,
      max_parallelism: 4,
      max_wall_time_ms: 120_000,
    },
    evidence_digest: d(g.genome_id.endsWith('.a') ? '6' : g.genome_id.endsWith('.b') ? '7' : '8'),
    evidence_refs: [`TRIAGE_${g.genome_id}`],
    external_triage_judge: true,
    authored_by_candidate: false,
  });

  const decision = selectRsiArchitecturesForFullEvaluation({
    candidates: [
      { genome: a, triage_receipt: triage(a, 0.86, 0.35, 8_000) },
      { genome: b, triage_receipt: triage(b, 0.92, 0.20, 40_000) },
      { genome: c, triage_receipt: triage(c, 0.30, 0.99, 25_000) },
    ],
    full_eval_slots: 2,
    exploration_slots: 1,
    search_round_id: 'arch-round-1',
  });
  verifyRsiArchitectureSearchDecision(decision);

  const admitted = decision.decisions.filter((row) => row.eligible_for_full_external_evaluation);
  assert.equal(admitted.length, 2);
  assert.equal(admitted.some((row) => row.exploration_slot === true && row.genome_id === c.genome_id), true);
  assert.equal(decision.exploration_escape_hatch_active, true);
  assert.equal(decision.cheap_judge_triage_only, true);
  assert.equal(decision.full_benchmark_required, true);
  assert.equal(decision.evaluator_root_external_and_immutable, true);
  assert.equal(decision.meta_search_policy_mutable_by_candidate, false);
  assert.equal(decision.authority_effect, false);
  for (const row of decision.decisions) {
    assert.equal(row.cheap_judge_final_verdict, false);
    assert.equal(row.full_benchmark_required_before_archive_admission, true);
    assert.equal(row.full_benchmark_required_before_promotion_review, true);
    assert.equal(row.authority_effect, false);
  }
});

test('architecture search decision is deterministic for exact same candidates and round id', () => {
  const a = genome('arch.det.a', { prompt: '9' });
  const b = genome('arch.det.b', { prompt: '8' });
  const receipt = (g, score, novelty, char) => createRsiAgentArchitectureTriageReceipt({
    genome: g,
    structural_novelty_score: novelty,
    cheap_judge_score: score,
    estimated_eval_cost: {
      max_model_calls: 5,
      max_total_tokens: 12_000,
      max_parallelism: 2,
      max_wall_time_ms: 60_000,
    },
    evidence_digest: d(char),
    evidence_refs: [`RUN_${char}`],
    external_triage_judge: true,
    authored_by_candidate: false,
  });
  const input = {
    candidates: [
      { genome: a, triage_receipt: receipt(a, 0.8, 0.5, 'a') },
      { genome: b, triage_receipt: receipt(b, 0.7, 0.6, 'b') },
    ],
    full_eval_slots: 1,
    exploration_slots: 0,
    search_round_id: 'arch-round-deterministic',
  };
  const left = selectRsiArchitecturesForFullEvaluation(input);
  const right = selectRsiArchitecturesForFullEvaluation(input);
  assert.equal(left.decision_digest, right.decision_digest);
  assert.deepEqual(left.decisions, right.decisions);
});

test('architecture search trust root keeps recursive design search away from authority roots', () => {
  const root = rsiAgentArchitectureSearchTrustRootSnapshot();
  assert.equal(root.representation, 'TYPED_ACYCLIC_AGENT_GRAPH_WITH_BOUNDED_LOCAL_ITERATION');
  assert.equal(root.search_space, 'PROMPTS_ROUTING_MEMORY_TOOLS_ORCHESTRATION');
  assert.equal(root.pareto_cost_quality_search, true);
  assert.equal(root.cheap_judge_triage_only, true);
  assert.equal(root.exploration_escape_hatch_required, true);
  assert.equal(root.full_external_evaluation_required, true);
  assert.equal(root.evaluator_root_mutable, false);
  assert.equal(root.promotion_root_mutable, false);
  assert.equal(root.scheduler_authority_mutable, false);
  assert.equal(root.signing_root_mutable, false);
  assert.equal(root.self_update_root_mutable, false);
  assert.equal(root.meta_search_policy_mutable_by_candidate, false);
  assert.equal(root.arbitrary_code_execution_surface, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.architecture_root_digest, /^sha256:[0-9a-f]{64}$/);
});
