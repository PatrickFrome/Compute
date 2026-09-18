
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiEpisodePromotionReview,
  verifyRsiEpisodePromotionReview,
  rsiEpisodePromotionReviewTrustRootSnapshot,
} from '../src/rsi-episode-promotion-review.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

const candidateId = 'candidate_sha256_' + 'c'.repeat(64);
const candidateSha = 'b'.repeat(40);
const parentSha = 'a'.repeat(40);

function review() {
  const core = {
    schema: 'metaengine.rsi.episode-promotion-review.v1',
    version: 1,
    state: 'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW',
    episode_id: 'rsi_episode_0123456789abcdef01234567',
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    source_sha: parentSha,
    trust_root_set_digest: 'sha256:' + '1'.repeat(64),
    evaluation_bundle_digest: 'sha256:' + '2'.repeat(64),
    promotion_gate_digest: 'sha256:' + '3'.repeat(64),
    risk_review_digest: 'sha256:' + '4'.repeat(64),
    risk_confirmation_digest: 'sha256:' + '5'.repeat(64),
    artifact_digest: 'sha256:' + '6'.repeat(64),
    provenance_digest: 'sha256:' + '7'.repeat(64),
    rollback: {
      predecessor_sha: parentSha,
      artifact_digest: 'sha256:' + '8'.repeat(64),
      ready: true,
      ambiguous_effect_replay_allowed: false,
      automatic_replay_authorized: false,
    },
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
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, review_digest: digest(core) };
}

test('verified episode promotion review is still zero-authority external handoff evidence', () => {
  const row = review();
  verifyRsiEpisodePromotionReview(row);
  assert.equal(row.state, 'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW');
  assert.equal(row.release_handoff_authorized, false);
  assert.equal(row.direct_install_authorized, false);
  assert.equal(row.direct_promotion_authorized, false);
  assert.equal(row.existing_self_update_handoff_authorized, false);
  assert.equal(row.promotion_token, null);
  assert.equal(row.physical_effect_replay_allowed, false);
  assert.equal(row.promotion_authority, false);
  assert.equal(row.self_update_authority, false);
});

test('review tampering and rollback replay widening fail closed', () => {
  const authority = structuredClone(review());
  authority.promotion_authority = true;
  assert.throws(() => verifyRsiEpisodePromotionReview(authority), /review_promotion_authority_invalid/);

  const rollback = structuredClone(review());
  rollback.rollback.automatic_replay_authorized = true;
  assert.throws(() => verifyRsiEpisodePromotionReview(rollback), /review_rollback_invalid/);

  const digestTamper = structuredClone(review());
  digestTamper.artifact_digest = 'sha256:' + '9'.repeat(64);
  assert.throws(() => verifyRsiEpisodePromotionReview(digestTamper), /review_digest_mismatch/);
});

test('episode promotion creation refuses incomplete durable readiness before any release gate evaluation', () => {
  const readiness = {
    schema: 'metaengine.rsi.episode-nomination-readiness.v1',
    version: 1,
    episode_id: 'rsi_episode_0123456789abcdef01234567',
    candidate_id: candidateId,
    candidate_sha: candidateSha,
    source_sha: parentSha,
    trust_root_set_digest: '1'.repeat(64),
    state: 'EVALUATING',
    ready: false,
    missing_evidence_kinds: ['TOURNAMENT'],
    blocking_evidence_kinds: [],
    requires_external_promotion_gate: true,
    direct_promotion_enabled: false,
    physical_effect_replay_allowed: false,
    execution_authority: false,
    browser_authority: false,
    scheduler_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  assert.throws(() => createRsiEpisodePromotionReview({
    episode_readiness: readiness,
  }), /readiness_not_ready/);
});

test('promotion review trust root requires episode evidence, statistics and rollback without granting release authority', () => {
  const root = rsiEpisodePromotionReviewTrustRootSnapshot();
  assert.equal(root.durable_episode_nomination_required, true);
  assert.equal(root.all_six_evidence_classes_must_pass, true);
  assert.equal(root.canonical_promotion_gate_recomputed, true);
  assert.equal(root.recursive_risk_confirmation_required, true);
  assert.equal(root.rollback_proof_required, true);
  assert.equal(root.rollback_ambiguous_replay_allowed, false);
  assert.equal(root.external_release_handoff_review_required, true);
  assert.equal(root.release_handoff_authorized, false);
  assert.equal(root.direct_install_authorized, false);
  assert.equal(root.direct_promotion_authorized, false);
  assert.equal(root.promotion_token_minted, false);
});
