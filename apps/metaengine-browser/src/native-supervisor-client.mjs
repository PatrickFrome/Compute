import fs from 'node:fs/promises';
import path from 'node:path';
import { SUPERVISOR_DEVICE_PROFILE } from './supervisor-device-identity.mjs';
import { SupervisorLifecycleRuntime } from './supervisor-lifecycle-runtime.mjs';
import { SelfUpdateRuntime } from './self-update-runtime.mjs';

export const NATIVE_SUPERVISOR_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1';
export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';

const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);
const READ_ONLY_ACTIONS = new Set(['POLL','CAPTURE','CAPTURE_VIEW','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD']);

async function persistSelfUpdateHandoffReceipt(receipt) {
  if (receipt?.schema !== 'metaengine.self-update.pre-install-receipt.v1') throw new Error('native_supervisor_self_update_receipt_schema_invalid');
  if (!receipt?.version || receipt?.version !== receipt?.available_version) throw new Error('native_supervisor_self_update_receipt_version_invalid');
  if (receipt?.metadata_verified !== true || receipt?.restart_gate_safe !== true || receipt?.authority_effect !== false) {
    throw new Error('native_supervisor_self_update_receipt_invariant_invalid');
  }
  const { app } = await import('electron');
  if (!app?.isPackaged) throw new Error('native_supervisor_self_update_packaged_required');
  if (!app.hasSingleInstanceLock()) throw new Error('native_supervisor_self_update_primary_lock_required');
  const target = path.join(app.getPath('userData'), 'metaengine-self-update-pre-install-receipt-v1.json');
  const temp = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const handle = await fs.open(temp, 'w', 0o600);
  try {
    await handle.write(`${JSON.stringify(receipt)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
  return { app, target };
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
      canActuate: () => this.#supervisorMode === 'CONTROL' && this.#armed === true,
      executeCommand: async (command) => {
        const action = String(command?.action || '');
        if (!READ_ONLY_ACTIONS.has(action)) {
          if (this.#supervisorMode !== 'CONTROL') throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
          if (!this.#armed) throw new Error('native_supervisor_disarmed');
        }
        return this.#executeCommand(command);
      },
    });
    this.#selfUpdate = new SelfUpdateRuntime({
      canRestart: async () => this.#supervisorMode === 'CONTROL'
        && this.#armed === true
        && this.#currentCommand == null
        && this.#lifecycle?.isQuiescent() === true,
      beforeInstall: async (receipt) => {
        await beforeSelfUpdateInstall?.(structuredClone(receipt));
        const { app } = await persistSelfUpdateHandoffReceipt(receipt);
        // Stop command polling before releasing the singleton lock. The old N process may remain alive
        // briefly while NSIS starts N+1, but it no longer has a scheduled supervisor actuation loop.
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
      arbitrary_eval: false,
      os_shell_authority: false,
    };
  }

  async start() {
    if (this.#running) return this.snapshot();
    this.#running = true;
    this.#startedAt = new Date().toISOString();
    await this.#identity.ensure();
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
    if (this.#supervisorMode !== 'CONTROL' && !READ_ONLY_ACTIONS.has(action)) {
      throw new Error(`native_supervisor_control_required:${this.#supervisorMode}`);
    }
    if (!this.#armed && !READ_ONLY_ACTIONS.has(action)) throw new Error('native_supervisor_disarmed');
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
