import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiRecursiveDepthPolicy,
  verifyRsiRecursiveDepthPolicy,
  createRsiRecursiveDepthLayer,
  verifyRsiRecursiveDepthLayer,
  createRsiRecursiveDepthEvaluation,
  verifyRsiRecursiveDepthEvaluation,
  evaluateRsiRecursiveDepthChain,
  createRsiRecursiveDepthArchive,
  rsiRecursiveDepthTrustRootSnapshot,
} from '../src/rsi-recursive-depth-controller.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;

function policy(overrides = {}) {
  return createRsiRecursiveDepthPolicy({
    policy_id: 'rsi.depth.policy.1',
    fixed_meta_operator_digest: d('a'),
    evaluator_root_digest: d('b'),
    base_solver_digest: d('c'),
    max_depth: 6,
    convergence_patience: 2,
    min_marginal_gain: 0.02,
    max_cost_growth_ratio: 2,
    external_policy_owner: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

function helpers(char = '1') {
  return [
    {
      helper_id: `helper.strategy.${char}`,
      kind: 'STRATEGY_PREPROCESSOR',
      artifact_digest: d(char),
      capabilities: ['READ_VERIFIED_CONTEXT'],
    },
    {
      helper_id: `helper.verify.${char}`,
      kind: 'LOCAL_VERIFIER',
      artifact_digest: d(char === 'f' ? 'e' : 'f'),
      capabilities: ['CHECK_TYPED_OUTPUT'],
    },
  ];
}

function layer(p, prior, depthChar) {
  return createRsiRecursiveDepthLayer({
    policy: p,
    chain_id: 'chain.meta.depth.1',
    prior_layers: prior,
    new_trace_digests: [d(depthChar)],
    strategy_digest: d(depthChar === '9' ? '8' : '9'),
    helpers: helpers(depthChar),
    external_meta_operator: true,
    authored_by_candidate: false,
  });
}

function evaluation(p, l, prior, {
  quality = 0.5,
  novelty = 0.5,
  cost = 10,
  hard = true,
  holdout = d('d'),
  ref = 'RUN_1',
} = {}) {
  return createRsiRecursiveDepthEvaluation({
    policy: p,
    layer: l,
    prior_layers: prior,
    hidden_holdout_digest: holdout,
    quality_score: quality,
    novelty_score: novelty,
    cost_units: cost,
    hard_invariants_pass: hard,
    evidence_refs: [ref],
    external_evaluator: true,
    authored_by_candidate: false,
  });
}

test('policy freezes the meta-operation while allowing depth to emerge from evidence', () => {
  const p = policy();
  verifyRsiRecursiveDepthPolicy(p);
  assert.equal(p.fixed_meta_operation, true);
  assert.equal(p.meta_operator_mutable_by_candidate, false);
  assert.equal(p.meta_operator_mutable_by_layer, false);
  assert.equal(p.strictly_growing_input_required, true);
  assert.equal(p.depth_selected_by_external_convergence, true);
  assert.equal(p.depth_is_not_fixed_in_advance, true);
  assert.equal(p.archive_search_over_layer_chains_allowed, true);
  assert.equal(p.candidate_can_choose_depth, false);
  assert.equal(p.candidate_can_modify_convergence_rule, false);
  assert.equal(p.helper_direct_tool_execution_allowed, false);
  assert.equal(p.arbitrary_code_execution_allowed, false);
  assert.equal(p.authority_effect, false);
});

test('each recursive layer reuses exactly one fixed operator and strictly grows its typed input', () => {
  const p = policy();
  const l1 = layer(p, [], '1');
  const l2 = layer(p, [l1], '2');
  const l3 = layer(p, [l1, l2], '3');

  verifyRsiRecursiveDepthLayer(l1, p, []);
  verifyRsiRecursiveDepthLayer(l2, p, [l1]);
  verifyRsiRecursiveDepthLayer(l3, p, [l1, l2]);

  assert.equal(l1.fixed_meta_operator_digest, p.fixed_meta_operator_digest);
  assert.equal(l2.fixed_meta_operator_digest, p.fixed_meta_operator_digest);
  assert.equal(l3.fixed_meta_operator_digest, p.fixed_meta_operator_digest);
  assert.equal(l1.meta_operator_code_mutated, false);
  assert.equal(l2.meta_operator_code_mutated, false);
  assert.equal(l3.meta_operator_code_mutated, false);
  assert.ok(l2.accumulated_context_count > l1.accumulated_context_count);
  assert.ok(l3.accumulated_context_count > l2.accumulated_context_count);
  assert.equal(l2.previous_layer_digest, l1.layer_digest);
  assert.equal(l3.previous_layer_digest, l2.layer_digest);
  assert.equal(l3.prior_layer_digests.includes(l1.layer_digest), true);
  assert.equal(l3.prior_layer_digests.includes(l2.layer_digest), true);
  assert.equal(l3.authority_effect, false);
});

test('helper libraries cannot smuggle shell, scheduler or self-update authority into recursive layers', () => {
  const p = policy();
  for (const capability of [
    'DIRECT_TOOL_EXECUTION',
    'SHELL',
    'EVAL',
    'PROCESS',
    'NETWORK_AUTHORITY',
    'SCHEDULER_AUTHORITY',
    'PROMOTION_AUTHORITY',
    'SELF_UPDATE_AUTHORITY',
    'SIGNING_AUTHORITY',
  ]) {
    assert.throws(() => createRsiRecursiveDepthLayer({
      policy: p,
      chain_id: 'chain.meta.depth.bad',
      prior_layers: [],
      new_trace_digests: [d('1')],
      strategy_digest: d('2'),
      helpers: [{
        helper_id: 'helper.bad',
        kind: 'PROPOSAL_HELPER',
        artifact_digest: d('3'),
        capabilities: [capability],
      }],
      external_meta_operator: true,
      authored_by_candidate: false,
    }), /forbidden_capability/);
  }
});

test('candidate-authored layer or evaluation cannot become trusted recursive evidence', () => {
  const p = policy();
  assert.throws(() => createRsiRecursiveDepthLayer({
    policy: p,
    chain_id: 'chain.meta.depth.self',
    prior_layers: [],
    new_trace_digests: [d('1')],
    strategy_digest: d('2'),
    helpers: helpers('3'),
    external_meta_operator: false,
    authored_by_candidate: true,
  }), /external_operator_required/);

  const l1 = layer(p, [], '1');
  assert.throws(() => createRsiRecursiveDepthEvaluation({
    policy: p,
    layer: l1,
    prior_layers: [],
    hidden_holdout_digest: d('d'),
    quality_score: 0.5,
    novelty_score: 0.5,
    cost_units: 10,
    hard_invariants_pass: true,
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_evaluator: false,
    authored_by_candidate: true,
  }), /external_origin_required/);
});

test('depth continues while gains are material and stops after externally observed convergence', () => {
  const p = policy({ convergence_patience: 2, min_marginal_gain: 0.02 });
  const l1 = layer(p, [], '1');
  const l2 = layer(p, [l1], '2');
  const l3 = layer(p, [l1, l2], '3');
  const l4 = layer(p, [l1, l2, l3], '4');

  const e1 = evaluation(p, l1, [], { quality: 0.60, cost: 10, ref: 'RUN_1' });
  const e2 = evaluation(p, l2, [l1], { quality: 0.70, cost: 12, ref: 'RUN_2' });
  const partial = evaluateRsiRecursiveDepthChain({
    policy: p,
    layers: [l1, l2],
    evaluations: [e1, e2],
  });
  assert.equal(partial.state, 'CONTINUE_DEPTH');

  const e3 = evaluation(p, l3, [l1, l2], { quality: 0.715, cost: 14, ref: 'RUN_3' });
  const e4 = evaluation(p, l4, [l1, l2, l3], { quality: 0.725, cost: 16, ref: 'RUN_4' });
  const result = evaluateRsiRecursiveDepthChain({
    policy: p,
    layers: [l1, l2, l3, l4],
    evaluations: [e1, e2, e3, e4],
  });
  assert.equal(result.state, 'STOP_CONVERGED');
  assert.equal(result.converged_by_marginal_gain, true);
  assert.equal(result.candidate_can_choose_stop_state, false);
  assert.equal(result.depth_selection_is_promotion, false);
  assert.equal(result.chain_result_is_archive_input_only, true);
  assert.equal(result.authority_effect, false);
});

test('hard invariant failure stops recursion regardless of quality score', () => {
  const p = policy();
  const l1 = layer(p, [], '1');
  const l2 = layer(p, [l1], '2');
  const e1 = evaluation(p, l1, [], { quality: 0.4, cost: 10, ref: 'RUN_1' });
  const e2 = evaluation(p, l2, [l1], { quality: 0.99, cost: 12, hard: false, ref: 'RUN_2' });
  const result = evaluateRsiRecursiveDepthChain({
    policy: p,
    layers: [l1, l2],
    evaluations: [e1, e2],
  });
  assert.equal(result.state, 'STOP_HARD_INVARIANT_FAILURE');
  assert.equal(result.hard_failure_depth, 2);
  assert.equal(result.best_observed_depth, 1);
});

test('excessive cost growth stops deeper recursion before low-value depth consumes the search budget', () => {
  const p = policy({ max_cost_growth_ratio: 1.5, min_marginal_gain: 0.001 });
  const l1 = layer(p, [], '1');
  const l2 = layer(p, [l1], '2');
  const e1 = evaluation(p, l1, [], { quality: 0.4, cost: 10, ref: 'RUN_1' });
  const e2 = evaluation(p, l2, [l1], { quality: 0.8, cost: 20, ref: 'RUN_2' });
  const result = evaluateRsiRecursiveDepthChain({
    policy: p,
    layers: [l1, l2],
    evaluations: [e1, e2],
  });
  assert.equal(result.state, 'STOP_COST_GROWTH');
  assert.equal(result.excessive_cost_growth, true);
});

test('hidden holdout identity cannot drift between recursive depths', () => {
  const p = policy();
  const l1 = layer(p, [], '1');
  const l2 = layer(p, [l1], '2');
  const e1 = evaluation(p, l1, [], { holdout: d('d'), ref: 'RUN_1' });
  const e2 = evaluation(p, l2, [l1], { holdout: d('e'), ref: 'RUN_2' });
  assert.throws(() => evaluateRsiRecursiveDepthChain({
    policy: p,
    layers: [l1, l2],
    evaluations: [e1, e2],
  }), /holdout_drift/);
});

test('archive stores layer chains as evolutionary inputs without creating scalar promotion truth', () => {
  const p = policy({ max_depth: 3, convergence_patience: 1, min_marginal_gain: 0.01 });

  const a1 = createRsiRecursiveDepthLayer({
    policy: p,
    chain_id: 'chain.archive.a',
    prior_layers: [],
    new_trace_digests: [d('1')],
    strategy_digest: d('2'),
    helpers: helpers('3'),
    external_meta_operator: true,
    authored_by_candidate: false,
  });
  const ae1 = evaluation(p, a1, [], { quality: 0.72, novelty: 0.5, cost: 10, ref: 'A1' });
  const chainA = evaluateRsiRecursiveDepthChain({ policy: p, layers: [a1], evaluations: [ae1] });

  const b1 = createRsiRecursiveDepthLayer({
    policy: p,
    chain_id: 'chain.archive.b',
    prior_layers: [],
    new_trace_digests: [d('4')],
    strategy_digest: d('5'),
    helpers: helpers('6'),
    external_meta_operator: true,
    authored_by_candidate: false,
  });
  const be1 = evaluation(p, b1, [], { quality: 0.68, novelty: 0.8, cost: 8, ref: 'B1' });
  const chainB = evaluateRsiRecursiveDepthChain({ policy: p, layers: [b1], evaluations: [be1] });

  const archive = createRsiRecursiveDepthArchive({
    policy: p,
    chain_results: [chainA, chainB],
    archive_id: 'archive.meta.depth.1',
    external_archive_owner: true,
    authored_by_candidate: false,
  });
  assert.equal(archive.evolutionary_archive_over_layer_chains, true);
  assert.equal(archive.scalar_ranking_authoritative, false);
  assert.equal(archive.archive_is_promotion_authority, false);
  assert.equal(archive.candidate_can_edit_archive, false);
  assert.equal(archive.entries.every((row) => row.scalar_winner === null), true);
  assert.ok(archive.pareto_chain_ids.length >= 1);
  assert.equal(archive.authority_effect, false);
});

test('recursive-depth trust root captures Meta^n-style fixed-operation recursion without widening authority', () => {
  const root = rsiRecursiveDepthTrustRootSnapshot();
  assert.equal(root.mechanism, 'FIXED_META_OPERATION_RECURSING_ON_GROWING_INPUT');
  assert.equal(root.fixed_meta_operation, true);
  assert.equal(root.meta_operator_mutable_by_candidate, false);
  assert.equal(root.meta_operator_mutable_by_layer, false);
  assert.equal(root.strictly_growing_input_required, true);
  assert.equal(root.depth_selected_by_external_convergence, true);
  assert.equal(root.archive_search_over_layer_chains_allowed, true);
  assert.equal(root.candidate_can_choose_depth, false);
  assert.equal(root.helper_direct_tool_execution_allowed, false);
  assert.equal(root.arbitrary_code_execution_allowed, false);
  assert.equal(root.evaluator_root_mutable, false);
  assert.equal(root.promotion_root_mutable, false);
  assert.equal(root.scheduler_authority_mutable, false);
  assert.equal(root.signing_root_mutable, false);
  assert.equal(root.self_update_root_mutable, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.recursive_depth_root_digest, /^sha256:[0-9a-f]{64}$/);
});
