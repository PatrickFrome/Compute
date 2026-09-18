import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateFinalInstallCycleAdmission,
} from './rsi-self-update-final-install-cycle-admission.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
  SELF_UPDATE_INSTALL_EFFECT_SCOPE,
  SELF_UPDATE_INSTALL_ACTUATOR,
} from './self-update-transaction-journal.mjs';

export const RSI_SELF_UPDATE_FINAL_APPLY_INVOCATION_RECEIPT_SCHEMA =
  'metaengine.rsi.self-update-final-apply-invocation-receipt.v1';
export const RSI_SELF_UPDATE_POST_EFFECT_READBACK_SCHEMA =
  'metaengine.rsi.self-update-post-effect-readback.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const TERMINAL_TRANSACTION_STATES = new Set(['QUALIFIED', 'QUARANTINED', 'SUPERSEDED']);

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
  if (!SHA40.test(out)) throw new Error('rsi_final_apply_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256.test(out)) throw new Error('rsi_final_apply_' + label + '_digest_invalid');
  return out;
}

function exactUtc(value, label) {
  const out = String(value || '');
  if (!UTC.test(out) || !Number.isFinite(Date.parse(out))) {
    throw new Error('rsi_final_apply_' + label + '_time_invalid');
  }
  return new Date(Date.parse(out)).toISOString();
}

function safeId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID.test(out)) throw new Error('rsi_final_apply_' + label + '_invalid');
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
      throw new Error('rsi_final_apply_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_final_apply_' + label + '_automatic_retry_invalid');
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

