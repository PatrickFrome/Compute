import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateCheckAdmission,
} from './rsi-self-update-controller-admission.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
} from './self-update-transaction-journal.mjs';

export const RSI_SELF_UPDATE_DOWNLOAD_READINESS_SCHEMA = 'metaengine.rsi.self-update-download-readiness.v1';

const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$/;

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
  if (!SHA40.test(out)) throw new Error('rsi_download_readiness_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256.test(out)) throw new Error('rsi_download_readiness_' + label + '_digest_invalid');
  return out;
}

function exactHex(value, label) {
  const out = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!HEX64.test(out)) throw new Error('rsi_download_readiness_' + label + '_digest_invalid');
  return out;
}

function exactUtc(value, label) {
  const out = String(value || '');
  if (!UTC.test(out) || !Number.isFinite(Date.parse(out))) throw new Error('rsi_download_readiness_' + label + '_time_invalid');
  return new Date(Date.parse(out)).toISOString();
}

function safeId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID.test(out)) throw new Error('rsi_download_readiness_' + label + '_invalid');
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
      throw new Error('rsi_download_readiness_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_download_readiness_' + label + '_automatic_retry_invalid');
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

function verifyTerminalPrior(prior, admission) {
  const expected = admission?.prior_transaction;
  if (prior == null) {
    if (expected?.present !== false || expected?.state !== 'NONE') {
      throw new Error('rsi_download_readiness_prior_transaction_disappeared');
    }
    return Object.freeze({ present:false, state:'NONE', transaction_id:null, target_version:null, authority_effect:false });
  }
  if (!prior || typeof prior !== 'object' || Array.isArray(prior) || prior.schema !== SELF_UPDATE_TRANSACTION_SCHEMA) {
    throw new Error('rsi_download_readiness_prior_transaction_schema_invalid');
  }
  if (prior.authority_effect !== false || prior.automatic_retry_allowed !== false) {
    throw new Error('rsi_download_readiness_prior_transaction_authority_invalid');
  }
  const state = String(prior.state || '').toUpperCase();
  if (!['QUALIFIED','SUPERSEDED'].includes(state)) {
    throw new Error('rsi_download_readiness_unresolved_prior:' + state);
  }
  const transactionId = safeId(prior.transaction_id, 'prior_transaction_id');
  const targetVersion = prior.target_version == null ? null : String(prior.target_version);
  if (targetVersion != null && !DEV_VERSION.test(targetVersion)) {
    throw new Error('rsi_download_readiness_prior_target_version_invalid');
  }
  if (
    expected?.present !== true
    || expected.state !== state
    || expected.transaction_id !== transactionId
    || expected.target_version !== targetVersion
  ) {
    throw new Error('rsi_download_readiness_prior_transaction_drift');
  }
  return Object.freeze({
    present:true,
    state,
    transaction_id:transactionId,
    target_version:targetVersion,
    authority_effect:false,
  });
}

function verifyHost(host) {
  if (!host || typeof host !== 'object' || Array.isArray(host) || host.schema !== 'metaengine.host-resilience-runtime.v7') {
    throw new Error('rsi_download_readiness_host_schema_invalid');
  }
  if (host.authority_effect !== false) throw new Error('rsi_download_readiness_host_authority_invalid');
  if (
    host.state !== 'ACTIVE'
    || host.external_stop_requested !== false
    || host.sentinel_worker_healthy !== true
    || host.sentinel?.worker_ready !== true
    || host.sentinel_bootstrap_retry_pending === true
  ) {
    throw new Error('rsi_download_readiness_host_not_ready');
  }
  return Object.freeze({
    schema:host.schema,
    state:'ACTIVE',
    external_stop_requested:false,
    sentinel_worker_healthy:true,
    sentinel_worker_ready:true,
    sentinel_bootstrap_retry_pending:false,
    snapshot_digest:digest(host),
    authority_effect:false,
  });
}

function verifyTrustedRelease(release, admission) {
  if (!release || typeof release !== 'object' || Array.isArray(release) || release.schema !== 'metaengine.trusted-dev-release.v1') {
    throw new Error('rsi_download_readiness_trusted_release_invalid');
  }
  if (release.authority_effect !== false) throw new Error('rsi_download_readiness_trusted_release_authority_invalid');
  if (
    String(release.version || '') !== admission.target_release_version
    || String(release.tag || '') !== admission.target_release_tag
    || exactSha(release.git_sha, 'release_source') !== admission.candidate_sha
  ) {
    throw new Error('rsi_download_readiness_trusted_release_identity_mismatch');
  }
  if (
    'sha256:' + exactHex(release.installer_sha256, 'installer') !== admission.target_installer_sha256
    || 'sha256:' + exactHex(release.manifest_sha256, 'manifest') !== admission.target_manifest_sha256
    || 'sha256:' + exactHex(release.installed_executable_sha256, 'installed_executable') !== admission.target_installed_executable_sha256
    || release.target_present_proof_supported !== true
  ) {
    throw new Error('rsi_download_readiness_trusted_release_digest_mismatch');
  }
  const feedUrl = String(release.feed_url || '').trim();
  if (!feedUrl || !feedUrl.startsWith('https://github.com/PatrickFrome/Compute/releases/download/')) {
    throw new Error('rsi_download_readiness_release_feed_invalid');
  }
  return Object.freeze({
    schema:release.schema,
    version:admission.target_release_version,
    tag:admission.target_release_tag,
    git_sha:admission.candidate_sha,
    feed_url:feedUrl,
    installer_name:String(release.installer_name || ''),
    installer_sha256:admission.target_installer_sha256,
    manifest_sha256:admission.target_manifest_sha256,
    installed_executable_sha256:admission.target_installed_executable_sha256,
    target_present_proof_supported:true,
    authority_effect:false,
  });
}

