import crypto from 'node:crypto';
import { browserControlCapabilities } from './browser-control-capabilities.mjs';
import { globalOwnerGateDisabled } from './owner-safety-gate-registry.mjs';
import { NativeSupervisorCommandLaneScheduler, classifyNativeSupervisorCommand } from './native-supervisor-command-lanes.mjs';
import { assertNativeSupervisorBatchCompletion, partitionNativeSupervisorBatchResults } from './native-supervisor-result-batch.mjs';
import { SUPERVISOR_DEVICE_PROFILE } from './supervisor-device-identity.mjs';
import { SupervisorLifecycleRuntime } from './supervisor-lifecycle-runtime.mjs';
import { SupervisorMeshRuntime } from './supervisor-mesh-runtime.mjs';
import { SelfUpdateRuntime } from './self-update-runtime.mjs';
import { NativeSupervisorCommandFastlane } from './native-supervisor-command-fastlane.mjs';
import { confirmSelfUpdateRestartSafety } from './self-update-restart-safety.mjs';
import { persistPreInstallReceipt } from './self-update-handoff.mjs';
import { readSelfUpdateTransaction } from './self-update-transaction-journal.mjs';
import { reconcileRestoredGeneratingChats } from './self-update-chat-reconcile.mjs';
import { DEVELOPER_EMERGENCY_UPDATE_ACTION } from './developer-emergency-update-admission.mjs';
import { loadNativeSupervisorControlState, persistNativeSupervisorControlState } from './native-supervisor-control-state.mjs';
import {
  beginSelfUpdateSessionContinuityRestoreAttempt,
  buildSelfUpdateSessionContinuity,
  persistSelfUpdateSessionContinuity,
  planPostRestoreDuplicateTabCleanup,
  restoreSelfUpdateSessionContinuity,
} from './self-update-session-continuity.mjs';
import { classifyChatGptAuthReadbackFromTabs } from './chatgpt-auth-readback.mjs';
import { SECURITY_POLICY } from './browser-policy.mjs';
import { verifiedDownloadReceiptConfirmsRequest } from './verified-download-manager.mjs';
import {
  devosRuntimeControlAllowsContinuousService,
  normalizeDevosRuntimeControl,
  unavailableDevosRuntimeControl,
} from './devos-runtime-control.mjs';
import { classifyFleetReconcileOutcome, projectFleetReconcileSemantics } from './fleet-provisioner.mjs';

export const NATIVE_SUPERVISOR_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1';
export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';
export const NATIVE_SUPERVISOR_WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);
const READ_ONLY_ACTIONS = Object.freeze({
  has: (action) => classifyNativeSupervisorCommand({ action }).read_only,
});
const ROOT_POLICY_ACTIONS = new Set(['GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL']);
const PROVEN_EFFECT_STATES = new Set(['PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','CONFIRMED']);
const TERMINAL_EFFECT_OUTCOMES = new Set(['CONFIRMED','NO_EFFECT_PROVEN','AMBIGUOUS']);
const DEFAULT_BATCH_WAIT_MS = 4000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 10000;
const ALWAYS_ON_CONTROL_ERROR = 'FINAL_RUNTIME_ALWAYS_ON_CONTROL_REQUIRED';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function fleetSnapshotFrom(value) {
  const fleet = value?.fleet?.schema === 'metaengine.browser.fleet-snapshot.v1' ? value.fleet : value;
  return fleet?.schema === 'metaengine.browser.fleet-snapshot.v1' && Array.isArray(fleet?.agents) ? fleet : null;
}

function failedCommandEffectOutcome(command, descriptor, error, { schedulerRejected = false } = {}) {
  if (descriptor.read_only) return null;
  if (schedulerRejected) return 'NO_EFFECT_PROVEN';
  const action = String(command?.action || '').toUpperCase();
  const message = String(error?.message || error || '');
  // TabRegistry raises this exact error before allocating a tab id or constructing
  // WebContents. Keep every other NEW_TAB failure ambiguous because it may occur
  // after registry allocation or renderer construction.
  if (action === 'NEW_TAB' && message === 'tab_capacity_exceeded') return 'NO_EFFECT_PROVEN';
  return 'AMBIGUOUS';
}

function clipped(value, max) {
  return String(value ?? '').slice(0, max);
}

function perceptionTransportProjection(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const targets = Array.isArray(frame.semantic_targets) ? frame.semantic_targets : [];
  const textExcerpt = clipped(frame.text_excerpt, 2048);
  return Object.freeze({
    schema: clipped(frame.schema || 'metaengine.native-browser.perception.v1', 96),
    captured_at: frame.captured_at || null,
    tab_id: frame.tab_id ? clipped(frame.tab_id, 80) : null,
    process_incarnation_id: frame.process_incarnation_id ? clipped(frame.process_incarnation_id, 160) : null,
    target_id: frame.target_id ? clipped(frame.target_id, 160) : null,
    runtime_observation_id: frame.runtime_observation_id ? clipped(frame.runtime_observation_id, 160) : null,
    state_revision_id: frame.state_revision_id ? clipped(frame.state_revision_id, 160) : null,
    url: clipped(frame.url, 1200),
    title: clipped(frame.title, 240),
    viewport: frame.viewport && typeof frame.viewport === 'object' ? stableValue(frame.viewport) : null,
    semantic_targets: targets.slice(0, 24).map((row) => Object.freeze({
      role: clipped(row?.role, 48),
      name: clipped(row?.name, 160),
      disabled: row?.disabled === true,
      backend_node_id: Number.isSafeInteger(Number(row?.backend_node_id)) ? Number(row.backend_node_id) : null,
      frame_id: row?.frame_id ? clipped(row.frame_id, 192) : null,
      semantic_ref: row?.semantic_ref && typeof row.semantic_ref === 'object'
        ? stableValue(row.semantic_ref)
        : null,
      value_sha256: /^[a-f0-9]{64}$/i.test(String(row?.value_sha256 || '')) ? String(row.value_sha256).toLowerCase() : null,
      authority_effect: false,
    })),
    semantic_target_count: targets.length,
    semantic_targets_truncated: targets.length > 24,
    text_excerpt: textExcerpt,
    text_excerpt_bytes: Buffer.byteLength(String(frame.text_excerpt || ''), 'utf8'),
    text_excerpt_sha256: crypto.createHash('sha256').update(String(frame.text_excerpt || ''), 'utf8').digest('hex'),
    text_excerpt_truncated: textExcerpt.length < String(frame.text_excerpt || '').length,
    perception_error: frame.perception_error ? clipped(frame.perception_error, 240) : null,
    input_values_exposed: false,
    transport_projection: true,
    full_capture_available_by_command: true,
    authority_effect: false,
  });
}

export function nativeSupervisorTransportState(state = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  return {
    ...state,
    perception: perceptionTransportProjection(state.perception),
    heartbeat_payload_bounded: true,
    heartbeat_full_perception_embedded: false,
  };
}

function controlModeAllows(supervisorMode) {
  return supervisorMode === 'CONTROL' || globalOwnerGateDisabled('authority.control_mode');
}
function armedAllows(armed) {
  return armed === true || globalOwnerGateDisabled('authority.armed');
}

function generationStateForTab(lifecycle, tabId) {
  const row = lifecycle?.supervisor_session?.tabs?.find((item) => String(item?.tab_id || '') === String(tabId || ''));
  const state = String(row?.state || '').toUpperCase();
  if (['GENERATING','STALLED'].includes(state)) return 'GENERATING';
  if (['IDLE','INTERRUPTED'].includes(state)) return 'IDLE';
  return 'UNKNOWN';
}

