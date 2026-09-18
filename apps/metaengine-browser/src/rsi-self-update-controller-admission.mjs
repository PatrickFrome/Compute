import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateEligibilityReview,
} from './rsi-release-promotion-outcome-ingest.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
} from './self-update-transaction-journal.mjs';

export const RSI_SELF_UPDATE_CHECK_ADMISSION_SCHEMA = 'metaengine.rsi.self-update-check-admission.v1';

const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,191}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

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
  if (!SHA40.test(out)) throw new Error('rsi_self_update_admission_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256.test(out)) throw new Error('rsi_self_update_admission_' + label + '_digest_invalid');
  return out;
}

function exactUtc(value, label) {
  const out = String(value || '');
  if (!UTC.test(out) || !Number.isFinite(Date.parse(out))) {
    throw new Error('rsi_self_update_admission_' + label + '_time_invalid');
  }
  return new Date(Date.parse(out)).toISOString();
}

function safeId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID.test(out)) throw new Error('rsi_self_update_admission_' + label + '_invalid');
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
      throw new Error('rsi_self_update_admission_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_self_update_admission_' + label + '_automatic_retry_invalid');
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

function verifyPriorTransaction(prior, currentVersion) {
  if (prior == null) {
    return Object.freeze({
      present: false,
      state: 'NONE',
      transaction_id: null,
      target_version: null,
      resolved_git_sha: null,
      readback_safe_for_new_check: true,
      unresolved_prior: false,
      authority_effect: false,
    });
  }
  if (!prior || typeof prior !== 'object' || Array.isArray(prior) || prior.schema !== SELF_UPDATE_TRANSACTION_SCHEMA) {
    throw new Error('rsi_self_update_admission_prior_transaction_schema_invalid');
  }
  if (prior.authority_effect !== false || prior.automatic_retry_allowed !== false) {
    throw new Error('rsi_self_update_admission_prior_transaction_authority_invalid');
  }
  const state = String(prior.state || '').toUpperCase();
  if (!['QUALIFIED','SUPERSEDED'].includes(state)) {
    throw new Error('rsi_self_update_admission_unresolved_prior:' + state);
  }
  const targetVersion = String(prior.target_version || '');
  if (targetVersion && !DEV_VERSION.test(targetVersion)) {
    throw new Error('rsi_self_update_admission_prior_target_version_invalid');
  }
  const resolvedGitSha = prior.resolved_git_sha == null ? null : exactSha(prior.resolved_git_sha, 'prior_resolved_git');
  if (state === 'QUALIFIED' && targetVersion !== currentVersion) {
    throw new Error('rsi_self_update_admission_qualified_prior_current_version_mismatch');
  }
  return Object.freeze({
    present: true,
    state,
    transaction_id: safeId(prior.transaction_id, 'prior_transaction_id'),
    target_version: targetVersion || null,
    resolved_git_sha: resolvedGitSha,
    readback_safe_for_new_check: true,
    unresolved_prior: false,
    authority_effect: false,
  });
}

function verifyHostResilience(host) {
  if (!host || typeof host !== 'object' || Array.isArray(host) || host.schema !== 'metaengine.host-resilience-runtime.v7') {
    throw new Error('rsi_self_update_admission_host_resilience_schema_invalid');
  }
  if (host.authority_effect !== false) throw new Error('rsi_self_update_admission_host_resilience_authority_invalid');
  if (
    host.state !== 'ACTIVE'
    || host.external_stop_requested !== false
    || host.sentinel_worker_healthy !== true
    || host.sentinel?.worker_ready !== true
    || host.sentinel_bootstrap_retry_pending === true
  ) {
    throw new Error('rsi_self_update_admission_host_resilience_not_ready');
  }
  return Object.freeze({
    schema: host.schema,
    state: host.state,
    external_stop_requested: false,
    sentinel_worker_healthy: true,
    sentinel_worker_ready: true,
    sentinel_bootstrap_retry_pending: false,
    host_snapshot_digest: digest(host),
    authority_effect: false,
  });
}