function verifyDownloadedRuntime(snapshot, admission, release, host) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.schema !== 'metaengine.self-update-runtime.v8') {
    throw new Error('rsi_download_readiness_runtime_schema_invalid');
  }
  if (snapshot.authority_effect !== false) throw new Error('rsi_download_readiness_runtime_authority_invalid');
  if (
    snapshot.state !== 'READY_RESTART'
    || snapshot.control_plane_enabled !== true
    || snapshot.install_effect_quarantined === true
    || snapshot.ci_test_feed_active === true
    || snapshot.developer_emergency_requested === true
    || snapshot.developer_emergency_policy_bypass === true
  ) {
    throw new Error('rsi_download_readiness_runtime_state_invalid');
  }
  if (
    snapshot.current_version !== admission.runtime.current_version
    || snapshot.available_version !== admission.target_release_version
    || snapshot.downloaded_version !== admission.target_release_version
    || snapshot.metadata_verified !== true
    || snapshot.publisher_verified !== true
    || snapshot.release_resolution !== 'VERIFIED'
    || snapshot.resolved_tag !== admission.target_release_tag
    || exactSha(snapshot.resolved_git_sha, 'runtime_resolved_source') !== admission.candidate_sha
    || snapshot.resolved_feed_url !== release.feed_url
    || snapshot.candidate_file_count !== 1
    || Number(snapshot.download_percent) !== 100
  ) {
    throw new Error('rsi_download_readiness_candidate_binding_invalid');
  }
  if (
    snapshot.install_attempted_version != null
    || snapshot.pre_install_receipt_persisted !== false
    || snapshot.installer_handoff_prepared !== false
    || snapshot.restart_gate_safe !== false
    || snapshot.restart_gate_since != null
  ) {
    throw new Error('rsi_download_readiness_install_effect_already_started');
  }
  if (digest(snapshot.host_resilience) !== host.snapshot_digest) {
    throw new Error('rsi_download_readiness_host_binding_mismatch');
  }
  return Object.freeze({
    schema:snapshot.schema,
    state:'READY_RESTART',
    current_version:snapshot.current_version,
    available_version:snapshot.available_version,
    downloaded_version:snapshot.downloaded_version,
    metadata_verified:true,
    publisher_verified:true,
    release_resolution:'VERIFIED',
    resolved_tag:snapshot.resolved_tag,
    resolved_git_sha:snapshot.resolved_git_sha,
    resolved_feed_url:snapshot.resolved_feed_url,
    candidate_file_count:1,
    download_percent:100,
    install_attempted_version:null,
    pre_install_receipt_persisted:false,
    installer_handoff_prepared:false,
    restart_gate_safe:false,
    restart_gate_since:null,
    runtime_snapshot_digest:digest(snapshot),
    authority_effect:false,
  });
}

