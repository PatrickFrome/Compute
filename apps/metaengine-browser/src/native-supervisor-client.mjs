import {
  NativeSupervisorClient as CoreNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  createBoundedSupervisorFetch,
} from './native-supervisor-client-core.mjs';
import { BrowserRealtimeProcessPlane } from './browser-realtime-process-plane.mjs';
import {
  BROWSER_COGNITIVE_BATCH_SCHEMA,
  BrowserCognitiveDeltaTransport,
} from './browser-cognitive-delta-transport.mjs';
import {
  normalizeWorkspaceBindingSnapshot,
  unavailableWorkspaceBindingSnapshot,
} from './workspace-binding-observer.mjs';

export * from './native-supervisor-client-core.mjs';

const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
export const NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH = '/v1/cognitive/deltas';
const hostResilienceRuntime = () => globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ || null;
const hostResilienceSnapshot = () => hostResilienceRuntime()?.snapshot?.() || null;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export async function sendNativeSupervisorCognitiveBatch({ identity, fetchImpl, batch } = {}) {
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
    throw new Error('native_supervisor_cognitive_identity_required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_cognitive_fetch_required');
  if (
    !batch
    || batch.schema !== BROWSER_COGNITIVE_BATCH_SCHEMA
    || batch.raw_payload_exposed !== false
    || batch.page_text_exposed !== false
    || batch.input_values_exposed !== false
    || batch.delivery_is_authority !== false
    || batch.control_authority !== false
    || batch.command_leasing !== false
    || batch.authority_effect !== false
  ) {
    throw new Error('native_supervisor_cognitive_batch_invalid');
  }
  const identityState = await identity.ensure();
  if (!identityState?.device_id) throw new Error('native_supervisor_cognitive_device_not_enrolled');
  const bodyText = JSON.stringify(batch);
  const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH}`;
  const headers = await identity.deviceHeaders('POST', requestPath, bodyText);
  const response = await fetchImpl(`${NATIVE_SUPERVISOR_BASE}${NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH}`, {
    method: 'POST',
    headers,
    body: bodyText,
    cache: 'no-store',
  });
  return Object.freeze({
    status: Number(response?.status || 0),
    body: await response?.json?.().catch(() => null) || null,
  });
}

export function createNativeSupervisorCognitiveTransport({
  identity,
  fetchImpl,
  readDeltas,
  resync,
  onFallbackRequired,
  batchSize = 128,
} = {}) {
  return new BrowserCognitiveDeltaTransport({
    readDeltas,
    sendBatch: (batch) => sendNativeSupervisorCognitiveBatch({ identity, fetchImpl, batch }),
    resync,
    onFallbackRequired,
    batchSize,
  });
}

export function dispatchRealtimeObservationEdge({ cognitiveTransport, scheduleFullState, baselineReady = true } = {}) {
  if (typeof scheduleFullState !== 'function') throw new Error('native_supervisor_full_state_scheduler_required');
  if (baselineReady !== true) {
    scheduleFullState();
    return Object.freeze({ transport: 'FULL_STATE', reason: 'BASELINE_REQUIRED', authority_effect: false });
  }
  const state = cognitiveTransport?.snapshot?.()?.state || 'UNAVAILABLE';
  if (!cognitiveTransport || state === 'UNAVAILABLE') {
    scheduleFullState();
    return Object.freeze({ transport: 'FULL_STATE', reason: state, authority_effect: false });
  }
  const scheduled = cognitiveTransport.notify?.() === true;
  if (!scheduled) {
    scheduleFullState();
    return Object.freeze({ transport: 'FULL_STATE', reason: 'COGNITIVE_NOTIFY_REJECTED', authority_effect: false });
  }
  return Object.freeze({ transport: 'COGNITIVE_DELTA', reason: state, authority_effect: false });
}

export function exactCommandTargetProjection(command) {
  const commandId = String(command?.command_id || '').toLowerCase();
  const tabId = String(command?.payload?.tab_id || '');
  if (!COMMAND_ID_RE.test(commandId)) return null;
  return Object.freeze({
    command_id: commandId,
    target_tab_id: TAB_ID_RE.test(tabId) ? tabId : null,
    payload_exposed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}

export async function runSupervisorEnrollmentBootstrap(supervisor) {
  if (!supervisor || typeof supervisor.ensureEnrollment !== 'function') {
    throw new Error('native_supervisor_enrollment_bootstrap_required');
  }
  const row = await supervisor.ensureEnrollment();
  return Object.freeze({
    status: String(row?.status || 'UNKNOWN').slice(0, 80),
    device_id: row?.device_id ? String(row.device_id) : null,
    request_id: row?.request_id ? String(row.request_id) : null,
    command_leasing: false,
    browser_authority: false,
    automatic_retry_allowed: false,
    second_polling_loop: false,
    authority_effect: false,
  });
}

function unavailableSemanticPlane(reason = 'UNAVAILABLE') {
  return Object.freeze({
    schema: 'metaengine.browser.realtime-semantic-plane.v1',
    running: false,
    state: String(reason || 'UNAVAILABLE').slice(0, 120),
    sequence: 0,
    target_count: 0,
    ready_count: 0,
    dirty_count: 0,
    targets: [],
    events: [],
    dropped_events: 0,
    event_driven: true,
    persistent_cdp_sessions: true,
    attach_per_command: false,
    raw_cdp_passthrough: false,
    control_authority: false,
    command_leasing: false,
    second_scheduler: false,
    authority_effect: false,
  });
}

function unavailableProcessPlane(reason = 'UNAVAILABLE') {
  return Object.freeze({
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: false,
    state: String(reason || 'UNAVAILABLE').slice(0, 120),
    sequence: 0,
    observed_at: null,
    process_count: 0,
    web_contents_count: 0,
    processes: [],
    web_contents: [],
    semantic_plane: unavailableSemanticPlane(reason),
    events: [],
    dropped_events: 0,
    event_driven_lifecycle: true,
    periodic_resource_sampling: true,
    control_authority: false,
    command_leasing: false,
    second_scheduler: false,
    authority_effect: false,
  });
}

// Additive wrapper. The proven Native Supervisor implementation remains in
// native-supervisor-client-core.mjs. Workspace observation, enrollment recovery and
// realtime process/semantic planes remain observation-only additions to the same
// trusted client. They never lease commands or grant mutation authority: DB-leased
// typed commands remain the only remote Browser actuation path.
export class NativeSupervisorClient extends CoreNativeSupervisorClient {
  #workspaceIdentity;
  #workspaceFetch;
  #workspaceObservation = unavailableWorkspaceBindingSnapshot('UNINITIALIZED');
  #workspaceObservationPromise = null;
  #commandTargetProjection = null;
  #enrollmentBootstrapPromise = null;
  #enrollmentBootstrapStatus = Object.freeze({
    status: 'UNINITIALIZED',
    device_id: null,
    request_id: null,
    command_leasing: false,
    browser_authority: false,
    automatic_retry_allowed: false,
    second_polling_loop: false,
    authority_effect: false,
  });
  #enrollmentBootstrapError = null;
  #sourceGetState = null;
  #processPlaneRef = null;
  #processPlaneSet = null;
  #processPlaneError = null;
  #processPushScheduled = false;
  #processPushPromise = null;
  #processPushPending = false;
  #processPushLastAt = null;
  #processPushLastError = null;
  #cognitiveTransport = null;
  #version = '0.0.0';
  #controlLatencySnapshot = null;

  constructor(options = {}) {
    const executeCommand = options.executeCommand;
    const sourceGetState = options.getState;
    const sourceBeforeSelfUpdateInstall = options.beforeSelfUpdateInstall;
    let commandTargetProjection = null;
    let realtimeProcessPlane = null;
    let controlLatencySnapshot = () => Object.freeze({
      schema: 'metaengine.browser.control-latency-status.v1',
      state: 'UNINITIALIZED',
      authority_effect: false,
    });

    const trackedExecuteCommand = typeof executeCommand === 'function'
      ? async (command) => {
          const action = String(command?.action || '').trim().toUpperCase();
          if (action === 'PROCESS_CENSUS') {
            return realtimeProcessPlane?.snapshot({
              eventLimit: boundedInt(command?.payload?.event_limit, 32, 0, 256),
            }) || unavailableProcessPlane('PROCESS_PLANE_NOT_READY');
          }
          if (action === 'PROCESS_EVENTS') {
            const snapshot = realtimeProcessPlane?.snapshot({
              eventsSince: boundedInt(command?.payload?.after_sequence, 0, 0, Number.MAX_SAFE_INTEGER),
              eventLimit: boundedInt(command?.payload?.limit, 256, 1, 1024),
            }) || unavailableProcessPlane('PROCESS_PLANE_NOT_READY');
            return Object.freeze({
              schema: 'metaengine.browser.realtime-process-events.v1',
              running: snapshot.running === true,
              sequence: snapshot.sequence || 0,
              observed_at: snapshot.observed_at || null,
              events: Array.isArray(snapshot.events) ? structuredClone(snapshot.events) : [],
              dropped_events: Number(snapshot.dropped_events || 0),
              page_content_exposed: false,
              control_authority: false,
              authority_effect: false,
            });
          }
          if (action === 'SEMANTIC_CENSUS') {
            return realtimeProcessPlane?.semanticSnapshot({
              includeText: command?.payload?.include_text !== false,
              eventLimit: boundedInt(command?.payload?.event_limit, 32, 0, 256),
            }) || unavailableSemanticPlane('SEMANTIC_PLANE_NOT_READY');
          }
          if (action === 'SEMANTIC_EVENTS') {
            const snapshot = realtimeProcessPlane?.semanticSnapshot({
              includeText: false,
              eventsSince: boundedInt(command?.payload?.after_sequence, 0, 0, Number.MAX_SAFE_INTEGER),
              eventLimit: boundedInt(command?.payload?.limit, 256, 1, 1024),
            }) || unavailableSemanticPlane('SEMANTIC_PLANE_NOT_READY');
            return Object.freeze({
              schema: 'metaengine.browser.realtime-semantic-events.v1',
              running: snapshot.running === true,
              sequence: snapshot.sequence || 0,
              events: Array.isArray(snapshot.events) ? structuredClone(snapshot.events) : [],
              dropped_events: Number(snapshot.dropped_events || 0),
              raw_cdp_passthrough: false,
              control_authority: false,
              authority_effect: false,
            });
          }
          if (action === 'CONTROL_LATENCY_STATUS') return controlLatencySnapshot();
          const projected = exactCommandTargetProjection(command);
          if (projected) commandTargetProjection = projected;
          return executeCommand(command);
        }
      : executeCommand;

    const getStateWithHostResilience = typeof sourceGetState === 'function'
      ? async () => ({
          ...(await sourceGetState()),
          host_resilience: hostResilienceSnapshot(),
          realtime_process_plane: realtimeProcessPlane?.snapshot({ eventLimit: 64 }) || unavailableProcessPlane('PROCESS_PLANE_NOT_READY'),
          control_latency: controlLatencySnapshot(),
        })
      : sourceGetState;

    const beforeSelfUpdateInstall = async (receipt) => {
      const host = hostResilienceRuntime();
      if (host?.prepareInstallerHandoff) await host.prepareInstallerHandoff('SELF_UPDATE');
      await sourceBeforeSelfUpdateInstall?.(receipt);
    };

    super({
      ...options,
      getState: getStateWithHostResilience,
      executeCommand: trackedExecuteCommand,
      beforeSelfUpdateInstall,
    });
    if (!options.identity) throw new Error('native_supervisor_identity_required');
    if (typeof (options.fetchImpl ?? globalThis.fetch) !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof sourceGetState !== 'function') throw new Error('native_supervisor_state_provider_required');
    this.#workspaceIdentity = options.identity;
    this.#workspaceFetch = createBoundedSupervisorFetch(options.fetchImpl ?? globalThis.fetch, { deadlineMs: options.requestDeadlineMs });
    this.#commandTargetProjection = () => commandTargetProjection;
    this.#sourceGetState = sourceGetState;
    this.#processPlaneRef = () => realtimeProcessPlane;
    this.#processPlaneSet = (value) => { realtimeProcessPlane = value; };
    this.#version = String(options.version || '0.0.0');
    this.#cognitiveTransport = createNativeSupervisorCognitiveTransport({
      identity: this.#workspaceIdentity,
      fetchImpl: this.#workspaceFetch,
      readDeltas: (after, limit) => {
        const plane = this.#processPlaneRef?.();
        if (!plane || typeof plane.cognitiveSnapshot !== 'function') {
          throw new Error('native_supervisor_cognitive_plane_not_ready');
        }
        return plane.cognitiveSnapshot({ eventsSince: after, eventLimit: limit });
      },
      resync: () => this.#pushRealtimeState(),
      onFallbackRequired: () => this.#scheduleRealtimeStatePush(),
      batchSize: options.cognitiveBatchSize,
    });
    controlLatencySnapshot = () => {
      const base = super.snapshot();
      const plane = realtimeProcessPlane?.snapshot({ eventLimit: 0 }) || unavailableProcessPlane('PROCESS_PLANE_NOT_READY');
      const semantic = realtimeProcessPlane?.semanticSnapshot({ includeText: false, eventLimit: 0 }) || unavailableSemanticPlane('SEMANTIC_PLANE_NOT_READY');
      return Object.freeze({
        schema: 'metaengine.browser.control-latency-status.v1',
        fast_lane: base?.control_fast_lane ? structuredClone(base.control_fast_lane) : null,
        current_command_count: Array.isArray(base?.current_commands) ? base.current_commands.length : 0,
        process_sample_interval_ms: plane.sample_interval_ms || null,
        process_event_sequence: plane.sequence || 0,
        semantic_event_sequence: semantic.sequence || 0,
        semantic_target_count: semantic.target_count || 0,
        semantic_ready_count: semantic.ready_count || 0,
        persistent_cdp_sessions: semantic.persistent_cdp_sessions === true,
        cdp_attach_per_command: semantic.attach_per_command === true,
        process_push_last_at: this.#processPushLastAt,
        process_push_last_error: this.#processPushLastError,
        process_push_in_flight: this.#processPushPromise != null,
        process_push_scheduled: this.#processPushScheduled,
        cognitive_delta_transport: this.#cognitiveTransport?.snapshot() || null,
        command_transport_authority: 'DB_LEASE_ONLY',
        observation_push_authority: false,
        observation_push_timer_ms: 0,
        target_zero_polling_delay: true,
        authority_effect: false,
      });
    };
    this.#controlLatencySnapshot = controlLatencySnapshot;
  }

  async #bootstrapEnrollment() {
    if (this.#enrollmentBootstrapPromise) return this.#enrollmentBootstrapPromise;
    this.#enrollmentBootstrapPromise = (async () => {
      try {
        const result = await runSupervisorEnrollmentBootstrap(this);
        this.#enrollmentBootstrapStatus = result;
        this.#enrollmentBootstrapError = null;
        return result;
      } catch (error) {
        this.#enrollmentBootstrapError = String(error?.message || error).slice(0, 240);
        this.#enrollmentBootstrapStatus = Object.freeze({
          status: 'ERROR',
          device_id: null,
          request_id: null,
          command_leasing: false,
          browser_authority: false,
          automatic_retry_allowed: false,
          second_polling_loop: false,
          authority_effect: false,
        });
        return this.#enrollmentBootstrapStatus;
      }
    })().finally(() => { this.#enrollmentBootstrapPromise = null; });
    return this.#enrollmentBootstrapPromise;
  }

  #scheduleRealtimeStatePush() {
    if (this.#processPushScheduled) return;
    this.#processPushScheduled = true;
    queueMicrotask(() => {
      this.#processPushScheduled = false;
      void this.#pushRealtimeState();
    });
  }

  #dispatchRealtimeObservationEdge() {
    return dispatchRealtimeObservationEdge({
      cognitiveTransport: this.#cognitiveTransport,
      scheduleFullState: () => this.#scheduleRealtimeStatePush(),
      baselineReady: this.#processPushLastAt != null,
    });
  }

  async #pushRealtimeState() {
    if (this.#processPushPromise) {
      this.#processPushPending = true;
      return this.#processPushPromise;
    }
    this.#processPushPromise = (async () => {
      const identity = await this.#workspaceIdentity.ensure();
      if (!identity?.device_id) return false;
      const base = super.snapshot();
      const sourceState = await this.#sourceGetState();
      const processPlane = this.#processPlaneRef?.()?.snapshot({ eventLimit: 64 }) || unavailableProcessPlane('PROCESS_PLANE_NOT_READY');
      const payload = {
        state: {
          ...sourceState,
          shell_version: this.#version,
          supervisor_mode: base?.supervisor_mode || 'MONITOR',
          armed: base?.armed === true,
          operator_mode: base?.supervisor_mode === 'CONTROL' ? 'CONTROL' : 'OBSERVE',
          started_at: base?.started_at || null,
          last_error: base?.last_error || null,
          supervisor_lifecycle: base?.lifecycle || null,
          self_update: base?.self_update || null,
          realtime_process_plane: processPlane,
          control_latency: this.#controlLatencySnapshot?.() || null,
          host_resilience: hostResilienceSnapshot(),
          realtime_observation_push: true,
          authority_effect: false,
        },
        last_command_id: base?.last_command_id || null,
        last_command_status: base?.last_command_status || null,
      };
      const path = '/v1/state';
      const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
      const bodyText = JSON.stringify(payload);
      const headers = await this.#workspaceIdentity.deviceHeaders('POST', requestPath, bodyText);
      const response = await this.#workspaceFetch(`${NATIVE_SUPERVISOR_BASE}${path}`, {
        method: 'POST', headers, body: bodyText, cache: 'no-store',
      });
      if (response.status !== 202) throw new Error(`native_supervisor_realtime_state_http_${response.status}`);
      this.#processPushLastAt = new Date().toISOString();
      this.#processPushLastError = null;
      return true;
    })().catch((error) => {
      this.#processPushLastError = String(error?.message || error).slice(0, 240);
      return false;
    }).finally(() => {
      this.#processPushPromise = null;
      if (this.#processPushPending) {
        this.#processPushPending = false;
        this.#scheduleRealtimeStatePush();
      }
    });
    return this.#processPushPromise;
  }

  async #startRealtimeProcessPlane() {
    const current = this.#processPlaneRef?.();
    if (current) return current.snapshot({ eventLimit: 0 });
    try {
      const electron = await import('electron');
      const app = electron?.app;
      const webContents = electron?.webContents;
      if (!app || typeof app.getAppMetrics !== 'function' || !webContents || typeof webContents.getAllWebContents !== 'function') {
        throw new Error('electron_process_metrics_unavailable');
      }
      const plane = new BrowserRealtimeProcessPlane({
        app,
        getWebContents: () => webContents.getAllWebContents(),
        sampleMs: 250,
        eventLimit: 512,
        onChange: () => {
          // The source planes already bound resource cadence and semantic burst
          // coalescing. The cognitive route is an observation-only replacement for
          // per-event full snapshots. Unsupported or ambiguous delivery immediately
          // falls back to the existing durable /v1/state path.
          this.#dispatchRealtimeObservationEdge();
        },
      });
      this.#processPlaneSet?.(plane);
      const snapshot = plane.start();
      this.#processPlaneError = null;
      this.#scheduleRealtimeStatePush();
      return snapshot;
    } catch (error) {
      this.#processPlaneError = String(error?.message || error).slice(0, 240);
      return unavailableProcessPlane(this.#processPlaneError);
    }
  }

  async #observeWorkspaceBindings() {
    if (this.#workspaceObservationPromise) return this.#workspaceObservationPromise;
    this.#workspaceObservationPromise = (async () => {
      try {
        const identity = await this.#workspaceIdentity.ensure();
        if (!identity?.device_id) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('DEVICE_NOT_ENROLLED');
          return this.#workspaceObservation;
        }
        const path = '/v1/devos/workspace-snapshot';
        const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
        const headers = await this.#workspaceIdentity.deviceHeaders('GET', requestPath, '');
        const response = await this.#workspaceFetch(`${NATIVE_SUPERVISOR_BASE}${path}`, { method: 'GET', headers, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (response.status === 404) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('ROUTE_UNAVAILABLE', 'WORKSPACE_SNAPSHOT_ROUTE_UNAVAILABLE');
          return this.#workspaceObservation;
        }
        if (response.status === 503 && ['RUNTIME_NOT_DEPLOYED','READ_UNAVAILABLE'].includes(String(body?.state || '').toUpperCase())) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot(String(body.state).toUpperCase(), body?.reason || null);
          return this.#workspaceObservation;
        }
        if (!response.ok) {
          this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('READ_ERROR', `WORKSPACE_SNAPSHOT_HTTP_${response.status}`);
          return this.#workspaceObservation;
        }
        const checked = normalizeWorkspaceBindingSnapshot(body);
        this.#workspaceObservation = checked || unavailableWorkspaceBindingSnapshot('INVALID_READBACK', 'WORKSPACE_SNAPSHOT_SCHEMA_INVALID');
        return this.#workspaceObservation;
      } catch (error) {
        this.#workspaceObservation = unavailableWorkspaceBindingSnapshot('READ_ERROR', String(error?.message || error).slice(0, 240));
        return this.#workspaceObservation;
      }
    })().finally(() => { this.#workspaceObservationPromise = null; });
    return this.#workspaceObservationPromise;
  }

  snapshot() {
    const base = super.snapshot();
    const target = this.#commandTargetProjection?.() || null;
    const currentCommand = base?.current_command && target?.command_id === String(base.current_command.command_id || '').toLowerCase()
      ? { ...base.current_command, target_tab_id: target.target_tab_id }
      : base?.current_command || null;
    return {
      ...base,
      current_command: currentCommand,
      current_command_payload_exposed: false,
      current_command_target_authority: 'DB_LEASED_TYPED_COMMAND_ONLY',
      enrollment_bootstrap: structuredClone(this.#enrollmentBootstrapStatus),
      enrollment_bootstrap_error: this.#enrollmentBootstrapError,
      enrollment_bootstrap_same_cycle: true,
      enrollment_bootstrap_auto_approval: false,
      workspace_bindings: structuredClone(this.#workspaceObservation),
      workspace_binding_source: 'NATIVE_SUPERVISOR_HEARTBEAT',
      workspace_binding_second_polling_loop: false,
      realtime_process_plane: this.#processPlaneRef?.()?.snapshot({ eventLimit: 32 }) || unavailableProcessPlane(this.#processPlaneError || 'PROCESS_PLANE_NOT_READY'),
      realtime_semantic_plane: this.#processPlaneRef?.()?.semanticSnapshot({ includeText: false, eventLimit: 32 }) || unavailableSemanticPlane(this.#processPlaneError || 'SEMANTIC_PLANE_NOT_READY'),
      realtime_process_plane_source: 'ELECTRON_MAIN_PROCESS',
      realtime_semantic_plane_source: 'PERSISTENT_CDP_PAGE_DOM_ACCESSIBILITY_RUNTIME_NETWORK',
      realtime_process_plane_command_authority: false,
      realtime_semantic_plane_command_authority: false,
      realtime_process_plane_second_scheduler: false,
      realtime_semantic_plane_second_scheduler: false,
      realtime_process_push: {
        last_at: this.#processPushLastAt,
        last_error: this.#processPushLastError,
        in_flight: this.#processPushPromise != null,
        scheduled: this.#processPushScheduled,
        pending: this.#processPushPending,
        event_driven: true,
        timer_delay_ms: 0,
        metrics_sample_ms: 250,
        semantic_event_driven: true,
        persistent_cdp_sessions: true,
        cdp_attach_per_command: false,
        command_leasing: false,
        authority_effect: false,
      },
      cognitive_delta_transport: this.#cognitiveTransport?.snapshot() || null,
      cognitive_delta_route: NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH,
      cognitive_delta_full_state_fallback: true,
      cognitive_delta_second_polling_loop: false,
      cognitive_delta_command_authority: false,
      host_resilience: hostResilienceSnapshot(),
      host_resilience_source: 'PRIMARY_BROWSER_PROCESS',
      host_resilience_second_polling_loop: false,
    };
  }

  async start() {
    // Start observation before enrollment/mesh so a newly launched Browser can build
    // a local census immediately. Remote push remains impossible until device auth is
    // present; observation therefore cannot bootstrap authority by itself.
    await this.#startRealtimeProcessPlane();
    // Enrollment must be attempted before dependent mesh/lifecycle startup so a
    // fresh installation cannot remain visually alive but permanently transport-dead.
    // Failure is fail-soft here: super.start() still brings up the existing watchdog,
    // and the normal cycle below re-attempts the bounded enrollment handshake.
    await this.#bootstrapEnrollment();
    const result = await super.start();
    this.#scheduleRealtimeStatePush();
    return result;
  }

  stop() {
    this.#processPushScheduled = false;
    this.#processPushPending = false;
    try { this.#processPlaneRef?.()?.stop?.(); } catch {}
    return super.stop();
  }

  async cycle() {
    // Piggyback enrollment recovery on the one existing supervisor cycle. No second
    // command interval is introduced and PENDING_APPROVAL never grants authority.
    await this.#bootstrapEnrollment();
    try {
      await super.cycle();
    } finally {
      await this.#observeWorkspaceBindings();
    }
    return this.snapshot();
  }
}
