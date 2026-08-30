import { app } from 'electron';
import { acquirePrimaryInstance, METAENGINE_BROWSER_APP_ID } from './single-instance-guard.mjs';
import {
  inspectSelfUpdateStartup,
  persistUpdatedSuccessorReceipt,
  SUCCESSOR_STARTUP_PROBE_ONLY,
} from './self-update-handoff.mjs';
import { qualifyUpdatedSuccessorWhenHealthy } from './self-update-successor-qualification.mjs';

const bypassSingleInstance = process.argv.includes('--metaengine-smoke')
  || process.argv.includes('--metaengine-devplane-smoke');
const instanceHoldProbe = process.argv.includes('--metaengine-single-instance-probe');
const versionProbe = process.argv.includes('--metaengine-version-probe');
const profileProbe = process.argv.includes('--metaengine-profile-probe');
const selfUpdateSmoke = process.argv.includes('--metaengine-self-update-smoke');
const updatedLaunch = process.argv.includes('--updated');

const guard = acquirePrimaryInstance(app, { bypass: bypassSingleInstance });

if (guard.primary) {
  if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId(METAENGINE_BROWSER_APP_ID);
  }

  let startupUpdateInspection = null;
  if (!selfUpdateSmoke && !versionProbe && !profileProbe && !instanceHoldProbe) {
    startupUpdateInspection = await inspectSelfUpdateStartup(app).catch((error) => ({
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'AMBIGUOUS_INSTALL',
      current_version: app.getVersion(),
      target_version: null,
      reason: String(error?.message || error).slice(0, 240),
      automatic_retry_allowed: false,
      authority_effect: false,
    }));
    if (startupUpdateInspection?.state === 'AMBIGUOUS_INSTALL') {
      process.env.METAENGINE_DISABLE_SELF_UPDATE = '1';
      process.env.METAENGINE_SELF_UPDATE_HOLD_REASON = 'AMBIGUOUS_INSTALL';
      if (startupUpdateInspection.target_version) {
        process.env.METAENGINE_SELF_UPDATE_HOLD_TARGET = String(startupUpdateInspection.target_version);
      }
      console.error(JSON.stringify({
        ...startupUpdateInspection,
        label: 'SELF_UPDATE_AUTOMATIC_RETRY_HELD',
      }));
    }
  }

  let updateHandoff = null;
  if (updatedLaunch) {
    try {
      updateHandoff = await persistUpdatedSuccessorReceipt(app, {
        primaryInstance: true,
        appId: METAENGINE_BROWSER_APP_ID,
      });
    } catch (error) {
      console.error(JSON.stringify({
        schema: 'metaengine.browser.self-update-successor-boot-failure.v1',
        version: app.getVersion(),
        pid: process.pid,
        primary_instance: true,
        error: String(error?.message || error).slice(0, 300),
        authority_effect: false,
      }));
      app.exit(7);
    }
  }

  if (updateHandoff?.successor_startup === SUCCESSOR_STARTUP_PROBE_ONLY) {
    console.log(JSON.stringify(updateHandoff.row));
    app.exit(0);
  } else if (versionProbe || profileProbe || instanceHoldProbe || selfUpdateSmoke) {
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
      if (profileProbe) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const userData = app.getPath('userData');
        const markerPath = path.join(userData, 'metaengine-self-update-profile-continuity-v1.txt');
        const expected = 'metaengine-profile-continuity-v1';
        if (process.env.METAENGINE_PROFILE_PROBE_WRITE === '1') {
          await fs.mkdir(userData, { recursive: true });
          await fs.writeFile(markerPath, `${expected}\n`, { mode: 0o600 });
        }
        let marker = null;
        try { marker = (await fs.readFile(markerPath, 'utf8')).trim(); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        const ok = marker === expected;
        console.log(JSON.stringify({
          schema: 'metaengine.browser.profile-probe.v1',
          version: app.getVersion(),
          pid: process.pid,
          primary_instance: true,
          app_id: METAENGINE_BROWSER_APP_ID,
          user_data_path: userData,
          marker_present: ok,
          marker_path: markerPath,
          authority_effect: false,
        }));
        app.exit(ok ? 0 : 5);
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
    if (updatedLaunch) {
      setImmediate(() => {
        qualifyUpdatedSuccessorWhenHealthy({ app })
          .then((result) => console.log(JSON.stringify({
            schema: 'metaengine.browser.self-update-qualification.v1',
            version: app.getVersion(),
            ...result,
            authority_effect: false,
          })))
          .catch((error) => console.error(JSON.stringify({
            schema: 'metaengine.browser.self-update-qualification.v1',
            version: app.getVersion(),
            state: 'QUALIFICATION_ERROR',
            error: String(error?.message || error).slice(0, 300),
            authority_effect: false,
          })));
      });
    }
  }
}
