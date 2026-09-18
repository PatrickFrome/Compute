import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSelfUpdateFinalApplyInvocationReceipt,
  verifyRsiSelfUpdateFinalApplyInvocationReceipt,
  createRsiSelfUpdatePostEffectReadback,
  verifyRsiSelfUpdatePostEffectReadback,
  rsiSelfUpdateFinalApplyReadbackTrustRootSnapshot,
} from '../src/rsi-self-update-final-apply-readback.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

const CANDIDATE = 'b'.repeat(40);
const PREVIOUS = 'a'.repeat(40);
const CURRENT = '0.7.0-dev.35330209177.1';
const TARGET = '0.7.0-dev.99999999999.1';
const INVOKED_AT = '2026-09-18T19:40:00.000Z';

function finalAdmission() {
  const core = {
    schema: 'metaengine.rsi.self-update-final-install-cycle-admission.v1',
    version: 1,
    state: 'READY_FOR_EXTERNAL_FINAL_APPLY_INVOCATION_REVIEW',
    probe_outcome_digest: 'sha256:' + '1'.repeat(64),
    probe_admission_digest: 'sha256:' + '2'.repeat(64),
    download_readiness_digest: 'sha256:' + '3'.repeat(64),
    candidate_sha: CANDIDATE,
    previous_authority_sha: PREVIOUS,
    target_release_tag: 'v' + TARGET,
    target_release_version: TARGET,
    target_installer_sha256: 'sha256:' + '4'.repeat(64),
    target_manifest_sha256: 'sha256:' + '5'.repeat(64),
    target_installed_executable_sha256: 'sha256:' + '6'.repeat(64),
    observed_at: '2026-09-18T19:39:59.000Z',
    observer_id: 'trusted-self-update-controller-v1',
    runtime: {
      schema: 'metaengine.self-update-runtime.v8',
      state: 'RESTART_GRACE',
      current_version: CURRENT,
      target_version: TARGET,
      resolved_git_sha: CANDIDATE,
      restart_gate_safe: true,
      restart_gate_since: '2026-09-18T19:39:40.000Z',
      restart_grace_ms: 12000,
      grace_elapsed_ms: 19000,
      install_attempted_version: null,
      pre_install_receipt_persisted: false,
      installer_handoff_prepared: false,
      runtime_snapshot_digest: 'sha256:' + '7'.repeat(64),
      authority_effect: false,
    },
    prior_transaction: {
      present: true,
      state: 'QUALIFIED',
      transaction_id: 'prior-qualified-final-apply-v1',
      target_version: CURRENT,
      authority_effect: false,
    },
    host_resilience: {
      schema: 'metaengine.host-resilience-runtime.v7',
      state: 'ACTIVE',
      external_stop_requested: false,
      sentinel_worker_healthy: true,
      sentinel_worker_ready: true,
      sentinel_bootstrap_retry_pending: false,
      snapshot_digest: 'sha256:' + '8'.repeat(64),
      authority_effect: false,
    },
    trusted_release: {
      schema: 'metaengine.trusted-dev-release.v1',
      version: TARGET,
      tag: 'v' + TARGET,
      git_sha: CANDIDATE,
      feed_url: 'https://github.com/PatrickFrome/Compute/releases/download/v' + TARGET + '/',
      installer_name: 'METAENGINE-Browser-Test-Setup-' + TARGET + '-x64.exe',
      installer_sha256: 'sha256:' + '4'.repeat(64),
      manifest_sha256: 'sha256:' + '5'.repeat(64),
      installed_executable_sha256: 'sha256:' + '6'.repeat(64),
      target_present_proof_supported: true,
      authority_effect: false,
    },
    exact_candidate_chain_verified: true,
    restart_gate_safe_reverified: true,
    restart_grace_elapsed_reverified: true,
    no_install_effect_yet_verified: true,
    external_self_update_controller_required: true,
    existing_self_update_runtime_method: 'applyWhenSafe',
    admitted_final_cycle_count: 1,
    single_final_apply_cycle_only: true,
    final_apply_invoked: false,
    final_apply_authorized_by_rsi: false,
    before_install_receipt_required: true,
    self_update_transaction_schema: 'metaengine.self-update.transaction.v1',
    install_effect_barrier: 'WRITE_AHEAD_V1',
    install_effect_scope: 'BROWSER_RESTART',
    install_actuator: 'ELECTRON_UPDATER_QUIT_AND_INSTALL',
    expected_effect_order: [
      'PERSIST_PRE_INSTALL_RECEIPT_AND_TRANSACTION',
      'PREPARE_EXPECTED_RESTART',
      'PREPARE_INSTALLER_HANDOFF',
      'CROSS_WRITE_AHEAD_INSTALL_EFFECT_BARRIER',
      'ELECTRON_QUIT_AND_INSTALL',
    ],
    one_attempt_physical_effect_required: true,
    post_effect_transaction_readback_required: true,
    successor_startup_readback_required: true,
    ambiguous_install_reconciliation_only: true,
    automatic_install_retry_allowed: false,
    installer_launch_authorized_by_rsi: false,
    physical_effect_replay_allowed: false,
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
  };
  return { ...core, final_install_admission_digest: digest(core) };
}

