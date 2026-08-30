import { browserControlCapabilities } from './browser-control-capabilities.mjs';
import { globalOwnerGateDisabled } from './owner-safety-gate-registry.mjs';
import { SUPERVISOR_DEVICE_PROFILE } from './supervisor-device-identity.mjs';
import { SupervisorLifecycleRuntime } from './supervisor-lifecycle-runtime.mjs';
import { SelfUpdateRuntime } from './self-update-runtime.mjs';
import { confirmSelfUpdateRestartSafety } from './self-update-restart-safety.mjs';
import { persistPreInstallReceipt } from './self-update-handoff.mjs';
import { reconcileRestoredGeneratingChats } from './self-update-chat-reconcile.mjs';
import {
  buildSelfUpdateSessionContinuity,
  clearSelfUpdateSessionContinuity,
  loadSelfUpdateSessionContinuity,
  persistSelfUpdateSessionContinuity,
} from './self-update-session-continuity.mjs';

export const NATIVE_SUPERVISOR_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1';
export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';

const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);
const READ_ONLY_ACTIONS = new Set([
  'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
  'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS',
]);
const ROOT_POLICY_ACTIONS = new Set(['GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL']);

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

export class NativeSupervisorClient {
  #identity;
  #fetch;
  #getState;
  #executeCommand;
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
  #enrollmentStatus = 'UNINITIALIZED';
  #supervisorMode = 'CONTROL';
  #armed = true;
  #lifecycle = null;
  #selfUpdate = null;
  #continuityStatus = { state: 'NONE', restored_tabs: 0, target_version: null, authority_effect: false };

