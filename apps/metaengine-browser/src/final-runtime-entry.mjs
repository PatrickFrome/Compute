import { registerHooks } from 'node:module';
import { app, BaseWindow } from 'electron';
import { requestPrimaryWindowResurrection } from './primary-window-resurrection.mjs';

const mainUrl = new URL('./main.mjs', import.meta.url).href;
const developmentPlaneUrl = new URL('./development-plane.mjs', import.meta.url).href;
const activatedDevelopmentPlaneUrl = new URL('./development-plane-activated.mjs', import.meta.url).href;
const nativeSupervisorUrl = new URL('./native-supervisor-client.mjs', import.meta.url).href;
const activatedNativeSupervisorUrl = new URL('./native-supervisor-client-activated.mjs', import.meta.url).href;
const realtimeProcessPlaneUrl = new URL('./browser-realtime-process-plane.mjs', import.meta.url).href;
const activatedRealtimeProcessPlaneUrl = new URL('./browser-realtime-process-plane-activated.mjs', import.meta.url).href;
const nativeBrowserControlUrl = new URL('./native-browser-control.mjs', import.meta.url).href;
const activatedNativeBrowserControlUrl = new URL('./native-browser-control-activated.mjs', import.meta.url).href;
const probeStdoutReserved = process.argv.some((arg) => [
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-single-instance-probe',
  '--metaengine-self-update-smoke',
].includes(String(arg || '')));
const primaryUiRecoveryEnabled = !process.argv.some((arg) => [
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-single-instance-probe',
  '--metaengine-self-update-smoke',
  '--metaengine-smoke',
  '--metaengine-devplane-smoke',
].includes(String(arg || '')));

// This listener is deliberately installed before main-entry acquires the
// single-instance lock. main-entry remains the authority for exact launch-nonce
// ACKs. This layer only asks the already-live primary runtime to execute its
// existing `activate` recovery path when a second launch arrives and the primary
// owns no BaseWindow. It never starts another Browser process, kills the primary,
// or mutates self-update authority.
let primaryUiRecoveryInFlight = null;
if (primaryUiRecoveryEnabled) {
  app.on('second-instance', () => {
    if (primaryUiRecoveryInFlight) return;
    primaryUiRecoveryInFlight = requestPrimaryWindowResurrection({ app, BaseWindow })
      .then((result) => {
        if (result.recovery_requested || !result.ok) {
          console.error(JSON.stringify({
            schema: 'metaengine.browser.final-runtime-primary-ui-recovery.v1',
            state: result.ok ? 'PRIMARY_UI_RECOVERY_REQUESTED' : 'PRIMARY_UI_RECOVERY_UNAVAILABLE',
            reason: result.reason,
            recovery_requested: result.recovery_requested === true,
            second_browser_runtime_started: false,
            primary_terminated: false,
            update_authority_effect: false,
            authority_effect: false,
          }));
        }
        return result;
      })
      .catch((error) => {
        console.error(JSON.stringify({
          schema: 'metaengine.browser.final-runtime-primary-ui-recovery.v1',
          state: 'PRIMARY_UI_RECOVERY_ERROR',
          error: String(error?.message || error).slice(0, 240),
          recovery_requested: false,
          second_browser_runtime_started: false,
          primary_terminated: false,
          update_authority_effect: false,
          authority_effect: false,
        }));
        return null;
      })
      .finally(() => {
        primaryUiRecoveryInFlight = null;
      });
  });
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (context.parentURL === nativeSupervisorUrl && resolved.url === realtimeProcessPlaneUrl) {
      return { url: activatedRealtimeProcessPlaneUrl, shortCircuit: true };
    }
    if (context.parentURL !== mainUrl) return resolved;
    if (resolved.url === developmentPlaneUrl) {
      return { url: activatedDevelopmentPlaneUrl, shortCircuit: true };
    }
    if (resolved.url === nativeSupervisorUrl) {
      return { url: activatedNativeSupervisorUrl, shortCircuit: true };
    }
    if (resolved.url === nativeBrowserControlUrl) {
      return { url: activatedNativeBrowserControlUrl, shortCircuit: true };
    }
    return resolved;
  },
});

