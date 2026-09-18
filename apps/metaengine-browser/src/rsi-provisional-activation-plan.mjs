
import crypto from 'node:crypto';

import {
  verifyRsiEpisodePromotionReview,
} from './rsi-episode-promotion-review.mjs';
import {
  parseMetaengineDevVersion,
} from './trusted-dev-release-resolver.mjs';

export const RSI_PROVISIONAL_ACTIVATION_PLAN_SCHEMA = 'metaengine.rsi.provisional-activation-plan.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const B64_SHA512_RE = /^[A-Za-z0-9+/]{86}==$/;

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
  if (!SHA40_RE.test(out)) throw new Error('rsi_activation_' + label + '_sha_invalid');
  return out;
}

function exactSha256(value, label) {
  const out = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!SHA256_RE.test(out)) throw new Error('rsi_activation_' + label + '_sha256_invalid');
  return out;
}

function iso(value, label) {
  const text = String(value || '').trim();
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) {
    throw new Error('rsi_activation_' + label + '_iso_invalid');
  }
  return text;
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1 || out > max) throw new Error('rsi_activation_' + label + '_invalid');
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
      throw new Error('rsi_activation_' + label + '_' + field + '_invalid');
    }
  }
  if (Object.hasOwn(value || {}, 'automatic_retry_allowed') && value.automatic_retry_allowed !== false) {
    throw new Error('rsi_activation_' + label + '_automatic_retry_invalid');
  }
}

function normalizeTrustedRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release) || release.schema !== 'metaengine.trusted-dev-release.v1') {
    throw new Error('rsi_activation_trusted_release_schema_invalid');
  }
  assertZeroAuthority(release, 'trusted_release');
  const parsed = parseMetaengineDevVersion(release.version);
  if (!parsed) throw new Error('rsi_activation_trusted_release_version_invalid');
  const tag = String(release.tag || '');
  if (tag !== 'v' + parsed.version) throw new Error('rsi_activation_trusted_release_tag_mismatch');
  const gitSha = exactSha(release.git_sha, 'release_git');
  const installerSha256 = exactSha256(release.installer_sha256, 'installer');
  const manifestSha256 = exactSha256(release.manifest_sha256, 'manifest');
  const devYmlSha256 = exactSha256(release.dev_yml_sha256, 'dev_yml');
  const installerSha512 = String(release.installer_sha512 || '').trim();
  if (!B64_SHA512_RE.test(installerSha512)) throw new Error('rsi_activation_installer_sha512_invalid');
  const installedExecutableSha256 = exactSha256(release.installed_executable_sha256, 'installed_executable');
  if (release.target_present_proof_supported !== true) throw new Error('rsi_activation_target_present_proof_required');
  return Object.freeze({
    version: parsed.version,
    build: parsed.build,
    tag,
    git_sha: gitSha,
    feed_url: String(release.feed_url || ''),
    installer_name: String(release.installer_name || ''),
    installer_sha256: installerSha256,
    installer_sha512: installerSha512,
    manifest_sha256: manifestSha256,
    dev_yml_sha256: devYmlSha256,
    installed_executable_sha256: installedExecutableSha256,
  });
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

export function createRsiProvisionalActivationPlan({
  promotion_review,
  trusted_release,
  activation_epoch,
  prepared_at,
  valid_until,
} = {}) {
  const review = verifyRsiEpisodePromotionReview(promotion_review);
  const release = normalizeTrustedRelease(trusted_release);
  if (release.git_sha !== review.candidate_sha) throw new Error('rsi_activation_release_candidate_mismatch');
  if (review.state !== 'READY_FOR_EXTERNAL_RELEASE_HANDOFF_REVIEW') throw new Error('rsi_activation_review_not_ready');

  const preparedAt = iso(prepared_at, 'prepared_at');
  const validUntil = iso(valid_until, 'valid_until');
  if (Date.parse(validUntil) <= Date.parse(preparedAt)) throw new Error('rsi_activation_deadline_not_after_prepare');
  const lifetimeMs = Date.parse(validUntil) - Date.parse(preparedAt);
  if (lifetimeMs > 6 * 60 * 60 * 1000) throw new Error('rsi_activation_deadline_too_far');
  const epoch = positiveInt(activation_epoch, 'epoch', 1_000_000_000);

  const identityCore = {
    candidate_sha: review.candidate_sha,
    parent_sha: review.parent_sha,
    version: release.version,
    tag: release.tag,
    installer_sha256: release.installer_sha256,
    installed_executable_sha256: release.installed_executable_sha256,
  };
  const identityDigest = digest(identityCore);

  const core = zeroAuthority({
    schema: RSI_PROVISIONAL_ACTIVATION_PLAN_SCHEMA,
    version: 1,
    state: 'PROVISIONAL_PREPARED',
    activation_epoch: epoch,
    prepared_at: preparedAt,
    valid_until: validUntil,
    promotion_review_digest: review.review_digest,
    episode_id: review.episode_id,
    candidate_id: review.candidate_id,
    candidate_sha: review.candidate_sha,
    parent_sha: review.parent_sha,
    artifact_digest: review.artifact_digest,
    provenance_digest: review.provenance_digest,
    rollback_artifact_digest: review.rollback.artifact_digest,
    release: Object.freeze(release),
    activation_identity_digest: identityDigest,
    activation_identity_frozen: true,
    identity_stable_canary_required: true,
    candidate_sha_must_equal_release_git_sha: true,
    exact_installed_predecessor_readback_required: true,
    exact_release_reresolution_before_effect_required: true,
    guardian_armed_healthy_required: true,
    host_resilience_ready_required: true,
    single_install_directory_required: true,
    shutdown_durability_barrier_required: true,
    installer_handoff_prepared_readback_required: true,
    startup_successor_exact_identity_readback_required: true,
    startup_recovery_terminal_commit_required: true,
    audit_live_coherence_required: true,
    provisional_deadline_required: true,
    rollback_contract: Object.freeze({
      predecessor_sha: review.parent_sha,
      rollback_artifact_digest: review.rollback.artifact_digest,
      rollback_ready: review.rollback.ready === true,
      rollback_on_uncommitted_transition_required: true,
      ambiguous_effect_replay_allowed: false,
      blind_installer_retry_allowed: false,
      automatic_rollback_effect_authorized: false,
      rollback_requires_fresh_readback: true,
    }),
    activation_attempt: 1,
    activation_attempt_replay_allowed: false,
    external_self_update_handoff_required: true,
    self_update_invocation_authorized: false,
    installer_execution_authorized: false,
    release_promotion_authorized: false,
    activation_token: null,
    physical_effect_replay_allowed: false,
  });
  return Object.freeze({ ...core, plan_digest: digest(core) });
}

export function verifyRsiProvisionalActivationPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== RSI_PROVISIONAL_ACTIVATION_PLAN_SCHEMA || plan.version !== 1) {
    throw new Error('rsi_activation_plan_schema_invalid');
  }
  assertZeroAuthority(plan, 'plan');
  if (
    plan.state !== 'PROVISIONAL_PREPARED'
    || plan.activation_identity_frozen !== true
    || plan.identity_stable_canary_required !== true
    || plan.candidate_sha_must_equal_release_git_sha !== true
    || plan.exact_installed_predecessor_readback_required !== true
    || plan.exact_release_reresolution_before_effect_required !== true
    || plan.guardian_armed_healthy_required !== true
    || plan.host_resilience_ready_required !== true
    || plan.single_install_directory_required !== true
    || plan.shutdown_durability_barrier_required !== true
    || plan.installer_handoff_prepared_readback_required !== true
    || plan.startup_successor_exact_identity_readback_required !== true
    || plan.startup_recovery_terminal_commit_required !== true
    || plan.audit_live_coherence_required !== true
    || plan.provisional_deadline_required !== true
    || plan.activation_attempt !== 1
    || plan.activation_attempt_replay_allowed !== false
    || plan.external_self_update_handoff_required !== true
    || plan.self_update_invocation_authorized !== false
    || plan.installer_execution_authorized !== false
    || plan.release_promotion_authorized !== false
    || plan.activation_token !== null
    || plan.physical_effect_replay_allowed !== false
  ) throw new Error('rsi_activation_plan_policy_invalid');

  const preparedAt = iso(plan.prepared_at, 'verify_prepared_at');
  const validUntil = iso(plan.valid_until, 'verify_valid_until');
  if (Date.parse(validUntil) <= Date.parse(preparedAt) || Date.parse(validUntil) - Date.parse(preparedAt) > 6 * 60 * 60 * 1000) {
    throw new Error('rsi_activation_plan_deadline_invalid');
  }
  positiveInt(plan.activation_epoch, 'verify_epoch', 1_000_000_000);
  const candidateSha = exactSha(plan.candidate_sha, 'verify_candidate');
  const parentSha = exactSha(plan.parent_sha, 'verify_parent');
  const release = normalizeTrustedRelease(plan.release);
  if (release.git_sha !== candidateSha) throw new Error('rsi_activation_plan_release_candidate_mismatch');
  const identityDigest = digest({
    candidate_sha: candidateSha,
    parent_sha: parentSha,
    version: release.version,
    tag: release.tag,
    installer_sha256: release.installer_sha256,
    installed_executable_sha256: release.installed_executable_sha256,
  });
  if (plan.activation_identity_digest !== identityDigest) throw new Error('rsi_activation_identity_digest_mismatch');

  if (
    plan.rollback_contract?.predecessor_sha !== parentSha
    || plan.rollback_contract?.rollback_artifact_digest !== plan.rollback_artifact_digest
    || plan.rollback_contract?.rollback_ready !== true
    || plan.rollback_contract?.rollback_on_uncommitted_transition_required !== true
    || plan.rollback_contract?.ambiguous_effect_replay_allowed !== false
    || plan.rollback_contract?.blind_installer_retry_allowed !== false
    || plan.rollback_contract?.automatic_rollback_effect_authorized !== false
    || plan.rollback_contract?.rollback_requires_fresh_readback !== true
  ) throw new Error('rsi_activation_rollback_contract_invalid');

  const clone = structuredClone(plan);
  const claimed = clone.plan_digest;
  delete clone.plan_digest;
  if (digest(clone) !== claimed) throw new Error('rsi_activation_plan_digest_mismatch');
  return plan;
}

export function rsiProvisionalActivationTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.provisional-activation-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-provisional-activation-plan.mjs',
    identity_stable_canary_required: true,
    exact_release_reresolution_before_effect_required: true,
    exact_installed_predecessor_readback_required: true,
    audit_live_coherence_required: true,
    rollback_on_uncommitted_transition_required: true,
    provisional_deadline_required: true,
    one_attempt_installer_handoff: true,
    blind_installer_retry_allowed: false,
    automatic_rollback_effect_authorized: false,
    external_self_update_handoff_required: true,
    self_update_invocation_authorized: false,
    installer_execution_authorized: false,
    release_promotion_authorized: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, provisional_activation_root_digest: digest(root) });
}