function invocation(admission = finalAdmission()) {
  return createRsiSelfUpdateFinalApplyInvocationReceipt({
    final_install_admission: admission,
    invocation_id: 'final-apply-invocation-v1',
    invoked_at: INVOKED_AT,
    controller_id: 'trusted-self-update-controller-v1',
    external_controller_verified: true,
    authored_by_candidate: false,
    invocation_count: 1,
  });
}

function effectEvidence() {
  return {
    effect_barrier_contract: 'WRITE_AHEAD_V1',
    effect_scope: 'BROWSER_RESTART',
    actuator_type: 'ELECTRON_UPDATER_QUIT_AND_INSTALL',
    physical_effect_attempted: true,
    effect_barrier_crossed: true,
    effect_must_be_single_shot: true,
    post_effect_readback_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function transaction(state, overrides = {}) {
  const qualified = state === 'QUALIFIED';
  const quarantined = state === 'QUARANTINED';
  const withEffect = !['PREPARED'].includes(state);
  return {
    schema: 'metaengine.self-update.transaction.v1',
    transaction_id: 'final-apply-transaction-v1',
    source_version: CURRENT,
    target_version: TARGET,
    resolved_git_sha: CANDIDATE,
    state,
    swapping: !['SUCCESSOR_BOOTED', 'QUALIFIED', 'QUARANTINED', 'SUPERSEDED'].includes(state),
    qualified,
    quarantined,
    attempt_count: 1,
    automatic_retry_allowed: false,
    created_at: '2026-09-18T19:40:00.100Z',
    updated_at: '2026-09-18T19:40:01.000Z',
    evidence: withEffect ? effectEvidence() : {},
    authority_effect: false,
    ...overrides,
  };
}

function readbackFor(txn, overrides = {}) {
  const admission = finalAdmission();
  const receipt = invocation(admission);
  return createRsiSelfUpdatePostEffectReadback({
    final_install_admission: admission,
    invocation_receipt: receipt,
    transaction_readback: txn,
    observed_at: '2026-09-18T19:40:02.000Z',
    observer_id: 'trusted-transaction-reader-v1',
    external_transaction_reader: true,
    authored_by_candidate: false,
    ...overrides,
  });
}

test('external final apply receipt is one-shot and cannot claim installer success', () => {
  const admission = finalAdmission();
  const receipt = invocation(admission);
  verifyRsiSelfUpdateFinalApplyInvocationReceipt(receipt, { final_install_admission: admission });
  assert.equal(receipt.runtime_method, 'applyWhenSafe');
  assert.equal(receipt.invocation_count, 1);
  assert.equal(receipt.retry_budget, 0);
  assert.equal(receipt.physical_effect_outcome_asserted, false);
  assert.equal(receipt.installer_success_claimed, false);
  assert.equal(receipt.same_invocation_retry_allowed, false);
  assert.equal(receipt.transaction_readback_required, true);
  assert.equal(receipt.successor_startup_readback_required, true);
});

test('candidate-authored or repeated final apply receipts are rejected', () => {
  const admission = finalAdmission();
  assert.throws(() => createRsiSelfUpdateFinalApplyInvocationReceipt({
    final_install_admission: admission,
    invocation_id: 'candidate-final-apply-v1',
    invoked_at: INVOKED_AT,
    controller_id: 'trusted-self-update-controller-v1',
    external_controller_verified: true,
    authored_by_candidate: true,
    invocation_count: 1,
  }), /external_controller_required/);
  assert.throws(() => createRsiSelfUpdateFinalApplyInvocationReceipt({
    final_install_admission: admission,
    invocation_id: 'repeated-final-apply-v1',
    invoked_at: INVOKED_AT,
    controller_id: 'trusted-self-update-controller-v1',
    external_controller_verified: true,
    authored_by_candidate: false,
    invocation_count: 2,
  }), /invocation_count_invalid/);
});

test('missing transaction readback is an unknown hold, never a retry signal', () => {
  const row = readbackFor(null);
  verifyRsiSelfUpdatePostEffectReadback(row);
  assert.equal(row.state, 'NO_TRANSACTION_READBACK_HOLD');
  assert.equal(row.transaction_present, false);
  assert.equal(row.physical_effect_status, 'UNKNOWN');
  assert.equal(row.terminal_reconciliation_required, true);
  assert.equal(row.same_invocation_retry_allowed, false);
  assert.equal(row.fresh_physical_effect_retry_allowed, false);
});

test('PREPARED proves barrier was not crossed but still requires terminal reconciliation before any fresh cycle', () => {
  const row = readbackFor(transaction('PREPARED'));
  assert.equal(row.state, 'NO_EFFECT_BARRIER_NOT_CROSSED');
  assert.equal(row.physical_effect_status, 'NOT_RECORDED');
  assert.equal(row.effect_barrier_crossed, false);
  assert.equal(row.terminal_reconciliation_required, true);
  assert.equal(row.same_invocation_retry_allowed, false);
});

test('INSTALLING with complete write-ahead evidence records one attempted effect and forbids retry', () => {
  const row = readbackFor(transaction('INSTALLING'));
  assert.equal(row.state, 'PHYSICAL_EFFECT_ATTEMPTED_PENDING_SUCCESSOR_READBACK');
  assert.equal(row.physical_effect_status, 'ATTEMPTED');
  assert.equal(row.complete_effect_evidence, true);
  assert.equal(row.effect_barrier_crossed, true);
  assert.equal(row.ambiguous_or_pending_effect, true);
  assert.equal(row.same_invocation_retry_allowed, false);
  assert.equal(row.fresh_physical_effect_retry_allowed, false);
  assert.equal(row.successor_startup_readback_required, true);
});

test('INSTALLING without complete barrier evidence becomes corrupt-evidence hold', () => {
  const row = readbackFor(transaction('INSTALLING', {
    evidence: { physical_effect_attempted: true, effect_barrier_crossed: true },
  }));
  assert.equal(row.state, 'CORRUPT_EFFECT_EVIDENCE_HOLD');
  assert.equal(row.physical_effect_status, 'UNKNOWN');
  assert.equal(row.terminal_reconciliation_required, true);
});

test('SUCCESSOR_BOOTED hands off only to the existing successor qualification pipeline', () => {
  const row = readbackFor(transaction('SUCCESSOR_BOOTED'));
  assert.equal(row.state, 'SUCCESSOR_BOOTED_PENDING_QUALIFICATION');
  assert.equal(row.successor_qualification_resume_allowed, true);
  assert.equal(row.existing_successor_qualification_pipeline_required, true);
  assert.equal(row.terminal_reconciliation_required, false);
  assert.equal(row.successor_startup_readback_required, true);
});

test('QUALIFIED is the only successful terminal successor state', () => {
  const row = readbackFor(transaction('QUALIFIED'));
  verifyRsiSelfUpdatePostEffectReadback(row);
  assert.equal(row.state, 'QUALIFIED_SUCCESSOR');
  assert.equal(row.transaction_terminal, true);
  assert.equal(row.qualified_successor, true);
  assert.equal(row.successor_startup_readback_required, false);
  assert.equal(row.ambiguous_or_pending_effect, false);
});

test('AMBIGUOUS_INSTALL is reconciliation-only even with complete effect evidence', () => {
  const row = readbackFor(transaction('AMBIGUOUS_INSTALL'));
  assert.equal(row.state, 'AMBIGUOUS_INSTALL_RECONCILIATION_ONLY');
  assert.equal(row.physical_effect_status, 'ATTEMPTED');
  assert.equal(row.existing_ambiguous_recovery_pipeline_required, true);
  assert.equal(row.terminal_reconciliation_required, true);
  assert.equal(row.same_invocation_retry_allowed, false);
  assert.equal(row.fresh_physical_effect_retry_allowed, false);
});

test('QUARANTINED may resume qualification only; it never authorizes another installer attempt', () => {
  const row = readbackFor(transaction('QUARANTINED'));
  assert.equal(row.state, 'QUARANTINED_SUCCESSOR');
  assert.equal(row.transaction_terminal, true);
  assert.equal(row.successor_qualification_resume_allowed, true);
  assert.equal(row.existing_successor_qualification_pipeline_required, true);
  assert.equal(row.same_invocation_retry_allowed, false);
});

test('SUPERSEDED is terminal and non-authoritative for a new physical effect', () => {
  const row = readbackFor(transaction('SUPERSEDED'));
  assert.equal(row.state, 'SUPERSEDED_ATTEMPT');
  assert.equal(row.transaction_terminal, true);
  assert.equal(row.qualified_successor, false);
  assert.equal(row.same_invocation_retry_allowed, false);
  assert.equal(row.fresh_physical_effect_retry_allowed, false);
});

test('transaction identity, target, source and time must bind to the exact final admission and invocation', () => {
  for (const txn of [
    transaction('INSTALLING', { target_version: '0.7.0-dev.88888888888.1' }),
    transaction('INSTALLING', { source_version: '0.7.0-dev.11111111111.1' }),
    transaction('INSTALLING', { resolved_git_sha: 'f'.repeat(40) }),
    transaction('INSTALLING', { created_at: '2026-09-18T19:39:59.000Z' }),
  ]) {
    assert.throws(() => readbackFor(txn), /(binding_mismatch|predates_invocation)/);
  }
});

test('post-effect readback cannot be widened into retry or authority', () => {
  const base = readbackFor(transaction('INSTALLING'));
  for (const mutate of [
    (x) => { x.same_invocation_retry_allowed = true; },
    (x) => { x.fresh_physical_effect_retry_allowed = true; },
    (x) => { x.automatic_install_retry_allowed = true; },
    (x) => { x.physical_effect_replay_allowed = true; },
    (x) => { x.self_update_authority = true; },
  ]) {
    const copy = structuredClone(base);
    mutate(copy);
    assert.throws(() => verifyRsiSelfUpdatePostEffectReadback(copy), /(policy_invalid|self_update_authority_invalid)/);
  }
});

test('final apply readback trust root keeps effect truth in durable transaction state', () => {
  const root = rsiSelfUpdateFinalApplyReadbackTrustRootSnapshot();
  assert.equal(root.external_one_shot_invocation_receipt_required, true);
  assert.equal(root.candidate_authored_invocation_receipt_forbidden, true);
  assert.equal(root.invocation_receipt_cannot_claim_effect_success, true);
  assert.equal(root.durable_transaction_readback_is_effect_truth, true);
  assert.equal(root.write_ahead_barrier_evidence_required_for_attempted_effect, true);
  assert.equal(root.successor_qualification_uses_existing_pipeline, true);
  assert.equal(root.ambiguous_install_uses_existing_recovery_pipeline, true);
  assert.equal(root.same_invocation_retry_allowed, false);
  assert.equal(root.fresh_physical_effect_retry_allowed, false);
  assert.equal(root.candidate_can_modify_readback_root, false);
});
