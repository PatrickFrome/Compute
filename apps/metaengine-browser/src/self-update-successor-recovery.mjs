export const SELF_UPDATE_SUCCESSOR_RECOVERY_VERSION = '1.5.0';
export const SELF_UPDATE_RECOVERY_DIAGNOSTIC_VERSION = '1.0.0';

const RECOVERY_SCHEMA = 'metaengine.self-update.recovery-diagnostic.v1';
const TRANSACTION_SCHEMA = 'metaengine.self-update.transaction.v1';
let latestRecoveryDiagnostic = null;

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function exactUpdatedHandoff(updateHandoff) {
  const row = updateHandoff?.row;
  if (!row || row.schema !== 'metaengine.self-update.successor-receipt.v1') return false;
  if (row.primary_instance !== true || row.authority_effect !== false) return false;
  const version = String(row.version || '');
  return Boolean(version && String(updateHandoff?.successor_startup || ''));
}

function baseDiagnostic(inspection, state, overrides = {}) {
  return Object.freeze({
    schema: RECOVERY_SCHEMA,
    version: SELF_UPDATE_RECOVERY_DIAGNOSTIC_VERSION,
    state,
    recovery_active: state !== 'NO_TRANSACTION',
    startup_state: clip(inspection?.state, 80),
    transaction_state: clip(inspection?.transaction_state, 80),
    current_version: clip(inspection?.current_version, 120),
    target_version: clip(inspection?.target_version, 120),
    reason: clip(inspection?.reason, 240),
    qualification_resume_allowed: false,
    recovery_installer_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  });
}

export function buildSelfUpdateRecoveryDiagnostic(startupInspection = null) {
  if (!startupInspection || typeof startupInspection !== 'object' || Array.isArray(startupInspection)) {
    return baseDiagnostic(null, 'INSPECTION_UNAVAILABLE', { reason: 'startup_inspection_unavailable' });
  }
  if (startupInspection.schema !== 'metaengine.self-update.startup-inspection.v1'
    || startupInspection.authority_effect !== false) {
    return baseDiagnostic(startupInspection, 'INSPECTION_UNAVAILABLE', { reason: 'startup_inspection_invariant_invalid' });
  }

  const startupState = String(startupInspection.state || '');
  const transactionState = String(startupInspection.transaction_state || '');
  const currentVersion = String(startupInspection.current_version || '');
  const targetVersion = String(startupInspection.target_version || '');

  if (startupState === 'NONE') {
    return baseDiagnostic(startupInspection, 'NO_TRANSACTION', {
      recovery_active: false,
      recovery_installer_effect_allowed: null,
      automatic_retry_allowed: startupInspection.automatic_retry_allowed === true,
    });
  }
  if (startupState === 'SUPERSEDED') {
    return baseDiagnostic(startupInspection, 'SUPERSEDED');
  }
  if (startupState === 'AMBIGUOUS_INSTALL') {
    return baseDiagnostic(startupInspection, 'AMBIGUOUS_INSTALL');
  }
  if (startupState === 'TARGET_INSTALLED' && transactionState === 'QUALIFIED') {
    return baseDiagnostic(startupInspection, 'QUALIFIED');
  }
  if (startupState === 'TARGET_INSTALLED'
    && transactionState === 'SUCCESSOR_BOOTED'
    && currentVersion
    && targetVersion
    && currentVersion === targetVersion
    && startupInspection.automatic_retry_allowed === false) {
    return baseDiagnostic(startupInspection, 'TARGET_INSTALLED_PENDING_QUALIFICATION', {
      qualification_resume_allowed: true,
    });
  }

  return baseDiagnostic(startupInspection, 'BLOCKED_NONTERMINAL', {
    reason: clip(startupInspection.reason || `unresolved_startup_state:${startupState || 'UNKNOWN'}:${transactionState || 'NONE'}`, 240),
  });
}

export function selfUpdateRecoveryDiagnosticSnapshot() {
  return latestRecoveryDiagnostic == null ? null : structuredClone(latestRecoveryDiagnostic);
}

export function recordSelfUpdateRecoveryQualificationResult(result = null) {
  const current = latestRecoveryDiagnostic;
  if (!current || current.state !== 'TARGET_INSTALLED_PENDING_QUALIFICATION') return selfUpdateRecoveryDiagnosticSnapshot();
  const transaction = result?.transaction;
  const exactQualified = result?.state === 'QUALIFIED'
    && result?.authority_effect === false
    && transaction?.schema === TRANSACTION_SCHEMA
    && transaction?.state === 'QUALIFIED'
    && transaction?.qualified === true
    && transaction?.automatic_retry_allowed === false
    && transaction?.authority_effect === false
    && String(transaction?.target_version || '') === String(current.target_version || '')
    && String(current.current_version || '') === String(current.target_version || '');
  if (!exactQualified) return selfUpdateRecoveryDiagnosticSnapshot();

  latestRecoveryDiagnostic = Object.freeze({
    ...current,
    state: 'QUALIFIED',
    transaction_state: 'QUALIFIED',
    reason: null,
    qualification_resume_allowed: false,
    recovery_installer_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  return selfUpdateRecoveryDiagnosticSnapshot();
}

export function shouldResumeSuccessorQualification({
  updatedLaunch = false,
  updateHandoff = null,
  startupInspection = null,
} = {}) {
  const diagnostic = buildSelfUpdateRecoveryDiagnostic(startupInspection);
  latestRecoveryDiagnostic = diagnostic;

  if (updatedLaunch === true) return exactUpdatedHandoff(updateHandoff);

  return diagnostic.state === 'TARGET_INSTALLED_PENDING_QUALIFICATION'
    && diagnostic.qualification_resume_allowed === true
    && diagnostic.recovery_installer_effect_allowed === false
    && diagnostic.automatic_retry_allowed === false
    && diagnostic.authority_effect === false;
}
