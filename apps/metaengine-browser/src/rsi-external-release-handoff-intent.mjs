import crypto from 'node:crypto';

import { verifyRsiEpisodePromotionReview } from './rsi-episode-promotion-review.mjs';
import { BROWSER_FABRIC_RELEASE_GATE_SCHEMA } from './browser-fabric-release-authority-gate.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
  SELF_UPDATE_INSTALL_EFFECT_SCOPE,
  SELF_UPDATE_INSTALL_ACTUATOR,
} from './self-update-transaction-journal.mjs';

export const RSI_EXTERNAL_RELEASE_HANDOFF_INTENT_SCHEMA = 'metaengine.rsi.external-release-handoff-intent.v1';
export const RSI_PROMOTION_ATTESTATION_VERIFICATION_SCHEMA = 'metaengine.rsi.promotion-review-attestation-verification.v1';

const EXPECTED_REPOSITORY_ID = 1341371143;
const EXPECTED_REPOSITORY = 'PatrickFrome/Compute';
const EXPECTED_ATTESTATION_WORKFLOW = '.github/workflows/rsi-promotion-attestation.yml';
const EXPECTED_PREDICATE_TYPE = 'https://github.com/PatrickFrome/Compute/attestations/rsi-promotion-review/v1';
const EXPECTED_ATTESTATION_CLASSIFICATION = 'CRYPTOGRAPHICALLY_VERIFIED_RSI_PROMOTION_REVIEW_NONAUTHORITATIVE';
const EXPECTED_ATTESTATION_NEXT = 'EXTERNAL_PROMOTION_AUTHORITY_MUST_CONSUME_THIS_RECEIPT_AND_REVALIDATE_LIVE_RELEASE_STATE';

const SHA40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CANDIDATE_ID = /^candidate_sha256_[0-9a-f]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digestHex(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function digest(value) {
  return 'sha256:' + digestHex(value);
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40.test(out)) throw new Error('rsi_release_handoff_' + label + '_sha_invalid');
  return out;
}

function exactHexDigest(value, label) {
  const out = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!HEX64.test(out)) throw new Error('rsi_release_handoff_' + label + '_digest_invalid');
  return out;
}

function exactPrefixedDigest(value, label) {
  return 'sha256:' + exactHexDigest(value, label);
}

function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error('rsi_release_handoff_' + label + '_invalid');
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
    'release_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (Object.hasOwn(value || {}, field) && value[field] !== false) {
      throw new Error('rsi_release_handoff_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_release_handoff_' + label + '_automatic_retry_invalid');
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
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function verifyRsiPromotionAttestationVerification(receipt) {
  if (
    !receipt
    || typeof receipt !== 'object'
    || Array.isArray(receipt)
    || receipt.schema !== RSI_PROMOTION_ATTESTATION_VERIFICATION_SCHEMA
  ) {
    throw new Error('rsi_release_handoff_attestation_schema_invalid');
  }
  assertZeroAuthority(receipt, 'attestation');
  if (
    receipt.classification !== EXPECTED_ATTESTATION_CLASSIFICATION
    || receipt.predicate_type !== EXPECTED_PREDICATE_TYPE
    || receipt.source_attestation_verified !== true
    || receipt.required_next !== EXPECTED_ATTESTATION_NEXT
    || receipt.direct_install_authorized !== false
  ) {
    throw new Error('rsi_release_handoff_attestation_policy_invalid');
  }

  const source = receipt.source;
  if (
    !source
    || typeof source !== 'object'
    || Array.isArray(source)
    || source.repository_id !== EXPECTED_REPOSITORY_ID
    || source.repository !== EXPECTED_REPOSITORY
    || source.workflow_path !== EXPECTED_ATTESTATION_WORKFLOW
  ) {
    throw new Error('rsi_release_handoff_attestation_source_invalid');
  }
  exactSha(source.head_sha, 'attestation_source_head');
  positiveInt(source.run_id, 'attestation_run_id');

  const candidateId = String(receipt.candidate_id || '').trim().toLowerCase();
  if (!CANDIDATE_ID.test(candidateId)) throw new Error('rsi_release_handoff_candidate_id_invalid');
  const candidateSha = exactSha(receipt.candidate_sha, 'attestation_candidate');
  const parentSha = exactSha(receipt.parent_sha, 'attestation_parent');
  if (candidateSha === parentSha) throw new Error('rsi_release_handoff_candidate_parent_same');

  for (const field of [
    'predicate_sha256',
    'attested_file_sha256',
    'promotion_subject_sha256',
    'artifact_sha256',
    'promotion_gate_sha256',
    'verification_receipt_sha256',
  ]) {
    exactHexDigest(receipt[field], 'attestation_' + field);
  }

  const clone = structuredClone(receipt);
  const claimed = exactHexDigest(clone.verification_receipt_sha256, 'attestation_receipt');
  delete clone.verification_receipt_sha256;
  if (digestHex(clone) !== claimed) throw new Error('rsi_release_handoff_attestation_receipt_digest_mismatch');

  return Object.freeze(structuredClone(receipt));
}

