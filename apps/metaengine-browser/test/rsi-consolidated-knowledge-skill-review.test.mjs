import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiKnowledgeConsolidationAdmission,
  createRsiKnowledgeTransferValidation,
} from '../src/rsi-slow-knowledge-consolidation.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiConsolidatedKnowledgeSkillReview,
  verifyRsiConsolidatedKnowledgeSkillReview,
  createRsiConsolidatedKnowledgeSkillEvidenceReview,
  verifyRsiConsolidatedKnowledgeSkillEvidenceReview,
  rsiConsolidatedKnowledgeSkillReviewTrustRootSnapshot,
} from '../src/rsi-consolidated-knowledge-skill-review.mjs';

const SOURCE = 'a'.repeat(40);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function dg(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}
function d(label) {
  return dg({ label });
}

function phase31Proposal(knowledgeClass = 'REUSABLE_RECIPE_CANDIDATE') {
  const core = {
    schema: 'metaengine.rsi.knowledge-consolidation-proposal.v1',
    version: 1,
    proposal_id: 'phase31.proposal.phase32.fixture',
    source_sha: SOURCE,
    evaluator_generation_digest: d('phase31-generation'),
    evaluation_epoch_digest: d('phase31-epoch'),
    knowledge_class: knowledgeClass,
    source_entry_digests: [d('source-a'), d('source-b')],
    source_experiment_receipt_digests: [d('receipt-a'), d('receipt-b')],
    source_candidate_artifact_digests: [d('candidate-a'), d('candidate-b')],
    source_entry_count: 2,
    source_candidate_count: 2,
    consolidation_tags: ['CONTROL_FLOW', 'VALIDATION'],
    consolidated_knowledge_digest: d('knowledge'),
    applicability_contract_digest: d('applicability'),
    watch_out_digest: d('watchout'),
    falsification_protocol_digest: d('falsification'),
    transfer_validation_plan_digest: d('transfer-plan'),
    external_consolidator: true,
    external_scope_owner: true,
    authored_by_candidate: false,
    same_evaluator_generation_required: true,
    same_evaluation_epoch_required: true,
    source_diversity_required: true,
    source_evidence_preserved_by_digest: true,
    raw_source_trajectory_copied: false,
    raw_hidden_holdout_copied: false,
    raw_evaluator_assets_copied: false,
    proposal_can_write_skill_library: false,
    proposal_can_write_experience_graph: false,
    proposal_can_modify_meta_skill_profile: false,
    proposal_can_schedule_transfer_validation: false,
    proposal_can_activate_knowledge: false,
    external_transfer_validation_required: true,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, proposal_digest: dg(core) });
}

function phase31Validation(proposal, label) {
  return createRsiKnowledgeTransferValidation({
    validation_id: `phase31.validation.${label}`,
    proposal,
    heldout_context_digest: d(`${label}-context`),
    heldout_task_set_digest: d(`${label}-tasks`),
    task_family_digest: d(`${label}-family`),
    transfer_harness_digest: d(`${label}-harness`),
    acceptance_policy_digest: d(`${label}-acceptance`),
    hidden_holdout_root_digest: d(`${label}-hidden`),
    external_evaluator_root_digest: d(`${label}-evaluator`),
    control_receipt_digest: d(`${label}-control`),
    treatment_receipt_digest: d(`${label}-treatment`),
    transfer_evidence_digest: d(`${label}-evidence`),
    source_context_exclusion_pass: true,
    hidden_holdout_pass: true,
    evaluator_integrity_pass: true,
    contamination_clear: true,
    from_scratch_replay_pass: true,
    task_non_regression: true,
    safety_non_regression: true,
    security_non_regression: true,
    process_non_regression: true,
    outcome_non_regression: true,
    efficiency_non_regression: true,
    strict_transfer_improvement: proposal.knowledge_class === 'REUSABLE_RECIPE_CANDIDATE',
    constraint_prediction_confirmed:
      proposal.knowledge_class === 'NEGATIVE_CONSTRAINT'
      || proposal.knowledge_class === 'LOW_YIELD_CONSTRAINT',
    diagnostic_discrimination_pass:
      proposal.knowledge_class === 'ENVIRONMENT_DIAGNOSTIC'
      || proposal.knowledge_class === 'AMBIGUITY_DIAGNOSTIC',
    external_transfer_validator: true,
    external_holdout_owner: true,
    authored_by_candidate: false,
  });
}

