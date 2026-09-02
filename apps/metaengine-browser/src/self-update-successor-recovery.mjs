export const SELF_UPDATE_SUCCESSOR_RECOVERY_VERSION = '1.0.0';

export function shouldResumeSuccessorQualification({ updatedLaunch = false, startupInspection = null } = {}) {
  if (updatedLaunch === true) return true;
  if (!startupInspection || typeof startupInspection !== 'object' || Array.isArray(startupInspection)) return false;
  if (startupInspection.state !== 'TARGET_INSTALLED') return false;
  if (startupInspection.authority_effect !== false || startupInspection.automatic_retry_allowed !== false) return false;
  const currentVersion = String(startupInspection.current_version || '');
  const targetVersion = String(startupInspection.target_version || '');
  return Boolean(currentVersion && targetVersion && currentVersion === targetVersion);
}
