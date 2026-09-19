import crypto from 'node:crypto';

import { verifyRsiDormantSkillRetrievalReview } from './rsi-dormant-skill-retrieval-review.mjs';
import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';

export const RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA =
  'metaengine.rsi.skill-exposure-release-preview.v1';
export const RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA =
  'metaengine.rsi.skill-exposure-release-certificate.v2';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const RELEASE_MODE = 'EXPLORATION_ACTIVE_ONLY';

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
  if (!SHA256_RE.test(out)) throw new Error('rsi_exposure_release_' + label + '_digest_invalid');
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error('rsi_exposure_release_' + label + '_invalid');
  return out;
}

function positiveInt(value, label, max = 1_000_000) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) {
    throw new Error('rsi_exposure_release_' + label + '_invalid');
  }
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
      throw new Error('rsi_exposure_release_' + label + '_' + field + '_invalid');
    }
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error('rsi_exposure_release_' + label + '_retry_invalid');
  }
}

function verifyPreview(preview, { library, current_governance, skill_digest } = {}) {
  if (
    !preview
    || preview.schema !== RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA
    || preview.version !== 1
  ) {
    throw new Error('rsi_exposure_release_preview_invalid');
  }
  assertZero(preview, 'preview');
  const checkedLibrary = verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance = verifyRsiSkillLibraryGovernance(current_governance, checkedLibrary);
  const skillDigest = exactDigest(skill_digest, 'skill');

  if (
    preview.library_digest !== checkedLibrary.library_digest
    || preview.current_governance_digest !== checkedGovernance.governance_digest
    || preview.skill_digest !== skillDigest
  ) {
    throw new Error('rsi_exposure_release_preview_binding_mismatch');
  }
  if (
    preview.current_state !== 'DORMANT_CAP'
    || preview.current_active_for_composition !== false
    || preview.current_admission_exposure_hold !== true
  ) {
    throw new Error('rsi_exposure_release_preview_current_hold_invalid');
  }
  if (
    preview.next_state !== 'EXPLORATION_ACTIVE'
    || preview.next_active_for_composition !== true
    || preview.next_admission_exposure_hold !== false
  ) {
    throw new Error('rsi_exposure_release_preview_exploration_only_required');
  }
  if (
    preview.only_target_state_changed !== true
    || preview.active_count_delta !== 1
    || preview.hold_count_delta !== -1
    || preview.exploration_active_count_delta !== 1
    || preview.next_exploration_active_count > preview.exploration_slot_limit
  ) {
    throw new Error('rsi_exposure_release_preview_bounded_transition_invalid');
  }
  exactDigest(preview.next_governance_digest, 'next_governance');
  const clone = structuredClone(preview);
  delete clone.preview_digest;
  if (digest(clone) !== exactDigest(preview.preview_digest, 'preview')) {
    throw new Error('rsi_exposure_release_preview_digest_mismatch');
  }
  return preview;
}

function reviewIdentityDigests(review) {
  return [
    review.retrieval_reviewer_identity_digest,
    review.consumer_evaluator_identity_digest,
    review.contamination_auditor_identity_digest,
    review.coalition_auditor_identity_digest,
    review.capacity_policy_owner_identity_digest,
  ].map((value, index) => exactDigest(value, 'r7_reviewer_' + index));
}