function exactTransactionBinding(transaction, admission, invocation) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new Error('rsi_final_apply_transaction_invalid');
  }
  if (transaction.schema !== SELF_UPDATE_TRANSACTION_SCHEMA) {
    throw new Error('rsi_final_apply_transaction_schema_invalid');
  }
  if (transaction.authority_effect !== false || transaction.automatic_retry_allowed !== false) {
    throw new Error('rsi_final_apply_transaction_authority_invalid');
  }
  if (
    String(transaction.target_version || '') !== admission.target_release_version
    || String(transaction.source_version || '') !== admission.runtime.current_version
    || exactSha(transaction.resolved_git_sha, 'transaction_source') !== admission.candidate_sha
  ) {
    throw new Error('rsi_final_apply_transaction_binding_mismatch');
  }
  const createdAt = exactUtc(transaction.created_at, 'transaction_created_at');
  const updatedAt = exactUtc(transaction.updated_at, 'transaction_updated_at');
  if (Date.parse(createdAt) < Date.parse(invocation.invoked_at)) {
    throw new Error('rsi_final_apply_transaction_predates_invocation');
  }
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error('rsi_final_apply_transaction_time_order_invalid');
  }
  const attemptCount = Number(transaction.attempt_count);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new Error('rsi_final_apply_transaction_attempt_count_invalid');
  }
  const state = String(transaction.state || '').toUpperCase();
  if (!['PREPARED', 'INSTALLING', 'SUCCESSOR_BOOTED', 'QUALIFIED', 'AMBIGUOUS_INSTALL', 'QUARANTINED', 'SUPERSEDED'].includes(state)) {
    throw new Error('rsi_final_apply_transaction_state_invalid');
  }
  return Object.freeze({
    schema: transaction.schema,
    transaction_id: safeId(transaction.transaction_id, 'transaction_id'),
    source_version: transaction.source_version,
    target_version: transaction.target_version,
    resolved_git_sha: admission.candidate_sha,
    state,
    swapping: transaction.swapping === true,
    qualified: transaction.qualified === true,
    quarantined: transaction.quarantined === true,
    attempt_count: attemptCount,
    created_at: createdAt,
    updated_at: updatedAt,
    evidence: transaction.evidence && typeof transaction.evidence === 'object' && !Array.isArray(transaction.evidence)
      ? structuredClone(transaction.evidence)
      : {},
    transaction_digest: digest(transaction),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function effectEvidence(transaction) {
  const evidence = transaction?.evidence || {};
  const barrier = evidence.effect_barrier_contract === SELF_UPDATE_INSTALL_EFFECT_BARRIER;
  const scope = evidence.effect_scope === SELF_UPDATE_INSTALL_EFFECT_SCOPE;
  const actuator = evidence.actuator_type === SELF_UPDATE_INSTALL_ACTUATOR;
  const physical = evidence.physical_effect_attempted === true;
  const crossed = evidence.effect_barrier_crossed === true;
  const singleShot = evidence.effect_must_be_single_shot === true;
  const readbackRequired = evidence.post_effect_readback_required === true;
  const complete = barrier && scope && actuator && physical && crossed && singleShot && readbackRequired;
  return Object.freeze({
    barrier_contract_verified: barrier,
    effect_scope_verified: scope,
    actuator_verified: actuator,
    physical_effect_attempted: physical,
    effect_barrier_crossed: crossed,
    single_shot_contract_verified: singleShot,
    post_effect_readback_required: readbackRequired,
    complete_effect_evidence: complete,
    authority_effect: false,
  });
}

function classifyTransaction(transaction) {
  const effect = effectEvidence(transaction);
  const state = transaction.state;

  if (state === 'PREPARED') {
    if (effect.physical_effect_attempted || effect.effect_barrier_crossed) {
      return Object.freeze({
        state: 'CORRUPT_EFFECT_EVIDENCE_HOLD',
        reason: 'PREPARED_WITH_EFFECT_EVIDENCE',
        physical_effect_status: 'UNKNOWN',
        same_invocation_retry_allowed: false,
        terminal_reconciliation_required: true,
        qualification_resume_allowed: false,
        ...effect,
      });
    }
    return Object.freeze({
      state: 'NO_EFFECT_BARRIER_NOT_CROSSED',
      reason: 'TRANSACTION_PREPARED_ONLY',
      physical_effect_status: 'NOT_RECORDED',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: true,
      qualification_resume_allowed: false,
      ...effect,
    });
  }

  if (state === 'AMBIGUOUS_INSTALL') {
    return Object.freeze({
      state: 'AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
      reason: effect.complete_effect_evidence ? 'BARRIER_CROSSED_OUTCOME_AMBIGUOUS' : 'EFFECT_STATUS_AMBIGUOUS',
      physical_effect_status: effect.complete_effect_evidence ? 'ATTEMPTED' : 'UNKNOWN',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: true,
      qualification_resume_allowed: false,
      ...effect,
    });
  }

  if (state === 'INSTALLING') {
    if (!effect.complete_effect_evidence) {
      return Object.freeze({
        state: 'CORRUPT_EFFECT_EVIDENCE_HOLD',
        reason: 'INSTALLING_WITHOUT_COMPLETE_WRITE_AHEAD_EVIDENCE',
        physical_effect_status: 'UNKNOWN',
        same_invocation_retry_allowed: false,
        terminal_reconciliation_required: true,
        qualification_resume_allowed: false,
        ...effect,
      });
    }
    return Object.freeze({
      state: 'PHYSICAL_EFFECT_ATTEMPTED_PENDING_SUCCESSOR_READBACK',
      reason: 'INSTALL_BARRIER_CROSSED',
      physical_effect_status: 'ATTEMPTED',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: true,
      qualification_resume_allowed: false,
      ...effect,
    });
  }

  if (['SUCCESSOR_BOOTED', 'QUALIFIED', 'QUARANTINED'].includes(state) && !effect.complete_effect_evidence) {
    return Object.freeze({
      state: 'CORRUPT_EFFECT_EVIDENCE_HOLD',
      reason: state + '_WITHOUT_COMPLETE_WRITE_AHEAD_EVIDENCE',
      physical_effect_status: 'UNKNOWN',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: true,
      qualification_resume_allowed: false,
      ...effect,
    });
  }

  if (state === 'SUCCESSOR_BOOTED') {
    return Object.freeze({
      state: 'SUCCESSOR_BOOTED_PENDING_QUALIFICATION',
      reason: 'TARGET_SUCCESSOR_OBSERVED',
      physical_effect_status: 'ATTEMPTED',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: false,
      qualification_resume_allowed: true,
      ...effect,
    });
  }

  if (state === 'QUALIFIED') {
    if (transaction.qualified !== true || transaction.quarantined === true) {
      return Object.freeze({
        state: 'CORRUPT_EFFECT_EVIDENCE_HOLD',
        reason: 'QUALIFIED_FLAG_INCONSISTENT',
        physical_effect_status: 'ATTEMPTED',
        same_invocation_retry_allowed: false,
        terminal_reconciliation_required: true,
        qualification_resume_allowed: false,
        ...effect,
      });
    }
    return Object.freeze({
      state: 'QUALIFIED_SUCCESSOR',
      reason: 'SELF_UPDATE_TRANSACTION_QUALIFIED',
      physical_effect_status: 'ATTEMPTED',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: false,
      qualification_resume_allowed: false,
      ...effect,
    });
  }

  if (state === 'QUARANTINED') {
    if (transaction.quarantined !== true || transaction.qualified === true) {
      return Object.freeze({
        state: 'CORRUPT_EFFECT_EVIDENCE_HOLD',
        reason: 'QUARANTINE_FLAG_INCONSISTENT',
        physical_effect_status: 'ATTEMPTED',
        same_invocation_retry_allowed: false,
        terminal_reconciliation_required: true,
        qualification_resume_allowed: false,
        ...effect,
      });
    }
    return Object.freeze({
      state: 'QUARANTINED_SUCCESSOR',
      reason: 'SUCCESSOR_QUALIFICATION_QUARANTINED',
      physical_effect_status: 'ATTEMPTED',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: false,
      qualification_resume_allowed: true,
      ...effect,
    });
  }

  if (state === 'SUPERSEDED') {
    return Object.freeze({
      state: 'SUPERSEDED_ATTEMPT',
      reason: 'TRANSACTION_SUPERSEDED',
      physical_effect_status: effect.complete_effect_evidence ? 'ATTEMPTED' : 'NOT_AUTHORITATIVELY_PROVEN',
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: false,
      qualification_resume_allowed: false,
      ...effect,
    });
  }

  return Object.freeze({
    state: 'CORRUPT_EFFECT_EVIDENCE_HOLD',
    reason: 'UNCLASSIFIED_TRANSACTION_STATE',
    physical_effect_status: 'UNKNOWN',
    same_invocation_retry_allowed: false,
    terminal_reconciliation_required: true,
    qualification_resume_allowed: false,
    ...effect,
  });
}

export function createRsiSelfUpdateFinalApplyInvocationReceipt({
  final_install_admission,
  invocation_id,
  invoked_at,
  controller_id,
  external_controller_verified = false,
  authored_by_candidate = true,
  invocation_count = 1,
} = {}) {
  const admission = verifyRsiSelfUpdateFinalInstallCycleAdmission(final_install_admission);
  if (external_controller_verified !== true || authored_by_candidate !== false) {
    throw new Error('rsi_final_apply_external_controller_required');
  }
  if (Number(invocation_count) !== 1) {
    throw new Error('rsi_final_apply_invocation_count_invalid');
  }

  const core = zeroAuthority({
    schema: RSI_SELF_UPDATE_FINAL_APPLY_INVOCATION_RECEIPT_SCHEMA,
    version: 1,
    final_install_admission_digest: admission.final_install_admission_digest,
    candidate_sha: admission.candidate_sha,
    previous_authority_sha: admission.previous_authority_sha,
    target_release_version: admission.target_release_version,
    invocation_id: safeId(invocation_id, 'invocation_id'),
    invoked_at: exactUtc(invoked_at, 'invoked_at'),
    controller_id: safeId(controller_id, 'controller_id'),
    runtime_method: 'applyWhenSafe',
    invocation_count: 1,
    external_controller_verified: true,
    authored_by_candidate: false,
    retry_budget: 0,
    physical_effect_outcome_asserted: false,
    transaction_readback_required: true,
    successor_startup_readback_required: true,
    same_invocation_retry_allowed: false,
    installer_success_claimed: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, invocation_receipt_digest: digest(core) });
}

export function verifyRsiSelfUpdateFinalApplyInvocationReceipt(row, { final_install_admission } = {}) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || row.schema !== RSI_SELF_UPDATE_FINAL_APPLY_INVOCATION_RECEIPT_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_final_apply_invocation_schema_invalid');
  }
  assertZeroAuthority(row, 'invocation');
  const admission = verifyRsiSelfUpdateFinalInstallCycleAdmission(final_install_admission);
  if (
    row.final_install_admission_digest !== admission.final_install_admission_digest
    || row.candidate_sha !== admission.candidate_sha
    || row.previous_authority_sha !== admission.previous_authority_sha
    || row.target_release_version !== admission.target_release_version
    || row.runtime_method !== 'applyWhenSafe'
    || row.invocation_count !== 1
    || row.external_controller_verified !== true
    || row.authored_by_candidate !== false
    || row.retry_budget !== 0
    || row.physical_effect_outcome_asserted !== false
    || row.transaction_readback_required !== true
    || row.successor_startup_readback_required !== true
    || row.same_invocation_retry_allowed !== false
    || row.installer_success_claimed !== false
    || row.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_final_apply_invocation_policy_invalid');
  }
  safeId(row.invocation_id, 'invocation_id');
  exactUtc(row.invoked_at, 'invoked_at');
  safeId(row.controller_id, 'controller_id');
  const clone = structuredClone(row);
  const claimed = exactDigest(clone.invocation_receipt_digest, 'invocation_receipt');
  delete clone.invocation_receipt_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_final_apply_invocation_digest_mismatch');
  return row;
}

