import crypto from 'node:crypto';

export const METAENGINE_BROWSER_APP_ID = 'com.metaengine.browser.test';
export const SINGLE_INSTANCE_GUARD_VERSION = '2.2.0';
export const SINGLE_INSTANCE_LOCK_SCHEMA = 'metaengine.browser.single-instance-lock.v2';
export const SECONDARY_INSTANCE_RENOTIFY_DELAY_MS = 4_000;
export const INSTALLER_SHUTDOWN_ARG = '--metaengine-installer-shutdown';
export const INSTALLER_PRIMARY_EXIT_FALLBACK_MS = 5_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const primaryShutdownBarriers = new WeakMap();
const installerShutdownAttempts = new WeakSet();

// Registered synchronously by an admitted primary before its first awaited
// provider import. The guard itself stays provider-free for control/secondary
// launches, including an installer signal delivered during primary startup.
export function registerPrimaryInstallerShutdownBarrier(app, barrier) {
  if (!app || typeof app !== 'object' || typeof barrier !== 'function'
    || primaryShutdownBarriers.has(app)) throw new Error('installer_shutdown_barrier_invalid');
  primaryShutdownBarriers.set(app, barrier);
}

export function validSingleInstanceLaunchData(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 3
    && value.schema === SINGLE_INSTANCE_LOCK_SCHEMA
    && value.app_id === METAENGINE_BROWSER_APP_ID
    && typeof value.launch_id === 'string'
    && UUID.test(value.launch_id);
}

export function isInstallerShutdownArgv(argv) {
  return Array.isArray(argv) && argv.some((arg) => String(arg) === INSTALLER_SHUTDOWN_ARG);
}

async function stopPrimaryForInstaller(app, { schedule = setTimeout } = {}) {
  if (installerShutdownAttempts.has(app)) return;
  installerShutdownAttempts.add(app);
  globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__ = true;

  try {
    const watchdog = globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__;
    watchdog?.cancel?.();
    await primaryShutdownBarriers.get(app)?.();
    // Preparation may have created its watchdog after the installer signal.
    const preparedWatchdog = globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__;
    if (preparedWatchdog !== watchdog) preparedWatchdog?.cancel?.();
    await globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__?.stop?.();
  } catch {
    console.error(JSON.stringify({
      schema: 'metaengine.browser.installer-shutdown.v1',
      state: 'PRIMARY_SHUTDOWN_BLOCKED',
      reason: 'OWNED_RUNTIME_OR_RESILIENCE_CLEANUP_UNCONFIRMED',
      primary_kept_alive: true,
      forced_by_installer: false,
      authority_effect: false,
    }));
    // Keep startup/retry fenced while the primary remains alive. A later
    // explicit installer signal may retry cleanup without resuming startup.
    installerShutdownAttempts.delete(app);
    return;
  }
  // main.mjs already treats Electron's before-quit event as the canonical
  // planned-shutdown fence: it disables close-to-background and runtime retry.
  // Calling quit only after confirmed owned cleanup and HostResilience.stop()
  // prevents an upgrade from leaving a detached database/API stack behind.
  const fallback = schedule(() => app.exit(0), INSTALLER_PRIMARY_EXIT_FALLBACK_MS);
  if (fallback && typeof fallback.unref === 'function') fallback.unref();
  app.quit();
}

function installPrimaryInstallerShutdownHandler(app, schedule) {
  if (!app || typeof app.on !== 'function') return false;
  app.on('second-instance', (_event, argv) => {
    if (!isInstallerShutdownArgv(argv)) return;
    void stopPrimaryForInstaller(app, { schedule });
  });
  return true;
}

function requestLock(app, additionalData) {
  return app.requestSingleInstanceLock(additionalData) === true;
}

