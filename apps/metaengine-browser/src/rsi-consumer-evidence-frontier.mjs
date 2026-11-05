// Read-only, post-verification lifecycle checks. The caller MUST first run the
// existing Phase 31/32 cryptographic/canonical evidence verifiers. This module
// does not attest external evidence or grant consumer execution authority.
const POSITIVE = new Set([
  'CONSUMER_REVALIDATED_RECIPE',
  'CONSUMER_REVALIDATED_COUNTEREVIDENCE',
  'CONSUMER_REVALIDATED_DIAGNOSTIC',
]);
const ADVERSE = new Set([
  'CONSUMER_NEGATIVE_TRANSFER',
  'CONSUMER_NO_CLEAR_BENEFIT',
  'CONSUMER_COUNTEREVIDENCE_NOT_CONFIRMED',
  'CONSUMER_DIAGNOSTIC_NOT_CONFIRMED',
  'CONSUMER_REVALIDATION_INVALID',
]);
const BINDINGS = Object.freeze([
  'consumer_model_family', 'consumer_environment_family',
  'consumer_context_digest', 'consumer_task_set_digest',
  'consumer_harness_digest', 'consumer_retrieval_profile_digest',
  'consumer_evaluator_root_digest', 'consumer_evaluator_generation_digest',
  'consumer_evaluator_generation_seq',
  'consumer_evaluator_generation_history_anchor_digest',
  'consumer_evaluation_epoch_seq', 'consumer_evaluation_epoch_digest',
  'consumer_evaluation_contract_digest', 'current_consumer_plane_digest',
  'current_verified_library_digest',
]);
const MAX_HISTORY = 2048;

function requireRow(row) {
  if (!row || typeof row !== 'object' || !row.handoff || !row.receipt ||
      typeof row.consumer_identity !== 'string' || !row.consumer_identity ||
      typeof row.handoff.handoff_digest !== 'string' ||
      typeof row.receipt.receipt_digest !== 'string' ||
      typeof row.receipt.receipt_id !== 'string' ||
      row.receipt.handoff_digest !== row.handoff.handoff_digest ||
      row.receipt.source_sha !== row.handoff.source_sha ||
      row.receipt.consumer_route !== row.handoff.consumer_route ||
      !(POSITIVE.has(row.receipt.state) || ADVERSE.has(row.receipt.state))) {
    throw new Error('rsi_consumer_frontier_verified_row_required');
  }
  return row;
}

// Existing rows are supplied from the canonically verified archive, already
// scoped to one consumer_identity. An adverse receipt may append after a
// favorable receipt, but a favorable replay may never erase a prior veto.
export function classifyRsiConsumerEvidenceAppend(existingRows, nextRow) {
  if (!Array.isArray(existingRows) || existingRows.length > MAX_HISTORY) {
    throw new Error('rsi_consumer_frontier_history_invalid');
  }
  const next = requireRow(nextRow);
  const ids = new Set();
  for (const existing of existingRows) {
    const prior = requireRow(existing);
    if (prior.consumer_identity !== next.consumer_identity ||
        prior.handoff.handoff_digest !== next.handoff.handoff_digest) {
      throw new Error('rsi_consumer_frontier_identity_conflict');
    }
    if (ids.has(prior.receipt.receipt_id)) {
      throw new Error('rsi_consumer_frontier_history_duplicate');
    }
    ids.add(prior.receipt.receipt_id);
    if (prior.receipt.receipt_id === next.receipt.receipt_id) {
      if (prior.receipt.receipt_digest !== next.receipt.receipt_digest) {
        throw new Error('rsi_consumer_frontier_receipt_id_conflict');
      }
      return 'IDEMPOTENT';
    }
  }
  if (existingRows.length === 0) return 'APPEND';
  if (!ADVERSE.has(next.receipt.state)) {
    throw new Error('rsi_consumer_frontier_positive_replay_forbidden');
  }
  return 'APPEND_ADVERSE';
}

// An observation is supplied by the existing consumer owner, not the
// candidate. Exact matches are necessary, not sufficient: this returns only
// permission to REQUEST another owner review, never skill activation.
export function assessRsiConsumerKnowledgeReview({ rows, handoff, observed } = {}) {
  const hold = (state) => Object.freeze({
    state, eligible_for_owner_review: false,
    skill_activation_authority: false, retrieval_exposure_authority: false,
    execution_authority: false, authority_effect: false,
  });
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_HISTORY ||
      !handoff || !handoff.handoff_digest) return hold('HOLD_NO_VERIFIED_ARCHIVE_ROW');
  let prior = [];
  for (const row of rows) {
    try {
      if (classifyRsiConsumerEvidenceAppend(prior, row) === 'IDEMPOTENT') {
        return hold('HOLD_DUPLICATE_ARCHIVE_ROW');
      }
    } catch {
      return hold('HOLD_INCONSISTENT_ARCHIVE');
    }
    prior.push(row);
  }
  if (rows[0].handoff.handoff_digest !== handoff.handoff_digest) {
    return hold('HOLD_HANDOFF_CHANGED');
  }
  if (!observed || typeof observed !== 'object' ||
      BINDINGS.some((key) => !Object.hasOwn(observed, key))) {
    return hold('HOLD_CURRENT_STATE_UNOBSERVED');
  }
  if (BINDINGS.some((key) => observed[key] !== handoff[key])) {
    return hold('HOLD_CURRENT_STATE_DRIFT');
  }
  if (rows.some((row) => ADVERSE.has(row.receipt.state))) {
    return hold('HOLD_POST_HANDOFF_ADVERSE_EVIDENCE');
  }
  if (!POSITIVE.has(rows[0].receipt.state)) {
    return hold('HOLD_NO_POSITIVE_REVALIDATION');
  }
  return Object.freeze({
    state: 'ELIGIBLE_FOR_FRESH_OWNER_REVIEW_ONLY',
    eligible_for_owner_review: true,
    skill_activation_authority: false, retrieval_exposure_authority: false,
    execution_authority: false, authority_effect: false,
  });
}
