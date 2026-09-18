import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiMetaSkillProfile,
  createRsiMetaSkillFastLoopSummary,
  createRsiMetaSkillEvolutionPlan,
  createRsiMetaSkillEvaluation,
  finalizeRsiMetaSkillEvolution,
} from '../src/rsi-meta-skill-evolution.mjs';
import { createRsiRuntimeMetaSkillRecord } from '../src/rsi-runtime-meta-skill-archive.mjs';
import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from '../src/rsi-recursive-risk-budget.mjs';
import {
  createRsiMetaProfileShadowPlan,
  createRsiMetaProfilePairReceipt,
  evaluateRsiMetaProfileShadow,
  createRsiMetaProfileStatisticalCertificate,
  createRsiMetaProfileQualification,
} from '../src/rsi-meta-profile-qualification.mjs';
import { createRsiShadowProfileBinding } from '../src/rsi-shadow-profile-binding.mjs';
import {
  RsiShadowDivergenceMonitorLedger,
  createRsiShadowDivergenceMonitorPolicy,
  createRsiShadowDivergenceObservation,
  rsiShadowDivergenceMonitorTrustRootSnapshot,
} from '../src/rsi-shadow-divergence-monitor.mjs';
import { createRsiBoundedCanaryReview } from '../src/rsi-bounded-canary-review.mjs';

const SOURCE = 'a'.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function skill({ id, role, sourceChar, implChar }) {
  const capsule = createRsiSkillCapsule({
    skill_id: id,
    version: 1,
    parent_skill_digest: null,
    source_candidate_sha: sourceChar.repeat(40),
    role,
    input_schema_digest: d('1'),
    output_schema_digest: d('2'),
    implementation_digest: d(implChar),
    components: [{ component_id: `${id}.component`, artifact_digest: d('f'), kind: 'TYPED_TRANSFORM' }],
    capabilities: ['READ_VERIFIED_CONTEXT'],
    max_context_tokens: 2048,
    max_output_tokens: 512,
    max_invocations: 2,
    external_builder: true,
    authored_by_candidate: false,
  });
  const evidence = createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest: d(sourceChar),
    evaluator_root_digest: d('4'),
    unit_test_digest: d('5'),
    runtime_feedback_digest: d('6'),
    attempt_count: 20,
    success_count: 18,
    hard_invariants_pass: true,
    verified_for_library: true,
    evidence_refs: [`VERIFY_${id}`],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  return { capsule, evidence };
}

function binding(entry) {
  return {
    skill_id: entry.capsule.skill_id,
    skill_version: entry.capsule.skill_version,
    skill_digest: entry.capsule.skill_digest,
  };
}

