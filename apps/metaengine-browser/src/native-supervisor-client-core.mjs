import { BoundedWorkerObserver } from './bounded-worker-observer.mjs';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';
import { DevOsNativeTaskCycle } from './devos-native-task-cycle.mjs';
import {
  assertNativeEffectBindingMatches,
  buildNativeEffectBinding,
  nativeActionRequiresEffectBinding,
} from './native-effect-binding.mjs';
import { buildSupervisorMeshWireProjectionV1 } from './supervisor-mesh-wire-projection.mjs';
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
export const DEFAULT_SUPERVISOR_WATCHDOG_STALE_MS = 5000;

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

export function supervisorHeartbeatIsStale(snapshot, {
  nowMs = Date.now(),
  staleMs = DEFAULT_SUPERVISOR_WATCHDOG_STALE_MS,
  watchdogLastAt = null,
} = {}) {
  const primaryMs = Date.parse(String(snapshot?.last_heartbeat_at || ''));
  const watchdogMs = Date.parse(String(watchdogLastAt || ''));
  const lastMs = Math.max(
    Number.isFinite(primaryMs) ? primaryMs : Number.NEGATIVE_INFINITY,
    Number.isFinite(watchdogMs) ? watchdogMs : Number.NEGATIVE_INFINITY,
  );
  return !Number.isFinite(lastMs) || nowMs - lastMs >= Math.max(1000, Number(staleMs) || DEFAULT_SUPERVISOR_WATCHDOG_STALE_MS);
}

export function buildSupervisorWatchdogHeartbeatPayload({ state = {}, supervisor = {}, version = '0.0.0', startedAt = null } = {}) {
  const mode = ['OFF','MONITOR','CONTROL'].includes(String(supervisor?.supervisor_mode || '').toUpperCase())
    ? String(supervisor.supervisor_mode).toUpperCase()
    : 'MONITOR';
  return Object.freeze({
    state: {
      ...(state && typeof state === 'object' ? structuredClone(state) : {}),
      shell_version: String(version || '0.0.0'),
      supervisor_mode: mode,
      armed: supervisor?.armed === true,
      operator_mode: mode === 'CONTROL' ? 'CONTROL' : 'OBSERVE',
      started_at: supervisor?.started_at || startedAt || new Date().toISOString(),
      last_error: supervisor?.last_error || null,
      supervisor_lifecycle: supervisor?.lifecycle ? structuredClone(supervisor.lifecycle) : null,
      self_update: supervisor?.self_update ? structuredClone(supervisor.self_update) : null,
      self_update_session_continuity: supervisor?.session_continuity
        ? structuredClone(supervisor.session_continuity)
        : { state: 'NONE', restored_tabs: 0, target_version: null, authority_effect: false },
      watchdog_heartbeat: true,
      authority_effect: false,
    },
    last_command_id: supervisor?.last_command_id || null,
    last_command_status: supervisor?.last_command_status || null,
  });
}

export function buildWorkerObserverHeartbeatProjection({
  observerSnapshot = null,
  signals = [],
  observedAt = null,
  lastError = null,
} = {}) {
  const safeSignals = Array.isArray(signals) ? signals.map((row) => ({
    agent_id: String(row?.agent_id || ''),
    lifecycle_state: row?.lifecycle_state == null ? null : String(row.lifecycle_state),
    generation_state: String(row?.generation_state || 'UNKNOWN'),
    observation_state: String(row?.observation_state || 'UNKNOWN'),
    lease_eligible: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  })) : [];
  return Object.freeze({
    schema: 'metaengine.bounded-worker-observer.heartbeat.v1',
    observer: observerSnapshot ? structuredClone(observerSnapshot) : null,
    observed_at: observedAt || null,
    signals: safeSignals,
    last_error: lastError || null,
    lease_eligible: false,
    scheduler_authority: false,
    control_authority: false,
    command_leasing: false,
    devos_leasing: false,
    second_polling_loop: false,
    authority_effect: false,
  });
}

