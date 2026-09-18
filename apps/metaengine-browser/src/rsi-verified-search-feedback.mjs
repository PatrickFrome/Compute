
import crypto from 'node:crypto';

import {
  verifyRsiAutonomousEpisodePlan,
} from './rsi-autonomous-episode-controller.mjs';
import {
  verifyRsiEpisodeEvaluationEvidenceBundle,
} from './rsi-episode-evaluation-ingest.mjs';
import {
  createRsiSearchModeOutcome,
  verifyRsiSearchContext,
} from './rsi-search-mode-router.mjs';

export const RSI_VERIFIED_SEARCH_FEEDBACK_SCHEMA = 'metaengine.rsi.verified-search-feedback.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const HANDOFF_SCHEMA = 'metaengine.rsi.isolated-candidate-handoff.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error('rsi_feedback_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error('rsi_feedback_' + label + '_digest_invalid');
  return out.startsWith('sha256:') ? out.slice(7) : out;
}

function candidateId(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error('rsi_feedback_candidate_id_invalid');
  return out;
}

function finitePositive(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out <= 0) throw new Error('rsi_feedback_' + label + '_invalid');
  return out;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'scheduler_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error('rsi_feedback_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_feedback_' + label + '_automatic_retry_invalid');
  }
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function normalizeHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) || handoff.schema !== HANDOFF_SCHEMA || handoff.version !== 1) {
    throw new Error('rsi_feedback_handoff_schema_invalid');
  }
  assertZeroAuthority(handoff, 'handoff');
  if (
    handoff.eligible_for_evaluation !== true
    || handoff.eligible_for_promotion !== false
    || handoff.materialization_replay_authorized !== false
  ) throw new Error('rsi_feedback_handoff_policy_invalid');

  const id = candidateId(handoff.candidate_capsule?.candidate_id);
  const candidateSha = exactSha(handoff.candidate_sha, 'candidate');
  const parentSha = exactSha(handoff.parent_sha, 'parent');
  const targetBranch = String(handoff.target_branch || '').trim();
  if (!/^work\/rsi\/[a-z0-9][a-z0-9._/-]{2,220}$/.test(targetBranch)) {
    throw new Error('rsi_feedback_target_branch_invalid');
  }
  return Object.freeze({
    candidate_id: id,
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    target_branch: targetBranch,
    handoff_digest: exactDigest(handoff.handoff_digest, 'handoff'),
    mutation_surface: String(handoff.mutation_surface || '').trim().toUpperCase(),
  });
}

function evidenceMap(bundle) {
  return new Map(bundle.evidence.map((row) => [String(row.evidence_kind || '').toUpperCase(), row]));
}

