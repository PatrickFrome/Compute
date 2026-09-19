import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';

export const RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA =
  'metaengine.rsi.dormant-skill-retrieval-review.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error('rsi_dormant_review_' + label + '_digest_invalid');
  return out;
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error('rsi_dormant_review_' + label + '_sha_invalid');
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error('rsi_dormant_review_' + label + '_invalid');
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
    'browser_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'direct_tool_execution_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) {
      throw new Error('rsi_dormant_review_' + label + '_' + field + '_invalid');
    }
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error('rsi_dormant_review_' + label + '_retry_invalid');
  }
}

function assertAdmissionAttemptZero(value) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) {
      throw new Error('rsi_dormant_review_admission_attempt_' + field + '_invalid');
    }
  }
  for (const optionalField of [
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'signing_authority',
    'direct_tool_execution_authority',
  ]) {
    if (value?.[optionalField] != null && value[optionalField] !== false) {
      throw new Error('rsi_dormant_review_admission_attempt_' + optionalField + '_invalid');
    }
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error('rsi_dormant_review_admission_attempt_retry_invalid');
  }
}

function verifyAdmissionReadback({ admission_attempt, successor_library, current_governance } = {}) {
  if (
    !admission_attempt
    || admission_attempt.schema !== 'metaengine.rsi.runtime-skill-library-admission-attempt.v1'
    || admission_attempt.version !== 1
  ) {
    throw new Error('rsi_dormant_review_admission_attempt_invalid');
  }
  assertAdmissionAttemptZero(admission_attempt);
  exactSha(admission_attempt.source_sha, 'source');
  exactDigest(admission_attempt.attempt_digest, 'attempt');
  exactDigest(admission_attempt.successor_library_digest, 'successor_library');
  exactDigest(admission_attempt.proposed_skill_digest, 'proposed_skill');
  exactDigest(admission_attempt.proposed_skill_evidence_digest, 'proposed_skill_evidence');
  exactDigest(admission_attempt.effect_executor_identity_digest, 'effect_executor');
  const certificate = admission_attempt.admission_certificate;
  if (!certificate || typeof certificate !== 'object') {
    throw new Error('rsi_dormant_review_admission_certificate_missing');
  }
  const consumerTaskSetDigest = exactDigest(certificate.consumer_task_set_digest, 'consumer_task_set');
  const retrievalProfileDigest = exactDigest(certificate.consumer_retrieval_profile_digest, 'consumer_retrieval_profile');
  const consumerPlaneDigest = exactDigest(certificate.current_consumer_plane_digest, 'current_consumer_plane');
  const consumerEvaluationContractDigest = exactDigest(certificate.consumer_evaluation_contract_digest, 'consumer_evaluation_contract');
  if (
    certificate.proposed_skill_digest !== admission_attempt.proposed_skill_digest
    || certificate.proposed_skill_evidence_digest !== admission_attempt.proposed_skill_evidence_digest
    || certificate.proposed_successor_library_digest !== admission_attempt.successor_library_digest
  ) {
    throw new Error('rsi_dormant_review_admission_certificate_binding_mismatch');
  }

  if (
    admission_attempt.current_state !== 'CONFIRMED_APPLIED_STORAGE_ONLY'
    || admission_attempt.effect_attempt_limit !== 1
    || admission_attempt.effect_attempt_count !== 1
    || admission_attempt.blind_retry_forbidden !== true
    || admission_attempt.ambiguous_outcome_requires_readback_only_reconciliation !== true
    || admission_attempt.storage_append_does_not_activate_skill !== true
    || admission_attempt.storage_append_does_not_reconcile_pending_evidence !== true
  ) {
    throw new Error('rsi_dormant_review_admission_attempt_not_confirmed_storage_only');
  }
  if (!Array.isArray(admission_attempt.transitions)
    || !admission_attempt.transitions.some((row) => row?.state === 'ATTEMPTED')
    || admission_attempt.transitions.at(-1)?.state !== 'CONFIRMED_APPLIED_STORAGE_ONLY') {
    throw new Error('rsi_dormant_review_admission_attempt_transition_invalid');
  }

  const library = verifyRsiVerifiedSkillLibrary(successor_library);
  if (library.library_digest !== admission_attempt.successor_library_digest) {
    throw new Error('rsi_dormant_review_successor_library_mismatch');
  }
  const governance = verifyRsiSkillLibraryGovernance(current_governance, library);
  if (governance.library_digest !== library.library_digest) {
    throw new Error('rsi_dormant_review_governance_library_mismatch');
  }

  const skill = governance.entries.find((row) => row.skill_digest === admission_attempt.proposed_skill_digest);
  if (!skill) throw new Error('rsi_dormant_review_appended_skill_missing');
  if (
    skill.state !== 'DORMANT_CAP'
    || skill.active_for_composition !== false
    || skill.admission_exposure_hold !== true
    || !Array.isArray(governance.admission_exposure_hold_skill_digests)
    || !governance.admission_exposure_hold_skill_digests.includes(skill.skill_digest)
  ) {
    throw new Error('rsi_dormant_review_exposure_hold_required');
  }

  return Object.freeze({
    admission_attempt,
    library,
    governance,
    skill,
    consumer_task_set_digest: consumerTaskSetDigest,
    consumer_retrieval_profile_digest: retrievalProfileDigest,
    current_consumer_plane_digest: consumerPlaneDigest,
    consumer_evaluation_contract_digest: consumerEvaluationContractDigest,
  });
}

