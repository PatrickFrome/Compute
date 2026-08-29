export const METAENGINE_BROWSER_APP_ID = 'com.metaengine.browser.test';
export const SINGLE_INSTANCE_GUARD_VERSION = '1.0.0';

export function acquirePrimaryInstance(app, { bypass = false } = {}) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function') throw new Error('single_instance_app_invalid');
  if (bypass) {
    return Object.freeze({
      schema: 'metaengine.browser.single-instance-guard.v1',
      primary: true,
      bypassed: true,
      app_id: METAENGINE_BROWSER_APP_ID,
      authority_effect: false,
    });
  }
  const primary = app.requestSingleInstanceLock({
    schema: 'metaengine.browser.single-instance-lock.v1',
    app_id: METAENGINE_BROWSER_APP_ID,
  });
  if (!primary) app.quit();
  return Object.freeze({
    schema: 'metaengine.browser.single-instance-guard.v1',
    primary,
    bypassed: false,
    app_id: METAENGINE_BROWSER_APP_ID,
    authority_effect: false,
  });
}
