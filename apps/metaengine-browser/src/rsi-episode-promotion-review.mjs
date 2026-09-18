
import crypto from 'node:crypto';

import {
  evaluateRsiPromotionAdmission,
} from './rsi-promotion-admission-gate.mjs';
import {
  evaluateRsiRiskControlledPromotionReview,
  verifyRsiRiskConfirmation,
} from './rsi-recursive-risk-budget.mjs';
import {
  verifyRsiEpisodeEvaluationEvidenceBundle,
} from './rsi-episode-evaluation-ingest.mjs';

export const RSI_EPISODE_PROMOTION_REVIEW_SCHEMA = 'metaengine.rsi.episode-promotion-review.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^(?:sha256:)?[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^candidate_sha256_[0-9a-f]{64}$/;
const READINESS_SCHEMA = 'metaengine.rsi.episode-nomination-readiness.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error('rsi_episode_promotion_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!DIGEST_RE.test(out)) throw new Error('rsi_episode_promotion_' + label + '_digest_invalid');
  return out.startsWith('sha256:') ? out : 'sha256:' + out;
}

function exactCandidateId(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!CANDIDATE_ID_RE.test(out)) throw new Error('rsi_episode_promotion_candidate_id_invalid');
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
      throw new Error('rsi_episode_promotion_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_episode_promotion_' + label + '_automatic_retry_invalid');
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

function verifyReadiness(readiness) {
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness) || readiness.schema !== READINESS_SCHEMA || readiness.version !== 1) {
    throw new Error('rsi_episode_promotion_readiness_schema_invalid');
  }
  assertZeroAuthority(readiness, 'readiness');
  if (
    readiness.state !== 'NOMINATION_READY'
    || readiness.ready !== true
    || readiness.requires_external_promotion_gate !== true
    || readiness.direct_promotion_enabled !== false
    || readiness.physical_effect_replay_allowed !== false
    || !Array.isArray(readiness.missing_evidence_kinds)
    || readiness.missing_evidence_kinds.length !== 0
    || !Array.isArray(readiness.blocking_evidence_kinds)
    || readiness.blocking_evidence_kinds.length !== 0
  ) throw new Error('rsi_episode_promotion_readiness_not_ready');

  return Object.freeze({
    episode_id: String(readiness.episode_id || ''),
    candidate_id: exactCandidateId(readiness.candidate_id),
    candidate_sha: exactSha(readiness.candidate_sha, 'readiness_candidate'),
    source_sha: exactSha(readiness.source_sha, 'readiness_source'),
    trust_root_set_digest: exactDigest(readiness.trust_root_set_digest, 'readiness_trust_root'),
  });
}

function verifyBundleForReadiness(bundle, readiness) {
  const checked = verifyRsiEpisodeEvaluationEvidenceBundle(bundle);
  assertZeroAuthority(checked, 'evaluation_bundle');
  if (
    checked.episode_id !== readiness.episode_id
    || checked.candidate_id !== readiness.candidate_id
    || exactSha(checked.candidate_sha, 'bundle_candidate') !== readiness.candidate_sha
    || exactSha(checked.source_sha, 'bundle_source') !== readiness.source_sha
    || exactDigest(checked.trust_root_set_digest, 'bundle_trust_root') !== readiness.trust_root_set_digest
  ) throw new Error('rsi_episode_promotion_bundle_readiness_mismatch');

  if (!Array.isArray(checked.evidence) || checked.evidence.length !== 6 || checked.evidence.some((row) => row.result !== 'PASS')) {
    throw new Error('rsi_episode_promotion_bundle_not_all_pass');
  }
  return checked;
}