function classify({
  evidence_blockers,
  task_non_regression,
  safety_non_regression,
  security_non_regression,
  process_non_regression,
  outcome_non_regression,
  efficiency_non_regression,
  strict_post_append_improvement,
  coalition_ablation_pass,
  marginal_contribution_pass,
  active_cap_pass,
  capacity_available,
} = {}) {
  if (evidence_blockers.length > 0) return 'KEEP_DORMANT_INVALID_EVIDENCE';
  if (
    task_non_regression !== true
    || safety_non_regression !== true
    || security_non_regression !== true
    || process_non_regression !== true
    || outcome_non_regression !== true
    || efficiency_non_regression !== true
  ) return 'KEEP_DORMANT_NEGATIVE_TRANSFER';
  if (strict_post_append_improvement !== true) return 'KEEP_DORMANT_NO_CLEAR_BENEFIT';
  if (coalition_ablation_pass !== true) return 'KEEP_DORMANT_COALITION_RISK';
  if (marginal_contribution_pass !== true) return 'KEEP_DORMANT_NO_MARGINAL_GAIN';
  if (active_cap_pass !== true || capacity_available !== true) return 'KEEP_DORMANT_ACTIVE_CAP';
  return 'ELIGIBLE_FOR_EXTERNAL_RETRIEVAL_EXPOSURE_ACTIVATION_REVIEW';
}