function phase31Bundle(knowledgeClass = 'REUSABLE_RECIPE_CANDIDATE') {
  const proposal = phase31Proposal(knowledgeClass);
  const validations = [
    phase31Validation(proposal, 'target-a'),
    phase31Validation(proposal, 'target-b'),
  ];
  const admission = createRsiKnowledgeConsolidationAdmission({
    admission_id: `phase31.admission.${knowledgeClass.toLowerCase()}`,
    proposal,
    validations,
    external_admission_owner: true,
    authored_by_candidate: false,
  });
  return { proposal, validations, admission };
}

function capsule({
  skillId = 'skill.phase32.baseline',
  version = 1,
  parent = null,
  source = '1',
  role = 'ANALYZER',
  input = d('input'),
  output = d('output'),
  implementation = d(`implementation-${source}`),
  capabilities = ['READ_VERIFIED_CONTEXT', 'ANALYZE_FAILURE_CODES'],
} = {}) {
  return createRsiSkillCapsule({
    skill_id: skillId,
    version,
    parent_skill_digest: parent,
    source_candidate_sha: source.repeat(40),
    role,
    input_schema_digest: input,
    output_schema_digest: output,
    implementation_digest: implementation,
    components: [{
      component_id: `${skillId}.component`,
      artifact_digest: d(`component-${skillId}-${version}`),
      kind: 'PROCEDURAL_RECIPE',
    }],
    capabilities,
    max_context_tokens: 8192,
    max_output_tokens: 2048,
    max_invocations: 4,
    deterministic_interface: true,
    external_builder: true,
    authored_by_candidate: false,
  });
}

function evidence(skill, label = 'baseline') {
  return createRsiSkillEvidence({
    capsule: skill,
    hidden_holdout_digest: d(`${label}-holdout`),
    evaluator_root_digest: d(`${label}-evaluator`),
    unit_test_digest: d(`${label}-unit`),
    runtime_feedback_digest: d(`${label}-runtime`),
    attempt_count: 8,
    success_count: 8,
    hard_invariants_pass: true,
    verified_for_library: true,
    evidence_refs: [`EVIDENCE_${label.toUpperCase()}`],
    external_evaluator: true,
    authored_by_candidate: false,
  });
}

function library() {
  const root = capsule();
  return createRsiVerifiedSkillLibrary({
    library_id: 'rsi.skill.library.phase32.fixture',
    entries: [{ capsule: root, evidence: evidence(root) }],
    external_library_owner: true,
    authored_by_candidate: false,
  });
}

function proposedSkill() {
  return createRsiSkillCapsule({
    skill_id: 'skill.phase32.consolidated.recipe',
    version: 1,
    parent_skill_digest: null,
    source_candidate_sha: SOURCE,
    role: 'PLAN_TRANSFORM',
    input_schema_digest: d('phase32-input'),
    output_schema_digest: d('phase32-output'),
    implementation_digest: d('phase32-implementation'),
    components: [{
      component_id: 'skill.phase32.consolidated.recipe.component',
      artifact_digest: d('phase32-component'),
      kind: 'PROCEDURAL_RECIPE',
    }],
    capabilities: ['READ_VERIFIED_CONTEXT', 'PROPOSE_TYPED_TRANSFORM'],
    max_context_tokens: 8192,
    max_output_tokens: 2048,
    max_invocations: 4,
    deterministic_interface: true,
    external_builder: true,
    authored_by_candidate: false,
  });
}

