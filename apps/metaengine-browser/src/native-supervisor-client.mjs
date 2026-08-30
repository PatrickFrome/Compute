import { DevOsNativeTaskCycle } from './devos-native-task-cycle.mjs';
import {
  NativeSupervisorClient as BaseNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  planPostRestoreBlankTabCleanup,
} from './native-supervisor-client-base.mjs';

export { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_RUNTIME_PATH, planPostRestoreBlankTabCleanup };

const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);

export class NativeSupervisorClient extends BaseNativeSupervisorClient {
  #devosTaskCycle;
  #lastDevosError = null;

  constructor(options = {}) {
    const identity = options.identity;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const getState = options.getState;
    const executeCommand = options.executeCommand;
    if (!identity) throw new Error('native_supervisor_identity_required');
    if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
    if (typeof executeCommand !== 'function') throw new Error('native_supervisor_command_executor_required');

    let devosRef = null;
    const executeCommandWithDevosLifecycle = async (command) => {
      if (String(command?.action || '') === 'FLEET_TASK_COMPLETE') {
        if (!devosRef) throw new Error('devos_task_cycle_not_initialized');
        return devosRef.completeFromTrustedCommand(command?.payload || {});
      }
      return executeCommand(command);
    };

    super({ ...options, fetchImpl, executeCommand: executeCommandWithDevosLifecycle });

    const signedRequest = async (path, { method = 'POST', payload = null } = {}) => {
      const bodyText = method === 'GET' ? '' : JSON.stringify(payload ?? {});
      const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
      const headers = await identity.deviceHeaders(method, requestPath, bodyText);
      const init = { method, headers, cache: 'no-store' };
      if (method !== 'GET') init.body = bodyText;
      return fetchImpl(`${NATIVE_SUPERVISOR_BASE}${path}`, init);
    };

    devosRef = new DevOsNativeTaskCycle({
      getState,
      executeCommand,
      signedRequest,
    });
    this.#devosTaskCycle = devosRef;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      devos_task_cycle: this.#devosTaskCycle?.snapshot() || null,
      devos_last_error: this.#lastDevosError,
      devos_scheduler_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      devos_second_polling_loop: false,
    };
  }

  async cycle() {
    await super.cycle();
    const supervisor = super.snapshot();
    const identity = supervisor?.identity || {};
    if (identity.device_id && supervisor.supervisor_mode === 'CONTROL' && supervisor.armed === true) {
      try {
        await this.#devosTaskCycle.cycle();
        this.#lastDevosError = null;
      } catch (error) {
        // DevOS is an additive heartbeat stage. A coordination fault must not stop
        // the existing supervisor heartbeat/command loop or trigger effect replay.
        this.#lastDevosError = clipError(error);
      }
    }
    return this.snapshot();
  }
}
