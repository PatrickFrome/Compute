import { DevOsNativeTaskCycle } from './devos-native-task-cycle.mjs';
import {
  assertNativeEffectBindingMatches,
  buildNativeEffectBinding,
  nativeActionRequiresEffectBinding,
} from './native-effect-binding.mjs';
import {
  NativeSupervisorClient as BaseNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  planPostRestoreBlankTabCleanup,
} from './native-supervisor-client-base.mjs';

export { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_RUNTIME_PATH, planPostRestoreBlankTabCleanup };

const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);
const DEFAULT_REQUEST_DEADLINE_MS = 8000;
const DEFAULT_BOOTSTRAP_HEARTBEAT_MS = 2000;

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

export function buildBootstrapHeartbeatPayload({ state = {}, version = '0.0.0', startedAt = null } = {}) {
  return Object.freeze({
    state: {
      ...(state && typeof state === 'object' ? structuredClone(state) : {}),
      shell_version: String(version || '0.0.0'),
      supervisor_mode: 'MONITOR',
      armed: false,
      operator_mode: 'OBSERVE',
      started_at: startedAt || new Date().toISOString(),
      supervisor_lifecycle: null,
      self_update: null,
      self_update_session_continuity: {
        state: 'BOOTSTRAP_RESTORE_PENDING',
        restored_tabs: 0,
        target_version: null,
        authority_effect: false,
      },
      bootstrap_heartbeat: true,
      authority_effect: false,
    },
    last_command_id: null,
    last_command_status: null,
  });
}

