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
import {
  createRsiRuntimeMetaSkillRecord,
} from '../src/rsi-runtime-meta-skill-archive.mjs';
import {
  createRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from '../src/rsi-recursive-risk-budget.mjs';
import {
  RsiRuntimeMetaProfileAdmissionStore,
  createRsiMetaProfilePairReceipt,
  createRsiMetaProfileRiskCertificate,
  createRsiMetaProfileShadowAdmission,
  createRsiMetaProfileTournamentPlan,
  evaluateRsiMetaProfileTournament,
  rsiMetaProfileAdmissionTrustRootSnapshot,
  verifyRsiMetaProfileShadowAdmission,
} from '../src/rsi-runtime-meta-profile-admission.mjs';

const SOURCE = 'a'.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function makeSkill({ id, role, sourceChar, implChar }) {
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
    attempt_count: 12,
    success_count: 10,
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
  const analyzer1 = makeSkill({ id: 'meta.analyzer.v1', role: 'ANALYZER', sourceChar: 'b', implChar: 'b' });
  const analyzer2 = makeSkill({ id: 'meta.analyzer.alt', role: 'ANALYZER', sourceChar: 'c', implChar: 'c' });
  const retriever = makeSkill({ id: 'meta.retriever', role: 'RETRIEVER', sourceChar: 'd', implChar: 'd' });
  const allocator = makeSkill({ id: 'meta.allocator', role: 'ALLOCATOR', sourceChar: 'e', implChar: 'e' });
  const proposer = makeSkill({ id: 'meta.proposer', role: 'PROPOSER', sourceChar: 'f', implChar: 'f' });
  const evolver = makeSkill({ id: 'meta.evolver', role: 'EVOLVER', sourceChar: 'a', implChar: 'a' });
  const library = createRsiVerifiedSkillLibrary({
    library_id: 'runtime.meta.skill.library',
    entries: [analyzer1, analyzer2, retriever, allocator, proposer, evolver],
    external_library_owner: true,
    authored_by_candidate: false,
  });
  const parent = createRsiMetaSkillProfile({
    profile_id: 'meta.profile.parent',
    library,
    profile_generation: 1,
    slow_meta_epoch: 1,
    fast_skill_epoch: 10,
    frozen_backbone_family: 'GPT_5_6_SOL',
    bindings: {
      ANALYZER: binding(analyzer1),
      RETRIEVER: binding(retriever),
      ALLOCATOR: binding(allocator),
      PROPOSER: binding(proposer),
      EVOLVER: binding(evolver),
    },
    external_profile_owner: true,
    authored_by_candidate: false,
  });
  const successor = createRsiMetaSkillProfile({
    profile_id: 'meta.profile.successor',
    library,
    profile_generation: 2,
    slow_meta_epoch: 2,
    fast_skill_epoch: 10,
    frozen_backbone_family: 'GPT_5_6_SOL',
    bindings: {
      ANALYZER: binding(analyzer2),
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
    episode_count: 10,
    helpful_count: 8,
    harmful_count: 1,
    neutral_count: 1,
    insufficient_count: 0,
    evidence_refs: ['meta:fast:summary'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  const plan = createRsiMetaSkillEvolutionPlan({
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
    plan,
    parent_profile: parent,
    successor_profile: successor,
    library,
    fast_loop_summary: fast,
    evaluator_root_digest: d('9'),
    objective_spec: [
      { metric: 'task_success', direction: 'MAXIMIZE', materiality_threshold: 0.01 },
      { metric: 'latency_ms', direction: 'MINIMIZE', materiality_threshold: 1 },
    ],
    parent_metrics: { task_success: 0.70, latency_ms: 100 },
    successor_metrics: { task_success: 0.76, latency_ms: 94 },
    hard_invariants_pass: true,
    evidence_refs: ['meta:slow:evaluation'],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  const result = finalizeRsiMetaSkillEvolution({
    plan,
    parent_profile: parent,
    successor_profile: successor,
    library,
    fast_loop_summary: fast,
    evaluation,
  });
  const record = createRsiRuntimeMetaSkillRecord({
    source_sha: SOURCE,
    record_id: 'meta.record.phase17',
    library,
    parent_profile: parent,
    successor_profile: successor,
    fast_loop_summary: fast,
    plan,
    evaluation,
    result,
    external_archive_owner: true,
    authored_by_candidate: false,
  });
  return { library, parent, successor, fast, plan, evaluation, result, record };
}

function makeTournament(record, { tradeoff = false } = {}) {
  const plan = createRsiMetaProfileTournamentPlan({
    record,
    evaluator_root_digest: d('c'),
    admission_holdout_digest: d('d'),
    pair_count: 5,
    external_tournament_owner: true,
    authored_by_candidate: false,
  });
  const receipts = Array.from({ length: 5 }, (_, index) => createRsiMetaProfilePairReceipt({
    plan,
    pair_index: index + 1,
    parent_metrics: { task_success: 0.70 + index * 0.001, latency_ms: 100 + index },
    successor_metrics: {
      task_success: 0.76 + index * 0.001,
      latency_ms: tradeoff ? 112 + index : 93 + index,
    },
    hard_invariants_pass: true,
    evidence_refs: [`meta:pair:${index + 1}`],
    external_evaluator: true,
    authored_by_candidate: false,
  }));
  return { plan, receipts, result: evaluateRsiMetaProfileTournament({ plan, receipts }) };
}

function makeRisk(plan, result, { superiority = true } = {}) {
  const budget = createRsiRecursiveRiskBudget({
    budget_id: 'meta.profile.recursive.risk',
    global_alpha: 0.05,
  });
  const alpha = rsiRiskAllocationForConfirmation(budget, 1) * 0.8;
  const certificate = createRsiMetaProfileRiskCertificate({
    certificate_id: 'meta.profile.risk.certificate.1',
    budget,
    confirmation_index: 1,
    plan,
    result,
    method: 'PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1',
    alpha_used: alpha,
    superiority_certified: superiority,
    paired_evaluation: true,
    independent_holdout: true,
    stopping_rule_precommitted: true,
    optional_stopping_used: false,
    familywise_valid: true,
    screening_spent_alpha: false,
    confirmation_triggered: true,
    sample_count: 50,
    evidence_refs: ['meta:risk:certificate'],
    external_verifier: true,
    authored_by_candidate: false,
  });
  return { budget, certificate };
}

test('independent tournament plus recursive-risk evidence admits only a shadow meta profile', () => {
  const { record } = fixture();
  const { plan, result } = makeTournament(record);
  assert.equal(result.relation, 'PARETO_ADVANCE');
  assert.equal(result.eligible_for_shadow_admission, true);
  const { budget, certificate } = makeRisk(plan, result);
  const admission = createRsiMetaProfileShadowAdmission({
    record,
    plan,
    result,
    budget,
    risk_certificate: certificate,
    admission_id: 'meta.profile.admission.1',
    external_admission_owner: true,
    authored_by_candidate: false,
  });
  verifyRsiMetaProfileShadowAdmission(admission);
  assert.equal(admission.state, 'SHADOW_PROFILE_ADMITTED');
  assert.equal(admission.shadow_profile_admitted, true);
  assert.equal(admission.eligible_for_bounded_shadow_canary, true);
  assert.equal(admission.bounded_shadow_canary_required, true);
  assert.equal(admission.direct_production_activation_authorized, false);
  assert.equal(admission.direct_self_update_authorized, false);
  assert.equal(admission.authority_effect, false);
});

test('admission holdout must be distinct from both fast-loop and slow meta holdouts', () => {
  const { record } = fixture();
  assert.throws(() => createRsiMetaProfileTournamentPlan({
    record,
    evaluator_root_digest: d('c'),
    admission_holdout_digest: record.fast_loop_summary.fast_holdout_digest,
    external_tournament_owner: true,
    authored_by_candidate: false,
  }), /admission_holdout_must_be_independent/);
  assert.throws(() => createRsiMetaProfileTournamentPlan({
    record,
    evaluator_root_digest: d('c'),
    admission_holdout_digest: record.plan.meta_holdout_digest,
    external_tournament_owner: true,
    authored_by_candidate: false,
  }), /admission_holdout_must_be_independent/);
});

test('tradeoff stepping stones remain archive-only and cannot enter shadow admission', () => {
  const { record } = fixture();
  const { plan, result } = makeTournament(record, { tradeoff: true });
  assert.equal(result.relation, 'TRADEOFF_STEPPING_STONE');
  assert.equal(result.eligible_for_shadow_admission, false);
  const { budget, certificate } = makeRisk(plan, result, { superiority: false });
  const admission = createRsiMetaProfileShadowAdmission({
    record,
    plan,
    result,
    budget,
    risk_certificate: certificate,
    admission_id: 'meta.profile.admission.tradeoff',
    external_admission_owner: true,
    authored_by_candidate: false,
  });
  assert.equal(admission.state, 'BLOCKED');
  assert.deepEqual(admission.blockers, ['RECURSIVE_RISK_NOT_CERTIFIED', 'TOURNAMENT_NOT_PARETO_ADVANCE', 'TOURNAMENT_NOT_SHADOW_ELIGIBLE']);
  assert.equal(admission.eligible_for_bounded_shadow_canary, false);
});

test('candidate-authored tournament, risk, or admission evidence fails closed', () => {
  const { record } = fixture();
  assert.throws(() => createRsiMetaProfileTournamentPlan({
    record,
    evaluator_root_digest: d('c'),
    admission_holdout_digest: d('d'),
    external_tournament_owner: false,
    authored_by_candidate: true,
  }), /external_tournament_owner_required/);

  const { plan, result } = makeTournament(record);
  const budget = createRsiRecursiveRiskBudget({ budget_id: 'meta.profile.recursive.risk', global_alpha: 0.05 });
  assert.throws(() => createRsiMetaProfileRiskCertificate({
    certificate_id: 'meta.profile.risk.candidate',
    budget,
    confirmation_index: 1,
    plan,
    result,
    method: 'E_VALUE_EXTERNAL_V1',
    alpha_used: 0.01,
    superiority_certified: true,
    paired_evaluation: true,
    independent_holdout: true,
    stopping_rule_precommitted: true,
    optional_stopping_used: false,
    familywise_valid: true,
    screening_spent_alpha: false,
    confirmation_triggered: true,
    sample_count: 20,
    evidence_refs: ['meta:risk:candidate'],
    external_verifier: false,
    authored_by_candidate: true,
  }), /external_risk_verifier_required/);

  const { certificate } = makeRisk(plan, result);
  assert.throws(() => createRsiMetaProfileShadowAdmission({
    record,
    plan,
    result,
    budget,
    risk_certificate: certificate,
    admission_id: 'meta.profile.admission.candidate',
    external_admission_owner: false,
    authored_by_candidate: true,
  }), /external_admission_owner_required/);
});

test('shadow admission store is append-only, restart durable, and has no active profile authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-meta-profile-admission-'));
  try {
    const { record } = fixture();
    const { plan, result } = makeTournament(record);
    const { budget, certificate } = makeRisk(plan, result);
    const admission = createRsiMetaProfileShadowAdmission({
      record,
      plan,
      result,
      budget,
      risk_certificate: certificate,
      admission_id: 'meta.profile.admission.persist',
      external_admission_owner: true,
      authored_by_candidate: false,
    });
    const statePath = path.join(root, 'admissions.json');
    const store = new RsiRuntimeMetaProfileAdmissionStore({ statePath, source_sha: SOURCE });
    await store.init();
    assert.equal((await store.add(admission)).state, 'SHADOW_PROFILE_ADMITTED');
    assert.equal((await store.add(admission)).state, 'IDEMPOTENT');
    assert.equal(store.snapshot().shadow_admitted_count, 1);
    assert.equal(store.snapshot().active_profile_digest, null);
    assert.equal(store.snapshot().store_can_activate_profile, false);
    assert.equal(store.admitted().length, 1);

    const restored = new RsiRuntimeMetaProfileAdmissionStore({ statePath, source_sha: SOURCE });
    await restored.init();
    assert.equal(restored.snapshot().admission_count, 1);
    assert.equal(restored.snapshot().shadow_admitted_count, 1);
    assert.equal(restored.snapshot().production_activation_authorized, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('trust root preserves fixed operation, independent evaluation, risk budget, and no direct activation', () => {
  const root = rsiMetaProfileAdmissionTrustRootSnapshot();
  assert.equal(root.fixed_meta_operation_self_rewrite_allowed, false);
  assert.equal(root.exact_meta_record_binding_required, true);
  assert.equal(root.exact_library_snapshot_binding_required, true);
  assert.equal(root.independent_admission_holdout_required, true);
  assert.equal(root.paired_tournament_required, true);
  assert.equal(root.pareto_advance_required_for_shadow_admission, true);
  assert.equal(root.tradeoff_is_archive_only, true);
  assert.equal(root.recursive_risk_budget_required, true);
  assert.equal(root.candidate_can_self_admit, false);
  assert.equal(root.shadow_admission_is_production_activation, false);
  assert.equal(root.bounded_shadow_canary_required, true);
  assert.equal(root.production_activation_authorized, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.meta_profile_admission_root_digest, /^sha256:[0-9a-f]{64}$/);
});