function isChatGptRoot(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && ['chatgpt.com','www.chatgpt.com'].includes(url.hostname.toLowerCase())
      && url.pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
}

// P0 repair (point 6): flush the persistent user-space partition's unwritten
// DOMStorage before the self-update handoff. Best-effort by design — Electron's
// flushStorageData() does NOT prove ChatGPT cookie persistence; it only removes
// the known "existed in memory, never written" class of false negatives. The
// pre/post auth readback comparison (Qualification V2) is the actual evidence.
export async function NativeSupervisorClientFlushUserSpaceStorage(app, { partition = SECURITY_POLICY.user_space_partition } = {}) {
  try {
    const electron = await import('electron');
    const targetSession = electron.session?.fromPath
      ? electron.session.fromPath(String(partition))
      : electron.default?.session?.fromPath
        ? electron.default.session.fromPath(String(partition))
        : null;
    await targetSession?.flushStorageData?.();
  } catch {
    // Hardening only: a failed flush must never block an update handoff that
    // the operator already admitted.
  }
}

export function planPostRestoreBlankTabCleanup({ continuityRow, bindings = [], currentTabs = [] } = {}) {
  const desiredRootCount = (continuityRow?.tabs || []).filter((tab) => isChatGptRoot(tab?.url)).length;
  const boundTabIds = new Set((bindings || []).map((row) => String(row?.tab_id || '')).filter(Boolean));
  let retainedRoots = (currentTabs || []).filter((tab) => boundTabIds.has(String(tab?.tab_id || '')) && isChatGptRoot(tab?.url)).length;
  const candidates = (currentTabs || [])
    .filter((tab) => !boundTabIds.has(String(tab?.tab_id || '')) && isChatGptRoot(tab?.url))
    .sort((a, b) => Number(a?.selected === true) - Number(b?.selected === true));
  const closeTabIds = [];
  for (const tab of candidates) {
    if (retainedRoots < desiredRootCount) {
      retainedRoots += 1;
      continue;
    }
    const tabId = String(tab?.tab_id || '');
    if (tabId) closeTabIds.push(tabId);
  }
  return Object.freeze({
    close_tab_ids: closeTabIds,
    desired_root_count: desiredRootCount,
    bound_tab_count: boundTabIds.size,
    current_root_count: (currentTabs || []).filter((tab) => isChatGptRoot(tab?.url)).length,
    arbitrary_tab_close: false,
    authority_effect: false,
  });
}

function stableCurrentCommand(command) {
  return command ? Object.freeze({
    command_id: command.command_id,
    action: command.action,
    platform: command.platform || null,
    issued_at: command.issued_at || null,
    expires_at: command.expires_at || null,
  }) : null;
}

// F-L1c: after F-L1a/F-L1b every CDP await and result POST is bounded, so a healthy
// cycle can no longer hang forever. This guard turns any residual stall (a code
// path the bounds do not reach) into an observable last_error instead of the
// silent "alive heartbeat / dead command plane" zombie state observed live.
const COMMAND_CYCLE_STALL_GUARD_MS = 900000;

// D-L2: pure classification of legitimate no-op completions. Exported for
// contract tests; returns null when the action still requires the generic
// postcondition readback path.
export function classifyNoOpEffectOutcome(actionRaw, result) {
  const action = String(actionRaw || '').toUpperCase();
  if (action === 'BACK' || action === 'FORWARD') {
    if (result && result.navigated === false) return 'NO_EFFECT_PROVEN';
    if (result && result.navigated === true) return 'CONFIRMED';
    return null;
  }
  if (action === 'RELOAD') {
    // webContents.reload() deterministically initiates the reload; a failed
    // load surfaces through perception_error afterwards.
    return 'CONFIRMED';
  }
  if (action === 'SCROLL') {
    const scroll = result?.scroll;
    if (scroll && scroll.proof === 'VIEWPORT_PAGE_Y_CHANGED') return 'CONFIRMED';
    if (scroll && scroll.proof === 'SCROLL_BOUNDARY_REACHED') return 'NO_EFFECT_PROVEN';
    return null;
  }
  if (action === 'SELF_UPDATE_CHECK') {
    const state = String(result?.state || '').toUpperCase();
    if (state === 'CURRENT') return 'NO_EFFECT_PROVEN';
    return 'CONFIRMED';
  }
  return null;
}

