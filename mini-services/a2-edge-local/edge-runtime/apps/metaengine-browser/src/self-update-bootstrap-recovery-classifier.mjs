export const SELF_UPDATE_BOOTSTRAP_RECOVERY_SCHEMA = 'metaengine.self-update.bootstrap-recovery.v1';
export const SELF_UPDATE_BOOTSTRAP_RECOVERY_VERSION = '1.0.4';

const HASH64 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const POSITIVE_INSTALL_STATES = new Set(['SUCCESSOR_BOOTED', 'QUALIFIED', 'QUARANTINED']);
const EFFECT_BOUNDARY_OR_UNKNOWN_STATES = new Set(['INSTALLING', 'SUCCESSOR_BOOTED', 'AMBIGUOUS_INSTALL', 'QUALIFIED', 'QUARANTINED']);

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function lowerHash(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  return HASH64.test(normalized) ? normalized : null;
}

function expectedTarget(value) {
  const row = objectOrNull(value);
  const version = String(row?.version || '').trim();
  const gitSha = String(row?.git_sha || '').trim().toLowerCase();
  const executablePath = String(row?.installed_executable_path || '').trim();
  const executableSha = lowerHash(row?.installed_executable_sha256);
  if (!VERSION.test(version) || !SHA40.test(gitSha) || !executablePath) return null;
  return Object.freeze({
    version,
    git_sha: gitSha,
    installed_executable_path: executablePath,
    installed_executable_sha256: executableSha,
    release_manifest_verified: row?.release_manifest_verified === true,
  });
}

function base(state, expected, evidence, reason, overrides = {}) {
  const transaction = objectOrNull(evidence?.transaction);
  return Object.freeze({
    schema: SELF_UPDATE_BOOTSTRAP_RECOVERY_SCHEMA,
    version: SELF_UPDATE_BOOTSTRAP_RECOVERY_VERSION,
    state,
    reason: clip(reason),
    target_version: expected?.version || null,
    target_git_sha: expected?.git_sha || null,
    transaction_state: clip(transaction?.state, 80),
    target_present_proven: false,
    install_effect_absent_proven: false,
    new_install_transaction_admissible: false,
    relaunch_effect_candidate: false,
    relaunch_effect_allowed: false,
    installer_effect_allowed: false,
    journal_mutation_allowed: false,
    probe_effect: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  });
}

function exactTransaction(transaction, expected) {
  return transaction?.schema === 'metaengine.self-update.transaction.v1'
    && String(transaction?.target_version || '') === expected.version
    && String(transaction?.resolved_git_sha || '').trim().toLowerCase() === expected.git_sha
    && transaction?.automatic_retry_allowed === false
    && transaction?.authority_effect === false;
}

function exactPreInstallReceipt(receipt, expected) {
  return receipt?.schema === 'metaengine.self-update.pre-install-receipt.v1'
    && String(receipt?.version || '') === expected.version
    && String(receipt?.available_version || '') === expected.version
    && receipt?.metadata_verified === true
    && receipt?.publisher_verified === true
    && String(receipt?.resolved_git_sha || '').trim().toLowerCase() === expected.git_sha
    && receipt?.restart_gate_safe === true
    && receipt?.authority_effect === false;
}

function exactSuccessorReceipt(receipt, expected, preInstallSha256) {
  return receipt?.schema === 'metaengine.self-update.successor-receipt.v1'
    && String(receipt?.version || '') === expected.version
    && receipt?.primary_instance === true
    && lowerHash(receipt?.pre_install_receipt_sha256) === preInstallSha256
    && receipt?.authority_effect === false;
}

function exactInstalledExecutable(installed, expected) {
  if (!expected.installed_executable_sha256) return false;
  if (installed?.readback_proven !== true || installed?.exists !== true) return false;
  if (String(installed?.path || '').toLowerCase() !== expected.installed_executable_path.toLowerCase()) return false;
  if (lowerHash(installed?.sha256) !== expected.installed_executable_sha256) return false;
  const observedVersion = String(installed?.product_version || installed?.version || '').trim();
  return !observedVersion || observedVersion === expected.version;
}

function exactReleaseBinding(release, expected) {
  return release?.verified === true
    && release?.authority_effect === false
    && String(release?.version || '') === expected.version
    && String(release?.git_sha || '').toLowerCase() === expected.git_sha
    && lowerHash(release?.installed_executable_sha256) === expected.installed_executable_sha256;
}