export function createRsiExternalReleaseHandoffIntent({
  episode_promotion_review,
  promotion_attestation_verification,
} = {}) {
  const review = verifyRsiEpisodePromotionReview(episode_promotion_review);
  const attestation = verifyRsiPromotionAttestationVerification(promotion_attestation_verification);

  if (
    attestation.candidate_id !== review.candidate_id
    || exactSha(attestation.candidate_sha, 'candidate') !== review.candidate_sha
    || exactSha(attestation.parent_sha, 'parent') !== review.parent_sha
  ) {
    throw new Error('rsi_release_handoff_candidate_identity_mismatch');
  }
  if (
    exactPrefixedDigest(attestation.artifact_sha256, 'artifact') !== review.artifact_digest
    || exactPrefixedDigest(attestation.promotion_gate_sha256, 'promotion_gate') !== review.promotion_gate_digest
  ) {
    throw new Error('rsi_release_handoff_attestation_review_binding_mismatch');
  }

  const core = zeroAuthority({
    schema: RSI_EXTERNAL_RELEASE_HANDOFF_INTENT_SCHEMA,
    version: 1,
    state: 'READY_FOR_EXTERNAL_RELEASE_COORDINATOR_REVIEW',
    episode_id: review.episode_id,
    candidate_id: review.candidate_id,
    candidate_sha: review.candidate_sha,
    parent_sha: review.parent_sha,
    source_sha: review.source_sha,
    candidate_identity_frozen: true,
    episode_promotion_review_digest: review.review_digest,
    promotion_gate_digest: review.promotion_gate_digest,
    risk_review_digest: review.risk_review_digest,
    risk_confirmation_digest: review.risk_confirmation_digest,
    evaluation_bundle_digest: review.evaluation_bundle_digest,
    artifact_digest: review.artifact_digest,
    provenance_digest: review.provenance_digest,
    rollback: Object.freeze(structuredClone(review.rollback)),
    promotion_attestation_verification_digest: exactPrefixedDigest(
      attestation.verification_receipt_sha256,
      'attestation_verification',
    ),
    promotion_attestation_source_head: exactSha(attestation.source.head_sha, 'attestation_source_head'),
    promotion_attestation_source_run_id: positiveInt(attestation.source.run_id, 'attestation_run_id'),
    promotion_attestation_subject_digest: exactPrefixedDigest(
      attestation.promotion_subject_sha256,
      'attestation_subject',
    ),
    promotion_attestation_predicate_digest: exactPrefixedDigest(
      attestation.predicate_sha256,
      'attestation_predicate',
    ),
    cryptographic_promotion_attestation_verified: true,
    external_release_coordinator_review_required: true,
    publisher_action_authorized: false,
    release_publication_authorized: false,
    promotion_token: null,
    candidate_sha_must_equal_release_source_sha: true,
    immutable_release_required_before_authority_advance: true,
    immutable_release_attestation_required: true,
    installed_executable_binding_required: true,
    fresh_source_ancestry_proof_required: true,
    existing_browser_fabric_release_gate_required: true,
    browser_fabric_release_gate_schema: BROWSER_FABRIC_RELEASE_GATE_SCHEMA,
    existing_self_update_transaction_journal_required: true,
    self_update_transaction_schema: SELF_UPDATE_TRANSACTION_SCHEMA,
    install_effect_barrier: SELF_UPDATE_INSTALL_EFFECT_BARRIER,
    install_effect_scope: SELF_UPDATE_INSTALL_EFFECT_SCOPE,
    install_actuator: SELF_UPDATE_INSTALL_ACTUATOR,
    self_update_handoff_authorized: false,
    direct_install_authorized: false,
    one_attempt_install_effect_required: true,
    ambiguous_install_requires_reconciliation: true,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, handoff_intent_digest: digest(core) });
}