export function createRsiSkillExposureReleaseCertificate({
  certificate_id,
  retrieval_review,
  admission_attempt,
  successor_library,
  current_governance,
  release_preview,
  routing_context_manifest_digest,
  shadow_routing_manifest_digest,
  no_skill_ablation_receipt_digest,
  coalition_ablation_receipt_digest,
  memory_poisoning_scan_digest,
  source_grounding_receipt_digest,
  bounded_canary_policy_digest,
  bounded_canary_result_digest,
  negative_transfer_memory_digest,
  shadow_context_count,
  shadow_success_count,
  shadow_hard_invariants_pass = false,
  no_skill_ablation_pass = false,
  coalition_ablation_pass = false,
  negative_transfer_clear = false,
  memory_poisoning_scan_pass = false,
  source_grounding_pass = false,
  bounded_canary_pass = false,
  canary_effect_mode,
  external_governance_owner_identity_digest,
  external_shadow_evaluator_identity_digest,
  external_security_reviewer_identity_digest,
  external_canary_evaluator_identity_digest,
  external_governance_owner = false,
  external_shadow_evaluator = false,
  external_security_reviewer = false,
  external_canary_evaluator = false,
  authored_by_candidate = true,
} = {}) {
  const library = verifyRsiVerifiedSkillLibrary(successor_library);
  const governance = verifyRsiSkillLibraryGovernance(current_governance, library);
  const review = verifyRsiDormantSkillRetrievalReview(retrieval_review, {
    admission_attempt,
    successor_library: library,
    current_governance: governance,
  });
  if (
    review.state !== 'ELIGIBLE_FOR_EXTERNAL_RETRIEVAL_EXPOSURE_ACTIVATION_REVIEW'
    || review.review_is_eligibility_evidence_only !== true
    || review.retrieval_exposure_changed !== false
    || review.skill_activation_performed !== false
    || review.bounded_exploration_capacity_available !== true
  ) {
    throw new Error('rsi_exposure_release_r7_review_not_eligible');
  }

  const preview = verifyPreview(release_preview, {
    library,
    current_governance: governance,
    skill_digest: review.skill_digest,
  });
  if (
    preview.library_digest !== review.library_digest
    || preview.current_governance_digest !== review.governance_digest
    || preview.skill_digest !== review.skill_digest
  ) {
    throw new Error('rsi_exposure_release_r7_review_preview_mismatch');
  }

  if (
    external_governance_owner !== true
    || external_shadow_evaluator !== true
    || external_security_reviewer !== true
    || external_canary_evaluator !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_exposure_release_external_ownership_required');
  }

  const releaseIdentities = [
    exactDigest(external_governance_owner_identity_digest, 'governance_owner_identity'),
    exactDigest(external_shadow_evaluator_identity_digest, 'shadow_evaluator_identity'),
    exactDigest(external_security_reviewer_identity_digest, 'security_reviewer_identity'),
    exactDigest(external_canary_evaluator_identity_digest, 'canary_evaluator_identity'),
  ];
  const priorIdentities = [
    ...reviewIdentityDigests(review),
    exactDigest(admission_attempt.effect_executor_identity_digest, 'storage_effect_executor_identity'),
  ];
  if (
    new Set(releaseIdentities).size !== releaseIdentities.length
    || releaseIdentities.some((identity) => priorIdentities.includes(identity))
  ) {
    throw new Error('rsi_exposure_release_cross_stage_separation_of_duties_required');
  }

  const evidenceRoots = [
    exactDigest(routing_context_manifest_digest, 'routing_context_manifest'),
    exactDigest(shadow_routing_manifest_digest, 'shadow_routing_manifest'),
    exactDigest(no_skill_ablation_receipt_digest, 'no_skill_ablation'),
    exactDigest(coalition_ablation_receipt_digest, 'coalition_ablation'),
    exactDigest(memory_poisoning_scan_digest, 'memory_poisoning_scan'),
    exactDigest(source_grounding_receipt_digest, 'source_grounding'),
    exactDigest(bounded_canary_policy_digest, 'bounded_canary_policy'),
    exactDigest(bounded_canary_result_digest, 'bounded_canary_result'),
    exactDigest(negative_transfer_memory_digest, 'negative_transfer_memory'),
  ];
  if (new Set(evidenceRoots).size !== evidenceRoots.length) {
    throw new Error('rsi_exposure_release_independent_evidence_roots_required');
  }

  const contextCount = positiveInt(shadow_context_count, 'shadow_context_count', 10_000);
  const successCount = positiveInt(shadow_success_count, 'shadow_success_count', contextCount);
  const blockers = [];
  if (contextCount < 3) blockers.push('INSUFFICIENT_SHADOW_CONTEXTS');
  if (successCount !== contextCount) blockers.push('SHADOW_CONTEXT_FAILURE');
  if (shadow_hard_invariants_pass !== true) blockers.push('SHADOW_HARD_INVARIANT_FAILURE');
  if (no_skill_ablation_pass !== true) blockers.push('NO_SKILL_ABLATION_FAILURE');
  if (coalition_ablation_pass !== true) blockers.push('COALITION_ABLATION_FAILURE');
  if (negative_transfer_clear !== true) blockers.push('NEGATIVE_TRANSFER_PRESENT');
  if (memory_poisoning_scan_pass !== true) blockers.push('MEMORY_POISONING_RISK');
  if (source_grounding_pass !== true) blockers.push('SOURCE_GROUNDING_FAILURE');
  if (bounded_canary_pass !== true) blockers.push('BOUNDED_CANARY_FAILURE');
  if (String(canary_effect_mode || '').trim().toUpperCase() !== 'READ_ONLY_SHADOW') {
    blockers.push('CANARY_NOT_READ_ONLY_SHADOW');
  }

  const eligible = blockers.length === 0;
  const core = zero({
    schema: RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA,
    version: 2,
    certificate_id: boundedId(certificate_id, 'certificate_id'),
    source_sha: review.source_sha,
    library_id: library.library_id,
    library_digest: library.library_digest,
    current_governance_digest: governance.governance_digest,
    next_governance_digest: preview.next_governance_digest,
    release_preview_digest: preview.preview_digest,
    skill_digest: review.skill_digest,
    skill_evidence_digest: review.skill_evidence_digest,
    r7_retrieval_review_id: review.review_id,
    r7_retrieval_review_digest: review.retrieval_review_digest,
    r7_admission_attempt_id: review.admission_attempt_id,
    r7_admission_attempt_digest: review.admission_attempt_digest,
    consumer_task_set_digest: review.consumer_task_set_digest,
    consumer_retrieval_profile_digest: review.consumer_retrieval_profile_digest,
    current_consumer_plane_digest: review.current_consumer_plane_digest,
    consumer_evaluation_contract_digest: review.consumer_evaluation_contract_digest,
    release_mode: RELEASE_MODE,
    routing_context_manifest_digest: evidenceRoots[0],
    shadow_routing_manifest_digest: evidenceRoots[1],
    no_skill_ablation_receipt_digest: evidenceRoots[2],
    coalition_ablation_receipt_digest: evidenceRoots[3],
    memory_poisoning_scan_digest: evidenceRoots[4],
    source_grounding_receipt_digest: evidenceRoots[5],
    bounded_canary_policy_digest: evidenceRoots[6],
    bounded_canary_result_digest: evidenceRoots[7],
    negative_transfer_memory_digest: evidenceRoots[8],
    shadow_context_count: contextCount,
    shadow_success_count: successCount,
    shadow_hard_invariants_pass: shadow_hard_invariants_pass === true,
    no_skill_ablation_pass: no_skill_ablation_pass === true,
    coalition_ablation_pass: coalition_ablation_pass === true,
    negative_transfer_clear: negative_transfer_clear === true,
    memory_poisoning_scan_pass: memory_poisoning_scan_pass === true,
    source_grounding_pass: source_grounding_pass === true,
    bounded_canary_pass: bounded_canary_pass === true,
    canary_effect_mode: 'READ_ONLY_SHADOW',
    blockers: Object.freeze(blockers.sort()),
    state: eligible ? 'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE' : 'REJECTED_EXPOSURE_RELEASE',
    eligible_for_one_attempt_exposure_release: eligible,
    external_governance_owner_identity_digest: releaseIdentities[0],
    external_shadow_evaluator_identity_digest: releaseIdentities[1],
    external_security_reviewer_identity_digest: releaseIdentities[2],
    external_canary_evaluator_identity_digest: releaseIdentities[3],
    external_governance_owner: true,
    external_shadow_evaluator: true,
    external_security_reviewer: true,
    external_canary_evaluator: true,
    authored_by_candidate: false,
    recent_durable_r7_review_required: true,
    r7_review_does_not_authorize_release_effect: true,
    held_skill_required: true,
    current_state_must_be_dormant: true,
    next_state_must_be_exploration_active: true,
    only_target_governance_state_may_change: true,
    automatic_full_activation_allowed: false,
    release_does_not_grant_browser_authority: true,
    release_does_not_grant_tool_authority: true,
    one_attempt_release_required: true,
    post_attempt_pre_effect_readback_required: true,
    ambiguous_release_retry_allowed: false,
    release_token: null,
  });
  return Object.freeze({ ...core, certificate_digest: digest(core) });
}