function reviewFixture() {
  const phase31 = phase31Bundle();
  const currentLibrary = library();
  const skill = proposedSkill();
  const review = createRsiConsolidatedKnowledgeSkillReview({
    review_id: 'phase32.review.fixture',
    ...phase31,
    current_library: currentLibrary,
    skill_capsule: skill,
    knowledge_to_skill_binding_digest: d('knowledge-binding'),
    external_materialization_receipt_digest: d('materialization'),
    interface_review_digest: d('interface-review'),
    capability_review_digest: d('capability-review'),
    external_skill_builder: true,
    external_interface_owner: true,
    external_capability_reviewer: true,
    authored_by_candidate: false,
  });
  return { ...phase31, currentLibrary, skill, review };
}

function localEvidenceArgs(fixture, overrides = {}) {
  return {
    evidence_review_id: 'phase32.evidence.review.fixture',
    review: fixture.review,
    proposal: fixture.proposal,
    validations: fixture.validations,
    admission: fixture.admission,
    current_library: fixture.currentLibrary,
    skill_capsule: fixture.skill,
    local_hidden_holdout_digest: d('phase32-local-holdout'),
    local_evaluator_root_digest: d('phase32-local-evaluator'),
    local_unit_test_digest: d('phase32-local-unit'),
    local_runtime_feedback_digest: d('phase32-local-runtime'),
    matched_reference_control_receipt_digest: d('phase32-matched-control'),
    treatment_receipt_digest: d('phase32-treatment'),
    local_evidence_digest: d('phase32-local-evidence'),
    behavioral_abstraction_digest: d('phase32-behavioral-abstraction'),
    behavioral_invariant_set_digest: d('phase32-behavioral-invariants'),
    failure_attribution_digest: d('phase32-failure-attribution'),
    attempt_count: 12,
    success_count: 11,
    local_acceptance_pass: true,
    matched_reference_pass: true,
    skill_specific_value_demonstrated: true,
    failure_attribution_clear: true,
    hard_invariants_pass: true,
    contamination_clear: true,
    from_scratch_replay_pass: true,
    task_non_regression: true,
    safety_non_regression: true,
    security_non_regression: true,
    process_non_regression: true,
    outcome_non_regression: true,
    efficiency_non_regression: true,
    negative_transfer_detected: false,
    external_library_evaluator: true,
    external_holdout_owner: true,
    authored_by_candidate: false,
    ...overrides,
  };
}

test('Phase32 converts only reusable Phase31 knowledge into a fresh local skill evidence review without writing the library', () => {
  const fx = reviewFixture();
  const checked = verifyRsiConsolidatedKnowledgeSkillReview(fx.review, {
    proposal: fx.proposal,
    validations: fx.validations,
    admission: fx.admission,
    current_library: fx.currentLibrary,
    skill_capsule: fx.skill,
  });
  assert.equal(checked.review_digest, fx.review.review_digest);
  assert.equal(fx.review.state, 'READY_FOR_FRESH_LOCAL_LIBRARY_VALIDATION');
  assert.equal(fx.review.current_library_digest, fx.currentLibrary.library_digest);
  assert.equal(fx.review.phase31_transfer_quorum_required, true);
  assert.equal(fx.review.fresh_local_validation_required, true);
  assert.equal(fx.review.review_can_write_skill_library, false);
  assert.equal(fx.review.review_can_activate_skill, false);
  assert.equal(fx.review.library_admission_token, null);

  const result = createRsiConsolidatedKnowledgeSkillEvidenceReview(localEvidenceArgs(fx));
  assert.equal(result.state, 'READY_FOR_EXTERNAL_EXISTING_LIBRARY_APPEND_REVIEW');
  assert.equal(result.blockers.length, 0);
  assert.equal(result.standard_skill_evidence_verified_for_library, true);
  assert.equal(result.standard_skill_evidence.skill_digest, fx.skill.skill_digest);
  assert.equal(result.structured_behavioral_abstraction_required, true);
  assert.equal(result.behavioral_invariant_set_required, true);
  assert.equal(result.independent_failure_attribution_required, true);
  assert.equal(result.raw_trajectory_stored, false);
  assert.equal(result.library_append_performed, false);
  assert.equal(result.library_admission_token, null);
  assert.equal(result.review_can_append_library, false);
  assert.equal(result.review_can_activate_skill, false);
  assert.equal(result.authority_effect, false);

  const verified = verifyRsiConsolidatedKnowledgeSkillEvidenceReview(result, {
    ...localEvidenceArgs(fx),
  });
  assert.equal(verified.evidence_review_digest, result.evidence_review_digest);
});

