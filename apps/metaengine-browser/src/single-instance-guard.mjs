import crypto from 'node:crypto';

export const METAENGINE_BROWSER_APP_ID = 'com.metaengine.browser.test';
export const SINGLE_INSTANCE_GUARD_VERSION = '2.1.0';
export const SINGLE_INSTANCE_LOCK_SCHEMA = 'metaengine.browser.single-instance-lock.v2';
export const SECONDARY_INSTANCE_RENOTIFY_DELAY_MS = 4_000;

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
      authority_effect: false,
    });
  }

  const primary = requestLock(app, additionalData);
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
    authority_effect: false,
  });
}