export function createRsiSelfUpdatePostEffectReadback({
  final_install_admission,
  invocation_receipt,
  transaction_readback = null,
  observed_at,
  observer_id,
  external_transaction_reader = false,
  authored_by_candidate = true,
} = {}) {
  const admission = verifyRsiSelfUpdateFinalInstallCycleAdmission(final_install_admission);
  const invocation = verifyRsiSelfUpdateFinalApplyInvocationReceipt(invocation_receipt, {
    final_install_admission: admission,
  });
  if (external_transaction_reader !== true || authored_by_candidate !== false) {
    throw new Error('rsi_final_apply_external_transaction_reader_required');
  }
  const observedAt = exactUtc(observed_at, 'observed_at');
  if (Date.parse(observedAt) < Date.parse(invocation.invoked_at)) {
    throw new Error('rsi_final_apply_observation_predates_invocation');
  }

  let transaction = null;
  let classification;
  if (transaction_readback == null) {
    classification = Object.freeze({
      state: 'NO_TRANSACTION_READBACK_HOLD',
      reason: 'NO_DURABLE_TRANSACTION_READBACK',
      physical_effect_status: 'UNKNOWN',
      complete_effect_evidence: false,
      same_invocation_retry_allowed: false,
      terminal_reconciliation_required: true,
      qualification_resume_allowed: false,
      authority_effect: false,
    });
  } else {
    transaction = exactTransactionBinding(transaction_readback, admission, invocation);
    classification = classifyTransaction(transaction);
  }

  const terminal = transaction ? TERMINAL_TRANSACTION_STATES.has(transaction.state) : false;
  const qualified = classification.state === 'QUALIFIED_SUCCESSOR';
  const successorPending = classification.state === 'SUCCESSOR_BOOTED_PENDING_QUALIFICATION';
  const quarantinePending = classification.state === 'QUARANTINED_SUCCESSOR';
  const ambiguous = [
    'NO_TRANSACTION_READBACK_HOLD',
    'AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
    'PHYSICAL_EFFECT_ATTEMPTED_PENDING_SUCCESSOR_READBACK',
    'CORRUPT_EFFECT_EVIDENCE_HOLD',
  ].includes(classification.state);

  const core = zeroAuthority({
    schema: RSI_SELF_UPDATE_POST_EFFECT_READBACK_SCHEMA,
    version: 1,
    state: classification.state,
    reason: classification.reason,
    final_install_admission_digest: admission.final_install_admission_digest,
    invocation_receipt_digest: invocation.invocation_receipt_digest,
    invocation_id: invocation.invocation_id,
    candidate_sha: admission.candidate_sha,
    previous_authority_sha: admission.previous_authority_sha,
    target_release_version: admission.target_release_version,
    observed_at: observedAt,
    observer_id: safeId(observer_id, 'observer_id'),
    external_transaction_reader: true,
    authored_by_candidate: false,
    transaction,
    transaction_present: transaction != null,
    transaction_terminal: terminal,
    physical_effect_status: classification.physical_effect_status,
    effect_barrier_crossed: classification.effect_barrier_crossed === true,
    complete_effect_evidence: classification.complete_effect_evidence === true,
    qualified_successor: qualified,
    successor_qualification_resume_allowed: successorPending || quarantinePending,
    terminal_reconciliation_required: classification.terminal_reconciliation_required === true,
    ambiguous_or_pending_effect: ambiguous,
    same_invocation_retry_allowed: false,
    fresh_physical_effect_retry_allowed: false,
    automatic_install_retry_allowed: false,
    successor_startup_readback_required: !qualified,
    existing_successor_qualification_pipeline_required: successorPending || quarantinePending,
    existing_ambiguous_recovery_pipeline_required:
      classification.state === 'AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
    installer_success_claimed_from_invocation_receipt: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, post_effect_readback_digest: digest(core) });
}