function scheduleSecondaryRenotify(app, additionalData, {
  delay_ms = SECONDARY_INSTANCE_RENOTIFY_DELAY_MS,
  schedule = setTimeout,
} = {}) {
  if (!Number.isFinite(delay_ms) || delay_ms <= 0 || delay_ms > 10_000) {
    throw new Error('single_instance_secondary_renotify_delay_invalid');
  }
  if (typeof schedule !== 'function') throw new Error('single_instance_secondary_renotify_scheduler_invalid');

  const timer = schedule(() => {
    try {
      // A burst of Windows launches can lose one second-instance notification
      // even while the primary continues to own the singleton. Re-issuing the
      // same lock request with the same immutable launch identity is a bounded,
      // idempotent signal retry: it cannot authorize a second Browser runtime.
      const unexpectedlyAcquired = requestLock(app, additionalData);
      if (unexpectedlyAcquired) {
        // The primary vanished between the original losing request and the retry.
        // Fail closed: this process was born as a secondary and must never promote
        // itself to primary. Release the accidental lock immediately.
        if (typeof app.releaseSingleInstanceLock === 'function') {
          app.releaseSingleInstanceLock();
        }
      }
    } catch {
      // This retry is only a signal amplifier. Failure cannot create authority,
      // alter the original ACK deadline, or justify starting another runtime.
    }
  }, delay_ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return true;
}

function finishInstallerShutdownControl(app, {
  primary,
  schedule = setTimeout,
  delay_ms = SECONDARY_INSTANCE_RENOTIFY_DELAY_MS + 250,
} = {}) {
  if (primary === true && typeof app.releaseSingleInstanceLock === 'function') {
    try { app.releaseSingleInstanceLock(); } catch {}
  }
  if (primary === true) {
    // No Browser owned the singleton. This process is installer control only and
    // must never become the Browser runtime merely because there was nothing to stop.
    app.exit?.(0);
    return true;
  }

  // Keep the losing control process alive just long enough for the existing
  // bounded re-notify (4s) to fire, then terminate it successfully before the
  // normal interactive 15s activation-ACK path can surface any UI. The installer
  // independently proves exact-path process absence before replacing files.
  const timer = schedule(() => app.exit?.(0), delay_ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return true;
}

/**
 * Acquire Electron's process singleton and attach a per-launch identity to the
 * second-instance notification. Losing the lock is deliberately not equivalent
 * to `app.quit()` here: ordinary interactive launches must first determine whether
 * the primary actually acknowledged and surfaced its UI.
 *
 * Installer shutdown is a separate local control launch. It never starts Browser
 * runtime authority: when no primary exists it releases an accidentally acquired
 * lock and exits; when a primary exists it emits the same bounded singleton signal,
 * permits one re-notify, then exits successfully before UI-ACK timeout.
 */
export function acquirePrimaryInstance(app, {
  bypass = false,
  launch_id = crypto.randomUUID(),
  secondary_retry_delay_ms = SECONDARY_INSTANCE_RENOTIFY_DELAY_MS,
  schedule = setTimeout,
} = {}) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function') throw new Error('single_instance_app_invalid');
  if (typeof launch_id !== 'string' || !UUID.test(launch_id)) throw new Error('single_instance_launch_id_invalid');

  const additionalData = Object.freeze({
    schema: SINGLE_INSTANCE_LOCK_SCHEMA,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id,
  });

  if (bypass) {
    return Object.freeze({
      schema: 'metaengine.browser.single-instance-guard.v2',
      primary: true,
      bypassed: true,
      app_id: METAENGINE_BROWSER_APP_ID,
      launch_id,
      additional_data: additionalData,
      secondary_ack_required: false,
      secondary_renotify_scheduled: false,
      installer_shutdown_control: false,
      authority_effect: false,
    });
  }

  const installerShutdownControl = isInstallerShutdownArgv(process.argv);
  const primary = requestLock(app, additionalData);
  if (primary === true && !installerShutdownControl) installPrimaryInstallerShutdownHandler(app, schedule);
  const secondaryRenotifyScheduled = primary !== true
    ? scheduleSecondaryRenotify(app, additionalData, {
      delay_ms: secondary_retry_delay_ms,
      schedule,
    })
    : false;

  if (installerShutdownControl) {
    finishInstallerShutdownControl(app, {
      primary,
      schedule,
      delay_ms: secondary_retry_delay_ms + 250,
    });
  }

  return Object.freeze({
    schema: 'metaengine.browser.single-instance-guard.v2',
    primary,
    bypassed: false,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id,
    additional_data: additionalData,
    secondary_ack_required: primary !== true && !installerShutdownControl,
    secondary_renotify_scheduled: secondaryRenotifyScheduled,
    secondary_renotify_delay_ms: secondaryRenotifyScheduled ? secondary_retry_delay_ms : null,
    installer_shutdown_control: installerShutdownControl,
    authority_effect: false,
  });
}