function explicitNoEffectProof(noEffect, expected, transaction) {
  // PREPARED is the only journal state before the write-ahead install-effect barrier.
  // INSTALLING and every later/ambiguous state may already represent a physical
  // installer effect and must never be downgraded by caller-supplied booleans.
  if (!exactTransaction(transaction, expected) || String(transaction?.state || '') !== 'PREPARED') return false;
  return noEffect?.schema === 'metaengine.self-update.bootstrap-no-effect-proof.v1'
    && noEffect?.installed_path_absent_proven === true
    && noEffect?.uninstall_registration_absent_proven === true
    && noEffect?.successor_receipt_absent_proven === true
    && noEffect?.installer_effect_absent_proven === true
    && noEffect?.effect_barrier_not_crossed_proven === true
    && String(noEffect?.target_version || '') === expected.version
    && String(noEffect?.transaction_id || '') === String(transaction?.transaction_id || '')
    && noEffect?.automatic_retry_allowed === false
    && noEffect?.authority_effect === false;
}

export function classifySelfUpdateBootstrapRecovery({ expected_target = null, evidence = null } = {}) {
  const expected = expectedTarget(expected_target);
  const observed = objectOrNull(evidence) || {};
  if (!expected) return base('AMBIGUOUS', null, observed, 'EXPECTED_TARGET_BINDING_INVALID');
  if (expected.release_manifest_verified !== true) {
    return base('AMBIGUOUS', expected, observed, 'RELEASE_MANIFEST_NOT_VERIFIED');
  }
  if (!expected.installed_executable_sha256) {
    return base('AMBIGUOUS', expected, observed, 'EXPECTED_INSTALLED_EXECUTABLE_DIGEST_MISSING');
  }

  const transaction = objectOrNull(observed.transaction);
  const preInstall = objectOrNull(observed.pre_install_receipt);
  const successor = objectOrNull(observed.successor_receipt);
  const installed = objectOrNull(observed.installed_executable);
  const release = objectOrNull(observed.release_binding);
  const noEffect = objectOrNull(observed.no_effect_proof);
  const preInstallSha256 = lowerHash(observed.pre_install_receipt_sha256);

  const transactionExact = exactTransaction(transaction, expected);
  const installState = String(transaction?.state || '');
  const positiveInstallEvidence = transactionExact && POSITIVE_INSTALL_STATES.has(installState);

  if (positiveInstallEvidence
      && preInstallSha256
      && exactPreInstallReceipt(preInstall, expected)
      && exactSuccessorReceipt(successor, expected, preInstallSha256)
      && exactInstalledExecutable(installed, expected)
      && exactReleaseBinding(release, expected)) {
    return base('TARGET_PRESENT', expected, observed, 'EXACT_TARGET_PRESENT_WITH_DURABLE_SUCCESSOR_PROOF', {
      target_present_proven: true,
      installed_executable_sha256: expected.installed_executable_sha256,
      pre_install_receipt_sha256: preInstallSha256,
      relaunch_effect_candidate: installState === 'SUCCESSOR_BOOTED',
    });
  }

  if (positiveInstallEvidence) {
    return base('AMBIGUOUS', expected, observed, 'PRIOR_INSTALL_EFFECT_POSITIVELY_OBSERVED_CURRENT_TARGET_NOT_EXACT');
  }

  if (transactionExact && EFFECT_BOUNDARY_OR_UNKNOWN_STATES.has(installState)) {
    return base('AMBIGUOUS', expected, observed, 'INSTALL_EFFECT_BOUNDARY_CROSSED_OR_UNKNOWN');
  }

  if (explicitNoEffectProof(noEffect, expected, transaction)) {
    // Classification is evidence-only. Even positive no-effect evidence does not grant
    // install authority; a future effectful controller must independently validate the
    // trusted proof origin and acquire its own single-shot effect fence.
    return base('NO_INSTALL_EFFECT_PROVEN', expected, observed, 'INDEPENDENT_EXACT_NO_EFFECT_PROOF_BEFORE_EFFECT_BARRIER', {
      install_effect_absent_proven: true,
    });
  }

  return base('AMBIGUOUS', expected, observed, 'INSUFFICIENT_BOOTSTRAP_RECOVERY_EVIDENCE');
}
