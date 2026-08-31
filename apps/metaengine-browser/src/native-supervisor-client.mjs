import { DevOsNativeTaskCycle } from './devos-native-task-cycle.mjs';
import {
  NativeSupervisorClient as BaseNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  planPostRestoreBlankTabCleanup,
} from './native-supervisor-client-base.mjs';

export { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_RUNTIME_PATH, planPostRestoreBlankTabCleanup };

const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);
const DEFAULT_REQUEST_DEADLINE_MS = 8000;

function isCommandResultUrl(value) {
  try {
    const pathname = new URL(String(value)).pathname;
    return /\/v1\/commands\/[^/]+\/result$/.test(pathname);
  } catch {
    return false;
  }
}

export function createBoundedSupervisorFetch(fetchImpl, { deadlineMs = DEFAULT_REQUEST_DEADLINE_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
  const boundedMs = Math.max(1000, Math.min(30000, Number(deadlineMs) || DEFAULT_REQUEST_DEADLINE_MS));
  return async (url, init = {}) => {
    // Result posting follows an effectful command. A local timeout there would turn
    // an unknown receipt outcome into a misleading FAILED path in the legacy base
    // client. Leave result delivery un-aborted until the receipt state machine is
    // upgraded to explicit ambiguous-result readback.
    if (isCommandResultUrl(url) || init.signal) return fetchImpl(url, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('native_supervisor_request_deadline')), boundedMs);
    timer.unref?.();
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

export class NativeSupervisorClient extends BaseNativeSupervisorClient {
  #devosTaskCycle;
  #lastDevosError = null;

  constructor(options = {}) {
    const identity = options.identity;
    const rawFetch = options.fetchImpl ?? globalThis.fetch;
    const getState = options.getState;
    const executeCommand = options.executeCommand;
    if (!identity) throw new Error('native_supervisor_identity_required');
    if (typeof rawFetch !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
    if (typeof executeCommand !== 'function') throw new Error('native_supervisor_command_executor_required');

    const boundedFetch = createBoundedSupervisorFetch(rawFetch, { deadlineMs: options.requestDeadlineMs });
    let devosRef = null;
    const executeCommandWithDevosLifecycle = async (command) => {
      if (String(command?.action || '') === 'FLEET_TASK_COMPLETE') {
        if (!devosRef) throw new Error('devos_task_cycle_not_initialized');
        return devosRef.completeFromTrustedCommand(command?.payload || {});
      }
      return executeCommand(command);
    };

    super({ ...options, fetchImpl: boundedFetch, executeCommand: executeCommandWithDevosLifecycle });

    const signedRequest = async (path, { method = 'POST', payload = null } = {}) => {
      const bodyText = method === 'GET' ? '' : JSON.stringify(payload ?? {});
      const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
      const headers = await identity.deviceHeaders(method, requestPath, bodyText);
      const init = { method, headers, cache: 'no-store' };
      if (method !== 'GET') init.body = bodyText;
      return boundedFetch(`${NATIVE_SUPERVISOR_BASE}${path}`, init);
    };

    devosRef = new DevOsNativeTaskCycle({ getState, executeCommand, signedRequest });
    this.#devosTaskCycle = devosRef;
  }

  snapshot() {
    return {
      ...super.snapshot(),
      devos_task_cycle: this.#devosTaskCycle?.snapshot() || null,
      devos_last_error: this.#lastDevosError,
      devos_scheduler_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      devos_second_polling_loop: false,
      bounded_read_deadline_ms: DEFAULT_REQUEST_DEADLINE_MS,
      command_result_timeout_disabled_until_ambiguous_receipt_readback: true,
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
        // DevOS is an additive stage of the existing heartbeat scheduler. A DB or
        // route fault never creates a second poll loop and never authorizes replay.
        this.#lastDevosError = clipError(error);
      }
    }
    return this.snapshot();
  }
}