function fixture() {
  const analyzerA = skill({ id: 'shadow.monitor.analyzer.a', role: 'ANALYZER', sourceChar: 'b', implChar: 'b' });
  const analyzerB = skill({ id: 'shadow.monitor.analyzer.b', role: 'ANALYZER', sourceChar: 'c', implChar: 'c' });
  const retriever = skill({ id: 'shadow.monitor.retriever', role: 'RETRIEVER', sourceChar: 'd', implChar: 'd' });
  const allocator = skill({ id: 'shadow.monitor.allocator', role: 'ALLOCATOR', sourceChar: 'e', implChar: 'e' });
  const proposer = skill({ id: 'shadow.monitor.proposer', role: 'PROPOSER', sourceChar: 'f', implChar: 'f' });
  const evolver = skill({ id: 'shadow.monitor.evolver', role: 'EVOLVER', sourceChar: '9', implChar: '9' });
  const library = createRsiVerifiedSkillLibrary({
    library_id: 'shadow.monitor.library',
    entries: [analyzerA, analyzerB, retriever, allocator, proposer, evolver],
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const parent = createRsiMetaSkillProfile({
    profile_id: 'shadow.monitor.parent',
    library,
    profile_generation: 1,
    slow_meta_epoch: 1,
    fast_skill_epoch: 20,
    frozen_backbone_family: 'GPT_5_6_SOL',
    bindings: {
      ANALYZER: binding(analyzerA),
      RETRIEVER: binding(retriever),
      ALLOCATOR: binding(allocator),
      PROPOSER: binding(proposer),
      EVOLVER: binding(evolver),
    },
    external_profile_owner: true,
    authored_by_candidate: false,
  });
  const successor = createRsiMetaSkillProfile({
    profile_id: 'shadow.monitor.successor',
    library,
    profile_generation: 2,
    slow_meta_epoch: 2,
    fast_skill_epoch: 20,
    frozen_backbone_family: 'GPT_5_6_SOL',
    bindings: {
      ANALYZER: binding(analyzerB),
      RETRIEVER: binding(retriever),
      ALLOCATOR: binding(allocator),
      PROPOSER: binding(proposer),
      EVOLVER: binding(evolver),
    },
    external_profile_owner: true,
    authored_by_candidate: false,
  });
  const fast = createRsiMetaSkillFastLoopSummary({
    profile: parent,
    library,
    fast_holdout_digest: d('7'),
    episode_count: 12,
    helpful_count: 9,
    harmful_count: 1,
    neutral_count: 2,
    insufficient_count: 0,
    evidence_refs: ['shadow:monitor:fast'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  const metaPlan = createRsiMetaSkillEvolutionPlan({
    parent_profile: parent,
    successor_profile: successor,
    library,
    fast_loop_summary: fast,
    min_fast_episodes: 8,
    meta_holdout_digest: d('8'),
    max_role_changes: 1,
    external_meta_operator: true,
    authored_by_candidate: false,
  });
  const evaluation = createRsiMetaSkillEvaluation({
    plan: metaPlan,
    parent_profile: parent,
    successor_profile: successor,
    library,
    fast_loop_summary: fast,
    evaluator_root_digest: d('9'),
    objective_spec: [
      { metric: 'task_success', direction: 'MAXIMIZE', materiality_threshold: 0.01 },
      { metric: 'latency_ms', direction: 'MINIMIZE', materiality_threshold: 1 },
    ],
    parent_metrics: { task_success: 0.70, latency_ms: 110 },
    successor_metrics: { task_success: 0.78, latency_ms: 96 },
    hard_invariants_pass: true,
    evidence_refs: ['shadow:monitor:meta'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  const metaResult = finalizeRsiMetaSkillEvolution({
    plan: metaPlan,
    parent_profile: parent,
    successor_profile: successor,
    library,
    fast_loop_summary: fast,
    evaluation,
  });
  const record = createRsiRuntimeMetaSkillRecord({
    source_sha: SOURCE,
    record_id: 'shadow.monitor.record.1',
    library,
    parent_profile: parent,
    successor_profile: successor,
    fast_loop_summary: fast,
    plan: metaPlan,
    evaluation,
    result: metaResult,
    external_archive_owner: true,
    authored_by_candidate: false,
  });
  const shadowPlan = createRsiMetaProfileShadowPlan({
    plan_id: 'shadow.monitor.qual.plan.1',
    meta_record: record,
    activation_holdout_digest: d('a'),
    evaluator_root_digest: d('b'),
    external_plan_owner: true,
    authored_by_candidate: false,
  });
  const receipts = Array.from({ length: shadowPlan.pair_count }, (_, i) => createRsiMetaProfilePairReceipt({
    plan: shadowPlan,
    meta_record: record,
    pair_index: i + 1,
    order: shadowPlan.precommitted_order_schedule[i],
    seed: shadowPlan.precommitted_seed_schedule[i],
    parent_metrics: { task_success: 0.70, latency_ms: 110 },
    successor_metrics: { task_success: 0.80, latency_ms: 94 },
    hard_invariants_pass: true,
    evidence_digest: d(String((i % 6) + 1)),
    evidence_refs: [`shadow:monitor:pair:${i + 1}`],
    external_evaluator: true,
    authored_by_candidate: false,
  }));
  const shadowResult = evaluateRsiMetaProfileShadow({
    plan: shadowPlan,
    meta_record: record,
    receipts,
  });
  const riskBudget = createRsiRecursiveRiskBudget({
    budget_id: 'rsi.meta-profile.activation.risk.v1',
    global_alpha: 0.05,
    spending_policy: RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    evidence_family: 'RSI_META_PROFILE_ACTIVATION',
  });
  const certificate = createRsiMetaProfileStatisticalCertificate({
    certificate_id: 'shadow.monitor.cert.1',
    budget: riskBudget,
    confirmation_index: 1,
    meta_record: record,
    shadow_plan: shadowPlan,
    shadow_result: shadowResult,
    receipts,
    alpha_used: rsiRiskAllocationForConfirmation(riskBudget, 1),
    superiority_certified: true,
    sample_count: shadowPlan.pair_count,
    evidence_refs: ['shadow:monitor:stat'],
    external_verifier: true,
    authored_by_candidate: false,
  });
  const qualification = createRsiMetaProfileQualification({
    qualification_id: 'shadow.monitor.qualification.1',
    meta_record: record,
    shadow_plan: shadowPlan,
    shadow_result: shadowResult,
    receipts,
    budget: riskBudget,
    certificate,
    confirmation_index: 1,
  });
  const shadowBinding = createRsiShadowProfileBinding({
    binding_id: 'shadow.monitor.binding.1',
    qualification,
    verified_context_digest: d('c'),
    comparator_root_digest: d('d'),
    external_shadow_owner: true,
    authored_by_candidate: false,
  });
  const lineage = {
    binding: shadowBinding,
    qualification,
    meta_record: record,
    shadow_plan: shadowPlan,
  };
  return { lineage, record, qualification, shadowPlan, shadowBinding };
}

function policyFor(fx, overrides = {}) {
  return createRsiShadowDivergenceMonitorPolicy({
    monitor_id: 'shadow.monitor.policy.1',
    ...fx.lineage,
    security_negative_holdout_digest: d('e'),
    from_scratch_replay_root_digest: d('f'),
    monitor_root_digest: d('0'),
    min_observations: 8,
    external_monitor_owner: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

function observationFor(policy, fx, index, overrides = {}) {
  return createRsiShadowDivergenceObservation({
    policy,
    lineage: fx.lineage,
    observation_index: index,
    relation: index === 1 ? 'CHALLENGER_BETTER' : 'MATCH',
    hard_invariants_pass: true,
    security_negative_pass: true,
    verifier_integrity_pass: true,
    identity_stable: true,
    from_scratch_replay_pass: true,
    ambiguous_evidence: false,
    evidence_digest: d(String((index % 6) + 1)),
    evidence_refs: [`shadow:monitor:observation:${index}`],
    external_monitor: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

test('monitor policy requires a fourth independent security holdout and separate monitor root', () => {
  const fx = fixture();
  assert.throws(() => policyFor(fx, {
    security_negative_holdout_digest: fx.record.fast_loop_summary.fast_holdout_digest,
  }), /security_holdout_alias/);
  assert.throws(() => policyFor(fx, {
    security_negative_holdout_digest: fx.record.plan.meta_holdout_digest,
  }), /security_holdout_alias/);
  assert.throws(() => policyFor(fx, {
    security_negative_holdout_digest: fx.shadowPlan.activation_holdout_digest,
  }), /security_holdout_alias/);
  assert.throws(() => policyFor(fx, {
    monitor_root_digest: fx.shadowBinding.comparator_root_digest,
  }), /monitor_comparator_root_alias/);
});

test('clean externally monitored evidence reaches review only, never canary authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-shadow-monitor-clean-'));
  try {
    const fx = fixture();
    const policy = policyFor(fx);
    const ledger = new RsiShadowDivergenceMonitorLedger({
      statePath: path.join(root, 'monitor.json'),
      source_sha: SOURCE,
      policy,
      lineage: fx.lineage,
    });
    await ledger.init();
    for (let index = 1; index <= 8; index += 1) {
      const result = await ledger.add(observationFor(policy, fx, index), { lineage: fx.lineage });
      assert.equal(result.canary_activation_authorized, false);
    }
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.row_count, 8);
    assert.equal(snapshot.incident_latched, false);
    assert.equal(snapshot.challenger_has_positive_evidence, true);
    assert.equal(snapshot.no_negative_comparative_evidence, true);
    assert.equal(snapshot.ready_for_external_bounded_canary_review, true);
    assert.equal(snapshot.ledger_can_activate_canary, false);
    assert.equal(snapshot.canary_activation_authorized, false);
    assert.equal(snapshot.active_profile_digest, fx.shadowBinding.champion_profile_digest);
    const reviewEvidence = ledger.reviewEvidence();
    assert.equal(reviewEvidence.ready_for_external_bounded_canary_review, true);
    assert.equal(reviewEvidence.incident_latched, false);
    assert.equal(reviewEvidence.champion_remains_default, true);
    assert.equal(reviewEvidence.canary_activation_authorized, false);
    assert.match(reviewEvidence.review_evidence_digest, /^sha256:[0-9a-f]{64}$/);
    const review = createRsiBoundedCanaryReview({
      review_id: 'shadow.monitor.external.review.1',
      shadow_review_evidence: reviewEvidence,
      external_cohort_digest: d('1'),
      external_reviewer: true,
      authored_by_candidate: false,
    });
    assert.equal(review.state, 'READY_FOR_EXTERNAL_CANARY_CONTROLLER_REVIEW');
    assert.equal(review.review_can_activate_canary, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('security or replay failure latches an incident permanently across restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-shadow-monitor-incident-'));
  try {
    const fx = fixture();
    const policy = policyFor(fx);
    const statePath = path.join(root, 'monitor.json');
    const ledger = new RsiShadowDivergenceMonitorLedger({
      statePath,
      source_sha: SOURCE,
      policy,
      lineage: fx.lineage,
    });
    await ledger.init();
    await ledger.add(observationFor(policy, fx, 1, {
      security_negative_pass: false,
      from_scratch_replay_pass: false,
    }), { lineage: fx.lineage });
    for (let index = 2; index <= 8; index += 1) {
      await ledger.add(observationFor(policy, fx, index), { lineage: fx.lineage });
    }
    assert.equal(ledger.snapshot().incident_latched, true);
    assert.deepEqual(
      ledger.snapshot().first_incident_codes,
      ['FROM_SCRATCH_REPLAY_FAILURE', 'SECURITY_NEGATIVE_FAILURE'],
    );
    assert.equal(ledger.snapshot().ready_for_external_bounded_canary_review, false);

    const restored = new RsiShadowDivergenceMonitorLedger({
      statePath,
      source_sha: SOURCE,
      policy,
      lineage: fx.lineage,
    });
    await restored.init();
    assert.equal(restored.snapshot().incident_latched, true);
    assert.equal(restored.snapshot().ready_for_external_bounded_canary_review, false);
    assert.equal(restored.snapshot().incident_can_be_cleared, false);
    const incidentEvidence = restored.reviewEvidence();
    assert.equal(incidentEvidence.incident_latched, true);
    assert.throws(() => createRsiBoundedCanaryReview({
      review_id: 'shadow.monitor.external.review.incident',
      shadow_review_evidence: incidentEvidence,
      external_cohort_digest: d('1'),
      external_reviewer: true,
      authored_by_candidate: false,
    }), /shadow_evidence_not_ready/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('negative comparative evidence prevents canary review even without a safety incident', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-shadow-monitor-regression-'));
  try {
    const fx = fixture();
    const policy = policyFor(fx);
    const ledger = new RsiShadowDivergenceMonitorLedger({
      statePath: path.join(root, 'monitor.json'),
      source_sha: SOURCE,
      policy,
      lineage: fx.lineage,
    });
    await ledger.init();
    await ledger.add(observationFor(policy, fx, 1, { relation: 'CHALLENGER_BETTER' }), { lineage: fx.lineage });
    await ledger.add(observationFor(policy, fx, 2, { relation: 'CHAMPION_BETTER' }), { lineage: fx.lineage });
    for (let index = 3; index <= 8; index += 1) {
      await ledger.add(observationFor(policy, fx, index, { relation: 'MATCH' }), { lineage: fx.lineage });
    }
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.incident_latched, false);
    assert.equal(snapshot.no_negative_comparative_evidence, false);
    assert.equal(snapshot.ready_for_external_bounded_canary_review, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('candidate cannot author monitor policy or observations', () => {
  const fx = fixture();
  assert.throws(() => createRsiShadowDivergenceMonitorPolicy({
    monitor_id: 'shadow.monitor.policy.candidate',
    ...fx.lineage,
    security_negative_holdout_digest: d('e'),
    from_scratch_replay_root_digest: d('f'),
    monitor_root_digest: d('0'),
    external_monitor_owner: false,
    authored_by_candidate: true,
  }), /external_owner_required/);

  const policy = policyFor(fx);
  assert.throws(() => createRsiShadowDivergenceObservation({
    policy,
    lineage: fx.lineage,
    observation_index: 1,
    relation: 'MATCH',
    hard_invariants_pass: true,
    security_negative_pass: true,
    verifier_integrity_pass: true,
    identity_stable: true,
    from_scratch_replay_pass: true,
    evidence_digest: d('1'),
    evidence_refs: ['shadow:monitor:candidate'],
    external_monitor: false,
    authored_by_candidate: true,
  }), /external_observation_required/);
});

test('shadow divergence monitor trust root preserves external verification and zero authority', () => {
  const root = rsiShadowDivergenceMonitorTrustRootSnapshot();
  assert.equal(root.independent_security_negative_holdout_required, true);
  assert.equal(root.security_holdout_distinct_from_fast_meta_activation, true);
  assert.equal(root.from_scratch_replay_required, true);
  assert.equal(root.immutable_candidate_identity_required, true);
  assert.equal(root.external_monitor_required, true);
  assert.equal(root.monitor_independent_from_comparator_required, true);
  assert.equal(root.candidate_can_view_security_holdout, false);
  assert.equal(root.candidate_can_clear_incidents, false);
  assert.equal(root.incident_latch_fail_closed, true);
  assert.equal(root.champion_remains_default, true);
  assert.equal(root.bounded_canary_review_only, true);
  assert.equal(root.canary_activation_authorized, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.shadow_monitor_root_digest, /^sha256:[0-9a-f]{64}$/);
});