test('Phase32 rejects negative/diagnostic knowledge classes from the procedural skill path', () => {
  for (const knowledgeClass of [
    'NEGATIVE_CONSTRAINT',
    'LOW_YIELD_CONSTRAINT',
    'ENVIRONMENT_DIAGNOSTIC',
    'AMBIGUITY_DIAGNOSTIC',
  ]) {
    const phase31 = phase31Bundle(knowledgeClass);
    assert.throws(() => createRsiConsolidatedKnowledgeSkillReview({
      review_id: `phase32.review.${knowledgeClass.toLowerCase()}`,
      ...phase31,
      current_library: library(),
      skill_capsule: proposedSkill(),
      knowledge_to_skill_binding_digest: d(`binding-${knowledgeClass}`),
      external_materialization_receipt_digest: d(`materialization-${knowledgeClass}`),
      interface_review_digest: d(`interface-${knowledgeClass}`),
      capability_review_digest: d(`capability-${knowledgeClass}`),
      external_skill_builder: true,
      external_interface_owner: true,
      external_capability_reviewer: true,
      authored_by_candidate: false,
    }), /reusable_recipe_required/);
  }
});

test('Phase32 local validation is independent from Phase31 holdouts and evaluator roots', () => {
  const fx = reviewFixture();
  assert.throws(() => createRsiConsolidatedKnowledgeSkillEvidenceReview(localEvidenceArgs(fx, {
    local_hidden_holdout_digest: fx.validations[0].hidden_holdout_root_digest,
  })), /reuses_phase31_evidence/);

  assert.throws(() => createRsiConsolidatedKnowledgeSkillEvidenceReview(localEvidenceArgs(fx, {
    local_evaluator_root_digest: fx.validations[1].external_evaluator_root_digest,
  })), /reuses_phase31_evidence/);
});

test('Phase32 differential and non-regression failures stay rejected evidence and never become library authority', () => {
  const fx = reviewFixture();
  const harmful = createRsiConsolidatedKnowledgeSkillEvidenceReview(localEvidenceArgs(fx, {
    matched_reference_pass: false,
    skill_specific_value_demonstrated: false,
    failure_attribution_clear: false,
    efficiency_non_regression: false,
    negative_transfer_detected: true,
  }));
  assert.equal(harmful.state, 'LOCAL_LIBRARY_VALIDATION_REJECTED');
  assert.equal(harmful.standard_skill_evidence_verified_for_library, false);
  assert.ok(harmful.blockers.includes('MATCHED_REFERENCE_FAILED'));
  assert.ok(harmful.blockers.includes('SKILL_SPECIFIC_VALUE_NOT_DEMONSTRATED'));
  assert.ok(harmful.blockers.includes('FAILURE_ATTRIBUTION_AMBIGUOUS'));
  assert.ok(harmful.blockers.includes('EFFICIENCY_REGRESSION'));
  assert.ok(harmful.blockers.includes('NEGATIVE_TRANSFER_DETECTED'));
  assert.equal(harmful.library_append_performed, false);
  assert.equal(harmful.review_can_append_library, false);
  assert.equal(harmful.authority_effect, false);
});