export function createRsiVerifiedSearchFeedback({
  controller_plan,
  candidate_handoff,
  evaluation_bundle,
  cost_units,
} = {}) {
  const plan = verifyRsiAutonomousEpisodePlan(controller_plan);
  const bundle = verifyRsiEpisodeEvaluationEvidenceBundle(evaluation_bundle);
  const handoff = normalizeHandoff(candidate_handoff);
  assertZeroAuthority(bundle, 'evaluation_bundle');

  if (handoff.parent_sha !== plan.source_sha) throw new Error('rsi_feedback_parent_source_mismatch');
  if (
    bundle.candidate_id !== handoff.candidate_id
    || exactSha(bundle.candidate_sha, 'bundle_candidate') !== handoff.candidate_sha
    || exactSha(bundle.parent_sha, 'bundle_parent') !== handoff.parent_sha
  ) {
    throw new Error('rsi_feedback_bundle_candidate_mismatch');
  }
  if (
    bundle.episode_id !== plan.episode_id
    || bundle.source_sha !== plan.source_sha
    || exactDigest(bundle.trust_root_set_digest, 'bundle_trust_root') === ''
  ) {
    throw new Error('rsi_feedback_bundle_episode_mismatch');
  }

  const variant = plan.variant_plans.find((row) => row.target_branch === handoff.target_branch);
  if (!variant) throw new Error('rsi_feedback_variant_not_found');
  if (
    exactSha(variant.source_sha, 'variant_source') !== handoff.parent_sha
    || String(variant.task_spec?.rsi?.mutation_surface || '').toUpperCase() !== handoff.mutation_surface
  ) {
    throw new Error('rsi_feedback_variant_handoff_mismatch');
  }

  const context = verifyRsiSearchContext(plan.search_context);
  const rows = evidenceMap(bundle);
  const required = [
    'HARD_INVARIANTS',
    'OBJECTIVES',
    'HOLDOUT',
    'REGRESSION_REPLAY',
    'EVALUATION_INTEGRITY',
    'TOURNAMENT',
  ];
  for (const kind of required) {
    if (!rows.has(kind)) throw new Error('rsi_feedback_required_evidence_missing:' + kind);
  }

  const hardPass = rows.get('HARD_INVARIANTS').result === 'PASS';
  const integrityPass = rows.get('EVALUATION_INTEGRITY').result === 'PASS';
  const holdoutPass = rows.get('HOLDOUT').result === 'PASS';
  const retentionPass = rows.get('REGRESSION_REPLAY').result === 'PASS';
  const objectivePass = rows.get('OBJECTIVES').result === 'PASS';
  const tournamentPass = rows.get('TOURNAMENT').result === 'PASS';

  const candidateValid = hardPass && integrityPass && holdoutPass && retentionPass;
  const netBenefitVerified = candidateValid && objectivePass && tournamentPass;
  const cost = finitePositive(cost_units, 'cost_units');
  const bundleDigest = exactDigest(bundle.bundle_digest, 'bundle');

  const routingOutcome = createRsiSearchModeOutcome({
    outcome_id: 'rsi-feedback-' + digest({
      episode_id: plan.episode_id,
      candidate_id: handoff.candidate_id,
      bundle_digest: bundleDigest,
      variant_digest: variant.search_variant.variant_digest,
    }).slice(0, 24),
    context,
    search_mode: variant.search_variant.search_mode,
    net_benefit_verified: netBenefitVerified,
    hard_invariants_pass: hardPass,
    candidate_valid: candidateValid,
    cost_units: cost,
    evaluation_digest: 'sha256:' + bundleDigest,
    evidence_refs: [
      'bundle:' + bundleDigest,
      'candidate:' + handoff.candidate_id,
      'variant:' + variant.search_variant.variant_digest,
    ],
    external_evaluator: true,
    authored_by_candidate: false,
  });

  const core = zeroAuthority({
    schema: RSI_VERIFIED_SEARCH_FEEDBACK_SCHEMA,
    version: 1,
    episode_id: plan.episode_id,
    source_sha: plan.source_sha,
    candidate_id: handoff.candidate_id,
    candidate_sha: handoff.candidate_sha,
    parent_sha: handoff.parent_sha,
    target_branch: handoff.target_branch,
    variant_id: variant.search_variant.variant_id,
    variant_digest: variant.search_variant.variant_digest,
    search_mode: variant.search_variant.search_mode,
    allocation_role: variant.search_variant.allocation_role,
    search_context_digest: plan.search_context_digest,
    routing_digest: plan.routing_digest,
    evaluation_bundle_digest: bundleDigest,
    candidate_valid: candidateValid,
    net_benefit_verified: netBenefitVerified,
    validity_breakdown: Object.freeze({
      hard_invariants_pass: hardPass,
      evaluation_integrity_pass: integrityPass,
      holdout_pass: holdoutPass,
      regression_replay_pass: retentionPass,
      objectives_pass: objectivePass,
      tournament_pass: tournamentPass,
    }),
    cost_units: cost,
    routing_outcome: routingOutcome,
    feedback_eligible_for_next_cycle: true,
    scalar_reward_authoritative: false,
    candidate_authored_feedback_allowed: false,
    failed_or_ambiguous_validity_cannot_count_as_benefit: true,
    search_feedback_is_scheduler_authority: false,
    search_feedback_is_promotion_authority: false,
  });
  return Object.freeze({ ...core, feedback_digest: digest(core) });
}

