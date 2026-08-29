import { app } from 'electron';
import { acquirePrimaryInstance, METAENGINE_BROWSER_APP_ID } from './single-instance-guard.mjs';

const bypassSingleInstance = process.argv.includes('--metaengine-smoke')
  || process.argv.includes('--metaengine-devplane-smoke');
const instanceHoldProbe = process.argv.includes('--metaengine-single-instance-probe');
const versionProbe = process.argv.includes('--metaengine-version-probe');
const selfUpdateSmoke = process.argv.includes('--metaengine-self-update-smoke');

const guard = acquirePrimaryInstance(app, { bypass: bypassSingleInstance });

if (guard.primary) {
  if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId(METAENGINE_BROWSER_APP_ID);
  }

  if (versionProbe || instanceHoldProbe || selfUpdateSmoke) {
    app.once('ready', async () => {
      if (selfUpdateSmoke) {
        try {
          const { runSelfUpdateSmoke } = await import('./self-update-smoke.mjs');
          await runSelfUpdateSmoke({ app });
        } catch (error) {
          console.error(JSON.stringify({
            schema: 'metaengine.self-update-smoke.trace.v1',
            label: 'BOOT_FAILURE',
            app_version: app.getVersion(),
            error: String(error?.message || error).slice(0, 300),
            authority_effect: false,
          }));
          app.exit(4);
        }
        return;
      }
      console.log(JSON.stringify({
        schema: versionProbe
          ? 'metaengine.browser.version-probe.v1'
          : 'metaengine.browser.single-instance-probe.v1',
        version: app.getVersion(),
        pid: process.pid,
        primary_instance: true,
        app_id: METAENGINE_BROWSER_APP_ID,
        authority_effect: false,
      }));
      if (versionProbe) app.exit(0);
      else setTimeout(() => app.exit(0), 15_000);
    });
  } else {
    await import('./main.mjs');
  }
}
