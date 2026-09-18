import crypto from 'node:crypto';

import {
  verifyRsiReleasePromotionJournalIntent,
  verifyRsiReleasePromotionJournalEvents,
} from './rsi-release-promotion-journal.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
  SELF_UPDATE_INSTALL_EFFECT_SCOPE,
  SELF_UPDATE_INSTALL_ACTUATOR,
} from './self-update-transaction-journal.mjs';

export const RSI_RELEASE_AUTHORITY_READBACK_SCHEMA = 'metaengine.rsi.release-authority-readback.v1';
export const RSI_SELF_UPDATE_ELIGIBILITY_REVIEW_SCHEMA = 'metaengine.rsi.self-update-eligibility-review.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,191}$/;
const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;

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
  if (!SHA40.test(out)) throw new Error('rsi_self_update_review_' + label + '_sha_invalid');
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!HEX64.test(out)) throw new Error('rsi_self_update_review_' + label + '_digest_invalid');
  return 'sha256:' + out;
}

function exactUtc(value, label) {
  const out = String(value || '');
  if (!UTC.test(out) || !Number.isFinite(Date.parse(out))) {
    throw new Error('rsi_self_update_review_' + label + '_time_invalid');
  }
  return new Date(Date.parse(out)).toISOString();
}

function safeId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID.test(out)) throw new Error('rsi_self_update_review_' + label + '_invalid');
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
      throw new Error('rsi_self_update_review_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_self_update_review_' + label + '_automatic_retry_invalid');
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

function exactTrustedRelease(release, candidateSha, releaseTag, releaseVersion) {
  if (!release || typeof release !== 'object' || Array.isArray(release) || release.schema !== 'metaengine.trusted-dev-release.v1') {
    throw new Error('rsi_self_update_review_trusted_release_invalid');
  }
  if (release.authority_effect !== false) throw new Error('rsi_self_update_review_trusted_release_authority_invalid');
  const version = String(release.version || '').trim();
  const tag = String(release.tag || '').trim();
  if (!DEV_VERSION.test(version) || tag !== 'v' + version) throw new Error('rsi_self_update_review_trusted_release_version_invalid');
  if (version !== releaseVersion || tag !== releaseTag) throw new Error('rsi_self_update_review_trusted_release_identity_mismatch');
  if (exactSha(release.git_sha, 'trusted_release') !== candidateSha) {
    throw new Error('rsi_self_update_review_trusted_release_source_mismatch');
  }
  const installer = exactDigest(release.installer_sha256, 'installer');
  const manifest = exactDigest(release.manifest_sha256, 'manifest');
  const feed = exactDigest(release.dev_yml_sha256, 'dev_yml');
  const installed = exactDigest(release.installed_executable_sha256, 'installed_executable');
  if (release.target_present_proof_supported !== true) {
    throw new Error('rsi_self_update_review_installed_executable_binding_required');
  }
  return Object.freeze({
    version,
    tag,
    git_sha: candidateSha,
    installer_name: safeId(release.installer_name, 'installer_name'),
    installer_sha256: installer,
    manifest_sha256: manifest,
    dev_yml_sha256: feed,
    installed_executable_sha256: installed,
    target_present_proof_supported: true,
  });
}