export function verifyRsiExternalReleaseHandoffIntent(intent) {
  if (
    !intent
    || typeof intent !== 'object'
    || Array.isArray(intent)
    || intent.schema !== RSI_EXTERNAL_RELEASE_HANDOFF_INTENT_SCHEMA
    || intent.version !== 1
  ) {
    throw new Error('rsi_release_handoff_intent_schema_invalid');
  }
  assertZeroAuthority(intent, 'intent');
  if (
    intent.state !== 'READY_FOR_EXTERNAL_RELEASE_COORDINATOR_REVIEW'
    || intent.candidate_identity_frozen !== true
    || intent.cryptographic_promotion_attestation_verified !== true
    || intent.external_release_coordinator_review_required !== true
    || intent.publisher_action_authorized !== false
    || intent.release_publication_authorized !== false
    || intent.promotion_token !== null
    || intent.candidate_sha_must_equal_release_source_sha !== true
    || intent.immutable_release_required_before_authority_advance !== true
    || intent.immutable_release_attestation_required !== true
    || intent.installed_executable_binding_required !== true
    || intent.fresh_source_ancestry_proof_required !== true
    || intent.existing_browser_fabric_release_gate_required !== true
    || intent.browser_fabric_release_gate_schema !== BROWSER_FABRIC_RELEASE_GATE_SCHEMA
    || intent.existing_self_update_transaction_journal_required !== true
    || intent.self_update_transaction_schema !== SELF_UPDATE_TRANSACTION_SCHEMA
    || intent.install_effect_barrier !== SELF_UPDATE_INSTALL_EFFECT_BARRIER
    || intent.install_effect_scope !== SELF_UPDATE_INSTALL_EFFECT_SCOPE
    || intent.install_actuator !== SELF_UPDATE_INSTALL_ACTUATOR
    || intent.self_update_handoff_authorized !== false
    || intent.direct_install_authorized !== false
    || intent.one_attempt_install_effect_required !== true
    || intent.ambiguous_install_requires_reconciliation !== true
    || intent.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_release_handoff_intent_policy_invalid');
  }

  const candidateId = String(intent.candidate_id || '').trim().toLowerCase();
  if (!CANDIDATE_ID.test(candidateId)) throw new Error('rsi_release_handoff_candidate_id_invalid');
  exactSha(intent.candidate_sha, 'intent_candidate');
  exactSha(intent.parent_sha, 'intent_parent');
  exactSha(intent.source_sha, 'intent_source');
  exactSha(intent.promotion_attestation_source_head, 'intent_attestation_source_head');
  positiveInt(intent.promotion_attestation_source_run_id, 'intent_attestation_run_id');
  for (const field of [
    'episode_promotion_review_digest',
    'promotion_gate_digest',
    'risk_review_digest',
    'risk_confirmation_digest',
    'evaluation_bundle_digest',
    'artifact_digest',
    'provenance_digest',
    'promotion_attestation_verification_digest',
    'promotion_attestation_subject_digest',
    'promotion_attestation_predicate_digest',
  ]) exactPrefixedDigest(intent[field], field);

  if (
    intent.rollback?.ready !== true
    || intent.rollback?.ambiguous_effect_replay_allowed !== false
    || intent.rollback?.automatic_replay_authorized !== false
    || exactSha(intent.rollback?.predecessor_sha, 'rollback_predecessor') !== intent.parent_sha
  ) {
    throw new Error('rsi_release_handoff_rollback_invalid');
  }

  const clone = structuredClone(intent);
  const claimed = exactPrefixedDigest(clone.handoff_intent_digest, 'intent');
  delete clone.handoff_intent_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_release_handoff_intent_digest_mismatch');
  return intent;
}

export function rsiExternalReleaseHandoffTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.external-release-handoff-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-external-release-handoff-intent.mjs',
    attestation_verifier_path: 'controller/rsi/promotion_attestation.py',
    attestation_contract_workflow_path: '.github/workflows/rsi-promotion-attestation-contract.yml',
    trusted_attestation_workflow_path: EXPECTED_ATTESTATION_WORKFLOW,
    candidate_identity_frozen: true,
    cryptographic_attestation_required: true,
    external_release_coordinator_review_required: true,
    release_publication_authorized: false,
    existing_browser_fabric_release_gate_required: true,
    existing_self_update_transaction_journal_required: true,
    one_attempt_install_effect_required: true,
    ambiguous_install_requires_reconciliation: true,
    physical_effect_replay_allowed: false,
    candidate_can_modify_release_handoff_root: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, release_handoff_root_digest: digest(root) });
}
