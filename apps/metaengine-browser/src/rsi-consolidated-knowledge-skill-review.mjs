import crypto from 'node:crypto';

import {
  verifyRsiKnowledgeConsolidationAdmission,
  verifyRsiKnowledgeTransferValidation,
} from './rsi-slow-knowledge-consolidation.mjs';
import {
  createRsiSkillEvidence,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';

export const RSI_CONSOLIDATED_KNOWLEDGE_SKILL_REVIEW_SCHEMA =
  'metaengine.rsi.consolidated-knowledge-skill-review.v1';
export const RSI_CONSOLIDATED_KNOWLEDGE_SKILL_EVIDENCE_REVIEW_SCHEMA =
  'metaengine.rsi.consolidated-knowledge-skill-evidence-review.v1';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_phase32_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_phase32_${label}_invalid`);
  return out;
}

function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZero(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_phase32_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_phase32_${label}_automatic_retry_invalid`);
  }
}

function sameArray(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeAdmissionEvidence({ proposal, validations, admission }) {
  if (!proposal || proposal.knowledge_class !== 'REUSABLE_RECIPE_CANDIDATE') {
    throw new Error('rsi_phase32_reusable_recipe_required');
  }
  if (!Array.isArray(validations) || validations.length < 2) {
    throw new Error('rsi_phase32_phase31_validation_quorum_required');
  }
  const checkedValidations = validations.map((row) =>
    verifyRsiKnowledgeTransferValidation(row, { proposal }));
  const checkedAdmission = verifyRsiKnowledgeConsolidationAdmission(admission, {
    proposal,
    validations: checkedValidations,
  });
  assertZero(checkedAdmission, 'phase31_admission');
  if (
    checkedAdmission.state !== 'ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW'
    || checkedAdmission.eligible_for_library_admission_review !== true
    || checkedAdmission.library_admission_token !== null
    || checkedAdmission.zero_observed_negative_transfer !== true
  ) {
    throw new Error('rsi_phase32_phase31_admission_not_eligible');
  }
  return Object.freeze({
    proposal,
    validations: Object.freeze(checkedValidations),
    admission: checkedAdmission,
  });
}

function findParent(library, skill) {
  if (skill.parent_skill_digest == null) return null;
  const parent = library.entries.find((row) => row.skill_digest === skill.parent_skill_digest);
  if (!parent) throw new Error('rsi_phase32_parent_skill_missing');
  if (parent.skill_id !== skill.skill_id) throw new Error('rsi_phase32_parent_skill_id_drift');
  if (skill.skill_version !== parent.skill_version + 1) throw new Error('rsi_phase32_non_adjacent_skill_version');
  if (
    parent.role !== skill.role
    || parent.input_schema_digest !== skill.input_schema_digest
    || parent.output_schema_digest !== skill.output_schema_digest
  ) {
    throw new Error('rsi_phase32_parent_interface_drift');
  }
  if (!sameArray(parent.capabilities, skill.capabilities)) {
    throw new Error('rsi_phase32_parent_capability_drift');
  }
  return parent;
}

function assertLibraryCandidateCompatible(library, skill) {
  const sameVersion = library.entries.find(
    (row) => row.skill_id === skill.skill_id && row.skill_version === skill.skill_version);
  if (sameVersion) throw new Error('rsi_phase32_skill_version_already_present');

  const sameDigest = library.entries.find((row) => row.skill_digest === skill.skill_digest);
  if (sameDigest) throw new Error('rsi_phase32_skill_digest_already_present');

  const sameId = library.entries.filter((row) => row.skill_id === skill.skill_id);
  if (skill.parent_skill_digest == null) {
    if (skill.skill_version !== 1) throw new Error('rsi_phase32_new_skill_must_start_at_version_one');
    if (sameId.length > 0) throw new Error('rsi_phase32_new_skill_id_conflicts_with_existing_lineage');
    return null;
  }
  return findParent(library, skill);
}

function phase31ForbiddenLocalRoots(validations) {
  const out = new Set();
  for (const row of validations) {
    for (const field of [
      'heldout_context_digest',
      'heldout_task_set_digest',
      'task_family_digest',
      'transfer_harness_digest',
      'acceptance_policy_digest',
      'hidden_holdout_root_digest',
      'external_evaluator_root_digest',
      'control_receipt_digest',
      'treatment_receipt_digest',
      'transfer_evidence_digest',
    ]) {
      out.add(exactDigest(row[field], `phase31_${field}`));
    }
  }
  return out;
}

export function createRsiConsolidatedKnowledgeSkillReview({
  review_id,
  proposal,
  validations,
  admission,
  current_library,
  skill_capsule,
  knowledge_to_skill_binding_digest,
  external_materialization_receipt_digest,
  interface_review_digest,
  capability_review_digest,
  external_skill_builder = false,
  external_interface_owner = false,
  external_capability_reviewer = false,
  authored_by_candidate = true,
} = {}) {
  const phase31 = normalizeAdmissionEvidence({ proposal, validations, admission });
  const library = verifyRsiVerifiedSkillLibrary(current_library);
  const skill = verifyRsiSkillCapsule(skill_capsule);

  if (
    external_skill_builder !== true
    || external_interface_owner !== true
    || external_capability_reviewer !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_phase32_external_skill_owners_required');
  }
  if (skill.source_candidate_sha !== phase31.admission.source_sha) {
    throw new Error('rsi_phase32_skill_source_sha_mismatch');
  }

  const parent = assertLibraryCandidateCompatible(library, skill);
  const roots = [
    exactDigest(knowledge_to_skill_binding_digest, 'knowledge_binding'),
    exactDigest(external_materialization_receipt_digest, 'materialization_receipt'),
    exactDigest(interface_review_digest, 'interface_review'),
    exactDigest(capability_review_digest, 'capability_review'),
    phase31.proposal.consolidated_knowledge_digest,
    phase31.proposal.applicability_contract_digest,
    phase31.proposal.falsification_protocol_digest,
  ];
  if (new Set(roots).size !== roots.length) {
    throw new Error('rsi_phase32_independent_review_roots_required');
  }

  const core = zero({
    schema: RSI_CONSOLIDATED_KNOWLEDGE_SKILL_REVIEW_SCHEMA,
    version: 1,
    review_id: boundedId(review_id, 'review_id'),
    source_sha: phase31.admission.source_sha,
    phase31_proposal_digest: phase31.proposal.proposal_digest,
    phase31_admission_digest: phase31.admission.admission_digest,
    phase31_validation_digests: Object.freeze(
      phase31.validations.map((row) => row.validation_digest).sort()),
    knowledge_class: phase31.proposal.knowledge_class,
    consolidated_knowledge_digest: phase31.proposal.consolidated_knowledge_digest,
    applicability_contract_digest: phase31.proposal.applicability_contract_digest,
    watch_out_digest: phase31.proposal.watch_out_digest,
    falsification_protocol_digest: phase31.proposal.falsification_protocol_digest,
    current_library_id: library.library_id,
    current_library_digest: library.library_digest,
    proposed_skill_id: skill.skill_id,
    proposed_skill_version: skill.skill_version,
    proposed_skill_digest: skill.skill_digest,
    proposed_skill_role: skill.role,
    proposed_skill_input_schema_digest: skill.input_schema_digest,
    proposed_skill_output_schema_digest: skill.output_schema_digest,
    proposed_skill_capabilities: skill.capabilities,
    proposed_skill_parent_digest: parent?.skill_digest ?? null,
    knowledge_to_skill_binding_digest: roots[0],
    external_materialization_receipt_digest: roots[1],
    interface_review_digest: roots[2],
    capability_review_digest: roots[3],
    external_skill_builder: true,
    external_interface_owner: true,
    external_capability_reviewer: true,
    authored_by_candidate: false,
    phase31_transfer_quorum_required: true,
    phase31_zero_negative_transfer_required: true,
    current_library_exact_binding_required: true,
    fresh_local_validation_required: true,
    local_holdout_must_be_distinct_from_phase31: true,
    matched_reference_required: true,
    skill_specific_value_required: true,
    candidate_can_choose_library_context: false,
    candidate_can_choose_local_holdout: false,
    candidate_can_choose_local_evaluator: false,
    review_can_write_skill_library: false,
    review_can_activate_skill: false,
    review_can_modify_skill_lifecycle: false,
    state: 'READY_FOR_FRESH_LOCAL_LIBRARY_VALIDATION',
    library_admission_token: null,
  });
  return Object.freeze({ ...core, review_digest: digest(core) });
}

export function verifyRsiConsolidatedKnowledgeSkillReview(
  review,
  { proposal, validations, admission, current_library, skill_capsule } = {},
) {
  if (
    !review
    || review.schema !== RSI_CONSOLIDATED_KNOWLEDGE_SKILL_REVIEW_SCHEMA
    || review.version !== 1
  ) {
    throw new Error('rsi_phase32_review_invalid');
  }
  assertZero(review, 'review');
  if (
    review.external_skill_builder !== true
    || review.external_interface_owner !== true
    || review.external_capability_reviewer !== true
    || review.authored_by_candidate !== false
    || review.phase31_transfer_quorum_required !== true
    || review.phase31_zero_negative_transfer_required !== true
    || review.current_library_exact_binding_required !== true
    || review.fresh_local_validation_required !== true
    || review.local_holdout_must_be_distinct_from_phase31 !== true
    || review.matched_reference_required !== true
    || review.skill_specific_value_required !== true
    || review.candidate_can_choose_library_context !== false
    || review.candidate_can_choose_local_holdout !== false
    || review.candidate_can_choose_local_evaluator !== false
    || review.review_can_write_skill_library !== false
    || review.review_can_activate_skill !== false
    || review.review_can_modify_skill_lifecycle !== false
    || review.state !== 'READY_FOR_FRESH_LOCAL_LIBRARY_VALIDATION'
    || review.library_admission_token !== null
  ) {
    throw new Error('rsi_phase32_review_policy_invalid');
  }
  const canonical = createRsiConsolidatedKnowledgeSkillReview({
    review_id: review.review_id,
    proposal,
    validations,
    admission,
    current_library,
    skill_capsule,
    knowledge_to_skill_binding_digest: review.knowledge_to_skill_binding_digest,
    external_materialization_receipt_digest: review.external_materialization_receipt_digest,
    interface_review_digest: review.interface_review_digest,
    capability_review_digest: review.capability_review_digest,
    external_skill_builder: true,
    external_interface_owner: true,
    external_capability_reviewer: true,
    authored_by_candidate: false,
  });
  if (canonical.review_digest !== exactDigest(review.review_digest, 'review')) {
    throw new Error('rsi_phase32_review_digest_mismatch');
  }
  return canonical;
}

export function createRsiConsolidatedKnowledgeSkillEvidenceReview({
  evidence_review_id,
  review,
  proposal,
  validations,
  admission,
  current_library,
  skill_capsule,
  local_hidden_holdout_digest,
  local_evaluator_root_digest,
  local_unit_test_digest,
  local_runtime_feedback_digest,
  matched_reference_control_receipt_digest,
  treatment_receipt_digest,
  local_evidence_digest,
  behavioral_abstraction_digest,
  behavioral_invariant_set_digest,
  failure_attribution_digest,
  attempt_count,
  success_count,
  local_acceptance_pass,
  matched_reference_pass,
  skill_specific_value_demonstrated,
  failure_attribution_clear,
  hard_invariants_pass,
  contamination_clear,
  from_scratch_replay_pass,
  task_non_regression,
  safety_non_regression,
  security_non_regression,
  process_non_regression,
  outcome_non_regression,
  efficiency_non_regression,
  negative_transfer_detected = true,
  external_library_evaluator = false,
  external_holdout_owner = false,
  authored_by_candidate = true,
} = {}) {
  const checkedReview = verifyRsiConsolidatedKnowledgeSkillReview(review, {
    proposal,
    validations,
    admission,
    current_library,
    skill_capsule,
  });
  const library = verifyRsiVerifiedSkillLibrary(current_library);
  const skill = verifyRsiSkillCapsule(skill_capsule);
  if (library.library_digest !== checkedReview.current_library_digest) {
    throw new Error('rsi_phase32_library_drift_requires_revalidation');
  }
  if (
    external_library_evaluator !== true
    || external_holdout_owner !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_phase32_external_local_validation_required');
  }

  const phase31 = normalizeAdmissionEvidence({ proposal, validations, admission });
  const forbidden = phase31ForbiddenLocalRoots(phase31.validations);
  const localRoots = [
    exactDigest(local_hidden_holdout_digest, 'local_hidden_holdout'),
    exactDigest(local_evaluator_root_digest, 'local_evaluator_root'),
    exactDigest(local_unit_test_digest, 'local_unit_test'),
    exactDigest(local_runtime_feedback_digest, 'local_runtime_feedback'),
    exactDigest(matched_reference_control_receipt_digest, 'matched_reference_control'),
    exactDigest(treatment_receipt_digest, 'treatment_receipt'),
    exactDigest(local_evidence_digest, 'local_evidence'),
    exactDigest(behavioral_abstraction_digest, 'behavioral_abstraction'),
    exactDigest(behavioral_invariant_set_digest, 'behavioral_invariant_set'),
    exactDigest(failure_attribution_digest, 'failure_attribution'),
  ];
  if (new Set(localRoots).size !== localRoots.length) {
    throw new Error('rsi_phase32_local_validation_roots_must_be_independent');
  }
  if (localRoots.some((root) => forbidden.has(root))) {
    throw new Error('rsi_phase32_local_validation_reuses_phase31_evidence');
  }

  const blockers = [];
  if (local_acceptance_pass !== true) blockers.push('LOCAL_ACCEPTANCE_FAILED');
  if (matched_reference_pass !== true) blockers.push('MATCHED_REFERENCE_FAILED');
  if (skill_specific_value_demonstrated !== true) blockers.push('SKILL_SPECIFIC_VALUE_NOT_DEMONSTRATED');
  if (failure_attribution_clear !== true) blockers.push('FAILURE_ATTRIBUTION_AMBIGUOUS');
  if (hard_invariants_pass !== true) blockers.push('HARD_INVARIANT_FAILURE');
  if (contamination_clear !== true) blockers.push('CONTAMINATION_DETECTED');
  if (from_scratch_replay_pass !== true) blockers.push('FROM_SCRATCH_REPLAY_FAILURE');
  if (task_non_regression !== true) blockers.push('TASK_REGRESSION');
  if (safety_non_regression !== true) blockers.push('SAFETY_REGRESSION');
  if (security_non_regression !== true) blockers.push('SECURITY_REGRESSION');
  if (process_non_regression !== true) blockers.push('PROCESS_REGRESSION');
  if (outcome_non_regression !== true) blockers.push('OUTCOME_REGRESSION');
  if (efficiency_non_regression !== true) blockers.push('EFFICIENCY_REGRESSION');
  if (negative_transfer_detected !== false) blockers.push('NEGATIVE_TRANSFER_DETECTED');

  const passed = blockers.length === 0;
  const standardEvidence = createRsiSkillEvidence({
    capsule: skill,
    hidden_holdout_digest: localRoots[0],
    evaluator_root_digest: localRoots[1],
    unit_test_digest: localRoots[2],
    runtime_feedback_digest: localRoots[3],
    attempt_count,
    success_count,
    hard_invariants_pass: hard_invariants_pass === true,
    verified_for_library: passed,
    evidence_refs: [
      checkedReview.review_id,
      `phase31:${phase31.admission.admission_id}`,
      `phase32:${boundedId(evidence_review_id, 'evidence_review_id')}`,
    ],
    external_evaluator: true,
    authored_by_candidate: false,
  });
  verifyRsiSkillEvidence(standardEvidence, skill);

  const core = zero({
    schema: RSI_CONSOLIDATED_KNOWLEDGE_SKILL_EVIDENCE_REVIEW_SCHEMA,
    version: 1,
    evidence_review_id: boundedId(evidence_review_id, 'evidence_review_id'),
    source_sha: checkedReview.source_sha,
    review_digest: checkedReview.review_digest,
    phase31_admission_digest: checkedReview.phase31_admission_digest,
    current_library_digest: checkedReview.current_library_digest,
    proposed_skill_digest: skill.skill_digest,
    local_hidden_holdout_digest: localRoots[0],
    local_evaluator_root_digest: localRoots[1],
    local_unit_test_digest: localRoots[2],
    local_runtime_feedback_digest: localRoots[3],
    matched_reference_control_receipt_digest: localRoots[4],
    treatment_receipt_digest: localRoots[5],
    local_evidence_digest: localRoots[6],
    behavioral_abstraction_digest: localRoots[7],
    behavioral_invariant_set_digest: localRoots[8],
    failure_attribution_digest: localRoots[9],
    attempt_count: standardEvidence.attempt_count,
    success_count: standardEvidence.success_count,
    local_acceptance_pass: local_acceptance_pass === true,
    matched_reference_pass: matched_reference_pass === true,
    skill_specific_value_demonstrated: skill_specific_value_demonstrated === true,
    failure_attribution_clear: failure_attribution_clear === true,
    hard_invariants_pass: hard_invariants_pass === true,
    contamination_clear: contamination_clear === true,
    from_scratch_replay_pass: from_scratch_replay_pass === true,
    task_non_regression: task_non_regression === true,
    safety_non_regression: safety_non_regression === true,
    security_non_regression: security_non_regression === true,
    process_non_regression: process_non_regression === true,
    outcome_non_regression: outcome_non_regression === true,
    efficiency_non_regression: efficiency_non_regression === true,
    negative_transfer_detected: negative_transfer_detected === true,
    blockers: Object.freeze(blockers.sort()),
    standard_skill_evidence: standardEvidence,
    standard_skill_evidence_digest: standardEvidence.evidence_digest,
    standard_skill_evidence_verified_for_library: standardEvidence.verified_for_library,
    state: passed
      ? 'READY_FOR_EXTERNAL_EXISTING_LIBRARY_APPEND_REVIEW'
      : 'LOCAL_LIBRARY_VALIDATION_REJECTED',
    library_append_performed: false,
    library_admission_token: null,
    external_library_evaluator: true,
    external_holdout_owner: true,
    authored_by_candidate: false,
    candidate_can_choose_reference: false,
    candidate_can_choose_holdout: false,
    candidate_can_choose_evaluator: false,
    structured_behavioral_abstraction_required: true,
    behavioral_invariant_set_required: true,
    independent_failure_attribution_required: true,
    raw_trajectory_stored: false,
    review_can_append_library: false,
    review_can_activate_skill: false,
    review_can_modify_skill_lifecycle: false,
    review_can_schedule_work: false,
  });
  return Object.freeze({ ...core, evidence_review_digest: digest(core) });
}

export function verifyRsiConsolidatedKnowledgeSkillEvidenceReview(
  evidenceReview,
  args = {},
) {
  if (
    !evidenceReview
    || evidenceReview.schema !== RSI_CONSOLIDATED_KNOWLEDGE_SKILL_EVIDENCE_REVIEW_SCHEMA
    || evidenceReview.version !== 1
  ) {
    throw new Error('rsi_phase32_evidence_review_invalid');
  }
  assertZero(evidenceReview, 'evidence_review');
  if (
    evidenceReview.library_append_performed !== false
    || evidenceReview.library_admission_token !== null
    || evidenceReview.external_library_evaluator !== true
    || evidenceReview.external_holdout_owner !== true
    || evidenceReview.authored_by_candidate !== false
    || evidenceReview.candidate_can_choose_reference !== false
    || evidenceReview.candidate_can_choose_holdout !== false
    || evidenceReview.candidate_can_choose_evaluator !== false
    || evidenceReview.structured_behavioral_abstraction_required !== true
    || evidenceReview.behavioral_invariant_set_required !== true
    || evidenceReview.independent_failure_attribution_required !== true
    || evidenceReview.raw_trajectory_stored !== false
    || evidenceReview.review_can_append_library !== false
    || evidenceReview.review_can_activate_skill !== false
    || evidenceReview.review_can_modify_skill_lifecycle !== false
    || evidenceReview.review_can_schedule_work !== false
  ) {
    throw new Error('rsi_phase32_evidence_review_policy_invalid');
  }
  const canonical = createRsiConsolidatedKnowledgeSkillEvidenceReview({
    ...args,
    evidence_review_id: evidenceReview.evidence_review_id,
    local_hidden_holdout_digest: evidenceReview.local_hidden_holdout_digest,
    local_evaluator_root_digest: evidenceReview.local_evaluator_root_digest,
    local_unit_test_digest: evidenceReview.local_unit_test_digest,
    local_runtime_feedback_digest: evidenceReview.local_runtime_feedback_digest,
    matched_reference_control_receipt_digest:
      evidenceReview.matched_reference_control_receipt_digest,
    treatment_receipt_digest: evidenceReview.treatment_receipt_digest,
    local_evidence_digest: evidenceReview.local_evidence_digest,
    behavioral_abstraction_digest: evidenceReview.behavioral_abstraction_digest,
    behavioral_invariant_set_digest: evidenceReview.behavioral_invariant_set_digest,
    failure_attribution_digest: evidenceReview.failure_attribution_digest,
    attempt_count: evidenceReview.attempt_count,
    success_count: evidenceReview.success_count,
    local_acceptance_pass: evidenceReview.local_acceptance_pass,
    matched_reference_pass: evidenceReview.matched_reference_pass,
    skill_specific_value_demonstrated: evidenceReview.skill_specific_value_demonstrated,
    failure_attribution_clear: evidenceReview.failure_attribution_clear,
    hard_invariants_pass: evidenceReview.hard_invariants_pass,
    contamination_clear: evidenceReview.contamination_clear,
    from_scratch_replay_pass: evidenceReview.from_scratch_replay_pass,
    task_non_regression: evidenceReview.task_non_regression,
    safety_non_regression: evidenceReview.safety_non_regression,
    security_non_regression: evidenceReview.security_non_regression,
    process_non_regression: evidenceReview.process_non_regression,
    outcome_non_regression: evidenceReview.outcome_non_regression,
    efficiency_non_regression: evidenceReview.efficiency_non_regression,
    negative_transfer_detected: evidenceReview.negative_transfer_detected,
    external_library_evaluator: true,
    external_holdout_owner: true,
    authored_by_candidate: false,
  });
  if (
    canonical.evidence_review_digest
    !== exactDigest(evidenceReview.evidence_review_digest, 'evidence_review')
  ) {
    throw new Error('rsi_phase32_evidence_review_digest_mismatch');
  }
  return canonical;
}

export function rsiConsolidatedKnowledgeSkillReviewTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.consolidated-knowledge-skill-review-root.v1',
    version: 1,
    phase31_eligible_admission_required: true,
    reusable_recipe_only_for_skill_review: true,
    existing_verified_skill_library_reused: true,
    second_skill_library_created: false,
    current_library_exact_binding_required: true,
    fresh_local_holdout_required: true,
    local_holdout_independent_from_phase31_required: true,
    matched_reference_required: true,
    skill_specific_value_required: true,
    structured_behavioral_abstraction_required: true,
    behavioral_invariant_set_required: true,
    independent_failure_attribution_required: true,
    raw_trajectory_stored: false,
    all_non_regression_dimensions_required: true,
    contamination_clear_required: true,
    from_scratch_replay_required: true,
    zero_negative_transfer_required: true,
    candidate_can_choose_library_context: false,
    candidate_can_choose_reference: false,
    candidate_can_choose_holdout: false,
    candidate_can_choose_evaluator: false,
    skill_library_write_performed_here: false,
    skill_activation_performed_here: false,
    skill_lifecycle_mutation_performed_here: false,
    scheduler_action_performed_here: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, review_root_digest: digest(root) });
}