export function verifyRsiVerifiedSearchFeedback(feedback) {
  if (!feedback || typeof feedback !== 'object' || Array.isArray(feedback) || feedback.schema !== RSI_VERIFIED_SEARCH_FEEDBACK_SCHEMA || feedback.version !== 1) {
    throw new Error('rsi_feedback_schema_invalid');
  }
  assertZeroAuthority(feedback, 'feedback');
  if (
    feedback.feedback_eligible_for_next_cycle !== true
    || feedback.scalar_reward_authoritative !== false
    || feedback.candidate_authored_feedback_allowed !== false
    || feedback.failed_or_ambiguous_validity_cannot_count_as_benefit !== true
    || feedback.search_feedback_is_scheduler_authority !== false
    || feedback.search_feedback_is_promotion_authority !== false
  ) throw new Error('rsi_feedback_policy_invalid');

  exactSha(feedback.source_sha, 'feedback_source');
  candidateId(feedback.candidate_id);
  exactSha(feedback.candidate_sha, 'feedback_candidate');
  exactSha(feedback.parent_sha, 'feedback_parent');
  exactDigest(feedback.search_context_digest, 'feedback_context');
  exactDigest(feedback.routing_digest, 'feedback_routing');
  exactDigest(feedback.evaluation_bundle_digest, 'feedback_bundle');

  const validity = feedback.validity_breakdown || {};
  const candidateValid =
    validity.hard_invariants_pass === true
    && validity.evaluation_integrity_pass === true
    && validity.holdout_pass === true
    && validity.regression_replay_pass === true;
  const netBenefit =
    candidateValid
    && validity.objectives_pass === true
    && validity.tournament_pass === true;
  if (feedback.candidate_valid !== candidateValid || feedback.net_benefit_verified !== netBenefit) {
    throw new Error('rsi_feedback_validity_derivation_mismatch');
  }

  if (
    feedback.routing_outcome?.context_digest !== 'sha256:' + feedback.search_context_digest
    && feedback.routing_outcome?.context_digest !== feedback.search_context_digest
  ) {
    throw new Error('rsi_feedback_routing_context_mismatch');
  }
  if (
    feedback.routing_outcome?.search_mode !== feedback.search_mode
    || feedback.routing_outcome?.candidate_valid !== feedback.candidate_valid
    || feedback.routing_outcome?.net_benefit_verified !== feedback.net_benefit_verified
  ) {
    throw new Error('rsi_feedback_routing_outcome_mismatch');
  }

  const clone = structuredClone(feedback);
  const claimed = exactDigest(clone.feedback_digest, 'feedback');
  delete clone.feedback_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_feedback_digest_mismatch');
  return feedback;
}

export function rsiVerifiedSearchFeedbackTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.verified-search-feedback-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-verified-search-feedback.mjs',
    candidate_feedback_source: 'INDEPENDENT_EVALUATION_BUNDLE_ONLY',
    validity_requires: [
      'HARD_INVARIANTS',
      'EVALUATION_INTEGRITY',
      'HOLDOUT',
      'REGRESSION_REPLAY',
    ],
    net_benefit_additionally_requires: [
      'OBJECTIVES',
      'TOURNAMENT',
    ],
    contextual_router_reuse: true,
    scalar_reward_authoritative: false,
    candidate_authored_feedback_allowed: false,
    failed_or_ambiguous_validity_cannot_count_as_benefit: true,
    search_feedback_is_scheduler_authority: false,
    search_feedback_is_promotion_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, search_feedback_root_digest: digest(root) });
}