export function createRsiReleaseAuthorityReadback({
  journal_intent,
  journal_events,
  observed_authority_sha,
  observed_at,
  observer_id,
  evidence_digest,
  external_authority_observer = false,
  authored_by_candidate = true,
} = {}) {
  const intent = verifyRsiReleasePromotionJournalIntent(journal_intent);
  const journal = verifyRsiReleasePromotionJournalEvents({
    journal_intent: intent,
    events: journal_events,
  });
  if (
    journal.state !== 'CONFIRMED_BY_INDEPENDENT_READBACK'
    || journal.confirmed_external_effect !== true
    || journal.terminal !== true
    || journal.reconciliation_required !== false
    || journal.release_authority_mutation_inferred_from_delivery !== false
  ) {
    throw new Error('rsi_self_update_review_release_promotion_not_confirmed');
  }
  if (external_authority_observer !== true || authored_by_candidate !== false) {
    throw new Error('rsi_self_update_review_external_authority_observer_required');
  }
  const authoritySha = exactSha(observed_authority_sha, 'observed_authority');
  if (authoritySha !== intent.candidate_sha) {
    throw new Error('rsi_self_update_review_authority_candidate_mismatch');
  }

  const core = zeroAuthority({
    schema: RSI_RELEASE_AUTHORITY_READBACK_SCHEMA,
    version: 1,
    journal_intent_digest: intent.journal_intent_digest,
    journal_readback_digest: journal.readback_digest,
    journal_chain_head_sha256: exactDigest(journal.chain_head_sha256, 'journal_chain_head'),
    effect_id: intent.effect_id,
    candidate_sha: intent.candidate_sha,
    previous_authority_sha: intent.previous_authority_sha,
    observed_authority_sha: authoritySha,
    release_tag: intent.release_tag,
    release_version: intent.release_version,
    observed_at: exactUtc(observed_at, 'observed_at'),
    observer_id: safeId(observer_id, 'observer_id'),
    evidence_digest: exactDigest(evidence_digest, 'authority_evidence'),
    external_authority_observer: true,
    authored_by_candidate: false,
    release_promotion_confirmed: true,
    exact_authority_readback: true,
    delivery_is_not_authority: true,
    independent_readback_required: true,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, authority_readback_digest: digest(core) });
}

export function verifyRsiReleaseAuthorityReadback(row, {
  journal_intent,
  journal_events,
} = {}) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || row.schema !== RSI_RELEASE_AUTHORITY_READBACK_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_self_update_review_authority_readback_schema_invalid');
  }
  assertZeroAuthority(row, 'authority_readback');
  if (
    row.external_authority_observer !== true
    || row.authored_by_candidate !== false
    || row.release_promotion_confirmed !== true
    || row.exact_authority_readback !== true
    || row.delivery_is_not_authority !== true
    || row.independent_readback_required !== true
    || row.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_self_update_review_authority_readback_policy_invalid');
  }
  const expected = createRsiReleaseAuthorityReadback({
    journal_intent,
    journal_events,
    observed_authority_sha: row.observed_authority_sha,
    observed_at: row.observed_at,
    observer_id: row.observer_id,
    evidence_digest: row.evidence_digest,
    external_authority_observer: true,
    authored_by_candidate: false,
  });
  if (JSON.stringify(stable(expected)) !== JSON.stringify(stable(row))) {
    throw new Error('rsi_self_update_review_authority_readback_mismatch');
  }
  return expected;
}

export function createRsiSelfUpdateEligibilityReview({
  journal_intent,
  journal_events,
  authority_readback,
  trusted_release,
} = {}) {
  const intent = verifyRsiReleasePromotionJournalIntent(journal_intent);
  const readback = verifyRsiReleaseAuthorityReadback(authority_readback, {
    journal_intent: intent,
    journal_events,
  });
  const release = exactTrustedRelease(
    trusted_release,
    intent.candidate_sha,
    intent.release_tag,
    intent.release_version,
  );

  if (
    readback.candidate_sha !== intent.candidate_sha
    || readback.observed_authority_sha !== intent.candidate_sha
    || readback.effect_id !== intent.effect_id
    || readback.journal_intent_digest !== intent.journal_intent_digest
  ) {
    throw new Error('rsi_self_update_review_exact_binding_mismatch');
  }

  const core = zeroAuthority({
    schema: RSI_SELF_UPDATE_ELIGIBILITY_REVIEW_SCHEMA,
    version: 1,
    state: 'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_REVIEW',
    candidate_sha: intent.candidate_sha,
    previous_authority_sha: intent.previous_authority_sha,
    release_tag: release.tag,
    release_version: release.version,
    installer_name: release.installer_name,
    installer_sha256: release.installer_sha256,
    manifest_sha256: release.manifest_sha256,
    dev_yml_sha256: release.dev_yml_sha256,
    installed_executable_sha256: release.installed_executable_sha256,
    journal_intent_digest: intent.journal_intent_digest,
    authority_readback_digest: readback.authority_readback_digest,
    release_promotion_confirmed: true,
    exact_release_authority_confirmed: true,
    trusted_release_reverified: true,
    installed_executable_binding_present: true,
    external_self_update_controller_required: true,
    existing_self_update_runtime_required: true,
    self_update_transaction_schema: SELF_UPDATE_TRANSACTION_SCHEMA,
    install_effect_barrier: SELF_UPDATE_INSTALL_EFFECT_BARRIER,
    install_effect_scope: SELF_UPDATE_INSTALL_EFFECT_SCOPE,
    install_actuator: SELF_UPDATE_INSTALL_ACTUATOR,
    fresh_release_reverification_required_at_check: true,
    prior_self_update_transaction_readback_required: true,
    restart_gate_revalidation_required: true,
    host_resilience_revalidation_required: true,
    self_update_check_authorized: false,
    self_update_apply_authorized: false,
    self_update_handoff_authorized: false,
    installer_launch_authorized: false,
    direct_install_authorized: false,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, eligibility_review_digest: digest(core) });
}

