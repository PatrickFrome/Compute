import crypto from 'node:crypto';

import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';
import { RSI_BROWSER_OUTCOME_EPISODE_SCHEMA } from './rsi-browser-outcome-ingest.mjs';

export const RSI_TRUSTED_CREDIT_RECEIPT_SCHEMA = 'metaengine.rsi.trusted-credit-receipt.v1';
export const RSI_EXPERIENCE_GRAPH_ADMISSION_SCHEMA = 'metaengine.rsi.experience-graph-admission.v1';
export const RSI_TRUSTED_CREDIT_ROOT_SCHEMA = 'metaengine.rsi.trusted-credit-root.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_REFS = 32;
const MAX_TAGS = 24;
const METHODS = new Set([
  'HIERARCHICAL_EXTERNAL',
  'TURN_VALUE_DELTA',
  'TD_STATE_DELTA',
  'COUNTERFACTUAL_EXTERNAL',
  'VERIFIED_SELF_CHECK_EXTERNAL',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function zeroAuthority(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZeroAuthority(value, label) {
  for (const key of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']) {
    if (value?.[key] !== false) throw new Error(`rsi_credit_${label}_${key}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_credit_${label}_retry_invalid`);
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_credit_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_credit_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_credit_${label}_invalid`);
  return out;
}

function token(value, label) {
  const out = String(value || '').trim().toUpperCase();
  if (!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_credit_${label}_invalid`);
  return out;
}

function positiveInt(value, label, max = 1_000_000) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error(`rsi_credit_${label}_invalid`);
  return out;
}

function boundedUnit(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0 || out > 1) throw new Error(`rsi_credit_${label}_invalid`);
  return Math.round(out * 1_000_000) / 1_000_000;
}

function boundedSignedUnit(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < -1 || out > 1) throw new Error(`rsi_credit_${label}_invalid`);
  return Math.round(out * 1_000_000) / 1_000_000;
}

function normalizeTokens(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_TAGS) throw new Error(`rsi_credit_${label}_invalid`);
  const out = value.map((row) => token(row, label)).sort();
  if (new Set(out).size !== out.length) throw new Error(`rsi_credit_${label}_duplicate`);
  return Object.freeze(out);
}

function normalizeDigests(value, label) {
  if (!Array.isArray(value) || value.length > MAX_REFS) throw new Error(`rsi_credit_${label}_invalid`);
  const out = value.map((row) => exactDigest(row, label)).sort();
  if (new Set(out).size !== out.length) throw new Error(`rsi_credit_${label}_duplicate`);
  return Object.freeze(out);
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REFS) throw new Error('rsi_credit_evidence_refs_invalid');
  const out = value.map((row) => boundedId(row, 'evidence_ref')).sort();
  if (new Set(out).size !== out.length) throw new Error('rsi_credit_evidence_ref_duplicate');
  return Object.freeze(out);
}

function verifyOutcomeEpisodeRecord(episode) {
  if (!episode || typeof episode !== 'object' || Array.isArray(episode) || episode.schema !== RSI_BROWSER_OUTCOME_EPISODE_SCHEMA || episode.version !== 1) {
    throw new Error('rsi_credit_outcome_episode_invalid');
  }
  assertZeroAuthority(episode, 'outcome');
  if (
    episode.quarantined !== false
    || episode.eligible_for_experience_graph !== true
    || episode.candidate_id == null
    || episode.candidate_sha == null
    || episode.proposal_digest == null
    || episode.raw_result_stored !== false
    || episode.raw_error_stored !== false
    || episode.raw_page_text_stored !== false
    || episode.raw_user_input_stored !== false
    || episode.candidate_can_edit_episode !== false
    || episode.physical_effect_replay_allowed !== false
  ) throw new Error('rsi_credit_outcome_episode_not_learning_eligible');
  exactSha(episode.source_sha, 'outcome_source');
  exactSha(episode.candidate_sha, 'outcome_candidate');
  exactDigest(episode.proposal_digest, 'outcome_proposal');
  exactDigest(episode.receipt_digest, 'outcome_receipt');
  const expected = { ...episode };
  delete expected.episode_digest;
  if (digest(expected) !== exactDigest(episode.episode_digest, 'outcome_episode')) {
    throw new Error('rsi_credit_outcome_episode_digest_mismatch');
  }
  return episode;
}