  constructor({ identity, fetchImpl = globalThis.fetch, getState, executeCommand, version, intervalMs = 2000, beforeSelfUpdateInstall = null }) {
    if (!identity) throw new Error('native_supervisor_identity_required');
    if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
    if (typeof getState !== 'function') throw new Error('native_supervisor_state_provider_required');
    if (typeof executeCommand !== 'function') throw new Error('native_supervisor_command_executor_required');
    if (beforeSelfUpdateInstall != null && typeof beforeSelfUpdateInstall !== 'function') throw new Error('native_supervisor_self_update_handoff_invalid');
    this.#identity = identity;
    this.#fetch = fetchImpl;
    this.#getState = getState;
    this.#executeCommand = executeCommand;
    this.#version = String(version || '0.0.0');
    this.#intervalMs = Math.max(1000, Number(intervalMs || 2000));
    this.#lifecycle = new SupervisorLifecycleRuntime({
      getState: this.#getState,
      canActuate: () => controlModeAllows(this.#supervisorMode) && armedAllows(this.#armed),
      executeCommand: async (command) => {
        const action = String(command?.action || '');
        if (!READ_ONLY_ACTIONS.has(action) && !ROOT_POLICY_ACTIONS.has(action)) {
          if (!controlModeAllows(this.#supervisorMode)) throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
          if (!armedAllows(this.#armed)) throw new Error('native_supervisor_disarmed');
        }
        return this.#executeCommand(command);
      },
    });
    this.#selfUpdate = new SelfUpdateRuntime({
      canRestart: async () => {
        if (!controlModeAllows(this.#supervisorMode)) return false;
        if (!armedAllows(this.#armed)) return false;
        if (this.#currentCommand != null && !globalOwnerGateDisabled('self_update.current_command')) return false;
        return confirmSelfUpdateRestartSafety({ getState: this.#getState });
      },
      beforeInstall: async (receipt) => {
        const { app } = await import('electron');
        await persistPreInstallReceipt(app, receipt);
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
      enrollment_status: this.#enrollmentStatus,
      identity: this.#identity.snapshot(),
      supervisor_mode: this.#supervisorMode,
      armed: this.#armed,
      lifecycle: this.#lifecycle?.snapshot() || null,
      self_update: this.#selfUpdate?.snapshot() || null,
      session_continuity: structuredClone(this.#continuityStatus),
      arbitrary_eval: false,
      os_shell_authority: false,
    };
  }

  async #persistSessionContinuity(app, receipt) {
    const state = await this.#getState();
    const lifecycle = this.#lifecycle?.snapshot() || null;
    const tabs = (state?.tabs || []).map((tab) => ({
      ...tab,
      generation_state: generationStateForTab(lifecycle, tab?.tab_id),
    }));
    const selectedTabId = state?.active_tab?.tab_id
      || tabs.find((tab) => tab?.selected === true)?.tab_id
      || null;
    const row = buildSelfUpdateSessionContinuity({
      currentVersion: this.#version,
      targetVersion: receipt?.version,
      tabsSnapshot: { tabs, selected_tab_id: selectedTabId },
      lifecycleSnapshot: lifecycle,
    });
    await persistSelfUpdateSessionContinuity(app.getPath('userData'), row);
    this.#continuityStatus = {
      state: 'PERSISTED',
      restored_tabs: 0,
      tab_count: row.tabs.length,
      target_version: row.target_version,
      had_generating_tabs: row.tabs.some((tab) => tab?.generation_state === 'GENERATING'),
      authority_effect: false,
    };
  }

  async #restoreSessionContinuity() {
    const { app } = await import('electron');
    const userData = app.getPath('userData');
    const row = await loadSelfUpdateSessionContinuity(userData);
    if (!row) return null;
    this.#continuityStatus = {
      state: 'FOUND',
      restored_tabs: 0,
      tab_count: row.tabs.length,
      target_version: row.target_version || null,
      authority_effect: false,
    };
    if (row.target_version && String(row.target_version) !== this.#version) {
      this.#continuityStatus.state = 'TARGET_VERSION_MISMATCH';
      return row;
    }

    const state = await this.#getState();
    const byUrl = new Map();
    for (const tab of state?.tabs || []) {
      const url = String(tab?.url || '');
      if (url && !byUrl.has(url)) byUrl.set(url, tab);
    }

    let selectedTabId = null;
    let restoredTabs = 0;
    let failedTabs = 0;
    let closedExtraTabs = 0;
    const bindings = [];
    for (const prior of row.tabs || []) {
      const url = String(prior?.url || '');
      if (!url) continue;
      let current = byUrl.get(url) || null;
      if (!current) {
        try {
          current = await this.#executeCommand({
            action: 'NEW_TAB',
            payload: { url, select: false },
            platform: null,
          });
          if (current?.tab_id) {
            byUrl.set(url, current);
            restoredTabs += 1;
          } else failedTabs += 1;
        } catch {
          failedTabs += 1;
          continue;
        }
      }
      if (current?.tab_id) {
        bindings.push({
          prior_tab_id: String(prior?.prior_tab_id || ''),
          tab_id: String(current.tab_id),
          generation_state: String(prior?.generation_state || 'UNKNOWN').toUpperCase(),
        });
      }
      if (prior?.selected === true && current?.tab_id) selectedTabId = String(current.tab_id);
    }
    if (selectedTabId) {
      try {
        await this.#executeCommand({ action: 'SELECT_TAB', payload: { tab_id: selectedTabId }, platform: null });
      } catch {
        failedTabs += 1;
      }
    }

    if (failedTabs === 0) {
      try {
        const postRestoreState = await this.#getState();
        const cleanup = planPostRestoreBlankTabCleanup({
          continuityRow: row,
          bindings,
          currentTabs: postRestoreState?.tabs || [],
        });
        for (const tabId of cleanup.close_tab_ids) {
          await this.#executeCommand({ action: 'CLOSE_TAB', payload: { tab_id: tabId }, platform: null });
          closedExtraTabs += 1;
        }
      } catch {
        failedTabs += 1;
      }
    }

    let reconcile = {
      schema: 'metaengine.self-update-chat-reconcile.v1',
      tabs: [], ambiguous_count: 0, unresolved_count: 0, authority_effect: false,
    };
    if (failedTabs === 0 && bindings.some((binding) => binding.generation_state === 'GENERATING')) {
      reconcile = await reconcileRestoredGeneratingChats({
        bindings,
        captureTab: async (tabId) => this.#executeCommand({
          action: 'CAPTURE', payload: { tab_id: String(tabId) }, platform: 'CHATGPT',
        }),
        clickControl: async (tabId, accessibleName) => this.#executeCommand({
          action: 'TYPED_CLICK',
          payload: { tab_id: String(tabId), role: 'button', accessible_name: String(accessibleName) },
          platform: 'CHATGPT',
        }),
      });
      failedTabs += Number(reconcile.unresolved_count || 0);
    }

    this.#continuityStatus = {
      state: failedTabs === 0 ? 'RESTORED' : 'PARTIAL',
      restored_tabs: restoredTabs,
      closed_extra_tabs: closedExtraTabs,
      failed_tabs: failedTabs,
      tab_count: row.tabs.length,
      target_version: row.target_version || null,
      had_generating_tabs: row.tabs.some((tab) => tab?.generation_state === 'GENERATING'),
      lifecycle_resume_present: Boolean(row.lifecycle?.active_request),
      reconciled_generating_tabs: reconcile.tabs.length,
      reconcile_ambiguous_count: reconcile.ambiguous_count,
      reconcile_unresolved_count: reconcile.unresolved_count,
      reconcile_authority_effect: reconcile.authority_effect === true,
      authority_effect: false,
    };
    if (failedTabs === 0) await clearSelfUpdateSessionContinuity(userData);
    return row;
  }