export function createRsiEpisodePromotionReview({
  episode_readiness,
  evaluation_bundle,
  candidate_handoff,
  tournament_plan,
  tournament_result,
  archive_admission,
  qualification,
  risk_confirmation,
} = {}) {
  const readiness = verifyReadiness(episode_readiness);
  const bundle = verifyBundleForReadiness(evaluation_bundle, readiness);

  const promotionGate = evaluateRsiPromotionAdmission({
    candidate_handoff,
    tournament_plan,
    tournament_result,
    archive_admission,
    qualification,
  });
  if (
    promotionGate.state !== 'READY_FOR_EXTERNAL_PROMOTION_REVIEW'
    || promotionGate.ready_for_external_promotion_review !== true
  ) throw new Error('rsi_episode_promotion_gate_not_ready');
  if (
    promotionGate.candidate_id !== readiness.candidate_id
    || exactSha(promotionGate.candidate_sha, 'gate_candidate') !== readiness.candidate_sha
    || exactSha(promotionGate.parent_sha, 'gate_parent') !== exactSha(candidate_handoff?.parent_sha, 'handoff_parent')
  ) throw new Error('rsi_episode_promotion_gate_identity_mismatch');

  const confirmation = verifyRsiRiskConfirmation(risk_confirmation);
  const riskReview = evaluateRsiRiskControlledPromotionReview({
    promotion_gate_result: promotionGate,
    risk_confirmation: confirmation,
  });

  if (
    riskReview.state !== 'READY_FOR_RISK_CONTROLLED_EXTERNAL_PROMOTION_REVIEW'
    || riskReview.external_promotion_review_required !== true
    || riskReview.direct_promotion_authorized !== false
    || riskReview.direct_install_authorized !== false
    || riskReview.existing_self_update_handoff_authorized !== false
    || riskReview.promotion_token !== null
  ) throw new Error('rsi_episode_promotion_risk_review_not_ready');

  const rollback = qualification?.rollback;
  if (
    !rollback
    || rollback.ready !== true
    || rollback.ambiguous_effect_replay_allowed !== false
    || exactSha(rollback.predecessor_sha, 'rollback_predecessor') !== promotionGate.parent_sha
  ) throw new Error('rsi_episode_promotion_rollback_not_ready');

  const core = zeroAuthority({
    schema: RSI_EPISODE_PROMOTION_REVIEW_SCHEMA,
    version: 1,
    state: 'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW',
    episode_id: readiness.episode_id,
    candidate_id: readiness.candidate_id,
    candidate_sha: readiness.candidate_sha,
    parent_sha: promotionGate.parent_sha,
    source_sha: readiness.source_sha,
    trust_root_set_digest: readiness.trust_root_set_digest,
    evaluation_bundle_digest: exactDigest(bundle.bundle_digest, 'evaluation_bundle'),
    promotion_gate_digest: exactDigest(promotionGate.gate_digest, 'promotion_gate'),
    risk_review_digest: exactDigest(riskReview.review_digest, 'risk_review'),
    risk_confirmation_digest: exactDigest(confirmation.confirmation_digest, 'risk_confirmation'),
    artifact_digest: exactDigest(promotionGate.artifact_digest, 'artifact'),
    provenance_digest: exactDigest(promotionGate.provenance_digest, 'provenance'),
    rollback: Object.freeze({
      predecessor_sha: promotionGate.parent_sha,
      artifact_digest: exactDigest(rollback.artifact_digest, 'rollback_artifact'),
      ready: true,
      ambiguous_effect_replay_allowed: false,
      automatic_replay_authorized: false,
    }),
    all_episode_evidence_pass: true,
    ordinary_promotion_gate_pass: true,
    statistical_confirmation_pass: true,
    rollback_ready: true,
    external_release_handoff_review_required: true,
    release_handoff_authorized: false,
    direct_install_authorized: false,
    direct_promotion_authorized: false,
    existing_self_update_handoff_authorized: false,
    promotion_token: null,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, review_digest: digest(core) });
}

export function verifyRsiEpisodePromotionReview(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review) || review.schema !== RSI_EPISODE_PROMOTION_REVIEW_SCHEMA || review.version !== 1) {
    throw new Error('rsi_episode_promotion_review_schema_invalid');
  }
  assertZeroAuthority(review, 'review');
  if (
    review.state !== 'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW'
    || review.all_episode_evidence_pass !== true
    || review.ordinary_promotion_gate_pass !== true
    || review.statistical_confirmation_pass !== true
    || review.rollback_ready !== true
    || review.external_release_handoff_review_required !== true
    || review.release_handoff_authorized !== false
    || review.direct_install_authorized !== false
    || review.direct_promotion_authorized !== false
    || review.existing_self_update_handoff_authorized !== false
    || review.promotion_token !== null
    || review.physical_effect_replay_allowed !== false
  ) throw new Error('rsi_episode_promotion_review_policy_invalid');

  exactCandidateId(review.candidate_id);
  exactSha(review.candidate_sha, 'review_candidate');
  exactSha(review.parent_sha, 'review_parent');
  exactSha(review.source_sha, 'review_source');
  exactDigest(review.trust_root_set_digest, 'review_trust_root');
  exactDigest(review.evaluation_bundle_digest, 'review_bundle');
  exactDigest(review.promotion_gate_digest, 'review_promotion_gate');
  exactDigest(review.risk_review_digest, 'review_risk');
  exactDigest(review.risk_confirmation_digest, 'review_confirmation');
  exactDigest(review.artifact_digest, 'review_artifact');
  exactDigest(review.provenance_digest, 'review_provenance');
  if (
    review.rollback?.ready !== true
    || review.rollback?.ambiguous_effect_replay_allowed !== false
    || review.rollback?.automatic_replay_authorized !== false
    || exactSha(review.rollback?.predecessor_sha, 'review_rollback_predecessor') !== review.parent_sha
  ) throw new Error('rsi_episode_promotion_review_rollback_invalid');

  const clone = structuredClone(review);
  const claimed = exactDigest(clone.review_digest, 'review');
  delete clone.review_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_episode_promotion_review_digest_mismatch');
  return review;
}

export function rsiEpisodePromotionReviewTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.episode-promotion-review-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-episode-promotion-review.mjs',
    durable_episode_nomination_required: true,
    all_six_evidence_classes_must_pass: true,
    canonical_promotion_gate_recomputed: true,
    recursive_risk_confirmation_required: true,
    rollback_proof_required: true,
    rollback_ambiguous_replay_allowed: false,
    external_release_handoff_review_required: true,
    release_handoff_authorized: false,
    direct_install_authorized: false,
    direct_promotion_authorized: false,
    self_update_authority: false,
    promotion_token_minted: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, episode_promotion_review_root_digest: digest(root) });
}