export function verifyRsiSelfUpdateEligibilityReview(row) {
  if (
    !row
    || typeof row !== 'object'
    || Array.isArray(row)
    || row.schema !== RSI_SELF_UPDATE_ELIGIBILITY_REVIEW_SCHEMA
    || row.version !== 1
  ) {
    throw new Error('rsi_self_update_review_schema_invalid');
  }
  assertZeroAuthority(row, 'eligibility');
  if (
    row.state !== 'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_REVIEW'
    || row.release_promotion_confirmed !== true
    || row.exact_release_authority_confirmed !== true
    || row.trusted_release_reverified !== true
    || row.installed_executable_binding_present !== true
    || row.external_self_update_controller_required !== true
    || row.existing_self_update_runtime_required !== true
    || row.self_update_transaction_schema !== SELF_UPDATE_TRANSACTION_SCHEMA
    || row.install_effect_barrier !== SELF_UPDATE_INSTALL_EFFECT_BARRIER
    || row.install_effect_scope !== SELF_UPDATE_INSTALL_EFFECT_SCOPE
    || row.install_actuator !== SELF_UPDATE_INSTALL_ACTUATOR
    || row.fresh_release_reverification_required_at_check !== true
    || row.prior_self_update_transaction_readback_required !== true
    || row.restart_gate_revalidation_required !== true
    || row.host_resilience_revalidation_required !== true
    || row.self_update_check_authorized !== false
    || row.self_update_apply_authorized !== false
    || row.self_update_handoff_authorized !== false
    || row.installer_launch_authorized !== false
    || row.direct_install_authorized !== false
    || row.physical_effect_replay_allowed !== false
  ) {
    throw new Error('rsi_self_update_review_policy_invalid');
  }

  exactSha(row.candidate_sha, 'candidate');
  exactSha(row.previous_authority_sha, 'previous_authority');
  if (!DEV_VERSION.test(String(row.release_version || '')) || row.release_tag !== 'v' + row.release_version) {
    throw new Error('rsi_self_update_review_release_identity_invalid');
  }
  safeId(row.installer_name, 'installer_name');
  for (const field of [
    'installer_sha256',
    'manifest_sha256',
    'dev_yml_sha256',
    'installed_executable_sha256',
    'journal_intent_digest',
    'authority_readback_digest',
  ]) exactDigest(row[field], field);

  const clone = structuredClone(row);
  const claimed = exactDigest(clone.eligibility_review_digest, 'eligibility');
  delete clone.eligibility_review_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_self_update_review_digest_mismatch');
  return row;
}

export function rsiSelfUpdateEligibilityReviewTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.self-update-eligibility-review-root.v1',
    version: 1,
    adapter_path: 'apps/metaengine-browser/src/rsi-release-promotion-outcome-ingest.mjs',
    release_promotion_journal_path: 'apps/metaengine-browser/src/rsi-release-promotion-journal.mjs',
    self_update_transaction_journal_path: 'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    trusted_release_resolver_path: 'apps/metaengine-browser/src/trusted-dev-release-resolver.mjs',
    exact_release_authority_readback_required: true,
    trusted_release_reverification_required: true,
    installed_executable_binding_required: true,
    existing_self_update_runtime_required: true,
    prior_self_update_transaction_readback_required: true,
    restart_gate_revalidation_required: true,
    host_resilience_revalidation_required: true,
    self_update_check_authorized: false,
    self_update_apply_authorized: false,
    installer_launch_authorized: false,
    candidate_can_modify_self_update_review_root: false,
    physical_effect_replay_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    release_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, self_update_review_root_digest: digest(root) });
}
