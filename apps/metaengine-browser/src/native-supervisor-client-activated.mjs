import path from 'node:path';
import { NativeSupervisorClient as ProvenNativeSupervisorClient } from './native-supervisor-client.mjs';
import {
  finalRuntimeActivationRegistrySnapshot,
  markFinalRuntimeSupervisorStarted,
  markFinalRuntimeSupervisorStopped,
  quiesceFinalRuntimeSupervisor,
  registerFinalRuntimeSupervisor,
} from './final-runtime-activation-registry.mjs';

export * from './native-supervisor-client.mjs';

async function currentUrlFromBrowserState(getBrowserState, command) {
  const state = await getBrowserState();
  const requestedTabId = String(command?.payload?.tab_id || '');
  if (requestedTabId) {
    const row = Array.isArray(state?.tabs)
      ? state.tabs.find((tab) => String(tab?.tab_id || '') === requestedTabId)
      : null;
    if (!row?.url) throw new Error('final_runtime_exact_tab_url_unavailable');
    return String(row.url);
  }
  const active = state?.active_tab || (Array.isArray(state?.tabs) ? state.tabs.find((tab) => tab?.selected === true) : null);
  if (!active?.url) throw new Error('final_runtime_active_tab_url_unavailable');
  return String(active.url);
}

export class NativeSupervisorClient extends ProvenNativeSupervisorClient {
  #finalRuntimeRegistered = false;

  constructor(options = {}) {
    const sourceBeforeSelfUpdateInstall = options.beforeSelfUpdateInstall;
    let finalRuntimeSupervisor = null;
    super({
      ...options,
      beforeSelfUpdateInstall: async (receipt) => {
        if (!finalRuntimeSupervisor) throw new Error('final_runtime_self_update_supervisor_not_ready');
        const quiesced = await quiesceFinalRuntimeSupervisor(finalRuntimeSupervisor, 'SELF_UPDATE_INSTALLER_HANDOFF');
        if (quiesced.state !== 'IDLE' || quiesced.supervisor_started !== false) {
          throw new Error(`final_runtime_self_update_quiesce_failed:${quiesced.state}`);
        }
        return sourceBeforeSelfUpdateInstall?.(receipt);
      },
    });
    finalRuntimeSupervisor = this;

    const identity = options.identity;
    const getBrowserState = options.getState;
    const executeCommand = options.executeCommand;
    const controlStatePath = String(options.controlStatePath || '');
    if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
      throw new Error('final_runtime_native_supervisor_identity_required');
    }
    if (typeof getBrowserState !== 'function') throw new Error('final_runtime_native_supervisor_state_required');
    if (typeof executeCommand !== 'function') throw new Error('final_runtime_native_supervisor_executor_required');
    if (!controlStatePath) throw new Error('final_runtime_native_supervisor_control_state_path_required');

    registerFinalRuntimeSupervisor(this, {
      userDataPath: path.dirname(controlStatePath),
      appVersion: String(options.version || '0.0.0'),
      identity,
      getBrowserState,
      getCurrentUrl: (command) => currentUrlFromBrowserState(getBrowserState, command),
      executeCommand,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
    });
    this.#finalRuntimeRegistered = true;
  }

  async start() {
    const result = await super.start();
    try {
      const activation = await markFinalRuntimeSupervisorStarted(this);
      if (activation.state !== 'READY') throw new Error(`final_runtime_activation_required:${activation.state}`);
      return result;
    } catch (error) {
      try { super.stop(); } catch {}
      throw error;
    }
  }

  stop() {
    if (this.#finalRuntimeRegistered) markFinalRuntimeSupervisorStopped(this);
    return super.stop();
  }

  finalRuntimeActivationSnapshot() {
    return finalRuntimeActivationRegistrySnapshot();
  }
}