export class NativeSupervisorClient {
  #identity;
  #fetch;
  #getState;
  #executeCommand;
  #developerEmergencyUpdate;
  #version;
  #intervalMs;
  #timer = null;
  #running = false;
  #cyclePromise = null;
  #startedAt = null;
  #lastError = null;
  #lastHeartbeatAt = null;
  #lastCommandId = null;
  #lastCommandStatus = null;
  #currentCommand = null;
  #currentCommands = new Map();
  // F-L1d: per-command execution start times + cycle start timestamp power the
  // command_plane observability projection (in-flight age) in snapshot().
  #commandStartsAtMs = new Map();
  #cycleStartedAtMs = 0;
  #enrollmentStatus = 'UNINITIALIZED';
  #supervisorMode = 'CONTROL';
  #armed = true;
  #lifecycle = null;
  #mesh = null;
  #selfUpdate = null;
  #continuityStatus = {
    state: 'NONE', restored_tabs: 0, target_version: null,
    user_session_continuity: null, tab_cardinality_continuity: null, authority_effect: false,
  };
  #commandLane;
  #batchTransport = 'UNKNOWN';
  #batchWaitMs;
  #maxBatch;
  #maxTabMutations;
  #lastBatchCount = 0;
  #heartbeatPromise = null;
  #maintenancePromise = null;
  #lastMaintenanceAtMs = 0;
  #maintenanceIntervalMs;
  // Preserve the already released 750ms transport accelerator only as a fallback.
  // Once wait-batch is proven supported, the held request becomes the sole lease path
  // and this helper is stopped so steady-state never has two competing lease loops.
  #commandFastlane = null;
  #legacyFastlaneBusy = false;
  #controlStatePath = null;
  #controlStateLoaded = false;
  #controlStatePersistenceError = null;
  #legacySingleLeaseFallback = true;
  #runtimeControl = unavailableDevosRuntimeControl('NOT_OBSERVED');
  #resultDeliveryAttempts;
  #resultDeliveryBackoffMs;

  constructor({
    identity,
    fetchImpl = globalThis.fetch,
    getState,
    executeCommand,
    developerEmergencyUpdate = null,
    version,
    intervalMs = 2000,
    beforeSelfUpdateInstall = null,
    meshStatePath = null,
    commandBatchSize = 64,
    commandReadConcurrency = 32,
    commandMutationConcurrency = 8,
    commandBatchWaitMs = DEFAULT_BATCH_WAIT_MS,
    maintenanceIntervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
    legacySingleLeaseFallback = true,
    commandFastlane = false,
    commandFastlaneIntervalMs = 750,
    controlStatePath = null,
    hostResilience = undefined,
    resultDeliveryAttempts = 3,
    resultDeliveryBackoffMs = [1000, 3000],
  }) {
    if (!identity) throw new Error('native_supervisor_identity_required');
    if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
    if (typeof executeCommand !== 'function') throw new Error('native_supervisor_command_executor_required');
    if (developerEmergencyUpdate != null && typeof developerEmergencyUpdate !== 'function') throw new Error('native_supervisor_developer_emergency_update_handler_invalid');
    if (beforeSelfUpdateInstall != null && typeof beforeSelfUpdateInstall !== 'function') throw new Error('native_supervisor_self_update_handoff_invalid');
    this.#identity = identity;
    this.#fetch = fetchImpl;
    this.#getState = getState;
    this.#executeCommand = executeCommand;
    this.#developerEmergencyUpdate = developerEmergencyUpdate;
    this.#version = String(version || '0.0.0');
    this.#intervalMs = Math.max(250, Math.min(5000, Number(intervalMs || 2000)));
    this.#batchWaitMs = Math.max(250, Math.min(15000, Number(commandBatchWaitMs) || DEFAULT_BATCH_WAIT_MS));
    this.#maxBatch = Math.max(1, Math.min(64, Number(commandBatchSize) || 64));
    this.#maxTabMutations = Math.max(1, Math.min(16, Number(commandMutationConcurrency) || 8));
    this.#maintenanceIntervalMs = Math.max(1000, Math.min(60000, Number(maintenanceIntervalMs) || DEFAULT_MAINTENANCE_INTERVAL_MS));
    this.#controlStatePath = controlStatePath ? String(controlStatePath) : null;
    this.#legacySingleLeaseFallback = legacySingleLeaseFallback !== false;
    this.#resultDeliveryAttempts = Math.max(1, Math.min(6, Number(resultDeliveryAttempts) || 3));
    this.#resultDeliveryBackoffMs = Array.isArray(resultDeliveryBackoffMs) && resultDeliveryBackoffMs.length
      ? resultDeliveryBackoffMs.map((ms) => Math.max(0, Number(ms) || 0))
      : [1000, 3000];
    this.#commandLane = new NativeSupervisorCommandLaneScheduler({
      readConcurrency: commandReadConcurrency,
      mutationConcurrency: commandMutationConcurrency,
      maxBatch: this.#maxBatch,
    });
    this.#commandFastlane = commandFastlane === true && this.#legacySingleLeaseFallback
      ? new NativeSupervisorCommandFastlane({
        intervalMs: Math.max(250, Number(commandFastlaneIntervalMs) || 750),
        isRunning: () => this.#running,
        isSlotBusy: () => this.#legacyFastlaneBusy
          || this.#cyclePromise != null
          || this.#currentCommands.size > 0
          || this.#batchTransport === 'SUPPORTED',
        identitySnapshot: () => this.#identity.snapshot?.() || null,
        pickupAndRun: () => this.#pickupAndRunLegacyFastlaneCommand(),
      })
      : null;

    const continuousServiceCanActuate = () => controlModeAllows(this.#supervisorMode)
      && armedAllows(this.#armed)
      && devosRuntimeControlAllowsContinuousService(this.#runtimeControl);
    const executeSupervisorCommand = async (command) => {
      const action = String(command?.action || '');
      if (!READ_ONLY_ACTIONS.has(action) && !ROOT_POLICY_ACTIONS.has(action)) {
        if (!controlModeAllows(this.#supervisorMode)) throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
        if (!armedAllows(this.#armed)) throw new Error('native_supervisor_disarmed');
        if (!devosRuntimeControlAllowsContinuousService(this.#runtimeControl)) throw new Error('continuous_service_admission_fenced');
      }
      return this.#executeCommand(command);
    };

    this.#lifecycle = new SupervisorLifecycleRuntime({
      getState: this.#getState,
      canActuate: continuousServiceCanActuate,
      executeCommand: executeSupervisorCommand,
      requireAuthoritativeAdmission: true,
    });
    this.#mesh = new SupervisorMeshRuntime({
      getState: this.#getState,
      executeCommand: executeSupervisorCommand,
      canActuate: continuousServiceCanActuate,
      primaryLifecycle: () => this.#lifecycle?.snapshot() || null,
      ...(meshStatePath ? { statePath: meshStatePath } : {}),
    });
    this.#selfUpdate = new SelfUpdateRuntime({
      // main-entry owns the one process-wide Sentinel/parent-progress runtime.
      // Reusing that exact object is required: a second HostResilienceRuntime
      // would overwrite the shared Sentinel state path with a new token while
      // the first lease kept writing the old token, causing the healthy primary
      // to be terminated when the 180-second startup grace expires.
      hostResilience,
      canRestart: async () => {
        if (!controlModeAllows(this.#supervisorMode)) return false;
        if (!armedAllows(this.#armed)) return false;
        if (this.#currentCommands.size > 0 && !globalOwnerGateDisabled('self_update.current_command')) return false;
        return confirmSelfUpdateRestartSafety({ getState: this.#getState });
      },
      beforeInstall: async (receipt) => {
        const { app } = await import('electron');
        await persistPreInstallReceipt(app, receipt);
      },
      readPriorTransaction: async () => {
        const { app } = await import('electron');
        return readSelfUpdateTransaction(app).catch(() => null);
      },
      beforeInstallerLaunch: async (receipt) => {
        const { app } = await import('electron');
        if (!app?.isPackaged && !globalOwnerGateDisabled('self_update.packaged_required')) throw new Error('native_supervisor_self_update_packaged_required');
        if (!app.hasSingleInstanceLock() && !globalOwnerGateDisabled('self_update.primary_instance_lock')) throw new Error('native_supervisor_self_update_primary_lock_required');
        await this.#persistSessionContinuity(app, receipt);
        await beforeSelfUpdateInstall?.(structuredClone(receipt));
        this.stop();
        app.releaseSingleInstanceLock();
      },
    });
  }

  snapshot() {
    return {
      schema: 'metaengine.native-supervisor.client.v1',
      running: this.#running,
      started_at: this.#startedAt,
      heartbeat_interval_ms: this.#intervalMs,
      last_heartbeat_at: this.#lastHeartbeatAt,
      last_error: this.#lastError,
      last_command_id: this.#lastCommandId,
      last_command_status: this.#lastCommandStatus,
      current_command: this.#currentCommand,
      current_commands: [...this.#currentCommands.values()].map((row) => structuredClone(row)),
      // F-L1d: makes the "heartbeat alive but command plane wedged" state externally
      // detectable without waiting for a lease TTL sweep.
      command_plane: Object.freeze({
        schema: 'metaengine.native-supervisor.command-plane-observability.v1',
        cycle_in_flight: this.#cyclePromise != null,
        cycle_started_at: this.#cycleStartedAtMs > 0 ? new Date(this.#cycleStartedAtMs).toISOString() : null,
        cycle_age_ms: this.#cycleStartedAtMs > 0 ? Date.now() - this.#cycleStartedAtMs : 0,
        in_flight_commands: Object.freeze([...this.#currentCommands.values()].map((row) => Object.freeze({
          command_id: row.command_id,
          action: row.action,
          age_ms: this.#commandStartsAtMs.get(String(row.command_id)) != null
            ? Date.now() - this.#commandStartsAtMs.get(String(row.command_id))
            : null,
        }))),
        authority_effect: false,
      }),
      enrollment_status: this.#enrollmentStatus,
      identity: this.#identity.snapshot(),
      supervisor_mode: this.#supervisorMode,
      armed: this.#armed,
      command_fastlane: this.#commandFastlane?.snapshot()
        || Object.freeze({ enabled: false, scheduler_authority: false, command_pickup_transport_only: false, authority_effect: false }),
      lifecycle: this.#lifecycle?.snapshot() || null,
      supervisor_mesh: this.#mesh?.snapshot() || null,
      self_update: this.#selfUpdate?.snapshot() || null,
      session_continuity: structuredClone(this.#continuityStatus),
      control_state: {
        schema: 'metaengine.native-supervisor.control-state-runtime.v1',
        path_configured: Boolean(this.#controlStatePath),
        loaded: this.#controlStateLoaded,
        persistence_error: this.#controlStatePersistenceError,
        quiescent: false,
        always_on_control: true,
        authority_effect: false,
      },
      control_fast_lane: {
        schema: 'metaengine.native-supervisor.control-fast-lane.v1',
        transport: this.#batchTransport,
        batch_transport_required: this.#legacySingleLeaseFallback === false,
        legacy_single_lease_fallback_enabled: this.#legacySingleLeaseFallback,
        wait_batch_ms: this.#batchWaitMs,
        last_batch_count: this.#lastBatchCount,
        scheduler: this.#commandLane.snapshot(),
        maintenance_interval_ms: this.#maintenanceIntervalMs,
        maintenance_in_flight: this.#maintenancePromise != null,
        heartbeat_in_flight: this.#heartbeatPromise != null,
        command_lane_precedes_maintenance: true,
        long_poll_replaces_idle_timer_latency: this.#batchTransport === 'SUPPORTED',
        legacy_750ms_fallback_configured: this.#commandFastlane != null,
        legacy_fallback_suppressed_by_batch_transport: this.#batchTransport === 'SUPPORTED',
        one_steady_state_lease_loop: true,
        transport_delivery_is_authority: false,
        automatic_effect_retry_allowed: false,
        authority_effect: false,
      },
      continuous_service: {
        terminal_requires_external_stop: true,
        startup_scheduler_armed_before_enrollment: true,
        cycle_errors_terminal: false,
        runtime_control: structuredClone(this.#runtimeControl),
        authoritative_admission_required: true,
        actuation_allowed: devosRuntimeControlAllowsContinuousService(this.#runtimeControl),
        authority_effect: false,
      },
      developer_emergency_update: {
        configured: this.#developerEmergencyUpdate != null,
        signed_lease_precedes_handler: true,
        bypasses_program_policy: true,
        bypasses_transport_authentication: false,
        authority_effect: false,
      },
      arbitrary_eval: false,
      os_shell_authority: false,
    };
  }

  async #persistSessionContinuity(app, receipt) {
    // P0 repair (point 6) — pre-persist barrier, inseparable from capsule
    // creation:
    //   1. metadata-only pre-install auth readback (the capsule's pre-auth
    //      evidence for Qualification V2; no cookie values, no storage reads);
    //   2. session.flushStorageData() on the persistent user-space partition
    //      so unwritten DOMStorage is flushed before the process hands off.
    //      The flush is hardening, NOT proof of ChatGPT cookie persistence —
    //      the pre/post auth readback comparison is the actual evidence.
    const preAuthReadback = await this.#capturePreInstallAuthReadback();
    await NativeSupervisorClientFlushUserSpaceStorage(app);
    const state = await this.#getState();
    const lifecycle = this.#lifecycle?.snapshot() || null;
    const tabs = (state?.tabs || []).map((tab) => ({ ...tab, generation_state: generationStateForTab(lifecycle, tab?.tab_id) }));
    const selectedTabId = state?.active_tab?.tab_id || tabs.find((tab) => tab?.selected === true)?.tab_id || null;
    const row = buildSelfUpdateSessionContinuity({ currentVersion: this.#version, targetVersion: receipt?.version, tabsSnapshot: { tabs, selected_tab_id: selectedTabId }, lifecycleSnapshot: lifecycle, preAuthReadback });
    await persistSelfUpdateSessionContinuity(app.getPath('userData'), row);
    this.#continuityStatus = { state: 'PERSISTED', restored_tabs: 0, tab_count: row.tabs.length, target_version: row.target_version, had_generating_tabs: row.tabs.some((tab) => tab?.generation_state === 'GENERATING'), user_session_continuity: null, tab_cardinality_continuity: null, authority_effect: false };
  }

  async #capturePreInstallAuthReadback() {
    try {
      const state = await this.#getState();
      return classifyChatGptAuthReadbackFromTabs(state?.tabs || []);
    } catch {
      return Object.freeze({
        auth_state: 'UNKNOWN', chatgpt_tab_count: 0, auth_redirect_tab_count: 0, authenticated_tab_count: 0,
        metadata_only: true, cookie_values_read: false,
      });
    }
  }

  async #restoreSessionContinuity() {
    const { app } = await import('electron');
    const userData = app.getPath('userData');
    // P0 repair (point 2) — ONE-SHOT FENCE: the capsule is claimed by a durable
    // rename BEFORE any NEW_TAB is issued. A process that crashes mid-restore,
    // and every successor process, will find the canonical path absent: the
    // 7 -> 14 -> 21 -> 28 -> 32 replay amplifier of the 2026-09-17 incident is
    // structurally impossible with this fence in place.
    const attempt = await beginSelfUpdateSessionContinuityRestoreAttempt(userData);
    if (!attempt) {
      this.#continuityStatus = { state: 'NONE', restored_tabs: 0, target_version: null, user_session_continuity: null, tab_cardinality_continuity: null, authority_effect: false };
      return null;
    }
    const { row } = attempt;
    this.#continuityStatus = { state: 'FOUND', restored_tabs: 0, tab_count: row.tabs.length, target_version: row.target_version || null, user_session_continuity: null, tab_cardinality_continuity: null, authority_effect: false };
    if (row.target_version && String(row.target_version) !== this.#version) {
      this.#continuityStatus.state = 'TARGET_VERSION_MISMATCH';
      return row;
    }

    // P0 repair (points 2+3): the module-level restore is auth-aware and
    // one-shot. The first restored /c/ tab observed on /auth/login latches
    // AUTH_REQUIRED as a TERMINAL state — remaining ChatGPT tabs are skipped
    // (no login-page multiplication), non-ChatGPT tabs still restore, and the
    // capsule is already fenced so no process will ever replay it.
    const restore = await restoreSelfUpdateSessionContinuity({
      row,
      currentVersion: this.#version,
      getState: this.#getState,
      executeCommand: this.#executeCommand,
    });

    // P0 repair (point 4) — cleanup by proof only: close tabs whose
    // created_by_continuity_id matches THIS attempt beyond the capsule's own
    // tab count. Tabs without the stamp (including the 32 legacy live tabs
    // of the incident) are never touched.
    let closedExtraTabs = 0;
    try {
      const postRestoreState = await this.#getState();
      const cleanup = planPostRestoreDuplicateTabCleanup({ continuityRow: row, currentTabs: postRestoreState?.tabs || [] });
      for (const tabId of cleanup.close_tab_ids) {
        await this.#executeCommand({ action: 'CLOSE_TAB', payload: { tab_id: tabId }, platform: null });
        closedExtraTabs += 1;
      }
    } catch {
      // Best-effort: un-closed duplicates remain observable via census.
    }

    let reconcile = { schema: 'metaengine.self-update-chat-reconcile.v1', tabs: [], ambiguous_count: 0, unresolved_count: 0, authority_effect: false };
    if (restore.state === 'RESTORED' && restore.bindings.some((binding) => binding.generation_state === 'GENERATING')) {
      reconcile = await reconcileRestoredGeneratingChats({
        bindings: restore.bindings,
        captureTab: async (tabId) => this.#executeCommand({ action: 'CAPTURE', payload: { tab_id: String(tabId) }, platform: 'CHATGPT' }),
        clickControl: async (tabId, control) => this.#executeCommand({
          action: 'TYPED_CLICK',
          payload: {
            tab_id: String(tabId),
            role: 'button',
            accessible_name: String(control?.name || ''),
            semantic_ref: control?.semantic_ref,
          },
          platform: 'CHATGPT',
        }),
      });
    }

    const failedTabs = restore.failed_tabs + Number(reconcile.unresolved_count || 0);
    let stateLabel = restore.state;
    if (stateLabel === 'RESTORED' && failedTabs > 0) stateLabel = 'PARTIAL';
    this.#continuityStatus = {
      state: stateLabel, restored_tabs: restore.restored_tabs, closed_extra_tabs: closedExtraTabs, failed_tabs: failedTabs,
      skipped_auth_required_tabs: restore.skipped_auth_required_tabs,
      tab_count: restore.tab_count, target_version: restore.target_version || null, had_generating_tabs: restore.had_generating_tabs,
      lifecycle_resume_present: restore.lifecycle_resume_present, reconciled_generating_tabs: reconcile.tabs.length,
      reconcile_ambiguous_count: reconcile.ambiguous_count, reconcile_unresolved_count: reconcile.unresolved_count,
      reconcile_authority_effect: reconcile.authority_effect === true,
      // Qualification V2 evidence (metadata-only, P0 repair point 5).
      continuity_id: restore.continuity_id,
      auth_readback_state: restore.auth_readback?.auth_state ?? null,
      auth_redirect_tab_count: restore.auth_readback?.auth_redirect_tab_count ?? null,
      user_session_continuity: restore.user_session_continuity,
      tab_cardinality_continuity: restore.tab_cardinality?.state ?? null,
      tab_cardinality_pre_tab_count: restore.tab_cardinality?.pre_tab_count ?? null,
      tab_cardinality_post_tab_count: restore.tab_cardinality?.post_tab_count ?? null,
      authority_effect: false,
    };
    return row;
  }

  async #restoreControlState() {
    if (this.#controlStateLoaded) return this.snapshot();
    this.#controlStateLoaded = true;
    if (!this.#controlStatePath) return this.snapshot();
    const restored = await loadNativeSupervisorControlState(this.#controlStatePath);
    if (restored) {
      this.#supervisorMode = 'CONTROL';
      this.#armed = true;
      if (restored.recovered_fail_closed === true) this.#controlStatePersistenceError = restored.recovery_reason || 'CONTROL_STATE_RECOVERED_FAIL_CLOSED';
    }
    return this.snapshot();
  }

  async #persistControlState() {
    if (!this.#controlStatePath) return null;
    try {
      const saved = await persistNativeSupervisorControlState(this.#controlStatePath, { supervisor_mode: this.#supervisorMode, armed: this.#armed });
      this.#controlStatePersistenceError = null;
      return saved;
    } catch (error) {
      this.#controlStatePersistenceError = `control_state_persistence:${clipError(error)}`;
      throw error;
    }
  }

  async start() {
    if (this.#running) { this.#schedule(); return this.snapshot(); }
    await this.#restoreControlState();
    this.#supervisorMode = 'CONTROL';
    this.#armed = true;
    this.#running = true;
    this.#startedAt = new Date().toISOString();
    this.#schedule();
    this.#commandFastlane?.start();
    try {
      await this.#identity.ensure();
      // Obtain the authoritative DB-backed admission projection before the first
      // lifecycle cycle. Unknown/missing readback leaves continuous service fenced;
      // self-update and Sentinel startup remain independent below.
      await this.#heartbeat().catch((error) => {
        this.#lastError = `startup_heartbeat:${clipError(error)}`;
      });
      await this.#restoreSessionContinuity().catch((error) => {
        this.#lastError = `continuity_restore:${clipError(error)}`;
        this.#continuityStatus = { ...this.#continuityStatus, state: 'ERROR', error: clipError(error), authority_effect: false };
      });
      const lifecycleSnapshot = await this.#lifecycle.start().catch((error) => {
        this.#lastError = `lifecycle_start:${clipError(error)}`;
        return null;
      });
      this.#synchronizeRuntimeControlFromLifecycle(lifecycleSnapshot, 'LIFECYCLE_START_FAILED');
      await this.#mesh.start().catch((error) => { this.#lastError = `mesh_start:${clipError(error)}`; });
      await this.#selfUpdate.start().catch((error) => { this.#lastError = `self_update_start:${clipError(error)}`; });
      await this.cycle().catch(() => {});
    } catch (error) {
      this.#lastError = `startup:${clipError(error)}`;
      throw error;
    } finally {
      if (this.#running) this.#schedule();
    }
    return this.snapshot();
  }

  stop() {
    this.#running = false;
    this.#mesh?.stop?.();
    this.#lifecycle?.stop?.();
    this.#commandFastlane?.stop();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  setControlState({ mode, armed } = {}) {
    if (mode !== undefined && String(mode).trim().toUpperCase() !== 'CONTROL') {
      const error = new Error(ALWAYS_ON_CONTROL_ERROR);
      error.code = ALWAYS_ON_CONTROL_ERROR;
      throw error;
    }
    if (armed !== undefined && armed !== true) {
      const error = new Error(ALWAYS_ON_CONTROL_ERROR);
      error.code = ALWAYS_ON_CONTROL_ERROR;
      throw error;
    }
    this.#supervisorMode = 'CONTROL';
    this.#armed = true;
    void this.#persistControlState().catch(() => {});
    return this.snapshot();
  }

  #schedule() {
    if (!this.#running || this.#timer) return;
    // A supported wait-batch request is itself the idle wait. Schedule the next
    // cycle immediately so there is no extra client timer after the held request.
    const delay = this.#batchTransport === 'SUPPORTED' ? 0 : this.#intervalMs;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.cycle().catch(() => {}).finally(() => this.#schedule());
    }, delay);
    this.#timer.unref?.();
  }

  async #enrollmentRequest(path, payload) {
    const bodyText = JSON.stringify(payload);
    const headers = await this.#identity.enrollmentHeaders(bodyText);
    return this.#fetch(`${NATIVE_SUPERVISOR_BASE}${path}`, { method: 'POST', headers, body: bodyText, cache: 'no-store' });
  }

  async #signedRequest(path, { method = 'POST', payload = null } = {}) {
    const bodyText = method === 'GET' ? '' : JSON.stringify(payload ?? {});
    const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
    const headers = await this.#identity.deviceHeaders(method, requestPath, bodyText);
    const init = { method, headers, cache: 'no-store' };
    if (method !== 'GET') init.body = bodyText;
    return this.#fetch(`${NATIVE_SUPERVISOR_BASE}${path}`, init);
  }

  async ensureEnrollment() {
    const identity = await this.#identity.ensure();
    if (identity.device_id) { this.#enrollmentStatus = 'ENROLLED'; return identity; }
    if (!identity.enrollment_request_id) {
      const payload = { profile: SUPERVISOR_DEVICE_PROFILE, public_jwk: identity.public_jwk, key_fingerprint_sha256: identity.key_fingerprint_sha256, metadata: { shell_version: this.#version } };
      const response = await this.#enrollmentRequest('/v1/device/enrollment/request', payload);
      const body = await response.json().catch(() => ({}));
      if (![200, 202].includes(response.status) || !body?.request_id) throw new Error(`native_supervisor_enrollment_request_http_${response.status}:${body?.reason || body?.error || 'unknown'}`);
      await this.#identity.bindEnrollmentRequest(body.request_id);
      this.#enrollmentStatus = String(body.status || 'PENDING');
      return this.#identity.snapshot();
    }
    const payload = { request_id: identity.enrollment_request_id, profile: SUPERVISOR_DEVICE_PROFILE, public_jwk: identity.public_jwk, key_fingerprint_sha256: identity.key_fingerprint_sha256 };
    const response = await this.#enrollmentRequest('/v1/device/enrollment/status', payload);
    const body = await response.json().catch(() => ({}));
    if (response.status === 200 && body?.accepted === true && body?.device_id) {
      await this.#identity.bindDevice(body.device_id); this.#enrollmentStatus = 'ENROLLED'; return this.#identity.snapshot();
    }
    if (response.status === 202) { this.#enrollmentStatus = 'PENDING_APPROVAL'; return this.#identity.snapshot(); }
    const reason = String(body?.reason || body?.error || 'unknown');
    if (response.status === 409 && /EXPIRED|REJECTED|NOT_FOUND/.test(reason.toUpperCase())) {
      await this.#identity.clearEnrollmentRequest(); this.#enrollmentStatus = 'RETRY_REQUIRED'; return this.#identity.snapshot();
    }
    throw new Error(`native_supervisor_enrollment_status_http_${response.status}:${reason}`);
  }

  async #heartbeat() {
    const state = nativeSupervisorTransportState(await this.#getState());
    const payload = {
      state: {
        ...state, shell_version: this.#version, supervisor_mode: 'CONTROL', armed: true,
        operator_mode: 'CONTROL', started_at: this.#startedAt, last_error: this.#lastError,
        supervisor_lifecycle: this.#lifecycle?.statusSnapshot?.() || this.#lifecycle?.snapshot() || null,
        self_update: this.#selfUpdate?.snapshot() || null,
        self_update_session_continuity: structuredClone(this.#continuityStatus),
      },
      last_command_id: this.#lastCommandId, last_command_status: this.#lastCommandStatus,
    };
    const response = await this.#signedRequest('/v1/state', { payload });
    if (response.status !== 202) throw new Error(`native_supervisor_state_http_${response.status}`);
    const body = await response.json().catch(() => ({}));
    const observedControl = normalizeDevosRuntimeControl(body?.runtime_control, { workspaceId: NATIVE_SUPERVISOR_WORKSPACE_ID });
    const lifecycleSnapshot = await this.#lifecycle?.applyRuntimeControl?.(observedControl);
    this.#synchronizeRuntimeControlFromLifecycle(lifecycleSnapshot, observedControl.reason || 'LIFECYCLE_READBACK_UNAVAILABLE');
    this.#lastHeartbeatAt = new Date().toISOString();
  }

  #synchronizeRuntimeControlFromLifecycle(snapshot, fallbackReason) {
    const applied = snapshot?.continuous_service?.runtime_control;
    this.#runtimeControl = applied?.authoritative === true
      ? normalizeDevosRuntimeControl(applied, { workspaceId: NATIVE_SUPERVISOR_WORKSPACE_ID })
      : unavailableDevosRuntimeControl(applied?.reason || fallbackReason || 'LIFECYCLE_READBACK_UNAVAILABLE');
    return this.#runtimeControl;
  }

  #kickHeartbeat() {
    if (this.#heartbeatPromise) return this.#heartbeatPromise;
    this.#heartbeatPromise = this.#heartbeat()
      .catch((error) => { this.#lastError = `heartbeat:${clipError(error)}`; })
      .finally(() => { this.#heartbeatPromise = null; });
    return this.#heartbeatPromise;
  }

  #kickMaintenance() {
    if (this.#supervisorMode === 'OFF' || this.#armed !== true) return this.#maintenancePromise;
    const now = Date.now();
    if (this.#maintenancePromise || now - this.#lastMaintenanceAtMs < this.#maintenanceIntervalMs) return this.#maintenancePromise;
    this.#lastMaintenanceAtMs = now;
    this.#maintenancePromise = (async () => {
      await this.#mesh?.reconcile().catch((error) => { this.#lastError = `mesh:${clipError(error)}`; });
      await this.#lifecycle?.cycle().catch((error) => { this.#lastError = `lifecycle:${clipError(error)}`; });
      await this.#mesh?.dispatchRecoveryIfNeeded().catch((error) => { this.#lastError = `mesh_recovery:${clipError(error)}`; });
      await this.#selfUpdate?.cycle().catch((error) => { this.#lastError = `self_update:${clipError(error)}`; });
    })().finally(() => { this.#maintenancePromise = null; });
    return this.#maintenancePromise;
  }

  async #nextCommand() {
    const response = await this.#signedRequest('/v1/commands/next', { payload: { supervisor_mode: this.#supervisorMode } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`native_supervisor_next_http_${response.status}`);
    return body?.command || null;
  }

  async #pickupAndRunLegacyFastlaneCommand() {
    if (!this.#legacySingleLeaseFallback || this.#batchTransport === 'SUPPORTED' || this.#legacyFastlaneBusy || this.#cyclePromise) return null;
    this.#legacyFastlaneBusy = true;
    try {
      const command = await this.#nextCommand();
      if (command) await this.#runCommand(command);
      return command || null;
    } finally {
      this.#legacyFastlaneBusy = false;
    }
  }

  async #nextCommands() {
    if (this.#batchTransport !== 'UNAVAILABLE') {
      const response = await this.#signedRequest('/v1/commands/wait-batch', {
        payload: {
          supervisor_mode: this.#supervisorMode,
          max_batch: this.#maxBatch,
          max_tab_mutations: this.#maxTabMutations,
          wait_ms: this.#batchWaitMs,
        },
      });
      if ([404, 405, 501].includes(response.status)) {
        if (this.#legacySingleLeaseFallback) {
          this.#batchTransport = 'UNAVAILABLE';
          this.#commandFastlane?.start();
        } else {
          this.#batchTransport = 'REQUIRED_UNAVAILABLE';
          this.#commandFastlane?.stop();
          this.#lastBatchCount = 0;
          throw new Error(`native_supervisor_batch_transport_required:http_${response.status}`);
        }
      } else {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(body?.commands)) {
          throw new Error(`native_supervisor_batch_next_http_${response.status}:${body?.error || 'invalid_batch'}`);
        }
        this.#batchTransport = 'SUPPORTED';
        this.#commandFastlane?.stop();
        this.#lastBatchCount = body.commands.length;
        return body.commands;
      }
    }
    if (!this.#legacySingleLeaseFallback) {
      this.#batchTransport = 'REQUIRED_UNAVAILABLE';
      this.#lastBatchCount = 0;
      throw new Error('native_supervisor_batch_transport_required');
    }
    const command = await this.#nextCommand();
    this.#lastBatchCount = command ? 1 : 0;
    return command ? [command] : [];
  }

  // Bounded, idempotent redelivery for command-result transport. The browser
  // effect has already happened when a receipt is posted; dropping the receipt
  // on a single transient transport failure turned completed commands into
  // EXPIRED lease_timeout_no_retry (observed live). Re-POSTing the immutable
  // receipt is safe — the completion RPC is atomic and idempotent per
  // command_id — and it never re-executes any browser effect. 4xx responses are
  // contract violations and are surfaced immediately without retry.
  static #retryableResultDeliveryFailure(status) {
    return Number(status) >= 500 || !Number.isFinite(Number(status));
  }

  async #deliverResultWithRetry(path, payload) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.#resultDeliveryAttempts; attempt += 1) {
      let response;
      try {
        response = await this.#signedRequest(path, { payload });
      } catch (error) {
        lastError = error;
        response = null;
      }
      if (response && response.ok) return response;
      if (response && !NativeSupervisorClient.#retryableResultDeliveryFailure(response.status)) {
        throw new Error(`native_supervisor_result_http_${response.status}`);
      }
      if (response) lastError = new Error(`native_supervisor_result_http_${response.status}`);
      if (attempt < this.#resultDeliveryAttempts) {
        const backoff = this.#resultDeliveryBackoffMs[Math.min(attempt - 1, this.#resultDeliveryBackoffMs.length - 1)] || 0;
        if (backoff > 0) await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw lastError || new Error('native_supervisor_result_delivery_failed');
  }

  async #postResult(command, ok, result, error = null, effectOutcome = null) {
    const payload = { ok, receipt: { schema: 'metaengine.native-supervisor.command-receipt.v2', command_id: command.command_id, action: command.action, platform: command.platform || null, result: result ?? null, effect_outcome: effectOutcome, recorded_at: new Date().toISOString(), authority_effect: false }, error };
    await this.#deliverResultWithRetry(`/v1/commands/${encodeURIComponent(command.command_id)}/result`, payload);
  }

  async #postBatchResults(rows) {
  const results = rows.map((row) => ({
    command_id: row.command.command_id,
    ok: row.ok,
    receipt: {
      schema: 'metaengine.native-supervisor.command-receipt.v2',
      command_id: row.command.command_id,
      action: row.command.action,
      platform: row.command.platform || null,
      result: row.result ?? null,
      effect_outcome: row.effect_outcome,
      lane: row.descriptor.lane,
      effect_key: row.descriptor.effect_key,
      execution_ms: row.execution_ms,
      recorded_at: new Date().toISOString(),
      authority_effect: false,
    },
    error: row.ok ? null : row.error,
    authority_effect: false,
  }));
  const chunks = partitionNativeSupervisorBatchResults(results);
  const acknowledgements = [];
  for (const chunk of chunks) {
    const response = await this.#deliverResultWithRetry('/v1/commands/result-batch', { results: chunk });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`native_supervisor_batch_result_http_${response.status}:${body?.error || 'unknown'}`);
    acknowledgements.push(...assertNativeSupervisorBatchCompletion(body, chunk));
  }
  return Object.freeze({
    schema: 'metaengine.native-supervisor.batch-result-delivery.v1',
    chunk_count: chunks.length,
    result_count: acknowledgements.length,
    results: Object.freeze(acknowledgements),
    transport_delivery_is_authority: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  });
}

  async #executeLocalOrRemote(command) {
    const action = String(command?.action || '').toUpperCase();
    // This is the only program-policy bypass. The command has already traversed
    // enrollment + device-signed lease transport before reaching this function.
    // The injected handler must independently prove developer owner/device binding,
    // immutable release authority and the Guardian durable effect journal.
    if (action === DEVELOPER_EMERGENCY_UPDATE_ACTION) {
      if (!this.#developerEmergencyUpdate) {
        return Object.freeze({
          schema: 'metaengine.developer-emergency-update-runtime.v1',
          state: 'HOLD',
          reason: 'DEVELOPER_EMERGENCY_UPDATE_HANDLER_UNAVAILABLE',
          physical_dispatch_count: 0,
          effect_outcome: 'NO_EFFECT_PROVEN',
          automatic_retry_allowed: false,
          bypass_program_policy: true,
          arbitrary_url_allowed: false,
          arbitrary_executable_allowed: false,
          arbitrary_shell_allowed: false,
          authority_effect: false,
        });
      }
      return this.#developerEmergencyUpdate(structuredClone(command));
    }
    if (ROOT_POLICY_ACTIONS.has(action)) return this.#executeCommand(command);
    if (action === 'ARM') {
      this.#supervisorMode = 'CONTROL';
      this.#armed = true;
      await this.#persistControlState();
      return { armed: true, supervisor_mode: 'CONTROL', authority_effect: true };
    }
    if (action === 'DISARM') {
      const error = new Error(ALWAYS_ON_CONTROL_ERROR);
      error.code = ALWAYS_ON_CONTROL_ERROR;
      throw error;
    }
    if (action === 'SET_SUPERVISOR_MODE') {
      const next = String(command?.payload?.mode || '').trim().toUpperCase();
      if (next !== 'CONTROL') {
        const error = new Error(ALWAYS_ON_CONTROL_ERROR);
        error.code = ALWAYS_ON_CONTROL_ERROR;
        throw error;
      }
      this.#supervisorMode = 'CONTROL';
      this.#armed = true;
      await this.#persistControlState();
      return { supervisor_mode: 'CONTROL', armed: true, authority_effect: true };
    }
    if (action === 'SET_MODE') {
      const requestedMode = String(command?.payload?.mode || command?.payload?.operator_mode || '').trim().toUpperCase();
      // SET_MODE is a legacy wire compatibility surface. OBSERVE and GATE_SEND no
      // longer represent runtime authority states; they canonicalize to the sole
      // supported always-on state instead of weakening setControlState().
      if (!['CONTROL','OBSERVE','GATE_SEND'].includes(requestedMode)) {
        const error = new Error(ALWAYS_ON_CONTROL_ERROR);
        error.code = ALWAYS_ON_CONTROL_ERROR;
        throw error;
      }
      this.#supervisorMode = 'CONTROL';
      this.#armed = true;
      await this.#persistControlState();
      return { operator_mode: 'CONTROL', supervisor_mode: 'CONTROL', armed: true, authority_effect: true };
    }
    if (action === 'CONTROL_CAPABILITIES') return browserControlCapabilities();
    if (action === 'SELF_UPDATE_STATUS') return this.#selfUpdate?.snapshot() || null;
    if (action === 'SELF_UPDATE_CHECK') {
      if (!controlModeAllows(this.#supervisorMode)) throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
      if (!armedAllows(this.#armed)) throw new Error('native_supervisor_disarmed');
      return this.#selfUpdate?.checkNow();
    }
    if (action === 'SELF_UPDATE_APPLY') {
      if (!controlModeAllows(this.#supervisorMode)) throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
      if (!armedAllows(this.#armed)) throw new Error('native_supervisor_disarmed');
      return this.#selfUpdate?.applyWhenSafe();
    }
    if (!controlModeAllows(this.#supervisorMode) && !READ_ONLY_ACTIONS.has(action)) throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
    if (!armedAllows(this.#armed) && !READ_ONLY_ACTIONS.has(action)) throw new Error('native_supervisor_disarmed');
    return this.#executeCommand(command);
  }

  #trackCommandStart(command) {
    const projection = stableCurrentCommand(command);
    this.#currentCommands.set(String(command.command_id), projection);
    this.#commandStartsAtMs.set(String(command.command_id), Date.now());
    if (!this.#currentCommand) this.#currentCommand = projection;
  }

  #trackCommandEnd(command) {
    this.#currentCommands.delete(String(command.command_id));
    this.#commandStartsAtMs.delete(String(command.command_id));
    this.#currentCommand = this.#currentCommands.values().next().value || null;
  }

  async #effectOutcome(command, result, descriptor, { beforeState = null } = {}) {
    if (descriptor.read_only) return null;
    const action = String(command?.action || '').toUpperCase();
    if (action === 'DOWNLOAD_FILE') {
      return verifiedDownloadReceiptConfirmsRequest(command?.payload, result) ? 'CONFIRMED' : 'AMBIGUOUS';
    }
    const explicit = String(result?.effect_outcome || '').toUpperCase();
    if (TERMINAL_EFFECT_OUTCOMES.has(explicit)) return explicit;
    const state = String(result?.effect_state || '').toUpperCase();
    if (PROVEN_EFFECT_STATES.has(state)) return 'CONFIRMED';
    if (state.startsWith('AMBIGUOUS')) return 'AMBIGUOUS';

    if (['ARM','SET_SUPERVISOR_MODE','SET_MODE'].includes(action)) return 'CONFIRMED';
    if (action === 'NEW_TAB' && result?.tab_id) return 'CONFIRMED';
    if (['FLEET_SET_PROFILE','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'].includes(action) && result) return 'CONFIRMED';

    if (action === 'FLEET_RECONCILE') {
      const before = fleetSnapshotFrom(beforeState);
      const returned = fleetSnapshotFrom(result);
      const afterState = await this.#getState().catch(() => null);
      const after = fleetSnapshotFrom(afterState);
      const ambiguousAgent = Array.isArray(result?.agents)
        && result.agents.some((agent) => String(agent?.lifecycle_state || '') === 'PROVISIONING_AMBIGUOUS');
      if (!before || !returned || !after || ambiguousAgent
        || !sameValue(projectFleetReconcileSemantics(returned), projectFleetReconcileSemantics(after))) return 'AMBIGUOUS';
      const explicitPhysicalChange = (Array.isArray(result?.elastic_retired) && result.elastic_retired.length > 0)
        || (Array.isArray(result?.orphan_fleet_tabs_swept) && result.orphan_fleet_tabs_swept.length > 0);
      if (explicitPhysicalChange) return 'CONFIRMED';
      return classifyFleetReconcileOutcome({
        before,
        after,
        active: command?.payload?.active === true,
        target_agents: command?.payload?.target_agents ?? null,
      }).effect_outcome;
    }

    if (['CLOSE_TAB','SELECT_TAB','NAVIGATE'].includes(action)) {
      const stateReadback = await this.#getState().catch(() => null);
      const tabId = String(command?.payload?.tab_id || result?.tab_id || '');
      const tabs = Array.isArray(stateReadback?.tabs) ? stateReadback.tabs : [];
      if (action === 'CLOSE_TAB') return tabId && !tabs.some((tab) => String(tab?.tab_id || '') === tabId) ? 'CONFIRMED' : 'AMBIGUOUS';
      if (action === 'SELECT_TAB') return tabId && String(stateReadback?.active_tab?.tab_id || '') === tabId ? 'CONFIRMED' : 'AMBIGUOUS';
      if (action === 'NAVIGATE') {
        const row = tabs.find((tab) => String(tab?.tab_id || '') === tabId);
        return row && result?.url && String(row.url || '') === String(result.url) ? 'CONFIRMED' : 'AMBIGUOUS';
      }
    }

    // D-L2: model legitimate no-op completions explicitly instead of quarantining
    // them as AMBIGUOUS (observed live as FAILED postcondition_not_confirmed on
    // healthy commands: BACK/FORWARD at history boundary, SCROLL at scroll
    // boundary, SELF_UPDATE_CHECK while CURRENT, RELOAD initiation).
    const noOpOutcome = classifyNoOpEffectOutcome(action, result);
    if (noOpOutcome) return noOpOutcome;

    // Dispatch success is not post-condition proof. Unsupported effect types are
    // quarantined instead of being mislabeled COMPLETED and are never auto-retried.
    return 'AMBIGUOUS';
  }

  async #executeForLane(command, descriptor) {
    if (!descriptor.read_only && this.#maintenancePromise) await this.#maintenancePromise;
    this.#trackCommandStart(command);
    const started = Date.now();
    try {
      const beforeState = String(command?.action || '').toUpperCase() === 'FLEET_RECONCILE'
        ? await this.#getState().catch(() => null)
        : null;
      const result = await this.#executeLocalOrRemote(command);
      const effectOutcome = await this.#effectOutcome(command, result, descriptor, { beforeState });
      return { result, effect_outcome: effectOutcome, execution_ms: Date.now() - started };
    } finally {
      this.#trackCommandEnd(command);
    }
  }

  async #runCommand(command) {
    const descriptor = classifyNativeSupervisorCommand(command);
    let result = null;
    let effectOutcome = descriptor.read_only ? null : 'AMBIGUOUS';
    try {
      const execution = await this.#executeForLane(command, descriptor);
      result = execution.result;
      effectOutcome = execution.effect_outcome;
      await this.#postResult(command, true, result, null, effectOutcome);
      this.#lastCommandId = command.command_id;
      this.#lastCommandStatus = descriptor.read_only || ['CONFIRMED','NO_EFFECT_PROVEN'].includes(effectOutcome) ? 'COMPLETED' : 'AMBIGUOUS';
      return result;
    } catch (error) {
      const message = clipError(error);
      effectOutcome = failedCommandEffectOutcome(command, descriptor, error);
      await this.#postResult(command, false, result, message, effectOutcome).catch(() => {});
      this.#lastCommandId = command.command_id;
      this.#lastCommandStatus = 'FAILED';
      throw error;
    }
  }

  async #runCommandBatch(commands) {
    const execution = await this.#commandLane.drain(commands, async (command, descriptor) => {
      const out = await this.#executeForLane(command, descriptor);
      return { command, descriptor, ...out };
    });
    const rows = execution.map((row, index) => {
      const nested = row.result || {};
      const descriptor = classifyNativeSupervisorCommand(commands[index]);
      return {
        command: commands[index],
        descriptor,
        ok: row.ok,
        result: row.ok ? nested.result ?? null : null,
        effect_outcome: row.ok
          ? nested.effect_outcome ?? null
          : failedCommandEffectOutcome(commands[index], descriptor, row.error, { schedulerRejected: row.scheduler_rejected === true }),
        execution_ms: row.ok ? nested.execution_ms ?? row.execution_ms : row.execution_ms,
        error: row.error,
      };
    });
    await this.#postBatchResults(rows);
    const last = rows.at(-1) || null;
    if (last) {
      this.#lastCommandId = last.command.command_id;
      this.#lastCommandStatus = last.ok
        ? (last.descriptor.read_only || ['CONFIRMED','NO_EFFECT_PROVEN'].includes(last.effect_outcome) ? 'COMPLETED' : 'AMBIGUOUS')
        : 'FAILED';
    }
    return rows;
  }

  async cycle() {
    if (this.#legacyFastlaneBusy) return this.snapshot();
    if (this.#cyclePromise) {
      // F-L1c: a healthy cycle is bounded by the CDP/result deadlines; a cycle
      // older than the stall guard means an execution path the bounds did not
      // reach. Surface it instead of waiting silently (the heartbeat stays alive
      // in parallel, which previously masked the wedge completely).
      const cycleAgeMs = this.#cycleStartedAtMs > 0 ? Date.now() - this.#cycleStartedAtMs : 0;
      if (cycleAgeMs > COMMAND_CYCLE_STALL_GUARD_MS) {
        this.#lastError = `command_cycle_stall:${cycleAgeMs}ms`;
      }
      return this.#cyclePromise;
    }
    this.#cycleStartedAtMs = Date.now();
    this.#cyclePromise = (async () => {
      try {
        const identity = await this.ensureEnrollment();
        if (!identity?.device_id) return this.snapshot();

        // Heartbeat is kept alive independently, but it never sits in front of the
        // command lease. Its state collection may be expensive (perception, fleet,
        // mesh), so the fast lane is allowed to proceed while the heartbeat is sent.
        this.#kickHeartbeat();

        const commands = await this.#nextCommands();
        if (commands.length > 0) {
          if (this.#batchTransport === 'SUPPORTED') await this.#runCommandBatch(commands);
          else await this.#runCommand(commands[0]);
        } else {
          // Heavy reconciler work only starts in an idle window. A later mutation
          // waits for an already-running maintenance pass instead of racing it.
          this.#kickMaintenance();
        }
        this.#lastError = null;
        return this.snapshot();
      } catch (error) {
        this.#lastError = clipError(error);
        throw error;
      }
    })().finally(() => { this.#cyclePromise = null; });
    return this.#cyclePromise;
  }
}
