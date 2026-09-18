import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import candidateCapsule from '../src/candidate-capsule.cjs';
import {
  RSI_COMPONENT_ATTRIBUTION_RESULT_SCHEMA,
  createRsiComponentAttributionPlan,
  createRsiComponentAblationReceipt,
  finalizeRsiComponentAttribution,
  rsiComponentAttributionTrustRootSnapshot,
  verifyRsiComponentAblationReceipt,
  verifyRsiComponentAttributionPlan,
  verifyRsiComponentAttributionRecord,
} from '../src/rsi-component-attribution.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const { createCandidateCapsule } = candidateCapsule;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function candidateHandoff() {
  const source = {
    repository: 'PatrickFrome/Compute',
    head: sha('2'),
    ref: 'work/rsi/component-attribution-fixture',
  };
  const capsule = createCandidateCapsule({
    source_head: source.head,
    sequence: 11,
    previous_candidate_id: null,
    intent: 'RSI BROWSER_RUNTIME two-component attribution fixture',
    components: [
      { path: 'apps/metaengine-browser/src/feature-a.mjs', change: 'MODIFY', digest: d('a') },
      { path: 'apps/metaengine-browser/src/feature-b.mjs', change: 'CREATE', digest: d('b') },
    ],
    verification_plan: [
      { id: 'EXACT_SOURCE_IDENTITY', required: true },
      { id: 'CONTRACT_TESTS', required: true },
    ],
    evidence: [{ name: 'FIXTURE', digest: d('c') }],
  }, source);
  const core = {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    mutation_surface: 'BROWSER_RUNTIME',
    parent_sha: sha('1'),
    candidate_sha: sha('2'),
    candidate_capsule: capsule,
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, handoff_digest: digest(core) });
}

function hardPass() {
  return {
    NO_DUPLICATE_IRREVERSIBLE_EFFECT: true,
    NO_AUTHORITY_VIOLATION: true,
    NO_WORKSPACE_ESCAPE: true,
    EXACT_SOURCE_IDENTITY: true,
    NO_SECURITY_REGRESSION: true,
    NO_AMBIGUOUS_EFFECT_RETRY: true,
  };
}

function plan() {
  return createRsiComponentAttributionPlan({
    candidate_handoff: candidateHandoff(),
    workload_digest: d('1'),
    holdout_digest: d('2'),
    environment_fingerprint: 'windows-x64-browsercell-v1',
    paired_seed_schedule_digest: d('3'),
    objective_spec: [
      { metric: 'task_success_rate', direction: 'MAXIMIZE', materiality_threshold: 0.01 },
      { metric: 'p95_latency_ms', direction: 'MINIMIZE', materiality_threshold: 1 },
    ],
  });
}

test('attribution plan covers every changed component and freezes matched ablation conditions', () => {
  const row = plan();
  verifyRsiComponentAttributionPlan(row);
  assert.equal(row.attribution_scope, 'ALL_CHANGED_COMPONENTS');
  assert.equal(row.component_count, 2);
  assert.equal(row.components.length, 2);
  assert.equal(new Set(row.components.map((component) => component.path)).size, 2);
  assert.equal(row.paired_ablation_required, true);
  assert.equal(row.exact_same_workload_required, true);
  assert.equal(row.exact_same_holdout_required, true);
  assert.equal(row.exact_same_seed_schedule_required, true);
  assert.equal(row.exact_same_environment_required, true);
  assert.equal(row.early_stop_allowed, false);
  assert.equal(row.missing_component_receipt_allowed, false);
  assert.equal(row.candidate_can_select_component, false);
  assert.equal(row.candidate_can_author_attribution, false);
  assert.equal(row.llm_narrative_is_attribution_authority, false);
  assert.equal(row.authority_effect, false);
});

test('matched external ablation identifies a contributing component from objective deltas', () => {
  const row = plan();
  const component = row.components[0];
  const receipt = createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: component.ablation_id,
    ablated_candidate_sha: sha('3'),
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: hardPass(),
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.70 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 116 },
    ],
    evidence_refs: ['EVAL_RUN_100', 'HOLDOUT_RECEIPT_100'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  verifyRsiComponentAblationReceipt(receipt, row);
  assert.equal(receipt.classification, 'CONTRIBUTING');
  assert.equal(receipt.objective_effects.find((x) => x.metric === 'task_success_rate').status, 'BENEFICIAL');
  assert.equal(receipt.objective_effects.find((x) => x.metric === 'p95_latency_ms').status, 'BENEFICIAL');
  assert.equal(receipt.external_evaluator, true);
  assert.equal(receipt.authored_by_candidate, false);
  assert.equal(receipt.llm_narrative_is_attribution_authority, false);
  assert.equal(receipt.authority_effect, false);
});