export function createRsiSelfUpdateDownloadReadiness({
  check_admission,
  post_check_runtime_snapshot,
  prior_transaction = null,
  trusted_release,
  observed_at,
  observer_id,
} = {}) {
  const admission = verifyRsiSelfUpdateCheckAdmission(check_admission);
  const host = verifyHost(post_check_runtime_snapshot?.host_resilience);
  const release = verifyTrustedRelease(trusted_release, admission);
  const runtime = verifyDownloadedRuntime(post_check_runtime_snapshot, admission, release, host);
  const prior = verifyTerminalPrior(prior_transaction, admission);

  const core = zeroAuthority({
    schema:RSI_SELF_UPDATE_DOWNLOAD_READINESS_SCHEMA,
    version:1,
    state:'READY_FOR_EXTERNAL_APPLY_CYCLE_REVIEW',
    check_admission_digest:admission.admission_digest,
    candidate_sha:admission.candidate_sha,
    previous_authority_sha:admission.previous_authority_sha,
    target_release_tag:admission.target_release_tag,
    target_release_version:admission.target_release_version,
    target_installer_sha256:admission.target_installer_sha256,
    target_manifest_sha256:admission.target_manifest_sha256,
    target_installed_executable_sha256:admission.target_installed_executable_sha256,
    observed_at:exactUtc(observed_at, 'observed_at'),
    observer_id:safeId(observer_id, 'observer_id'),
    runtime,
    prior_transaction:prior,
    host_resilience:host,
    trusted_release:release,
    exact_downloaded_candidate_verified:true,
    metadata_verified:true,
    publisher_verified:true,
    trusted_release_reverified_after_download:true,
    no_install_effect_attempted:true,
    external_self_update_controller_required:true,
    existing_self_update_runtime_method:'applyWhenSafe',
    restart_gate_must_be_evaluated_inside_existing_runtime:true,
    restart_grace_must_be_honored:true,
    prior_transaction_must_be_rechecked_before_install:true,
    host_resilience_must_be_rechecked_before_installer_handoff:true,
    apply_cycle_invoked:false,
    apply_cycle_authorized_by_rsi:false,
    restart_authorized:false,
    pre_install_receipt_authorized:false,
    installer_handoff_authorized:false,
    installer_launch_authorized:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze({ ...core, readiness_digest:digest(core) });
}

export function verifyRsiSelfUpdateDownloadReadiness(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== RSI_SELF_UPDATE_DOWNLOAD_READINESS_SCHEMA || row.version !== 1) {
    throw new Error('rsi_download_readiness_schema_invalid');
  }
  assertZeroAuthority(row, 'readiness');
  if (
    row.state !== 'READY_FOR_EXTERNAL_APPLY_CYCLE_REVIEW'
    || row.exact_downloaded_candidate_verified !== true
    || row.metadata_verified !== true
    || row.publisher_verified !== true
    || row.trusted_release_reverified_after_download !== true
    || row.no_install_effect_attempted !== true
    || row.external_self_update_controller_required !== true
    || row.existing_self_update_runtime_method !== 'applyWhenSafe'
    || row.restart_gate_must_be_evaluated_inside_existing_runtime !== true
    || row.restart_grace_must_be_honored !== true
    || row.prior_transaction_must_be_rechecked_before_install !== true
    || row.host_resilience_must_be_rechecked_before_installer_handoff !== true
    || row.apply_cycle_invoked !== false
    || row.apply_cycle_authorized_by_rsi !== false
    || row.restart_authorized !== false
    || row.pre_install_receipt_authorized !== false
    || row.installer_handoff_authorized !== false
    || row.installer_launch_authorized !== false
    || row.physical_effect_replay_allowed !== false
  ) throw new Error('rsi_download_readiness_policy_invalid');

  exactDigest(row.check_admission_digest, 'check_admission');
  exactSha(row.candidate_sha, 'candidate');
  exactSha(row.previous_authority_sha, 'previous_authority');
  if (!DEV_VERSION.test(String(row.target_release_version || '')) || row.target_release_tag !== 'v' + row.target_release_version) {
    throw new Error('rsi_download_readiness_target_release_invalid');
  }
  exactDigest(row.target_installer_sha256, 'installer');
  exactDigest(row.target_manifest_sha256, 'manifest');
  exactDigest(row.target_installed_executable_sha256, 'installed_executable');
  exactUtc(row.observed_at, 'observed_at');
  safeId(row.observer_id, 'observer_id');
  if (
    row.runtime?.state !== 'READY_RESTART'
    || row.runtime?.metadata_verified !== true
    || row.runtime?.publisher_verified !== true
    || row.runtime?.download_percent !== 100
    || row.runtime?.install_attempted_version !== null
    || row.runtime?.pre_install_receipt_persisted !== false
    || row.runtime?.installer_handoff_prepared !== false
    || row.runtime?.restart_gate_safe !== false
  ) throw new Error('rsi_download_readiness_runtime_summary_invalid');
  if (
    row.host_resilience?.state !== 'ACTIVE'
    || row.host_resilience?.sentinel_worker_healthy !== true
    || row.host_resilience?.sentinel_worker_ready !== true
  ) throw new Error('rsi_download_readiness_host_summary_invalid');
  if (!['NONE','QUALIFIED','SUPERSEDED'].includes(row.prior_transaction?.state)) {
    throw new Error('rsi_download_readiness_prior_summary_invalid');
  }

  const clone=structuredClone(row);
  const claimed=exactDigest(clone.readiness_digest, 'readiness');
  delete clone.readiness_digest;
  if (digest(clone)!==claimed) throw new Error('rsi_download_readiness_digest_mismatch');
  return row;
}

export function rsiSelfUpdateDownloadReadinessTrustRootSnapshot() {
  const root={
    schema:'metaengine.rsi.self-update-download-readiness-root.v1',
    version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-self-update-download-readiness.mjs',
    check_admission_path:'apps/metaengine-browser/src/rsi-self-update-controller-admission.mjs',
    self_update_runtime_path:'apps/metaengine-browser/src/self-update-runtime-v8.mjs',
    transaction_journal_path:'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    host_resilience_runtime_path:'apps/metaengine-browser/src/host-resilience-runtime.mjs',
    trusted_release_resolver_path:'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
    exact_downloaded_candidate_required:true,
    publisher_and_metadata_verification_required:true,
    no_install_effect_before_readiness:true,
    external_apply_controller_required:true,
    restart_gate_owned_by_existing_runtime:true,
    restart_grace_required:true,
    prior_transaction_recheck_required:true,
    host_resilience_recheck_required:true,
    apply_cycle_authorized_by_rsi:false,
    installer_launch_authorized:false,
    candidate_can_modify_readiness_root:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    release_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({ ...root, download_readiness_root_digest:digest(root) });
}