const activationEntryRow = JSON.stringify({
  schema: 'metaengine.browser.final-runtime-entry.v1',
  state: 'ACTIVATION_HOOK_INSTALLED',
  main_module: 'main.mjs',
  development_plane_mode: 'PROVEN_RUNTIME_PLUS_FINAL_ACTIVATION',
  native_supervisor_mode: 'PROVEN_RUNTIME_PLUS_HOST_VEF_FAST_CONTROL',
  realtime_process_plane_mode: 'PROVEN_RUNTIME_PLUS_COGNITIVE_CURSOR_COMPLETION',
  native_browser_control_mode: 'PROVEN_RUNTIME_PLUS_HIDDEN_VIEW_CAPTURE_ACTIVATION',
  primary_ui_resurrection: primaryUiRecoveryEnabled,
  probe_stdout_reserved: probeStdoutReserved,
  second_scheduler: false,
  production_authority_fabricated: false,
  authority_effect: false,
});
if (probeStdoutReserved) console.error(activationEntryRow);
else console.log(activationEntryRow);

await import('./main-entry.mjs');

// main-entry owns single-instance authority and has already imported main.mjs,
// so the normal Browser `activate` handler is registered before this point. Do
// not block top-level module evaluation waiting for Electron readiness: doing so
// can delay the very `ready` edge we need. Instead arm one exact one-shot ready
// continuation. On the edge it asks the existing primary runtime to execute its
// already-registered activate path; the HostResilience bootstrap barrier inside
// main.mjs still fences actual window creation.
const primaryInstance = typeof app.hasSingleInstanceLock !== 'function'
  || app.hasSingleInstanceLock() === true;
if (primaryUiRecoveryEnabled && primaryInstance) {
  const requestInitialPrimaryUi = () => {
    void requestPrimaryWindowResurrection({
      app,
      BaseWindow,
      timeout_ms: 0,
    }).then((result) => {
      if (result.recovery_requested || !result.ok) {
        console.error(JSON.stringify({
          schema: 'metaengine.browser.final-runtime-initial-ui-bootstrap.v1',
          state: result.ok ? 'PRIMARY_UI_BOOTSTRAP_REQUESTED' : 'PRIMARY_UI_BOOTSTRAP_UNAVAILABLE',
          reason: result.reason,
          error: null,
          recovery_requested: result.recovery_requested === true,
          second_browser_runtime_started: false,
          primary_terminated: false,
          update_authority_effect: false,
          authority_effect: false,
        }));
      }
      return result;
    }).catch((error) => {
      console.error(JSON.stringify({
        schema: 'metaengine.browser.final-runtime-initial-ui-bootstrap.v1',
        state: 'PRIMARY_UI_BOOTSTRAP_ERROR',
        reason: 'PRIMARY_UI_INITIAL_BOOTSTRAP_ERROR',
        error: String(error?.message || error).slice(0, 240),
        recovery_requested: false,
        second_browser_runtime_started: false,
        primary_terminated: false,
        update_authority_effect: false,
        authority_effect: false,
      }));
    });
  };

  if (typeof app.isReady === 'function' && app.isReady()) {
    queueMicrotask(requestInitialPrimaryUi);
  } else {
    app.once('ready', requestInitialPrimaryUi);
  }
}

// ── ME2 SMART MERGE (R40): плоскость интеграции METAENGINE 2 ─────────────
// Fail-open и zero-authority по построению: при ME2_INTEGRATION=0, отсутствии
// ME2-рунтайма на хосте или любых ошибках — браузер работает ровно как раньше.
// Не касается self-update authority, single-instance, second-scheduler, окон.
// Карта слияния: docs/me2-smart-merge-r40.md
if (!probeStdoutReserved && primaryUiRecoveryEnabled && process.env.ME2_INTEGRATION !== '0') {
  import('./me2/me2-integration-entry.mjs')
    .then((me2) => {
      const r = me2.startMe2Integration({ app });
      if (r && typeof r.catch === 'function') {
        r.catch((error) => console.error(JSON.stringify({
          schema: 'metaengine.browser.me2.integration.v1',
          state: 'ME2_INTEGRATION_START_FAILED',
          error: String(error?.message || error).slice(0, 240),
          update_authority_effect: false,
          authority_effect: false,
        })));
      }
    })
    .catch((error) => console.error(JSON.stringify({
      schema: 'metaengine.browser.me2.integration.v1',
      state: 'ME2_INTEGRATION_IMPORT_FAILED',
      error: String(error?.message || error).slice(0, 240),
      update_authority_effect: false,
      authority_effect: false,
    })));
}