export function createRsiTrustedCreditReceipt({ outcome_episode, assignment } = {}) {
  const episode = verifyOutcomeEpisodeRecord(outcome_episode);
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) throw new Error('rsi_credit_assignment_invalid');
  if (assignment.external_credit_assigner !== true || assignment.authored_by_candidate !== false) {
    throw new Error('rsi_credit_external_assigner_required');
  }
  const method = token(assignment.assignment_method, 'assignment_method');
  if (!METHODS.has(method)) throw new Error('rsi_credit_assignment_method_invalid');
  const overallOutcome = String(episode.terminal_status || '').toUpperCase() === 'COMPLETED' ? 'SUCCESS' : 'FAILURE';
  const failureCodes = normalizeTokens(assignment.failure_codes || [], 'failure_code', { min: overallOutcome === 'FAILURE' ? 1 : 0 });
  if (overallOutcome === 'SUCCESS' && failureCodes.length > 0) throw new Error('rsi_credit_success_failure_codes_forbidden');

  const core = zeroAuthority({
    schema: RSI_TRUSTED_CREDIT_RECEIPT_SCHEMA,
    version: 1,
    source_sha: exactSha(episode.source_sha, 'source'),
    credit_id: boundedId(assignment.credit_id, 'credit_id'),
    outcome_episode_digest: exactDigest(episode.episode_digest, 'episode'),
    command_id: boundedId(episode.command_id, 'command_id'),
    candidate_id: boundedId(episode.candidate_id, 'candidate_id'),
    candidate_sha: exactSha(episode.candidate_sha, 'candidate'),
    proposal_digest: exactDigest(episode.proposal_digest, 'proposal'),
    task_id: boundedId(episode.task_id, 'task_id'),
    task_signature_digest: exactDigest(episode.task_signature_digest, 'task_signature'),
    environment_fingerprint: boundedId(episode.environment_fingerprint, 'environment_fingerprint'),
    model_family: token(episode.model_family, 'model_family'),
    overall_outcome: overallOutcome,
    assignment_method: method,
    step_credit: boundedSignedUnit(assignment.step_credit, 'step_credit'),
    confidence: boundedUnit(assignment.confidence, 'confidence'),
    attempt_index: positiveInt(assignment.attempt_index, 'attempt_index'),
    challenge_family: token(assignment.challenge_family, 'challenge_family'),
    hidden_manifest_digest: exactDigest(assignment.hidden_manifest_digest, 'hidden_manifest'),
    execution_signature_digest: exactDigest(assignment.execution_signature_digest, 'execution_signature'),
    failure_codes: failureCodes,
    mechanism_tags: normalizeTokens(assignment.mechanism_tags || [], 'mechanism_tag'),
    lesson_digests: normalizeDigests(assignment.lesson_digests || [], 'lesson'),
    attribution_digests: normalizeDigests(assignment.attribution_digests || [], 'attribution'),
    transfer_receipt_digests: normalizeDigests(assignment.transfer_receipt_digests || [], 'transfer_receipt'),
    evidence_digest: exactDigest(assignment.evidence_digest, 'evidence'),
    evidence_refs: normalizeEvidenceRefs(assignment.evidence_refs),
    external_credit_assigner: true,
    authored_by_candidate: false,
    terminal_task_reward_is_step_credit: false,
    credit_is_contextual_not_global_truth: true,
    candidate_can_edit_credit: false,
    credit_is_promotion_authority: false,
    raw_trajectory_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    page_model_text_authority: false,
  });
  return Object.freeze({ ...core, credit_receipt_digest: digest(core) });
}

export function verifyRsiTrustedCreditReceipt(receipt, outcomeEpisode) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.schema !== RSI_TRUSTED_CREDIT_RECEIPT_SCHEMA || receipt.version !== 1) {
    throw new Error('rsi_credit_receipt_invalid');
  }
  assertZeroAuthority(receipt, 'receipt');
  const canonical = createRsiTrustedCreditReceipt({
    outcome_episode: outcomeEpisode,
    assignment: {
      credit_id: receipt.credit_id,
      assignment_method: receipt.assignment_method,
      step_credit: receipt.step_credit,
      confidence: receipt.confidence,
      attempt_index: receipt.attempt_index,
      challenge_family: receipt.challenge_family,
      hidden_manifest_digest: receipt.hidden_manifest_digest,
      execution_signature_digest: receipt.execution_signature_digest,
      failure_codes: receipt.failure_codes,
      mechanism_tags: receipt.mechanism_tags,
      lesson_digests: receipt.lesson_digests,
      attribution_digests: receipt.attribution_digests,
      transfer_receipt_digests: receipt.transfer_receipt_digests,
      evidence_digest: receipt.evidence_digest,
      evidence_refs: receipt.evidence_refs,
      external_credit_assigner: true,
      authored_by_candidate: false,
    },
  });
  if (canonical.credit_receipt_digest !== exactDigest(receipt.credit_receipt_digest, 'receipt')) {
    throw new Error('rsi_credit_receipt_digest_mismatch');
  }
  return canonical;
}