export function verifyRsiSkillExposureReleaseCertificate(certificate, args = {}) {
  if (
    !certificate
    || certificate.schema !== RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA
    || certificate.version !== 2
  ) {
    throw new Error('rsi_exposure_release_certificate_invalid');
  }
  assertZero(certificate, 'certificate');
  if (
    certificate.release_mode !== RELEASE_MODE
    || certificate.recent_durable_r7_review_required !== true
    || certificate.r7_review_does_not_authorize_release_effect !== true
    || certificate.held_skill_required !== true
    || certificate.current_state_must_be_dormant !== true
    || certificate.next_state_must_be_exploration_active !== true
    || certificate.only_target_governance_state_may_change !== true
    || certificate.automatic_full_activation_allowed !== false
    || certificate.release_does_not_grant_browser_authority !== true
    || certificate.release_does_not_grant_tool_authority !== true
    || certificate.one_attempt_release_required !== true
    || certificate.post_attempt_pre_effect_readback_required !== true
    || certificate.ambiguous_release_retry_allowed !== false
    || certificate.release_token !== null
    || certificate.external_governance_owner !== true
    || certificate.external_shadow_evaluator !== true
    || certificate.external_security_reviewer !== true
    || certificate.external_canary_evaluator !== true
    || certificate.authored_by_candidate !== false
  ) {
    throw new Error('rsi_exposure_release_certificate_policy_invalid');
  }
  const canonical = createRsiSkillExposureReleaseCertificate({
    ...args,
    certificate_id: certificate.certificate_id,
    routing_context_manifest_digest: certificate.routing_context_manifest_digest,
    shadow_routing_manifest_digest: certificate.shadow_routing_manifest_digest,
    no_skill_ablation_receipt_digest: certificate.no_skill_ablation_receipt_digest,
    coalition_ablation_receipt_digest: certificate.coalition_ablation_receipt_digest,
    memory_poisoning_scan_digest: certificate.memory_poisoning_scan_digest,
    source_grounding_receipt_digest: certificate.source_grounding_receipt_digest,
    bounded_canary_policy_digest: certificate.bounded_canary_policy_digest,
    bounded_canary_result_digest: certificate.bounded_canary_result_digest,
    negative_transfer_memory_digest: certificate.negative_transfer_memory_digest,
    shadow_context_count: certificate.shadow_context_count,
    shadow_success_count: certificate.shadow_success_count,
    shadow_hard_invariants_pass: certificate.shadow_hard_invariants_pass,
    no_skill_ablation_pass: certificate.no_skill_ablation_pass,
    coalition_ablation_pass: certificate.coalition_ablation_pass,
    negative_transfer_clear: certificate.negative_transfer_clear,
    memory_poisoning_scan_pass: certificate.memory_poisoning_scan_pass,
    source_grounding_pass: certificate.source_grounding_pass,
    bounded_canary_pass: certificate.bounded_canary_pass,
    canary_effect_mode: certificate.canary_effect_mode,
    external_governance_owner_identity_digest: certificate.external_governance_owner_identity_digest,
    external_shadow_evaluator_identity_digest: certificate.external_shadow_evaluator_identity_digest,
    external_security_reviewer_identity_digest: certificate.external_security_reviewer_identity_digest,
    external_canary_evaluator_identity_digest: certificate.external_canary_evaluator_identity_digest,
    external_governance_owner: true,
    external_shadow_evaluator: true,
    external_security_reviewer: true,
    external_canary_evaluator: true,
    authored_by_candidate: false,
  });
  if (canonical.certificate_digest !== exactDigest(certificate.certificate_digest, 'certificate')) {
    throw new Error('rsi_exposure_release_certificate_digest_mismatch');
  }
  return canonical;
}

export function rsiSkillExposureReleaseTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.skill-exposure-release-root.v2',
    version: 2,
    policy_path: 'apps/metaengine-browser/src/rsi-skill-exposure-release.mjs',
    exact_r7_retrieval_review_required: true,
    recent_durable_r7_review_event_required: true,
    exact_current_library_required: true,
    exact_current_governance_required: true,
    exact_consumer_context_required: true,
    exact_next_governance_preview_required: true,
    held_dormant_skill_required: true,
    exploration_only_release: true,
    only_target_governance_state_may_change: true,
    minimum_shadow_context_count: 3,
    all_shadow_contexts_must_pass: true,
    shadow_hard_invariants_required: true,
    no_skill_ablation_required: true,
    coalition_ablation_required: true,
    negative_transfer_clear_required: true,
    memory_poisoning_scan_required: true,
    source_grounding_required: true,
    read_only_shadow_canary_required: true,
    cross_stage_separation_of_duties_required: true,
    automatic_full_activation_allowed: false,
    one_attempt_release_required: true,
    post_attempt_pre_effect_readback_required: true,
    ambiguous_release_retry_allowed: false,
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
  };
  return Object.freeze({ ...root, exposure_release_root_digest: digest(root) });
}
