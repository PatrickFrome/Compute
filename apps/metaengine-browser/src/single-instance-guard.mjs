import crypto from 'node:crypto';

export const METAENGINE_BROWSER_APP_ID = 'com.metaengine.browser.test';
export const SINGLE_INSTANCE_GUARD_VERSION = '2.2.0';
export const SINGLE_INSTANCE_LOCK_SCHEMA = 'metaengine.browser.single-instance-lock.v2';
export const SECONDARY_INSTANCE_RENOTIFY_DELAY_MS = 4_000;
export const INSTALLER_SHUTDOWN_ARG = '--metaengine-installer-shutdown';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function stopPrimaryForInstaller(app) {
  if (globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__ === true) return;
  globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__ = true;

  try {
    globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__?.cancel?.();
  } catch {}

  try {
    await globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__?.stop?.();
  } catch (error) {
    console.error(JSON.stringify({
      schema: 'metaengine.browser.installer-shutdown.v1',
      state: 'HOST_RESILIENCE_STOP_FAILED',
      error: String(error?.message || error).slice(0, 240),
      forced_by_installer: false,
      authority_effect: false,
    }));
  } finally {
    // main.mjs already treats Electron's before-quit event as the canonical
    // planned-shutdown fence: it disables close-to-background and runtime retry.
    // Calling quit only after HostResilience.stop() prevents the Sentinel worker
    // from interpreting an installer upgrade as an unexpected parent death.
    app.quit();
  }
}

function installPrimaryInstallerShutdownHandler(app) {
  if (!app || typeof app.on !== 'function') return false;
  app.on('second-instance', (_event, argv) => {
    if (!isInstallerShutdownArgv(argv)) return;
    void stopPrimaryForInstaller(app);
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
        // itself to primary. Release the accidental lock immediately; main-entry
        // will continue waiting for the original durable activation ACK and exit.
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

/**
 * Acquire Electron's process singleton and attach a per-launch identity to the
 * second-instance notification. Losing the lock is deliberately not equivalent
 * to `app.quit()` here: the entrypoint must first determine whether the primary
 * actually acknowledged and surfaced its UI. This closes the mixed-version
 * failure mode where an old hidden primary consumed the lock but ignored the
 * user's second launch.
 *
 * A losing interactive process also schedules exactly one bounded re-notify with
 * the same immutable launch identity. If the primary disappeared and that retry
 * unexpectedly obtains the lock, the secondary releases it immediately and still
 * never becomes a Browser runtime.
 *
 * A primary additionally listens for the local installer-only argv signal. That
 * signal has no page/model authority and can only request a planned local quit;
 * HostResilience/Sentinel are stopped before Electron exits.
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
      installer_shutdown_listener_installed: false,
      authority_effect: false,
    });
  }

  const primary = requestLock(app, additionalData);
  const installerShutdownListenerInstalled = primary === true
    ? installPrimaryInstallerShutdownHandler(app)
    : false;
  const secondaryRenotifyScheduled = primary !== true
    ? scheduleSecondaryRenotify(app, additionalData, {
      delay_ms: secondary_retry_delay_ms,
      schedule,
    })
    : false;

  return Object.freeze({
    schema: 'metaengine.browser.single-instance-guard.v2',
    primary,
    bypassed: false,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id,
    additional_data: additionalData,
    secondary_ack_required: primary !== true,
    secondary_renotify_scheduled: secondaryRenotifyScheduled,
    secondary_renotify_delay_ms: secondaryRenotifyScheduled ? secondary_retry_delay_ms : null,
    installer_shutdown_listener_installed: installerShutdownListenerInstalled,
    authority_effect: false,
  });
}