export function verifyRsiSelfUpdatePostEffectReadback(row) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || row.schema !== RSI_SELF_UPDATE_POST_EFFECT_READBACK_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_final_apply_post_effect_schema_invalid');
  }
  assertZeroAuthority(row, 'post_effect');
  if (
    row.external_transaction_reader !== true
    || row.authored_by_candidate !== false
    || row.same_invocation_retry_allowed !== false
    || row.fresh_physical_effect_retry_allowed !== false
    || row.automatic_install_retry_allowed !== false
    || row.installer_success_claimed_from_invocation_receipt !== false
    || row.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_final_apply_post_effect_policy_invalid');
  }
  if (![
    'NO_TRANSACTION_READBACK_HOLD',
    'NO_EFFECT_BARRIER_NOT_CROSSED',
    'PHYSICAL_EFFECT_ATTEMPTED_PENDING_SUCCESSOR_READBACK',
    'SUCCESSOR_BOOTED_PENDING_QUALIFICATION',
    'QUALIFIED_SUCCESSOR',
    'AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
    'QUARANTINED_SUCCESSOR',
    'SUPERSEDED_ATTEMPT',
    'CORRUPT_EFFECT_EVIDENCE_HOLD',
  ].includes(row.state)) {
    throw new Error('rsi_final_apply_post_effect_state_invalid');
  }
  exactDigest(row.final_install_admission_digest, 'final_install_admission');
  exactDigest(row.invocation_receipt_digest, 'invocation_receipt');
  safeId(row.invocation_id, 'invocation_id');
  exactSha(row.candidate_sha, 'candidate');
  exactSha(row.previous_authority_sha, 'previous_authority');
  exactUtc(row.observed_at, 'observed_at');
  safeId(row.observer_id, 'observer_id');

  if ((row.transaction == null) !== (row.transaction_present === false)) {
    throw new Error('rsi_final_apply_post_effect_transaction_presence_invalid');
  }
  if (row.state === 'QUALIFIED_SUCCESSOR' && row.qualified_successor !== true) {
    throw new Error('rsi_final_apply_post_effect_qualified_flag_invalid');
  }
  if (row.state !== 'QUALIFIED_SUCCESSOR' && row.qualified_successor !== false) {
    throw new Error('rsi_final_apply_post_effect_nonqualified_flag_invalid');
  }
  if (row.state === 'SUCCESSOR_BOOTED_PENDING_QUALIFICATION' && row.existing_successor_qualification_pipeline_required !== true) {
    throw new Error('rsi_final_apply_post_effect_successor_pipeline_invalid');
  }
  if (row.state === 'AMBIGUOUS_INSTALL_RECONCILIATION_ONLY' && row.existing_ambiguous_recovery_pipeline_required !== true) {
    throw new Error('rsi_final_apply_post_effect_ambiguous_pipeline_invalid');
  }
  if (row.transaction?.state === 'INSTALLING' && row.complete_effect_evidence !== true && row.state !== 'CORRUPT_EFFECT_EVIDENCE_HOLD') {
    throw new Error('rsi_final_apply_post_effect_installing_evidence_invalid');
  }

  const clone = structuredClone(row);
  const claimed = exactDigest(clone.post_effect_readback_digest, 'post_effect_readback');
  delete clone.post_effect_readback_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_final_apply_post_effect_digest_mismatch');
  return row;
}

export function rsiSelfUpdateFinalApplyReadbackTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.self-update-final-apply-readback-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-self-update-final-apply-readback.mjs',
    final_install_admission_path: 'apps/metaengine-browser/src/rsi-self-update-final-install-cycle-admission.mjs',
    self_update_transaction_journal_path: 'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    ambiguous_successor_recovery_path: 'apps/metaengine-browser/src/self-update-ambiguous-successor-recovery.mjs',
    successor_qualification_path: 'apps/metaengine-browser/src/self-update-successor-qualification.mjs',
    external_one_shot_invocation_receipt_required: true,
    candidate_authored_invocation_receipt_forbidden: true,
    invocation_receipt_cannot_claim_effect_success: true,
    durable_transaction_readback_is_effect_truth: true,
    write_ahead_barrier_evidence_required_for_attempted_effect: true,
    successor_qualification_uses_existing_pipeline: true,
    ambiguous_install_uses_existing_recovery_pipeline: true,
    same_invocation_retry_allowed: false,
    fresh_physical_effect_retry_allowed: false,
    automatic_install_retry_allowed: false,
    candidate_can_modify_readback_root: false,
    physical_effect_replay_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, final_apply_readback_root_digest: digest(root) });
}