export async function sendBootstrapHeartbeat({ identity, fetchImpl, getState, version, startedAt } = {}) {
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') throw new Error('native_supervisor_identity_required');
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
  if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
  const identityState = await identity.ensure();
  if (!identityState?.device_id) return Object.freeze({ sent: false, reason: 'DEVICE_NOT_ENROLLED', authority_effect: false });
  const payload = buildBootstrapHeartbeatPayload({ state: await getState(), version, startedAt });
  const bodyText = JSON.stringify(payload);
  const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`;
  const headers = await identity.deviceHeaders('POST', requestPath, bodyText);
  const response = await fetchImpl(`${NATIVE_SUPERVISOR_BASE}/v1/state`, {
    method: 'POST', headers, body: bodyText, cache: 'no-store',
  });
  if (response.status !== 202) throw new Error(`native_supervisor_bootstrap_state_http_${response.status}`);
  return Object.freeze({ sent: true, at: new Date().toISOString(), authority_effect: false });
}

export class NativeSupervisorClient extends BaseNativeSupervisorClient {
  #devosTaskCycle;
  #lastDevosError = null;
  #identityRef;
  #boundedFetch;
  #getStateRef;
  #versionRef;
  #bootstrapHeartbeatMs;
  #bootstrapTimer = null;
  #bootstrapInFlight = false;
  #bootstrapLastAt = null;
  #bootstrapLastError = null;
  #startPromise = null;

  constructor(options = {}) {
    const identity = options.identity;
    const rawFetch = options.fetchImpl ?? globalThis.fetch;
    const getState = options.getState;
    const executeCommand = options.executeCommand;
    const prepareEffectBinding = options.prepareEffectBinding;
    if (!identity) throw new Error('native_supervisor_identity_required');
    if (typeof rawFetch !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
    if (typeof executeCommand !== 'function') throw new Error('native_supervisor_command_executor_required');
    if (prepareEffectBinding != null && typeof prepareEffectBinding !== 'function') throw new Error('native_supervisor_effect_binding_provider_invalid');

    const boundedFetch = createBoundedSupervisorFetch(rawFetch, { deadlineMs: options.requestDeadlineMs });
    let devosRef = null;
    let sealEffectRef = null;
    const executeCommandWithDevosLifecycle = async (command) => {
      if (String(command?.action || '') === 'FLEET_TASK_COMPLETE') {
        if (!devosRef) throw new Error('devos_task_cycle_not_initialized');
        return devosRef.completeFromTrustedCommand(command?.payload || {});
      }
      if (nativeActionRequiresEffectBinding(command?.action)) {
        if (!sealEffectRef) throw new Error('native_supervisor_effect_binding_not_initialized');
        return sealEffectRef(command);
      }
      return executeCommand(command);
    };

    super({ ...options, fetchImpl: boundedFetch, executeCommand: executeCommandWithDevosLifecycle });

    this.#identityRef = identity;
    this.#boundedFetch = boundedFetch;
    this.#getStateRef = getState;
    this.#versionRef = String(options.version || '0.0.0');
    this.#bootstrapHeartbeatMs = Math.max(1000, Number(options.bootstrapHeartbeatMs) || DEFAULT_BOOTSTRAP_HEARTBEAT_MS);

    const signedRequest = async (path, { method = 'POST', payload = null } = {}) => {
      const bodyText = method === 'GET' ? '' : JSON.stringify(payload ?? {});
      const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
      const headers = await identity.deviceHeaders(method, requestPath, bodyText);
      const init = { method, headers, cache: 'no-store' };
      if (method !== 'GET') init.body = bodyText;
      return boundedFetch(`${NATIVE_SUPERVISOR_BASE}${path}`, init);
    };

    sealEffectRef = async (command) => {
      if (typeof prepareEffectBinding !== 'function') throw new Error('native_supervisor_effect_binding_provider_required');
      const observed = await prepareEffectBinding(command);
      const identityState = await identity.ensure();
      const binding = buildNativeEffectBinding({
        command,
        clientId: identityState.client_id,
        processIncarnationId: observed?.process_incarnation_id,
        tabId: observed?.tab_id,
        targetId: observed?.target_id,
        observedAt: observed?.observed_at,
      });
      const response = await signedRequest(`/v1/commands/${encodeURIComponent(command.command_id)}/effect-intent`, {
        payload: { binding },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.accepted !== true || !body?.effect_binding) {
        throw new Error(`native_supervisor_effect_binding_http_${response.status}:${body?.reason || body?.error || 'rejected'}`);
      }
      const sealed = assertNativeEffectBindingMatches({
        command,
        binding: body.effect_binding,
        clientId: identityState.client_id,
        processIncarnationId: observed.process_incarnation_id,
        tabId: observed.tab_id,
        targetId: observed.target_id,
      });
      return executeCommand({
        ...command,
        effect_binding: sealed,
        effect_binding_sha256: body.effect_binding_sha256 || null,
      });
    };

    devosRef = new DevOsNativeTaskCycle({ getState, executeCommand, signedRequest });
    this.#devosTaskCycle = devosRef;
  }

  async #bootstrapPulse(startedAt) {
    if (this.#bootstrapInFlight) return;
    this.#bootstrapInFlight = true;
    try {
      const result = await sendBootstrapHeartbeat({
        identity: this.#identityRef,
        fetchImpl: this.#boundedFetch,
        getState: this.#getStateRef,
        version: this.#versionRef,
        startedAt,
      });
      if (result.sent) this.#bootstrapLastAt = result.at;
      this.#bootstrapLastError = result.sent ? null : result.reason;
    } catch (error) {
      this.#bootstrapLastError = clipError(error);
    } finally {
      this.#bootstrapInFlight = false;
    }
  }

  #startBootstrapPump(startedAt) {
    if (this.#bootstrapTimer) return;
    void this.#bootstrapPulse(startedAt);
    this.#bootstrapTimer = setInterval(() => { void this.#bootstrapPulse(startedAt); }, this.#bootstrapHeartbeatMs);
    this.#bootstrapTimer.unref?.();
  }

  #stopBootstrapPump() {
    if (this.#bootstrapTimer) clearInterval(this.#bootstrapTimer);
    this.#bootstrapTimer = null;
  }

  async start() {
    if (this.#startPromise) return this.#startPromise;
    const startedAt = new Date().toISOString();
    this.#startBootstrapPump(startedAt);
    this.#startPromise = Promise.resolve()
      .then(() => super.start())
      .finally(() => {
        this.#stopBootstrapPump();
        this.#startPromise = null;
      });
    return this.#startPromise;
  }

  stop() {
    this.#stopBootstrapPump();
    return super.stop();
  }

  snapshot() {
    return {
      ...super.snapshot(),
      devos_task_cycle: this.#devosTaskCycle?.snapshot() || null,
      devos_last_error: this.#lastDevosError,
      devos_scheduler_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      devos_second_polling_loop: false,
      generic_tab_effect_binding: 'SIGNED_DB_COMMAND_INTENT_V1',
      bounded_read_deadline_ms: DEFAULT_REQUEST_DEADLINE_MS,
      command_result_timeout_disabled_until_ambiguous_receipt_readback: true,
      bootstrap_heartbeat: {
        active: this.#bootstrapTimer != null,
        interval_ms: this.#bootstrapHeartbeatMs,
        last_at: this.#bootstrapLastAt,
        last_error: this.#bootstrapLastError,
        control_authority: false,
        command_leasing: false,
        authority_effect: false,
      },
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
