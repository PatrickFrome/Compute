import { app, BaseWindow, dialog } from 'electron';
import {
  acquirePrimaryInstance,
  METAENGINE_BROWSER_APP_ID,
  validSingleInstanceLaunchData,
} from './single-instance-guard.mjs';
import { HostResilienceRuntime } from './host-resilience-runtime.mjs';
import {
  activateExistingPrimaryWindow,
  beginBrowserStartupJournal,
  recordBrowserStartupEvent,
  waitForPrimaryActivationAck,
  waitForStablePrimaryWindow,
} from './browser-startup-observability.mjs';
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
const browserRuntimeNeeded = !selfUpdateSmoke && !versionProbe && !profileProbe && !instanceHoldProbe;
const interactiveNormalLaunch = browserRuntimeNeeded && !updatedLaunch;

const guard = acquirePrimaryInstance(app, { bypass: bypassSingleInstance });

if (!guard.primary) {
  // The old guard called app.quit() immediately. That made a hidden/stale old
  // primary indistinguishable from a successful "focus the existing window"
  // handoff. A normal user launch now waits only for a durable ACK tied to its
  // unique launch nonce. It never starts a second Browser runtime or kills the
  // current primary.
  if (interactiveNormalLaunch) {
    const ack = await waitForPrimaryActivationAck(app, { launch_id: guard.launch_id })
      .catch((error) => ({
        ok: false,
        reason: 'PRIMARY_ACTIVATION_ACK_OBSERVER_ERROR',
        last_read_error: String(error?.message || error).slice(0, 160),
        authority_effect: false,
      }));
    if (!ack.ok) {
      const reason = String(ack.reason || 'PRIMARY_ACTIVATION_ACK_MISSING');
      console.error(JSON.stringify({
        schema: 'metaengine.browser.secondary-launch.v1',
        state: 'PRIMARY_UI_ACTIVATION_UNPROVEN',
        launch_id: guard.launch_id,
        reason,
        last_read_error: ack.last_read_error || null,
        second_browser_runtime_started: false,
        primary_terminated: false,
        authority_effect: false,
      }));
      // Electron documents showErrorBox as safe before app.ready on Windows;
      // this is intentionally a local diagnostic surface, not execution
      // authority. Never auto-kill a potentially live old primary here.
      dialog.showErrorBox(
        'METAENGINE Browser — existing instance did not open',
        [
          'Another METAENGINE Browser process already owns the single-instance lock,',
          'but it did not confirm that an existing Browser window was shown.',
          '',
          'This usually means an older or hidden Browser process is still running.',
          'Close the old METAENGINE Browser process and start the Browser again.',
          '',
          `Diagnostic: ${reason}`,
        ].join('\n'),
      );
      app.exit(2);
    } else {
      console.log(JSON.stringify({
        schema: 'metaengine.browser.secondary-launch.v1',
        state: 'PRIMARY_UI_ACTIVATION_ACKNOWLEDGED',
        launch_id: guard.launch_id,
        primary_version: ack.primary_version,
        primary_pid: ack.primary_pid,
        event_sequence: ack.event_sequence,
        second_browser_runtime_started: false,
        authority_effect: false,
      }));
      app.exit(0);
    }
  } else {
    // Probe/smoke and updater-successor launches preserve the existing
    // fail-closed singleton behavior. They are not interactive user launches
    // and must not manufacture a second process authority path.
    app.exit(0);
  }
} else {
  if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId(METAENGINE_BROWSER_APP_ID);
  }

  let startupJournalFailureLogged = false;
  const startupContextPromise = browserRuntimeNeeded
    ? beginBrowserStartupJournal(app, {
      launch_kind: updatedLaunch ? 'UPDATED_SUCCESSOR' : 'NORMAL',
    }).catch((error) => {
      if (!startupJournalFailureLogged) {
        startupJournalFailureLogged = true;
        console.error(JSON.stringify({
          schema: 'metaengine.browser.startup-observability.v1',
          state: 'STARTUP_JOURNAL_UNAVAILABLE',
          error: String(error?.message || error).slice(0, 300),
          authority_effect: false,
        }));
      }
      return null;
    })
    : Promise.resolve(null);

  const recordStartup = async (state, reason, details = {}, error = null) => {
    const context = await startupContextPromise;
    if (!context) return null;
    try {
      return await recordBrowserStartupEvent(app, {
        boot_id: context.boot_id,
        state,
        reason,
        details,
        error,
      });
    } catch (journalError) {
      if (!startupJournalFailureLogged) {
        startupJournalFailureLogged = true;
        console.error(JSON.stringify({
          schema: 'metaengine.browser.startup-observability.v1',
          state: 'STARTUP_JOURNAL_WRITE_FAILED',
          error: String(journalError?.message || journalError).slice(0, 300),
          authority_effect: false,
        }));
      }
      return null;
    }
  };

  if (browserRuntimeNeeded) {
    // Electron emits second-instance in the primary process after a later launch
    // loses requestSingleInstanceLock(). Reactivate first; journal I/O must never
    // sit in front of the user-visible show/restore/focus operation. V2
    // additionalData carries a launch nonce, and only a visible activation event
    // with that exact nonce can acknowledge the losing secondary.
    app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
      void (async () => {
        const launchData = validSingleInstanceLaunchData(additionalData) ? additionalData : null;
        void recordStartup(
          'SECOND_INSTANCE_RECEIVED',
          launchData ? 'SINGLE_INSTANCE_LAUNCH_NONCE_RECEIVED' : 'SINGLE_INSTANCE_LEGACY_LAUNCH_RECEIVED',
          { launch_id: launchData?.launch_id ?? null },
        );

        let activation = activateExistingPrimaryWindow(BaseWindow);
        if (!activation.ok && activation.reason === 'PRIMARY_WINDOW_NOT_READY') {
          const observed = await waitForStablePrimaryWindow(BaseWindow, {
            timeout_ms: 8_000,
            stable_ms: 250,
            poll_ms: 100,
          });
          if (observed.ok) activation = activateExistingPrimaryWindow(BaseWindow);
        }
        await recordStartup(
          activation.ok ? 'PRIMARY_WINDOW_ACTIVATED' : 'PRIMARY_WINDOW_ACTIVATION_UNAVAILABLE',
          activation.reason,
          {
            launch_id: launchData?.launch_id ?? null,
            window_count: activation.window_count ?? 0,
            restored: activation.restored === true,
            visible: activation.visible === true,
            focused: activation.focused === true,
          },
        );
      })();
    });
  }

  // Load the Browser runtime before any slow startup awaits so it can register
  // privileged protocol metadata and its ready handler in time. The handler is
  // fenced on this promise and cannot create the Browser window until host
  // resilience has completed its first bootstrap attempt.
  let resolveBrowserBootstrap = null;
  let browserRuntimeLoadError = null;
  let browserRuntimePromise = null;
  if (browserRuntimeNeeded) {
    globalThis.__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__ = new Promise((resolve) => { resolveBrowserBootstrap = resolve; });
    browserRuntimePromise = import('./main.mjs')
      .then((runtime) => {
        void recordStartup('RUNTIME_IMPORT_OK', 'MAIN_MODULE_IMPORTED');
        return runtime;
      })
      .catch((error) => {
        browserRuntimeLoadError = error;
        void recordStartup(
          'RUNTIME_IMPORT_FAILED',
          'MAIN_MODULE_IMPORT_REJECTED',
          { host_process_kept_alive: true },
          error,
        );
        return null;
      });
  }

  let startupUpdateInspection = null;
  if (!selfUpdateSmoke && !versionProbe && !profileProbe && !instanceHoldProbe) {
    void recordStartup('SELF_UPDATE_INSPECTION_STARTED', 'STARTUP_INSPECTION_BEGIN');
    startupUpdateInspection = await inspectSelfUpdateStartup(app).catch((error) => ({
      schema: 'metaengine.self-update.startup-inspection.v1',
      state: 'AMBIGUOUS_INSTALL',
      current_version: app.getVersion(),
      target_version: null,
      reason: String(error?.message || error).slice(0, 240),
      automatic_retry_allowed: false,
      authority_effect: false,
    }));
    void recordStartup(
      'SELF_UPDATE_INSPECTION_COMPLETED',
      'STARTUP_INSPECTION_SETTLED',
      {
        inspection_state: startupUpdateInspection?.state || 'UNKNOWN',
        target_version: startupUpdateInspection?.target_version || null,
      },
    );
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
      void recordStartup(
        'SELF_UPDATE_AMBIGUOUS_INSTALL_HOLD',
        'SELF_UPDATE_AUTOMATIC_RETRY_HELD',
        { target_version: startupUpdateInspection.target_version },
      );
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
      // A successor-receipt failure can occur after the install effect and/or
      // transaction transition. Never turn that ambiguity into a blind process
      // retry. Keep the primary process alive, hold self-update authority, and
      // allow host resilience to preserve recovery surfaces. Qualification is
      // gated on updateHandoff below, so this boot cannot be promoted.
      process.env.METAENGINE_DISABLE_SELF_UPDATE = '1';
      process.env.METAENGINE_SELF_UPDATE_HOLD_REASON = 'SUCCESSOR_RECEIPT_AMBIGUOUS';
      console.error(JSON.stringify({
        schema: 'metaengine.browser.self-update-successor-boot-failure.v1',
        version: app.getVersion(),
        pid: process.pid,
        primary_instance: true,
        error: String(error?.message || error).slice(0, 300),
        recovery_state: 'LIVE_HOLD',
        automatic_retry_allowed: false,
        terminal: false,
        authority_effect: false,
      }));
      void recordStartup(
        'SUCCESSOR_RECEIPT_AMBIGUOUS',
        'UPDATED_SUCCESSOR_RECEIPT_FAILED',
        { host_process_kept_alive: true },
        error,
      );
    }
  }

  const resumeSuccessorQualification = shouldResumeSuccessorQualification({
    updatedLaunch,
    updateHandoff,
    startupInspection: startupUpdateInspection,
  });

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

    void recordStartup('CONTINUITY_WATCHDOG_IMPORT_STARTED', 'CONTINUITY_WATCHDOG_MODULE_IMPORT_BEGIN');
    const { startSelfUpdateContinuityWatchdog } = await import('./self-update-continuity-watchdog.mjs');
    void recordStartup('CONTINUITY_WATCHDOG_MODULE_IMPORTED', 'CONTINUITY_WATCHDOG_MODULE_IMPORT_COMPLETED');
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
    void recordStartup('CONTINUITY_WATCHDOG_INSTALLED', 'CONTINUITY_WATCHDOG_STARTED');
    globalThis.fetch = installSignedSupervisorHeartbeatQualificationHook({ app, fetchImpl: globalThis.fetch });
    void recordStartup('SIGNED_HEARTBEAT_HOOK_INSTALLED', 'SUPERVISOR_HEARTBEAT_QUALIFICATION_HOOK_READY');

    await browserRuntimePromise;

    // Electron emits `ready` only after the main process reaches its first event
    // loop tick. Awaiting app.whenReady() from this ESM entrypoint can therefore
    // keep module evaluation open and deadlock the exact event we are waiting for.
    // Arm the continuation and finish top-level evaluation instead. The existing
    // Browser bootstrap barrier still prevents main.mjs from creating a window
    // until this same one-shot host bootstrap settles.
    let readyContinuationStarted = false;
    const continueStartupAfterReady = async () => {
      void recordStartup('APP_READY', 'ELECTRON_APP_READY');
      void recordStartup('HOST_RESILIENCE_BOOTSTRAP_STARTED', 'HOST_BOOTSTRAP_ATTEMPT_BEGIN');
      const hostSnapshot = await hostResilience.start()
        .catch((error) => ({
          schema: 'metaengine.host-resilience-runtime.v7',
          state: 'ERROR',
          error: String(error?.message || error).slice(0, 300),
          terminal: false,
          authority_effect: false,
        }));
      void recordStartup(
        'HOST_RESILIENCE_BOOTSTRAP_SETTLED',
        'HOST_BOOTSTRAP_ATTEMPT_COMPLETED',
        {
          host_state: hostSnapshot?.state || 'UNKNOWN',
          login_start_verified: hostSnapshot?.login_start_verified === true,
          sentinel_worker_healthy: hostSnapshot?.sentinel_worker_healthy === true,
        },
      );
      console.log(JSON.stringify({
        schema: 'metaengine.host-resilience-bootstrap.v2',
        state: hostSnapshot?.state || 'UNKNOWN',
        login_start_verified: hostSnapshot?.login_start_verified === true,
        sentinel_worker_healthy: hostSnapshot?.sentinel_worker_healthy === true,
        browser_runtime_loaded: browserRuntimeLoadError == null,
        terminal: false,
        authority_effect: false,
      }));

      // Window creation in main.mjs is fenced on this barrier. Releasing it must
      // never wait on observability I/O; the journal records the already-observed
      // host state asynchronously after the UI is allowed to proceed.
      resolveBrowserBootstrap?.(hostSnapshot);
      void recordStartup(
        'BROWSER_BOOTSTRAP_BARRIER_RELEASED',
        'HOST_BOOTSTRAP_ATTEMPT_SETTLED',
        { host_state: hostSnapshot?.state || 'UNKNOWN' },
      );
      void recordStartup(
        'HOST_RESILIENCE_BOOTSTRAPPED',
        'HOST_BOOTSTRAP_ATTEMPT_COMPLETED',
        {
          host_state: hostSnapshot?.state || 'UNKNOWN',
          login_start_verified: hostSnapshot?.login_start_verified === true,
          sentinel_worker_healthy: hostSnapshot?.sentinel_worker_healthy === true,
          browser_runtime_loaded: browserRuntimeLoadError == null,
        },
      );

      if (browserRuntimeLoadError) {
        // The host/sentinel plane is already bootstrapped. Keep it alive so a
        // trusted external recovery/update can repair the Browser runtime instead
        // of converting a local import failure into a terminal stop. Unlike the
        // old behavior, persist the failure and make it visible to the user.
        process.env.METAENGINE_BROWSER_RUNTIME_HOLD_REASON = 'RUNTIME_LOAD_ERROR';
        const startupContext = await startupContextPromise;
        console.error(JSON.stringify({
          schema: 'metaengine.browser-runtime-load.v1',
          state: 'ERROR',
          error: String(browserRuntimeLoadError?.message || browserRuntimeLoadError).slice(0, 300),
          host_resilience_bootstrapped: true,
          recovery_state: 'HOST_ALIVE',
          terminal: false,
          authority_effect: false,
        }));
        await recordStartup(
          'RUNTIME_HOLD_NO_WINDOW',
          'RUNTIME_IMPORT_FAILED_HOST_ALIVE',
          { host_resilience_bootstrapped: true },
          browserRuntimeLoadError,
        );
        try {
          await dialog.showMessageBox({
            type: 'error',
            title: 'METAENGINE Browser — startup error',
            message: 'The Browser UI could not be loaded.',
            detail: [
              String(browserRuntimeLoadError?.message || browserRuntimeLoadError).slice(0, 500),
              '',
              'The recovery host is still running and automatic effect retry is held.',
              startupContext?.journal_path ? `Startup diagnostics: ${startupContext.journal_path}` : null,
            ].filter(Boolean).join('\n'),
            buttons: ['OK'],
            defaultId: 0,
            noLink: true,
          });
          await recordStartup('RUNTIME_FAILURE_PRESENTED', 'STARTUP_ERROR_DIALOG_SHOWN');
        } catch (dialogError) {
          await recordStartup(
            'RUNTIME_FAILURE_PRESENTATION_FAILED',
            'STARTUP_ERROR_DIALOG_FAILED',
            {},
            dialogError,
          );
        }
      } else {
        // A successful import is still not a usable Browser. Require independent
        // readback that a visible BaseWindow survived for a bounded stability
        // interval. CI consumes the same durable event on a normal no-flag boot.
        void waitForStablePrimaryWindow(BaseWindow)
          .then((windowReadback) => recordStartup(
            windowReadback.ok ? 'PRIMARY_WINDOW_STABLE' : 'PRIMARY_WINDOW_STABLE_TIMEOUT',
            windowReadback.reason,
            {
              window_count: windowReadback.window_count ?? 0,
              stable_ms: windowReadback.stable_ms ?? 0,
              visible: windowReadback.visible === true,
              focused: windowReadback.focused === true,
            },
          ))
          .catch((error) => recordStartup(
            'PRIMARY_WINDOW_OBSERVER_FAILED',
            'PRIMARY_WINDOW_READBACK_ERROR',
            {},
            error,
          ));
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
    };

    const runReadyContinuation = () => {
      if (readyContinuationStarted) return;
      readyContinuationStarted = true;
      void continueStartupAfterReady().catch((error) => {
        console.error(JSON.stringify({
          schema: 'metaengine.browser.ready-continuation.v1',
          state: 'ERROR',
          error: String(error?.message || error).slice(0, 300),
          browser_bootstrap_barrier_released: false,
          terminal: false,
          authority_effect: false,
        }));
        void recordStartup(
          'APP_READY_CONTINUATION_FAILED',
          'ELECTRON_READY_CONTINUATION_ERROR',
          { browser_bootstrap_barrier_released: false },
          error,
        );
        try {
          dialog.showErrorBox(
            'METAENGINE Browser — startup bootstrap error',
            [
              'Electron became ready, but the Browser bootstrap continuation failed.',
              'The Browser window was not released because host bootstrap did not settle safely.',
              '',
              `Diagnostic: ${String(error?.message || error).slice(0, 300)}`,
            ].join('\n'),
          );
        } catch {}
      });
    };

    void recordStartup('APP_READY_CONTINUATION_ARMED', 'ELECTRON_READY_EVENT_LISTENER_ARMED');
    if (typeof app.isReady === 'function' && app.isReady()) {
      // Preserve one-shot ordering even if readiness raced with the earlier local
      // startup inspection. Never invoke the continuation inline during ESM
      // evaluation.
      setImmediate(runReadyContinuation);
    } else {
      app.once('ready', runReadyContinuation);
    }
  }
}