  async start() {
    if (this.#running) return this.snapshot();
    this.#running = true;
    this.#startedAt = new Date().toISOString();
    await this.#identity.ensure();
    await this.#restoreSessionContinuity().catch((error) => {
      this.#lastError = `continuity_restore:${clipError(error)}`;
      this.#continuityStatus = { ...this.#continuityStatus, state: 'ERROR', error: clipError(error), authority_effect: false };
    });
    await this.#lifecycle.start().catch((error) => { this.#lastError = `lifecycle_start:${clipError(error)}`; });
    await this.#selfUpdate.start().catch((error) => { this.#lastError = `self_update_start:${clipError(error)}`; });
    await this.cycle().catch(() => {});
    this.#schedule();
    return this.snapshot();
  }

  stop() {
    this.#running = false;
    this.#lifecycle?.stop?.();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  setControlState({ mode, armed } = {}) {
    if (mode !== undefined) {
      const next = String(mode).toUpperCase();
      if (!['OFF','MONITOR','CONTROL'].includes(next)) throw new Error('native_supervisor_mode_invalid');
      this.#supervisorMode = next;
    }
    if (armed !== undefined) this.#armed = armed === true;
    return this.snapshot();
  }

  #schedule() {
    if (!this.#running || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.cycle().catch(() => {}).finally(() => this.#schedule());
    }, this.#intervalMs);
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
    if (identity.device_id) {
      this.#enrollmentStatus = 'ENROLLED';
      return identity;
    }
    if (!identity.enrollment_request_id) {
      const payload = {
        profile: SUPERVISOR_DEVICE_PROFILE,
        public_jwk: identity.public_jwk,
        key_fingerprint_sha256: identity.key_fingerprint_sha256,
        metadata: { shell_version: this.#version },
      };
      const response = await this.#enrollmentRequest('/v1/device/enrollment/request', payload);
      const body = await response.json().catch(() => ({}));
      if (![200, 202].includes(response.status) || !body?.request_id) {
        throw new Error(`native_supervisor_enrollment_request_http_${response.status}:${body?.reason || body?.error || 'unknown'}`);
      }
      await this.#identity.bindEnrollmentRequest(body.request_id);
      this.#enrollmentStatus = String(body.status || 'PENDING');
      return this.#identity.snapshot();
    }
    const payload = {
      request_id: identity.enrollment_request_id,
      profile: SUPERVISOR_DEVICE_PROFILE,
      public_jwk: identity.public_jwk,
      key_fingerprint_sha256: identity.key_fingerprint_sha256,
    };
    const response = await this.#enrollmentRequest('/v1/device/enrollment/status', payload);
    const body = await response.json().catch(() => ({}));
    if (response.status === 200 && body?.accepted === true && body?.device_id) {
      await this.#identity.bindDevice(body.device_id);
      this.#enrollmentStatus = 'ENROLLED';
      return this.#identity.snapshot();
    }
    if (response.status === 202) {
      this.#enrollmentStatus = 'PENDING_APPROVAL';
      return this.#identity.snapshot();
    }
    const reason = String(body?.reason || body?.error || 'unknown');
    if (response.status === 409 && /EXPIRED|REJECTED|NOT_FOUND/.test(reason.toUpperCase())) {
      await this.#identity.clearEnrollmentRequest();
      this.#enrollmentStatus = 'RETRY_REQUIRED';
      return this.#identity.snapshot();
    }
    throw new Error(`native_supervisor_enrollment_status_http_${response.status}:${reason}`);
  }

  async #heartbeat() {
    const state = await this.#getState();
    const payload = {
      state: {
        ...state,
        shell_version: this.#version,
        supervisor_mode: this.#supervisorMode,
        armed: this.#armed,
        operator_mode: this.#supervisorMode === 'CONTROL' ? 'CONTROL' : 'OBSERVE',
        started_at: this.#startedAt,
        last_error: this.#lastError,
        supervisor_lifecycle: this.#lifecycle?.snapshot() || null,
        self_update: this.#selfUpdate?.snapshot() || null,
        self_update_session_continuity: structuredClone(this.#continuityStatus),
      },
      last_command_id: this.#lastCommandId,
      last_command_status: this.#lastCommandStatus,
    };
    const response = await this.#signedRequest('/v1/state', { payload });
    if (response.status !== 202) throw new Error(`native_supervisor_state_http_${response.status}`);
    this.#lastHeartbeatAt = new Date().toISOString();
  }

  async #nextCommand() {
    const response = await this.#signedRequest('/v1/commands/next', { payload: { supervisor_mode: this.#supervisorMode } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`native_supervisor_next_http_${response.status}`);
    return body?.command || null;
  }

  async #postResult(command, ok, result, error = null) {
    const payload = {
      ok,
      receipt: {
        schema: 'metaengine.native-supervisor.command-receipt.v1',
        command_id: command.command_id,
        action: command.action,
        platform: command.platform || null,
        result: result ?? null,
        recorded_at: new Date().toISOString(),
        authority_effect: false,
      },
      error,
    };
    const response = await this.#signedRequest(`/v1/commands/${encodeURIComponent(command.command_id)}/result`, { payload });
    if (!response.ok) throw new Error(`native_supervisor_result_http_${response.status}`);
  }

  async #executeLocalOrRemote(command) {
    const action = String(command?.action || '');
    if (ROOT_POLICY_ACTIONS.has(action)) return this.#executeCommand(command);
    if (action === 'ARM') {
      this.#armed = true;
      return { armed: true, supervisor_mode: this.#supervisorMode, authority_effect: true };
    }
    if (action === 'DISARM') {
      this.#armed = false;
      return { armed: false, supervisor_mode: this.#supervisorMode, authority_effect: true };
    }
    if (action === 'SET_SUPERVISOR_MODE') {
      const next = String(command?.payload?.mode || '').toUpperCase();
      if (!['OFF','MONITOR','CONTROL'].includes(next)) throw new Error('native_supervisor_mode_invalid');
      this.#supervisorMode = next;
      return { supervisor_mode: next, armed: this.#armed, authority_effect: true };
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
    if (!controlModeAllows(this.#supervisorMode) && !READ_ONLY_ACTIONS.has(action)) {
      throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
    }
    if (!armedAllows(this.#armed) && !READ_ONLY_ACTIONS.has(action)) throw new Error('native_supervisor_disarmed');
    return this.#executeCommand(command);
  }

  async #runCommand(command) {
    this.#currentCommand = {
      command_id: command.command_id,
      action: command.action,
      platform: command.platform || null,
      issued_at: command.issued_at || null,
      expires_at: command.expires_at || null,
    };
    let result = null;
    try {
      result = await this.#executeLocalOrRemote(command);
      await this.#postResult(command, true, result, null);
      this.#lastCommandId = command.command_id;
      this.#lastCommandStatus = 'COMPLETED';
      return result;
    } catch (error) {
      const message = clipError(error);
      await this.#postResult(command, false, result, message).catch(() => {});
      this.#lastCommandId = command.command_id;
      this.#lastCommandStatus = 'FAILED';
      throw error;
    } finally {
      this.#currentCommand = null;
    }
  }

  async cycle() {
    if (this.#cyclePromise) return this.#cyclePromise;
    this.#cyclePromise = (async () => {
      try {
        await this.#lifecycle?.cycle().catch((error) => { this.#lastError = `lifecycle:${clipError(error)}`; });
        await this.#selfUpdate?.cycle().catch((error) => { this.#lastError = `self_update:${clipError(error)}`; });
        const identity = await this.ensureEnrollment();
        if (!identity?.device_id) return this.snapshot();
        await this.#heartbeat();
        const command = await this.#nextCommand();
        if (command) await this.#runCommand(command);
        await this.#lifecycle?.cycle().catch(() => {});
        await this.#selfUpdate?.cycle().catch(() => {});
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