function verifyRuntimeSnapshot(snapshot, review, host) {
  if (
    !snapshot
    || typeof snapshot !== 'object'
    || Array.isArray(snapshot)
    || snapshot.schema !== 'metaengine.self-update-runtime.v8'
  ) {
    throw new Error('rsi_self_update_admission_runtime_schema_invalid');
  }
  if (snapshot.authority_effect !== false) throw new Error('rsi_self_update_admission_runtime_authority_invalid');
  const currentVersion = String(snapshot.current_version || '').trim();
  if (!DEV_VERSION.test(currentVersion)) throw new Error('rsi_self_update_admission_current_version_invalid');
  if (currentVersion === review.release_version) throw new Error('rsi_self_update_admission_target_already_installed');
  if (
    snapshot.control_plane_enabled !== true
    || snapshot.install_effect_quarantined === true
    || snapshot.ci_test_feed_active === true
    || snapshot.developer_emergency_requested === true
    || snapshot.developer_emergency_policy_bypass === true
  ) {
    throw new Error('rsi_self_update_admission_runtime_policy_hold');
  }
  const state = String(snapshot.state || '').toUpperCase();
  if (!['IDLE','CURRENT'].includes(state)) {
    throw new Error('rsi_self_update_admission_runtime_state_not_check_safe:' + state);
  }
  if (
    snapshot.available_version != null
    || snapshot.downloaded_version != null
    || snapshot.install_attempted_version != null
    || snapshot.pre_install_receipt_persisted !== false
    || snapshot.installer_handoff_prepared !== false
    || snapshot.restart_gate_safe !== false
  ) {
    throw new Error('rsi_self_update_admission_runtime_has_inflight_update_state');
  }
  const embeddedHost = snapshot.host_resilience;
  if (!embeddedHost || digest(embeddedHost) !== host.host_snapshot_digest) {
    throw new Error('rsi_self_update_admission_host_snapshot_binding_mismatch');
  }
  return Object.freeze({
    schema: snapshot.schema,
    state,
    current_version: currentVersion,
    control_plane_enabled: true,
    install_effect_quarantined: false,
    ci_test_feed_active: false,
    developer_emergency_requested: false,
    developer_emergency_policy_bypass: false,
    restart_gate_safe: false,
    pre_install_receipt_persisted: false,
    installer_handoff_prepared: false,
    runtime_snapshot_digest: digest(snapshot),
    authority_effect: false,
  });
}

export function createRsiSelfUpdateCheckAdmission({
  eligibility_review,
  self_update_runtime_snapshot,
  prior_transaction = null,
  observed_at,
  observer_id,
} = {}) {
  const review = verifyRsiSelfUpdateEligibilityReview(eligibility_review);
  const host = verifyHostResilience(self_update_runtime_snapshot?.host_resilience);
  const runtime = verifyRuntimeSnapshot(self_update_runtime_snapshot, review, host);
  const prior = verifyPriorTransaction(prior_transaction, runtime.current_version);

  const core = zeroAuthority({
    schema: RSI_SELF_UPDATE_CHECK_ADMISSION_SCHEMA,
    version: 1,
    state: 'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_INVOCATION_REVIEW',
    eligibility_review_digest: review.eligibility_review_digest,
    candidate_sha: exactSha(review.candidate_sha, 'candidate'),
    previous_authority_sha: exactSha(review.previous_authority_sha, 'previous_authority'),
    target_release_tag: review.release_tag,
    target_release_version: review.release_version,
    target_installer_sha256: exactDigest(review.installer_sha256, 'installer'),
    target_manifest_sha256: exactDigest(review.manifest_sha256, 'manifest'),
    target_installed_executable_sha256: exactDigest(review.installed_executable_sha256, 'installed_executable'),
    observed_at: exactUtc(observed_at, 'observed_at'),
    observer_id: safeId(observer_id, 'observer_id'),
    runtime,
    prior_transaction: prior,
    host_resilience: host,
    external_self_update_controller_required: true,
    existing_self_update_runtime_method: 'checkNow',
    fresh_trusted_release_reverification_inside_runtime_required: true,
    updater_feed_must_be_exact_trusted_release: true,
    metadata_reverification_required: true,
    download_may_begin_only_inside_existing_runtime: true,
    self_update_check_invoked: false,
    self_update_check_authorized_by_rsi: false,
    self_update_apply_authorized: false,
    restart_gate_authorized: false,
    pre_install_receipt_authorized: false,
    installer_handoff_authorized: false,
    installer_launch_authorized: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, admission_digest: digest(core) });
}

