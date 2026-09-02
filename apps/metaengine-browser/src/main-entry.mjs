import { app } from 'electron';
import { acquirePrimaryInstance, METAENGINE_BROWSER_APP_ID } from './single-instance-guard.mjs';
import { HostResilienceRuntime } from './host-resilience-runtime.mjs';
import {
  inspectSelfUpdateStartup,
  persistUpdatedSuccessorReceipt,
  SUCCESSOR_STARTUP_PROBE_ONLY,
} from './self-update-handoff.mjs';
import { installSignedSupervisorHeartbeatQualificationHook } from './self-update-signed-heartbeat.mjs';
import { qualifyUpdatedSuccessorWhenHealthy } from './self-update-successor-qualification.mjs';
import { shouldResumeSuccessorQualification } from './self-update-successor-recovery.mjs';

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

  // Load the Browser runtime before any slow startup awaits so it can register
  // privileged protocol metadata and its ready handler in time. The handler is
  // fenced on this promise and cannot create the Browser window until host
  // resilience has completed its first bootstrap attempt.
  const browserRuntimeNeeded = !selfUpdateSmoke && !versionProbe && !profileProbe && !instanceHoldProbe;
  let resolveBrowserBootstrap = null;
  let browserRuntimeLoadError = null;
  let browserRuntimePromise = null;
  if (browserRuntimeNeeded) {
    globalThis.__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__ = new Promise((resolve) => { resolveBrowserBootstrap = resolve; });
    browserRuntimePromise = import('./main.mjs').catch((error) => {
      browserRuntimeLoadError = error;
      return null;
    });
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
  const resumeSuccessorQualification = shouldResumeSuccessorQualification({
    updatedLaunch,
    startupInspection: startupUpdateInspection,
  });

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
    if (typeof app.hasSingleInstanceLock === 'function'
      && app.hasSingleInstanceLock() === true
      && typeof app.releaseSingleInstanceLock === 'function') {
      app.releaseSingleInstanceLock();
    }
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
    const hostResilience = new HostResilienceRuntime();
    globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ = hostResilience;

    const { startSelfUpdateContinuityWatchdog } = await import('./self-update-continuity-watchdog.mjs');
    startSelfUpdateContinuityWatchdog({
      userDataPath: app.getPath('userData'),
      currentVersion: app.getVersion(),
      relaunch: () => app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--updated') }),
      exit: (code) => app.exit(code),
      onError: (error) => console.error(JSON.stringify({
        schema: 'metaengine.self-update-continuity-watchdog.v1',
        state: 'WATCHDOG_ERROR',
        error,
        authority_effect: false,
      })),
    });
    globalThis.fetch = installSignedSupervisorHeartbeatQualificationHook({ app, fetchImpl: globalThis.fetch });

    await browserRuntimePromise;
    const hostSnapshot = await app.whenReady()
      .then(() => hostResilience.start())
      .catch((error) => ({
        schema: 'metaengine.host-resilience-runtime.v6',
        state: 'ERROR',
        error: String(error?.message || error).slice(0, 300),
        terminal: false,
        authority_effect: false,
      }));
    console.log(JSON.stringify({
      schema: 'metaengine.host-resilience-bootstrap.v2',
      state: hostSnapshot?.state || 'UNKNOWN',
      login_start_verified: hostSnapshot?.login_start_verified === true,
      sentinel_worker_healthy: hostSnapshot?.sentinel_worker_healthy === true,
      browser_runtime_loaded: browserRuntimeLoadError == null,
      terminal: false,
      authority_effect: false,
    }));
    resolveBrowserBootstrap?.(hostSnapshot);

    if (browserRuntimeLoadError) {
      console.error(JSON.stringify({
        schema: 'metaengine.browser-runtime-load.v1',
        state: 'ERROR',
        error: String(browserRuntimeLoadError?.message || browserRuntimeLoadError).slice(0, 300),
        host_resilience_bootstrapped: true,
        authority_effect: false,
      }));
      app.exit(1);
    }

    if (resumeSuccessorQualification) {
      setImmediate(() => {
        qualifyUpdatedSuccessorWhenHealthy({ app })
          .then((result) => console.log(JSON.stringify({
            schema: 'metaengine.browser.self-update-qualification.v2',
            version: app.getVersion(),
            recovery_startup: updatedLaunch !== true,
            ...result,
            authority_effect: false,
          })))
          .catch((error) => console.error(JSON.stringify({
            schema: 'metaengine.browser.self-update-qualification.v2',
            version: app.getVersion(),
            recovery_startup: updatedLaunch !== true,
            state: 'QUALIFICATION_ERROR',
            error: String(error?.message || error).slice(0, 300),
            authority_effect: false,
          })));
      });
    }
  }
}