export function createRsiDormantSkillRetrievalReview({
  review_id,
  admission_attempt,
  successor_library,
  current_governance,
  post_append_evaluation_epoch_digest,
  post_append_holdout_digest,
  post_append_evaluator_root_digest,
  matched_control_receipt_digest,
  treatment_receipt_digest,
  post_append_evidence_digest,
  coalition_ablation_receipt_digest,
  marginal_contribution_receipt_digest,
  active_cap_policy_digest,
  retrieval_reviewer_identity_digest,
  consumer_evaluator_identity_digest,
  contamination_auditor_identity_digest,
  coalition_auditor_identity_digest,
  capacity_policy_owner_identity_digest,
  same_instances_pass = false,
  same_harness_pass = false,
  same_budget_pass = false,
  evaluator_integrity_pass = false,
  consumer_state_integrity_pass = false,
  retrieval_profile_integrity_pass = false,
  hidden_holdout_pass = false,
  contamination_clear = false,
  from_scratch_replay_pass = false,
  task_non_regression = false,
  safety_non_regression = false,
  security_non_regression = false,
  process_non_regression = false,
  outcome_non_regression = false,
  efficiency_non_regression = false,
  strict_post_append_improvement = false,
  coalition_ablation_pass = false,
  marginal_contribution_pass = false,
  active_cap_pass = false,
  external_runtime_readback = false,
  external_retrieval_reviewer = false,
  external_consumer_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  if (
    external_runtime_readback !== true
    || external_retrieval_reviewer !== true
    || external_consumer_evaluator !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_dormant_review_external_owners_required');
  }

  const storage = verifyAdmissionReadback({ admission_attempt, successor_library, current_governance });
  const evidenceRoots = [
    exactDigest(post_append_evaluation_epoch_digest, 'post_append_epoch'),
    exactDigest(post_append_holdout_digest, 'post_append_holdout'),
    exactDigest(post_append_evaluator_root_digest, 'post_append_evaluator'),
    exactDigest(matched_control_receipt_digest, 'matched_control_receipt'),
    exactDigest(treatment_receipt_digest, 'treatment_receipt'),
    exactDigest(post_append_evidence_digest, 'post_append_evidence'),
    exactDigest(coalition_ablation_receipt_digest, 'coalition_ablation_receipt'),
    exactDigest(marginal_contribution_receipt_digest, 'marginal_contribution_receipt'),
    exactDigest(active_cap_policy_digest, 'active_cap_policy'),
  ];
  const reviewerIdentities = [
    exactDigest(retrieval_reviewer_identity_digest, 'retrieval_reviewer_identity'),
    exactDigest(consumer_evaluator_identity_digest, 'consumer_evaluator_identity'),
    exactDigest(contamination_auditor_identity_digest, 'contamination_auditor_identity'),
    exactDigest(coalition_auditor_identity_digest, 'coalition_auditor_identity'),
    exactDigest(capacity_policy_owner_identity_digest, 'capacity_policy_owner_identity'),
  ];
  if (new Set(evidenceRoots).size !== evidenceRoots.length) {
    throw new Error('rsi_dormant_review_independent_evidence_roots_required');
  }
  if (new Set(reviewerIdentities).size !== reviewerIdentities.length
    || reviewerIdentities.includes(storage.admission_attempt.effect_executor_identity_digest)) {
    throw new Error('rsi_dormant_review_separation_of_duties_invalid');
  }

  const evidenceBlockers = [];
  if (same_instances_pass !== true) evidenceBlockers.push('INSTANCE_MISMATCH');
  if (same_harness_pass !== true) evidenceBlockers.push('HARNESS_MISMATCH');
  if (same_budget_pass !== true) evidenceBlockers.push('BUDGET_MISMATCH');
  if (evaluator_integrity_pass !== true) evidenceBlockers.push('EVALUATOR_INTEGRITY_FAILURE');
  if (consumer_state_integrity_pass !== true) evidenceBlockers.push('CONSUMER_STATE_DRIFT');
  if (retrieval_profile_integrity_pass !== true) evidenceBlockers.push('RETRIEVAL_PROFILE_DRIFT');
  if (hidden_holdout_pass !== true) evidenceBlockers.push('HIDDEN_HOLDOUT_FAILURE');
  if (contamination_clear !== true) evidenceBlockers.push('CONTAMINATION_DETECTED');
  if (from_scratch_replay_pass !== true) evidenceBlockers.push('FROM_SCRATCH_REPLAY_FAILURE');

  const explorationActiveCount = storage.governance.entries.filter((row) => row.state === 'EXPLORATION_ACTIVE').length;
  const activeCapCapacityAvailable = storage.governance.active_count < storage.governance.config.max_active_skills;
  const explorationSlotCapacityAvailable = explorationActiveCount < storage.governance.config.exploration_slots;
  const capacityAvailable = activeCapCapacityAvailable && explorationSlotCapacityAvailable;
  const state = classify({
    evidence_blockers: evidenceBlockers,
    task_non_regression,
    safety_non_regression,
    security_non_regression,
    process_non_regression,
    outcome_non_regression,
    efficiency_non_regression,
    strict_post_append_improvement,
    coalition_ablation_pass,
    marginal_contribution_pass,
    active_cap_pass,
    capacity_available: capacityAvailable,
  });

  const core = zero({
    schema: RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA,
    version: 1,
    review_id: boundedId(review_id, 'review_id'),
    source_sha: exactSha(storage.admission_attempt.source_sha, 'source'),
    admission_attempt_id: boundedId(storage.admission_attempt.attempt_id, 'attempt_id'),
    admission_attempt_digest: storage.admission_attempt.attempt_digest,
    library_digest: storage.library.library_digest,
    governance_digest: storage.governance.governance_digest,
    skill_digest: storage.skill.skill_digest,
    skill_evidence_digest: storage.admission_attempt.proposed_skill_evidence_digest,
    consumer_task_set_digest: storage.consumer_task_set_digest,
    consumer_retrieval_profile_digest: storage.consumer_retrieval_profile_digest,
    current_consumer_plane_digest: storage.current_consumer_plane_digest,
    consumer_evaluation_contract_digest: storage.consumer_evaluation_contract_digest,
    post_append_evaluation_epoch_digest: evidenceRoots[0],
    post_append_holdout_digest: evidenceRoots[1],
    post_append_evaluator_root_digest: evidenceRoots[2],
    matched_control_receipt_digest: evidenceRoots[3],
    treatment_receipt_digest: evidenceRoots[4],
    post_append_evidence_digest: evidenceRoots[5],
    coalition_ablation_receipt_digest: evidenceRoots[6],
    marginal_contribution_receipt_digest: evidenceRoots[7],
    active_cap_policy_digest: evidenceRoots[8],
    retrieval_reviewer_identity_digest: reviewerIdentities[0],
    consumer_evaluator_identity_digest: reviewerIdentities[1],
    contamination_auditor_identity_digest: reviewerIdentities[2],
    coalition_auditor_identity_digest: reviewerIdentities[3],
    capacity_policy_owner_identity_digest: reviewerIdentities[4],
    same_instances_pass: same_instances_pass === true,
    same_harness_pass: same_harness_pass === true,
    same_budget_pass: same_budget_pass === true,
    evaluator_integrity_pass: evaluator_integrity_pass === true,
    consumer_state_integrity_pass: consumer_state_integrity_pass === true,
    retrieval_profile_integrity_pass: retrieval_profile_integrity_pass === true,
    hidden_holdout_pass: hidden_holdout_pass === true,
    contamination_clear: contamination_clear === true,
    from_scratch_replay_pass: from_scratch_replay_pass === true,
    task_non_regression: task_non_regression === true,
    safety_non_regression: safety_non_regression === true,
    security_non_regression: security_non_regression === true,
    process_non_regression: process_non_regression === true,
    outcome_non_regression: outcome_non_regression === true,
    efficiency_non_regression: efficiency_non_regression === true,
    strict_post_append_improvement: strict_post_append_improvement === true,
    coalition_ablation_pass: coalition_ablation_pass === true,
    marginal_contribution_pass: marginal_contribution_pass === true,
    active_cap_pass: active_cap_pass === true,
    active_cap_capacity_available: activeCapCapacityAvailable,
    exploration_active_count: explorationActiveCount,
    exploration_slot_limit: storage.governance.config.exploration_slots,
    exploration_slot_capacity_available: explorationSlotCapacityAvailable,
    bounded_exploration_capacity_available: capacityAvailable,
    evidence_blockers: Object.freeze(evidenceBlockers.sort()),
    state,
    appended_skill_initial_governance_state: 'DORMANT_CAP',
    admission_exposure_hold_verified: true,
    fresh_post_append_paired_evidence_required: true,
    matched_no_skill_or_reference_required: true,
    hidden_holdout_required: true,
    from_scratch_replay_required: true,
    coalition_aware_ablation_required: true,
    marginal_contribution_required: true,
    exact_current_governance_required: true,
    separation_of_duties_required: true,
    review_is_eligibility_evidence_only: true,
    retrieval_exposure_token: null,
    retrieval_exposure_changed: false,
    skill_activation_performed: false,
    lifecycle_mutation_performed: false,
    governance_mutation_performed: false,
    review_can_schedule_work: false,
  });
  return Object.freeze({ ...core, retrieval_review_digest: digest(core) });
}

export function verifyRsiDormantSkillRetrievalReview(review, args = {}) {
  if (
    !review
    || review.schema !== RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA
    || review.version !== 1
  ) {
    throw new Error('rsi_dormant_review_invalid');
  }
  assertZero(review, 'review');
  if (
    review.appended_skill_initial_governance_state !== 'DORMANT_CAP'
    || review.admission_exposure_hold_verified !== true
    || review.fresh_post_append_paired_evidence_required !== true
    || review.matched_no_skill_or_reference_required !== true
    || review.hidden_holdout_required !== true
    || review.from_scratch_replay_required !== true
    || review.coalition_aware_ablation_required !== true
    || review.marginal_contribution_required !== true
    || review.exact_current_governance_required !== true
    || review.separation_of_duties_required !== true
    || review.review_is_eligibility_evidence_only !== true
    || review.retrieval_exposure_token !== null
    || review.retrieval_exposure_changed !== false
    || review.skill_activation_performed !== false
    || review.lifecycle_mutation_performed !== false
    || review.governance_mutation_performed !== false
    || review.review_can_schedule_work !== false
  ) {
    throw new Error('rsi_dormant_review_policy_invalid');
  }
  const canonical = createRsiDormantSkillRetrievalReview({
    ...args,
    review_id: review.review_id,
    post_append_evaluation_epoch_digest: review.post_append_evaluation_epoch_digest,
    post_append_holdout_digest: review.post_append_holdout_digest,
    post_append_evaluator_root_digest: review.post_append_evaluator_root_digest,
    matched_control_receipt_digest: review.matched_control_receipt_digest,
    treatment_receipt_digest: review.treatment_receipt_digest,
    post_append_evidence_digest: review.post_append_evidence_digest,
    coalition_ablation_receipt_digest: review.coalition_ablation_receipt_digest,
    marginal_contribution_receipt_digest: review.marginal_contribution_receipt_digest,
    active_cap_policy_digest: review.active_cap_policy_digest,
    retrieval_reviewer_identity_digest: review.retrieval_reviewer_identity_digest,
    consumer_evaluator_identity_digest: review.consumer_evaluator_identity_digest,
    contamination_auditor_identity_digest: review.contamination_auditor_identity_digest,
    coalition_auditor_identity_digest: review.coalition_auditor_identity_digest,
    capacity_policy_owner_identity_digest: review.capacity_policy_owner_identity_digest,
    same_instances_pass: review.same_instances_pass,
    same_harness_pass: review.same_harness_pass,
    same_budget_pass: review.same_budget_pass,
    evaluator_integrity_pass: review.evaluator_integrity_pass,
    consumer_state_integrity_pass: review.consumer_state_integrity_pass,
    retrieval_profile_integrity_pass: review.retrieval_profile_integrity_pass,
    hidden_holdout_pass: review.hidden_holdout_pass,
    contamination_clear: review.contamination_clear,
    from_scratch_replay_pass: review.from_scratch_replay_pass,
    task_non_regression: review.task_non_regression,
    safety_non_regression: review.safety_non_regression,
    security_non_regression: review.security_non_regression,
    process_non_regression: review.process_non_regression,
    outcome_non_regression: review.outcome_non_regression,
    efficiency_non_regression: review.efficiency_non_regression,
    strict_post_append_improvement: review.strict_post_append_improvement,
    coalition_ablation_pass: review.coalition_ablation_pass,
    marginal_contribution_pass: review.marginal_contribution_pass,
    active_cap_pass: review.active_cap_pass,
    external_runtime_readback: true,
    external_retrieval_reviewer: true,
    external_consumer_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.retrieval_review_digest !== exactDigest(review.retrieval_review_digest, 'review')) {
    throw new Error('rsi_dormant_review_digest_mismatch');
  }
  return canonical;
}

export function rsiDormantSkillRetrievalReviewTrustRootSnapshot() {
  return Object.freeze({
    schema: 'metaengine.rsi.dormant-skill-retrieval-review-trust-root.v1',
    policy_path: 'apps/metaengine-browser/src/rsi-dormant-skill-retrieval-review.mjs',
    exact_confirmed_storage_attempt_required: true,
    admission_exposure_hold_required: true,
    fresh_post_append_evidence_required: true,
    paired_control_treatment_required: true,
    same_instances_harness_budget_required: true,
    hidden_holdout_required: true,
    evaluator_integrity_required: true,
    contamination_clear_required: true,
    from_scratch_replay_required: true,
    consumer_state_and_retrieval_profile_integrity_required: true,
    task_safety_security_process_outcome_efficiency_non_regression_required: true,
    strict_post_append_improvement_required: true,
    coalition_ablation_required: true,
    marginal_contribution_required: true,
    active_cap_required: true,
    exploration_slot_capacity_required: true,
    separation_of_duties_required: true,
    review_is_eligibility_evidence_only: true,
    storage_does_not_imply_exposure: true,
    retrieval_exposure_change_authorized: false,
    skill_activation_authorized: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
