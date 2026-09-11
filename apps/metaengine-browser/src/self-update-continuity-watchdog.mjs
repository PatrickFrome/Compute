import {
  loadSelfUpdateSessionContinuity,
  quarantineSelfUpdateSessionContinuity,
} from './self-update-session-continuity.mjs';

export const DEFAULT_SELF_UPDATE_CONTINUITY_WATCHDOG_MS = 30_000;

function clipError(error) { return String(error?.message || error || 'unknown_error').slice(0, 300); }

export async function recoverStuckSelfUpdateContinuity({
  userDataPath,
  currentVersion,
  relaunch,
  exit,
  quarantinedAt = new Date().toISOString(),
} = {}) {
  if (!userDataPath) throw new Error('self_update_continuity_watchdog_user_data_required');
  if (!currentVersion) throw new Error('self_update_continuity_watchdog_version_required');
  if (typeof relaunch !== 'function' || typeof exit !== 'function') throw new Error('self_update_continuity_watchdog_process_hooks_required');

  const row = await loadSelfUpdateSessionContinuity(userDataPath);
  if (!row) return { state: 'CLEARED', recovered: false, authority_effect: false };
  if (!row.target_version || String(row.target_version) !== String(currentVersion)) {
    return {
      state: 'TARGET_VERSION_MISMATCH',
      recovered: false,
      target_version: row.target_version || null,
      current_version: String(currentVersion),
      authority_effect: false,
    };
  }

  const quarantinePath = await quarantineSelfUpdateSessionContinuity(userDataPath, { quarantinedAt });
  if (!quarantinePath) return { state: 'CLEARED_RACE', recovered: false, authority_effect: false };

  relaunch();
  exit(18);
  return {
    state: 'QUARANTINED_RELAUNCH',
    recovered: true,
    target_version: row.target_version,
    quarantine_path: quarantinePath,
    blind_retry: false,
    page_authority: false,
    authority_effect: false,
  };
}

export function startSelfUpdateContinuityWatchdog({
  userDataPath,
  currentVersion,
  relaunch,
  exit,
  onError = () => {},
  timeoutMs = DEFAULT_SELF_UPDATE_CONTINUITY_WATCHDOG_MS,
  setTimer = setTimeout,
} = {}) {
  const delayMs = Math.max(5_000, Number(timeoutMs) || DEFAULT_SELF_UPDATE_CONTINUITY_WATCHDOG_MS);
  const timer = setTimer(() => {
    recoverStuckSelfUpdateContinuity({ userDataPath, currentVersion, relaunch, exit })
      .catch((error) => onError(clipError(error)));
  }, delayMs);
  timer?.unref?.();
  return {
    timeout_ms: delayMs,
    cancel: () => clearTimeout(timer),
    authority_effect: false,
  };
}