test('component whose removal breaks a hard invariant is safety-critical even without objective gain', () => {
  const row = plan();
  const component = row.components[1];
  const ablatedHard = hardPass();
  ablatedHard.NO_AMBIGUOUS_EFFECT_RETRY = false;
  const receipt = createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: component.ablation_id,
    ablated_candidate_sha: sha('4'),
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: ablatedHard,
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.82 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 110 },
    ],
    evidence_refs: ['EVAL_RUN_101', 'HOLDOUT_RECEIPT_101'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  assert.equal(receipt.classification, 'SAFETY_CRITICAL');
  assert.deepEqual(receipt.safety_critical_invariants, ['NO_AMBIGUOUS_EFFECT_RETRY']);
});

test('tradeoff attribution stays unresolved instead of collapsing to a scalar winner', () => {
  const row = plan();
  const component = row.components[0];
  const receipt = createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: component.ablation_id,
    ablated_candidate_sha: sha('5'),
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: hardPass(),
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.70 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 100 },
    ],
    evidence_refs: ['EVAL_RUN_102'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  assert.equal(receipt.classification, 'TRADEOFF_INTERACTION');
  assert.equal(receipt.interaction_resolution_required, true);
});

test('candidate-authored attribution and invalid ablated identity fail closed', () => {
  const row = plan();
  const component = row.components[0];
  assert.throws(() => createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: component.ablation_id,
    ablated_candidate_sha: sha('3'),
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: hardPass(),
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.70 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 116 },
    ],
    evidence_refs: ['MODEL_SELF_REPORT'],
    external_evaluator: false,
    authored_by_candidate: true,
  }), /external_origin_required/);

  assert.throws(() => createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: component.ablation_id,
    ablated_candidate_sha: row.candidate_sha,
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: hardPass(),
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.70 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 116 },
    ],
    evidence_refs: ['EVAL_RUN_103'],
    external_evaluator: true,
    authored_by_candidate: false,
  }), /ablated_identity_invalid/);
});

test('final attribution requires one exact receipt for every changed component', () => {
  const row = plan();
  const [first, second] = row.components;
  const firstReceipt = createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: first.ablation_id,
    ablated_candidate_sha: sha('3'),
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: hardPass(),
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.70 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 116 },
    ],
    evidence_refs: ['EVAL_RUN_104'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  assert.throws(() => finalizeRsiComponentAttribution({
    plan: row,
    receipts: [firstReceipt],
  }), /receipt_set_incomplete/);

  const ablatedHard = hardPass();
  ablatedHard.NO_SECURITY_REGRESSION = false;
  const secondReceipt = createRsiComponentAblationReceipt({
    plan: row,
    ablation_id: second.ablation_id,
    ablated_candidate_sha: sha('4'),
    full_candidate_hard_invariants: hardPass(),
    ablated_candidate_hard_invariants: ablatedHard,
    objectives: [
      { metric: 'task_success_rate', full_candidate_value: 0.82, ablated_candidate_value: 0.82 },
      { metric: 'p95_latency_ms', full_candidate_value: 110, ablated_candidate_value: 110 },
    ],
    evidence_refs: ['EVAL_RUN_105'],
    external_evaluator: true,
    authored_by_candidate: false,
  });

  const result = finalizeRsiComponentAttribution({
    plan: row,
    receipts: [secondReceipt, firstReceipt],
  });
  assert.equal(result.schema, RSI_COMPONENT_ATTRIBUTION_RESULT_SCHEMA);
  assert.equal(result.records.length, 2);
  assert.equal(result.all_changed_components_attributed, true);
  assert.equal(result.candidate_authored_attribution_count, 0);
  assert.equal(result.classification_counts.CONTRIBUTING, 1);
  assert.equal(result.classification_counts.SAFETY_CRITICAL, 1);
  assert.equal(result.attribution_is_promotion_authority, false);
  assert.equal(result.authority_effect, false);
  for (const record of result.records) verifyRsiComponentAttributionRecord(record);
});

test('tampering with attribution plan digest or paired experiment conditions is rejected', () => {
  const row = plan();
  assert.throws(() => verifyRsiComponentAttributionPlan({
    ...row,
    early_stop_allowed: true,
  }), /plan_policy_invalid/);
  assert.throws(() => verifyRsiComponentAttributionPlan({
    ...row,
    environment_fingerprint: 'different-environment',
  }), /plan_digest_mismatch/);
});

test('component attribution trust root prevents model narrative from becoming causal authority', () => {
  const root = rsiComponentAttributionTrustRootSnapshot();
  assert.equal(root.attribution_scope, 'ALL_CHANGED_COMPONENTS');
  assert.equal(root.paired_ablation_required, true);
  assert.equal(root.candidate_can_select_component, false);
  assert.equal(root.candidate_can_author_attribution, false);
  assert.equal(root.llm_narrative_is_attribution_authority, false);
  assert.equal(root.interaction_claims_require_separate_evidence, true);
  assert.equal(root.attribution_is_promotion_authority, false);
  assert.equal(root.execution_authority, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.attribution_root_digest, /^sha256:[0-9a-f]{64}$/);
});
