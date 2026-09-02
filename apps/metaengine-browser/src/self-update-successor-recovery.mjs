export const SELF_UPDATE_SUCCESSOR_RECOVERY_VERSION = '1.1.0';

function exactUpdatedHandoff(updateHandoff) {
  const row = updateHandoff?.row;
  if (!row || row.schema !== 'metaengine.self-update.successor-receipt.v1') return false;
  if (row.primary_instance !== true || row.authority_effect !== false) return false;
  const version = String(row.version || '');
  return Boolean(version && String(updateHandoff?.successor_startup || ''));
}

export function shouldResumeSuccessorQualification({
  updatedLaunch = false,
  updateHandoff = null,
  startupInspection = null,
} = {}) {
  // An --updated argv is only an intent hint. Qualification authority comes from
  // the successfully persisted exact successor handoff. If receipt persistence
  // was ambiguous, the newer nonterminal LIVE_HOLD path must remain fenced.
  if (updatedLaunch === true) return exactUpdatedHandoff(updateHandoff);

  // A normal process restart may resume only the already-observed installed
  // target. This is qualification recovery, never authority to repeat install.
  if (!startupInspection || typeof startupInspection !== 'object' || Array.isArray(startupInspection)) return false;
  if (startupInspection.state !== 'TARGET_INSTALLED') return false;
  if (startupInspection.authority_effect !== false || startupInspection.automatic_retry_allowed !== false) return false;
  const currentVersion = String(startupInspection.current_version || '');
  const targetVersion = String(startupInspection.target_version || '');
  return Boolean(currentVersion && targetVersion && currentVersion === targetVersion);
}
