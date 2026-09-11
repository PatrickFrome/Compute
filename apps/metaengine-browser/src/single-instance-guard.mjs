import crypto from 'node:crypto';

export const METAENGINE_BROWSER_APP_ID = 'com.metaengine.browser.test';
export const SINGLE_INSTANCE_GUARD_VERSION = '2.0.0';
export const SINGLE_INSTANCE_LOCK_SCHEMA = 'metaengine.browser.single-instance-lock.v2';

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

/**
 * Acquire Electron's process singleton and attach a per-launch nonce to the
 * second-instance notification. Losing the lock is deliberately not equivalent
 * to `app.quit()` here: the entrypoint must first determine whether the primary
 * actually acknowledged and surfaced its UI. This closes the mixed-version
 * failure mode where an old hidden primary consumed the lock but ignored the
 * user's second launch.
 */
export function acquirePrimaryInstance(app, { bypass = false, launch_id = crypto.randomUUID() } = {}) {
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
      authority_effect: false,
    });
  }

  const primary = app.requestSingleInstanceLock(additionalData);
  return Object.freeze({
    schema: 'metaengine.browser.single-instance-guard.v2',
    primary,
    bypassed: false,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id,
    additional_data: additionalData,
    secondary_ack_required: primary !== true,
    authority_effect: false,
  });
}
