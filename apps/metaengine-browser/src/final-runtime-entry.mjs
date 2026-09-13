import { registerHooks } from 'node:module';
import { app, BaseWindow } from 'electron';
import { requestPrimaryWindowResurrection } from './primary-window-resurrection.mjs';

const mainUrl = new URL('./main.mjs', import.meta.url).href;
const developmentPlaneUrl = new URL('./development-plane.mjs', import.meta.url).href;
const activatedDevelopmentPlaneUrl = new URL('./development-plane-activated.mjs', import.meta.url).href;
const nativeSupervisorUrl = new URL('./native-supervisor-client.mjs', import.meta.url).href;
const activatedNativeSupervisorUrl = new URL('./native-supervisor-client-activated.mjs', import.meta.url).href;
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
    if (context.parentURL !== mainUrl) return resolved;
    if (resolved.url === developmentPlaneUrl) {
      return { url: activatedDevelopmentPlaneUrl, shortCircuit: true };
    }
    if (resolved.url === nativeSupervisorUrl) {
      return { url: activatedNativeSupervisorUrl, shortCircuit: true };
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
  primary_ui_resurrection: primaryUiRecoveryEnabled,
  probe_stdout_reserved: probeStdoutReserved,
  second_scheduler: false,
  production_authority_fabricated: false,
  authority_effect: false,
});
if (probeStdoutReserved) console.error(activationEntryRow);
else console.log(activationEntryRow);

await import('./main-entry.mjs');