export function createRsiExperienceGraphAdmission({ outcome_episode, credit_receipt } = {}) {
  const episode = verifyOutcomeEpisodeRecord(outcome_episode);
  const credit = verifyRsiTrustedCreditReceipt(credit_receipt, episode);
  const attributionDigests = [...new Set([credit.credit_receipt_digest, ...credit.attribution_digests])].sort();
  const taskAnchor = Object.freeze({
    task_id: episode.task_id,
    task_signature_digest: episode.task_signature_digest,
    challenge_family: credit.challenge_family,
    hidden_manifest_digest: credit.hidden_manifest_digest,
    external_writer: true,
    authored_by_candidate: false,
  });
  const caseRow = createRsiExperienceCase({
    case_id: `rsi_case_${credit.credit_receipt_digest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    task_id: episode.task_id,
    task_signature_digest: episode.task_signature_digest,
    attempt_index: credit.attempt_index,
    candidate_id: episode.candidate_id,
    candidate_sha: episode.candidate_sha,
    outcome: credit.overall_outcome,
    environment_fingerprint: episode.environment_fingerprint,
    model_family: episode.model_family,
    execution_signature_digest: credit.execution_signature_digest,
    failure_codes: credit.failure_codes,
    mechanism_tags: credit.mechanism_tags,
    lesson_digests: credit.lesson_digests,
    attribution_digests: attributionDigests,
    transfer_receipt_digests: credit.transfer_receipt_digests,
    evidence_digest: credit.evidence_digest,
    evidence_refs: credit.evidence_refs,
    external_writer: true,
    authored_by_candidate: false,
  });
  const core = zeroAuthority({
    schema: RSI_EXPERIENCE_GRAPH_ADMISSION_SCHEMA,
    version: 1,
    source_sha: episode.source_sha,
    outcome_episode_digest: episode.episode_digest,
    credit_receipt: credit,
    task_anchor: taskAnchor,
    experience_case: caseRow,
    append_only_graph_admission: true,
    candidate_can_write_graph: false,
    candidate_can_edit_case: false,
    external_writer: true,
    authored_by_candidate: false,
    raw_trajectory_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
  });
  return Object.freeze({ ...core, admission_digest: digest(core) });
}

export function verifyRsiExperienceGraphAdmission(admission) {
  if (!admission || typeof admission !== 'object' || Array.isArray(admission) || admission.schema !== RSI_EXPERIENCE_GRAPH_ADMISSION_SCHEMA || admission.version !== 1) {
    throw new Error('rsi_credit_admission_invalid');
  }
  assertZeroAuthority(admission, 'admission');
  if (
    admission.append_only_graph_admission !== true
    || admission.candidate_can_write_graph !== false
    || admission.candidate_can_edit_case !== false
    || admission.external_writer !== true
    || admission.authored_by_candidate !== false
    || admission.raw_trajectory_stored !== false
    || admission.raw_page_text_stored !== false
    || admission.raw_user_input_stored !== false
  ) throw new Error('rsi_credit_admission_policy_invalid');
  const expected = { ...admission };
  delete expected.admission_digest;
  if (digest(expected) !== exactDigest(admission.admission_digest, 'admission')) throw new Error('rsi_credit_admission_digest_mismatch');
  return admission;
}

export function applyRsiExperienceGraphAdmission({ previous_snapshot = null, admission } = {}) {
  const checked = verifyRsiExperienceGraphAdmission(admission);
  const graphId = `rsi.runtime.experience.${checked.source_sha.slice(0, 16)}`;
  if (!previous_snapshot) {
    return createRsiExperienceGraphSnapshot({
      graph_id: graphId,
      epoch: 1,
      predecessor_snapshot_digest: null,
      task_anchors: [checked.task_anchor],
      cases: [checked.experience_case],
      similarity_edges: [],
      correction_edges: [],
      utility_receipts: [],
    });
  }
  const previous = verifyRsiExperienceGraphSnapshot(previous_snapshot);
  if (previous.graph_id !== graphId) throw new Error('rsi_credit_graph_source_mismatch');
  const existingAnchor = previous.task_anchors.find((row) => row.task_id === checked.task_anchor.task_id) || null;
  if (
    existingAnchor
    && (
      existingAnchor.task_signature_digest !== checked.task_anchor.task_signature_digest
      || existingAnchor.challenge_family !== checked.task_anchor.challenge_family
      || existingAnchor.hidden_manifest_digest !== checked.task_anchor.hidden_manifest_digest
    )
  ) throw new Error('rsi_credit_task_anchor_drift');
  return extendRsiExperienceGraphSnapshot({
    previous_snapshot: previous,
    task_anchors: existingAnchor ? [] : [checked.task_anchor],
    cases: [checked.experience_case],
    similarity_edges: [],
    correction_edges: [],
    utility_receipts: [],
  });
}

export function rsiTrustedCreditTrustRootSnapshot() {
  const root = zeroAuthority({
    schema: RSI_TRUSTED_CREDIT_ROOT_SCHEMA,
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-trusted-credit-assignment.mjs',
    allowed_assignment_methods: [...METHODS].sort(),
    persisted_terminal_outcome_required: true,
    candidate_command_attribution_required: true,
    external_credit_assigner_required: true,
    terminal_task_reward_is_step_credit: false,
    contextual_credit_not_global_truth: true,
    append_only_experience_graph_admission: true,
    candidate_can_write_graph: false,
    candidate_can_edit_credit: false,
    candidate_can_edit_case: false,
    raw_trajectory_stored: false,
    page_model_text_authority: false,
    second_scheduler: false,
  });
  return Object.freeze({ ...root, credit_root_digest: digest(root) });
}
