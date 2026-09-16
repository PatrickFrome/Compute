import {
  loadSelfUpdateSessionContinuity,
  quarantineSelfUpdateSessionContinuity,
  supersedeSelfUpdateSessionContinuity,
} from './self-update-session-continuity.mjs';
import { compareVersions } from './self-update-handoff.mjs';

export const DEFAULT_SELF_UPDATE_CONTINUITY_WATCHDOG_MS = 30_000;

function clipError(error) { return String(error?.message || error || 'unknown_error').slice(0, 300); }

// Reconciles a session-continuity capsule whose target version does not match
// the running version. Previously this case was informational-only, which left
// a strictly-older leftover capsule blocking successor qualification forever
// (probe requires the capsule to be absent, and nothing ever removed it).
//
// Semantics (fail-closed preserved):
//  - capsule absent                 -> CLEARED (nothing to do)
//  - target === current             -> NOT_STALE (the startup watchdog owns this case)
//  - target strictly OLDER          -> archive as superseded sidecar (SUPERSEDED);
//                                      the install this capsule was prepared for
//                                      has demonstrably been superseded by the
//                                      currently running newer version
//  - target strictly NEWER          -> FUTURE_TARGET (capsule belongs to a pending
//                                      newer install; this process must not touch it)
//  - version strings not comparable -> COMPARISON_UNAVAILABLE (fail-closed, no action)
//
// No relaunch, no exit, no installer effect: this is pure durable-file
// reconciliation with an auditable archive.
export async function reconcileStaleSelfUpdateSessionContinuity({
  userDataPath,
  currentVersion,
  supersededAt = new Date().toISOString(),
} = {}) {
  if (!userDataPath) throw new Error('self_update_continuity_watchdog_user_data_required');
  if (!currentVersion) throw new Error('self_update_continuity_watchdog_version_required');

  const row = await loadSelfUpdateSessionContinuity(userDataPath);
  if (!row) return { state: 'CLEARED', authority_effect: false };
  if (!row.target_version || String(row.target_version) === String(currentVersion)) {
    return {
      state: 'NOT_STALE',
      target_version: row.target_version || null,
      current_version: String(currentVersion),
      authority_effect: false,
    };
  }
  const comparison = compareVersions(String(currentVersion), String(row.target_version));
  if (comparison == null) {
    return {
      state: 'COMPARISON_UNAVAILABLE',
      target_version: row.target_version,
      current_version: String(currentVersion),
      authority_effect: false,
    };
  }
  if (comparison < 0) {
    return {
      state: 'FUTURE_TARGET',
      target_version: row.target_version,
      current_version: String(currentVersion),
      authority_effect: false,
    };
  }
  const supersedePath = await supersedeSelfUpdateSessionContinuity(userDataPath, { supersededAt });
  if (!supersedePath) return { state: 'CLEARED_RACE', authority_effect: false };
  return {
    state: 'SUPERSEDED',
    target_version: row.target_version,
    current_version: String(currentVersion),
    supersede_path: supersedePath,
    authority_effect: false,
  };
}

export async function recoverStuckSelfUpdateContinuity({
  userDataPath,
  currentVersion,
  relaunch,
  exit,
  quarantinedAt = new Date().toISOString(),
  shouldAbort = null,
} = {}) {
  if (!userDataPath) throw new Error('self_update_continuity_watchdog_user_data_required');
  if (!currentVersion) throw new Error('self_update_continuity_watchdog_version_required');
  if (typeof relaunch !== 'function' || typeof exit !== 'function') throw new Error('self_update_continuity_watchdog_process_hooks_required');
  if (shouldAbort != null && typeof shouldAbort !== 'function') throw new Error('self_update_continuity_watchdog_abort_hook_invalid');

  const row = await loadSelfUpdateSessionContinuity(userDataPath);
  if (!row) return { state: 'CLEARED', recovered: false, authority_effect: false };
  // D1 fix: a cancel() that lands while the load is in flight must still stop
  // this attempt before any durable file effect or process effect happens.
  if (shouldAbort?.()) return { state: 'ABORTED', recovered: false, authority_effect: false };
  if (!row.target_version || String(row.target_version) !== String(currentVersion)) {
    // Mismatched capsule: reconcile strictly-older leftovers (superseded by the
    // currently running version) instead of leaving them blocking qualification
    // forever. Newer-target and non-comparable capsules stay fail-closed.
    const reconciled = await reconcileStaleSelfUpdateSessionContinuity({ userDataPath, currentVersion });
    return {
      state: 'TARGET_VERSION_MISMATCH',
      recovered: false,
      target_version: row.target_version || null,
      current_version: String(currentVersion),
      reconcile_state: reconciled.state,
      supersede_path: reconciled.supersede_path || null,
      authority_effect: false,
    };
  }

  const quarantinePath = await quarantineSelfUpdateSessionContinuity(userDataPath, { quarantinedAt });
  if (!quarantinePath) return { state: 'CLEARED_RACE', recovered: false, authority_effect: false };
  // D1 fix: the capsule is already archived (durable, auditable) but the
  // process-level relaunch+exit effects are still ahead — honor a cancel that
  // arrived during the quarantine write instead of running them to completion.
  if (shouldAbort?.()) {
    return {
      state: 'QUARANTINED_ABORTED',
      recovered: false,
      target_version: row.target_version,
      quarantine_path: quarantinePath,
      blind_retry: false,
      page_authority: false,
      authority_effect: false,
    };
  }

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
  let cancelled = false;
  const timer = setTimer(() => {
    recoverStuckSelfUpdateContinuity({ userDataPath, currentVersion, relaunch, exit, shouldAbort: () => cancelled })
      .catch((error) => onError(clipError(error)));
  }, delayMs);
  timer?.unref?.();

  const handle = {
    timeout_ms: delayMs,
    cancel: () => {
      // D1 fix: flag first so an already-fired, in-flight recovery attempt
      // observes the cancellation at its next await point and stops before
      // its effectful tail (relaunch/exit).
      cancelled = true;
      clearTimeout(timer);
      if (globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__ === handle) {
        delete globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__;
      }
    },
    authority_effect: false,
  };
  globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__ = handle;
  return handle;
}