async function postStateHeartbeat({ identity, fetchImpl, payload } = {}) {
  const identityState = await identity.ensure();
  if (!identityState?.device_id) return Object.freeze({ sent: false, reason: 'DEVICE_NOT_ENROLLED', authority_effect: false });
  const bodyText = JSON.stringify(payload);
  const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`;
  const headers = await identity.deviceHeaders('POST', requestPath, bodyText);
  const response = await fetchImpl(`${NATIVE_SUPERVISOR_BASE}/v1/state`, {
    method: 'POST', headers, body: bodyText, cache: 'no-store',
  });
  if (response.status !== 202) throw new Error(`native_supervisor_watchdog_state_http_${response.status}`);
  return Object.freeze({ sent: true, at: new Date().toISOString(), authority_effect: false });
}

export async function sendBootstrapHeartbeat({ identity, fetchImpl, getState, version, startedAt } = {}) {
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') throw new Error('native_supervisor_identity_required');
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
  if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
  return postStateHeartbeat({
    identity,
    fetchImpl,
    payload: buildBootstrapHeartbeatPayload({ state: await getState(), version, startedAt }),
  });
}

export class NativeSupervisorClient extends BaseNativeSupervisorClient {
  #devosTaskCycle;
  #lastDevosError = null;
  #identityRef;
  #boundedFetch;
  #getStateRef;
  #versionRef;
  #bootstrapHeartbeatMs;
  #watchdogStaleMs;
  #bootstrapTimer = null;
  #bootstrapInFlight = false;
  #bootstrapLastAt = null;
  #bootstrapLastError = null;
  #startPromise = null;
  #workerObserver = null;
  #workerObserveLocalTarget = null;
  #workerGetState = null;
  #workerExecuteCommand = null;
  #workerObservationSignals = [];
  #workerObservationLastAt = null;
  #workerObservationLastError = null;

  constructor(options = {}) {
    const identity = options.identity;
    const rawFetch = options.fetchImpl ?? globalThis.fetch;
    const getState = options.getState;
    const executeCommand = options.executeCommand;
    const prepareEffectBinding = options.prepareEffectBinding;
    const observeLocalTarget = options.observeLocalTarget;
    if (!identity) throw new Error('native_supervisor_identity_required');
    if (typeof rawFetch !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
    if (typeof executeCommand !== 'function') throw new Error('native_supervisor_command_executor_required');
    if (prepareEffectBinding != null && typeof prepareEffectBinding !== 'function') throw new Error('native_supervisor_effect_binding_provider_invalid');
    if (observeLocalTarget != null && typeof observeLocalTarget !== 'function') throw new Error('native_supervisor_worker_observer_invalid');

    const boundedFetch = createBoundedSupervisorFetch(rawFetch, { deadlineMs: options.requestDeadlineMs });
    let devosRef = null;
    let sealEffectRef = null;
    let clientRef = null;
    const getStateWithMeshProjection = async () => {
      const state = await getState();
      const localSnapshot = clientRef?.snapshot?.() || null;
      const localMeshRuntime = localSnapshot?.supervisor_mesh || null;
      const supervisorMesh = buildSupervisorMeshWireProjectionV1(localMeshRuntime);
      const workerObserver = localSnapshot?.worker_observer || null;
      return {
        ...state,
        ...(supervisorMesh ? { supervisor_mesh: supervisorMesh } : {}),
        ...(workerObserver ? { worker_observer: workerObserver } : {}),
      };
    };
    const executeCommandWithDevosLifecycle = async (command) => {
      if (String(command?.action || '') === 'FLEET_TASK_COMPLETE') {
        if (!devosRef) throw new Error('devos_task_cycle_not_initialized');
        return devosRef.completeFromTrustedCommand(command?.payload || {});
      }
      // Only remote DB-leased commands carry command_id. Local supervisor lifecycle
      // and DevOS have their own durable proof contracts and are audited separately.
      if (command?.command_id && nativeActionRequiresEffectBinding(command?.action)) {
        if (!sealEffectRef) throw new Error('native_supervisor_effect_binding_not_initialized');
        return sealEffectRef(command);
      }
      return executeCommand(command);
    };

    super({ ...options, getState: getStateWithMeshProjection, fetchImpl: boundedFetch, executeCommand: executeCommandWithDevosLifecycle });
    clientRef = this;

    this.#identityRef = identity;
    this.#boundedFetch = boundedFetch;
    this.#getStateRef = getStateWithMeshProjection;
    this.#versionRef = String(options.version || '0.0.0');
    this.#bootstrapHeartbeatMs = Math.max(1000, Number(options.bootstrapHeartbeatMs) || DEFAULT_BOOTSTRAP_HEARTBEAT_MS);
    this.#watchdogStaleMs = Math.max(this.#bootstrapHeartbeatMs * 2, Number(options.watchdogStaleMs) || DEFAULT_SUPERVISOR_WATCHDOG_STALE_MS);
    if (observeLocalTarget) {
      this.#workerObserver = new BoundedWorkerObserver({ budget: options.workerObservationBudget ?? 4 });
      this.#workerObserveLocalTarget = observeLocalTarget;
      this.#workerGetState = getState;
      this.#workerExecuteCommand = executeCommand;
    }

    const signedRequest = async (path, { method = 'POST', payload = null } = {}) => {
      const bodyText = method === 'GET' ? '' : JSON.stringify(payload ?? {});
      const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
      const headers = await identity.deviceHeaders(method, requestPath, bodyText);
      const init = { method, headers, cache: 'no-store' };
      if (method !== 'GET') init.body = bodyText;
      return boundedFetch(`${NATIVE_SUPERVISOR_BASE}${path}`, init);
    };

    const observeEffectBinding = prepareEffectBinding || (async (command) => {
      const tabId = String(command?.payload?.tab_id || '');
      if (!tabId) throw new Error('native_supervisor_effect_binding_explicit_tab_required');
      const frame = await executeCommand({
        action: 'CAPTURE',
        payload: { tab_id: tabId },
        platform: command?.platform || null,
      });
      if (!frame?.process_incarnation_id || !frame?.target_id || String(frame?.tab_id || '') !== tabId) {
        throw new Error('native_supervisor_effect_binding_local_observation_invalid');
      }
      return {
        process_incarnation_id: frame.process_incarnation_id,
        tab_id: tabId,
        target_id: frame.target_id,
        observed_at: frame.captured_at || new Date().toISOString(),
      };
    });

    sealEffectRef = async (command) => {
      const observed = await observeEffectBinding(command);
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

  async #observeWorkers() {
    if (!this.#workerObserver) return;
    try {
      const state = await this.#workerGetState();
      const agents = Array.isArray(state?.fleet?.agents) ? state.fleet.agents : [];
      const signals = await this.#workerObserver.observe(agents, {
        capture: (tabId) => this.#workerExecuteCommand({ action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: tabId } }),
        isGenerating: (frame) => chatGptControlCount(frame, 'STOP') > 0,
        observeLocalTarget: this.#workerObserveLocalTarget,
      });
      this.#workerObservationSignals = structuredClone(signals);
      this.#workerObservationLastAt = new Date().toISOString();
      this.#workerObservationLastError = null;
    } catch (error) {
      // Liveness telemetry is deliberately fail-soft and has no scheduling authority.
      // Lease admission remains independently fail-closed on exact ACTIVE transport proof.
      this.#workerObservationSignals = [];
      this.#workerObservationLastAt = new Date().toISOString();
      this.#workerObservationLastError = clipError(error);
    }
  }

  #workerObserverProjection() {
    if (!this.#workerObserver) return null;
    return buildWorkerObserverHeartbeatProjection({
      observerSnapshot: this.#workerObserver.snapshot(),
      signals: this.#workerObservationSignals,
      observedAt: this.#workerObservationLastAt,
      lastError: this.#workerObservationLastError,
    });
  }

  async #bootstrapPulse(startedAt) {
    if (this.#bootstrapInFlight) return;
    const supervisor = super.snapshot();
    if (!supervisorHeartbeatIsStale(supervisor, {
      staleMs: this.#watchdogStaleMs,
      watchdogLastAt: this.#bootstrapLastAt,
    })) return;
    this.#bootstrapInFlight = true;
    try {
      const state = await this.#getStateRef();
      const payload = supervisor?.running === true
        ? buildSupervisorWatchdogHeartbeatPayload({ state, supervisor, version: this.#versionRef, startedAt })
        : buildBootstrapHeartbeatPayload({ state, version: this.#versionRef, startedAt });
      const result = await postStateHeartbeat({
        identity: this.#identityRef,
        fetchImpl: this.#boundedFetch,
        payload,
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
        // Keep the heartbeat watchdog alive after startup. It has no command leasing
        // or actuation authority and emits only when the primary heartbeat is stale.
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
      worker_observer: this.#workerObserverProjection(),
      worker_observer_source: this.#workerObserver ? 'NATIVE_SUPERVISOR_HEARTBEAT' : null,
      worker_observer_second_polling_loop: false,
      devos_task_cycle: this.#devosTaskCycle?.snapshot() || null,
      devos_last_error: this.#lastDevosError,
      devos_scheduler_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      devos_second_polling_loop: false,
      generic_tab_effect_binding: 'SIGNED_DB_COMMAND_INTENT_V1',
      supervisor_mesh_wire_projection: 'LOCAL_V2_TO_LIVE_V1_BOUNDED_16',
      bounded_read_deadline_ms: DEFAULT_REQUEST_DEADLINE_MS,
      command_result_timeout_disabled_until_ambiguous_receipt_readback: true,
      bootstrap_heartbeat: {
        active: this.#bootstrapTimer != null,
        mode: 'STALE_HEARTBEAT_WATCHDOG',
        interval_ms: this.#bootstrapHeartbeatMs,
        stale_after_ms: this.#watchdogStaleMs,
        last_at: this.#bootstrapLastAt,
        last_error: this.#bootstrapLastError,
        control_authority: false,
        command_leasing: false,
        devos_leasing: false,
        authority_effect: false,
      },
    };
  }

  async cycle() {
    // Read-only worker observation is an additive stage of this existing scheduler
    // heartbeat. It never starts a timer, issues a lease, or mutates fleet lifecycle.
    await this.#observeWorkers();
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