test('Phase32 exact-binds the current library and requires new version semantics', () => {
  const fx = reviewFixture();
  const second = capsule({
    skillId: 'skill.phase32.other',
    source: '2',
    role: 'VERIFIER',
    input: d('other-input'),
    output: d('other-output'),
    capabilities: ['READ_VERIFIED_CONTEXT', 'CHECK_TYPED_OUTPUT'],
  });
  const drifted = createRsiVerifiedSkillLibrary({
    library_id: fx.currentLibrary.library_id,
    entries: [
      ...fx.currentLibrary.entries.map((row) => ({ capsule: row.capsule, evidence: row.evidence })),
      { capsule: second, evidence: evidence(second, 'other') },
    ],
    external_library_owner: true,
    authored_by_candidate: false,
  });
  assert.throws(() => createRsiConsolidatedKnowledgeSkillEvidenceReview(localEvidenceArgs(fx, {
    current_library: drifted,
  })), /review_digest_mismatch|library_drift_requires_revalidation/);

  const invalidVersion = createRsiSkillCapsule({
    skill_id: 'skill.phase32.consolidated.recipe',
    version: 2,
    parent_skill_digest: null,
    source_candidate_sha: SOURCE,
    role: 'PLAN_TRANSFORM',
    input_schema_digest: d('phase32-input'),
    output_schema_digest: d('phase32-output'),
    implementation_digest: d('phase32-implementation-v2'),
    components: [{
      component_id: 'skill.phase32.consolidated.recipe.component.v2',
      artifact_digest: d('phase32-component-v2'),
      kind: 'PROCEDURAL_RECIPE',
    }],
    capabilities: ['READ_VERIFIED_CONTEXT', 'PROPOSE_TYPED_TRANSFORM'],
    max_context_tokens: 8192,
    max_output_tokens: 2048,
    max_invocations: 4,
    deterministic_interface: true,
    external_builder: true,
    authored_by_candidate: false,
  });
  assert.throws(() => createRsiConsolidatedKnowledgeSkillReview({
    review_id: 'phase32.review.invalid-version',
    proposal: fx.proposal,
    validations: fx.validations,
    admission: fx.admission,
    current_library: fx.currentLibrary,
    skill_capsule: invalidVersion,
    knowledge_to_skill_binding_digest: d('invalid-version-binding'),
    external_materialization_receipt_digest: d('invalid-version-materialization'),
    interface_review_digest: d('invalid-version-interface'),
    capability_review_digest: d('invalid-version-capability'),
    external_skill_builder: true,
    external_interface_owner: true,
    external_capability_reviewer: true,
    authored_by_candidate: false,
  }), /new_skill_must_start_at_version_one/);
});

test('Phase32 trust root freezes local revalidation and keeps all activation authority external', () => {
  const root = rsiConsolidatedKnowledgeSkillReviewTrustRootSnapshot();
  assert.equal(root.phase31_eligible_admission_required, true);
  assert.equal(root.reusable_recipe_only_for_skill_review, true);
  assert.equal(root.existing_verified_skill_library_reused, true);
  assert.equal(root.second_skill_library_created, false);
  assert.equal(root.current_library_exact_binding_required, true);
  assert.equal(root.fresh_local_holdout_required, true);
  assert.equal(root.local_holdout_independent_from_phase31_required, true);
  assert.equal(root.matched_reference_required, true);
  assert.equal(root.skill_specific_value_required, true);
  assert.equal(root.structured_behavioral_abstraction_required, true);
  assert.equal(root.behavioral_invariant_set_required, true);
  assert.equal(root.independent_failure_attribution_required, true);
  assert.equal(root.raw_trajectory_stored, false);
  assert.equal(root.zero_negative_transfer_required, true);
  assert.equal(root.skill_library_write_performed_here, false);
  assert.equal(root.skill_activation_performed_here, false);
  assert.equal(root.skill_lifecycle_mutation_performed_here, false);
  assert.equal(root.scheduler_action_performed_here, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.review_root_digest, /^sha256:[0-9a-f]{64}$/);
});