export function verifyRsiSelfUpdateCheckAdmission(row) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || row.schema !== RSI_SELF_UPDATE_CHECK_ADMISSION_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_self_update_admission_schema_invalid');
  }
  assertZeroAuthority(row, 'admission');
  if (
    row.state !== 'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_INVOCATION_REVIEW'
    || row.external_self_update_controller_required !== true
    || row.existing_self_update_runtime_method !== 'checkNow'
    || row.fresh_trusted_release_reverification_inside_runtime_required !== true
    || row.updater_feed_must_be_exact_trusted_release !== true
    || row.metadata_reverification_required !== true
    || row.download_may_begin_only_inside_existing_runtime !== true
    || row.self_update_check_invoked !== false
    || row.self_update_check_authorized_by_rsi !== false
    || row.self_update_apply_authorized !== false
    || row.restart_gate_authorized !== false
    || row.pre_install_receipt_authorized !== false
    || row.installer_handoff_authorized !== false
    || row.installer_launch_authorized !== false
    || row.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_self_update_admission_policy_invalid');
  }

  exactDigest(row.eligibility_review_digest, 'eligibility_review');
  exactSha(row.candidate_sha, 'candidate');
  exactSha(row.previous_authority_sha, 'previous_authority');
  if (!DEV_VERSION.test(String(row.target_release_version || '')) || row.target_release_tag !== 'v' + row.target_release_version) {
    throw new Error('rsi_self_update_admission_target_release_invalid');
  }
  exactDigest(row.target_installer_sha256, 'target_installer');
  exactDigest(row.target_manifest_sha256, 'target_manifest');
  exactDigest(row.target_installed_executable_sha256, 'target_installed_executable');
  exactUtc(row.observed_at, 'observed_at');
  safeId(row.observer_id, 'observer_id');

  if (
    row.runtime?.schema !== 'metaengine.self-update-runtime.v8'
    || row.runtime?.control_plane_enabled !== true
    || row.runtime?.install_effect_quarantined !== false
    || row.runtime?.restart_gate_safe !== false
    || row.runtime?.pre_install_receipt_persisted !== false
    || row.runtime?.installer_handoff_prepared !== false
  ) {
    throw new Error('rsi_self_update_admission_runtime_summary_invalid');
  }
  if (
    row.host_resilience?.schema !== 'metaengine.host-resilience-runtime.v7'
    || row.host_resilience?.state !== 'ACTIVE'
    || row.host_resilience?.external_stop_requested !== false
    || row.host_resilience?.sentinel_worker_healthy !== true
    || row.host_resilience?.sentinel_worker_ready !== true
  ) {
    throw new Error('rsi_self_update_admission_host_summary_invalid');
  }
  if (row.prior_transaction?.unresolved_prior !== false || row.prior_transaction?.readback_safe_for_new_check !== true) {
    throw new Error('rsi_self_update_admission_prior_summary_invalid');
  }

  const clone = structuredClone(row);
  const claimed = exactDigest(clone.admission_digest, 'admission');
  delete clone.admission_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_self_update_admission_digest_mismatch');
  return row;
}

export function rsiSelfUpdateCheckAdmissionTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.self-update-check-admission-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-self-update-controller-admission.mjs',
    eligibility_review_path: 'apps/metaengine-browser/src/rsi-release-promotion-outcome-ingest.mjs',
    self_update_runtime_path: 'apps/metaengine-browser/src/self-update-runtime-v8.mjs',
    self_update_transaction_journal_path: 'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    host_resilience_runtime_path: 'apps/metaengine-browser/src/host-resilience-runtime.mjs',
    external_self_update_controller_required: true,
    current_runtime_state_must_be_idle_or_current: true,
    unresolved_prior_transaction_forbidden: true,
    host_resilience_active_required: true,
    sentinel_worker_ready_required: true,
    ci_test_feed_forbidden: true,
    developer_emergency_bypass_forbidden: true,
    fresh_release_reverification_inside_runtime_required: true,
    self_update_check_authorized_by_rsi: false,
    self_update_apply_authorized: false,
    installer_launch_authorized: false,
    candidate_can_modify_admission_root: false,
    physical_effect_replay_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, self_update_check_admission_root_digest: digest(root) });
}
