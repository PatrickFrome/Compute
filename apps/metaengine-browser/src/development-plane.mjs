import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { utilityProcess } from 'electron';

export const DEVELOPMENT_PLANE_PROTOCOL = 'metaengine.development-plane.v1';
export const DEVELOPMENT_PLANE_VERSION = '0.5.0';
export const DEVELOPMENT_PLANE_CAPABILITIES = Object.freeze([
  'HEALTH',
  'CAPABILITIES',
  'PROCESS_METRICS',
  'REPO_HEAD_READ',
  'DEVOS_REPO_READ_MODEL',
  'DEVOS_REPO_SEARCH',
  'CANDIDATE_CAPSULE_CREATE',
  'CANDIDATE_CAPSULE_VERIFY',
  'VERIFICATION_SANDBOX_PLAN_CREATE',
  'VERIFICATION_SANDBOX_PLAN_VERIFY',
  'ADVISORY_EVIDENCE_VERIFY',
]);

const PAYLOAD_CAPABILITIES = new Set([
  'DEVOS_REPO_SEARCH',
  'CANDIDATE_CAPSULE_CREATE',
  'CANDIDATE_CAPSULE_VERIFY',
  'VERIFICATION_SANDBOX_PLAN_CREATE',
  'VERIFICATION_SANDBOX_PLAN_VERIFY',
  'ADVISORY_EVIDENCE_VERIFY',
]);
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_TRANSCRIPT = 64;
const MAX_RESULTS = 16;

function payloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validatePayload(capability, payload) {
  if (!PAYLOAD_CAPABILITIES.has(capability)) {
    if (payload !== undefined && payload !== null) throw new Error('development_plane_payload_denied');
    return null;
  }
  if (!isPlainObject(payload)) throw new Error('development_plane_payload_required');
  if (payloadBytes(payload) > MAX_PAYLOAD_BYTES) throw new Error('development_plane_payload_too_large');
  return structuredClone(payload);
}

export class DevelopmentPlane {
  #spawnWorker;
  #workerPath;
  #env;
  #timeoutMs;
  #restartBaseMs;
  #restartMaxMs;
  #clock;
  #uuid;
  #child = null;
  #state = 'STOPPED';
  #pending = new Map();
  #restartTimer = null;
  #restartAttempt = 0;
  #lastExitCode = null;
  #lastError = null;
  #startedAt = null;
  #stopRequested = false;
  #cooperativeShutdownAck = false;
  #transcript = [];
  #lastResults = new Map();

  constructor({
    spawnWorker = null,
    workerPath = new URL('./development-plane-worker.cjs', import.meta.url),
    env = process.env,
    timeout_ms = 2500,
    restart_base_ms = 250,
    restart_max_ms = 5000,
    clock = Date.now,
    uuid = randomUUID,
  } = {}) {
    this.#workerPath = workerPath;
    this.#env = env;
    this.#timeoutMs = Math.max(100, Number(timeout_ms) || 2500);
    this.#restartBaseMs = Math.max(20, Number(restart_base_ms) || 250);
    this.#restartMaxMs = Math.max(this.#restartBaseMs, Number(restart_max_ms) || 5000);
    this.#clock = clock;
    this.#uuid = uuid;
    this.#spawnWorker = spawnWorker || (() => utilityProcess.fork(this.#workerPath, [], {
      env: { ...this.#env, ELECTRON_RUN_AS_NODE: '1' },
      serviceName: 'METAENGINE Development Plane',
    }));
  }

  snapshot() {
    const latest = Object.fromEntries([...this.#lastResults.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    return {
      protocol: DEVELOPMENT_PLANE_PROTOCOL,
      version: DEVELOPMENT_PLANE_VERSION,
      state: this.#state,
      pid: this.#child?.pid || null,
      capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES],
      authority_effect: false,
      browser_actuation_authority: false,
      shell_execution_authority: false,
      arbitrary_eval: false,
      direct_promote_current: false,
      verified_shutdown_required: true,
      cooperative_shutdown: true,
      cooperative_shutdown_ack: this.#cooperativeShutdownAck,
      automatic_restart: true,
      terminal_requires_external_stop: true,
      external_stop_requested: this.#stopRequested,
      restart_pending: Boolean(this.#restartTimer),
      restart_attempt: this.#restartAttempt,
      last_exit_code: this.#lastExitCode,
      last_error: this.#lastError,
      started_at: this.#startedAt,
      devos_repo_search: true,
      devos_repo_search_cache: 'HEAD_PLUS_WORKTREE_EVENT_EPOCH',
      devos_repo_search_worktree_watcher: true,
      devos_repo_source_cache: 'GIT_EVENT_INVALIDATED',
      devos_repo_search_warm_source_filesystem_reads: 0,
      devos_repo_search_arbitrary_path_selection: false,
      devos_repo_arbitrary_path_read: false,
      advisory_evidence_verification: true,
      advisory_evidence_network_dispatch: false,
      advisory_evidence_browser_authority: false,
      advisory_evidence_promotion_authority: false,
      transcript: this.#transcript.map((row) => ({ ...row })),
      latest,
    };
  }

  async start() {
    this.#stopRequested = false;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    if (this.#child) return this.snapshot();
    this.#state = 'STARTING';
    this.#cooperativeShutdownAck = false;
    let child;
    try {
      child = this.#spawnWorker();
    } catch (error) {
      this.#lastError = String(error?.message || error);
      this.#state = 'LOST';
      this.#scheduleRestart();
      throw error;
    }
    this.#child = child;
    child.on('message', (message) => this.#onMessage(child, message));
    child.on('exit', (code) => this.#onExit(child, code));
    child.on('error', (error) => {
      if (this.#child !== child) return;
      this.#lastError = String(error?.message || error);
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.has('__READY__')) return;
        this.#pending.delete('__READY__');
        this.#state = 'LOST';
        this.#lastError = 'development_plane_ready_timeout';
        try { child.kill(); } catch {}
        this.#scheduleRestart();
        reject(new Error('development_plane_ready_timeout'));
      }, this.#timeoutMs);
      this.#pending.set('__READY__', {
        capability: 'READY',
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  async request(capability, payload = undefined) {
    const name = String(capability || '').toUpperCase();
    if (!DEVELOPMENT_PLANE_CAPABILITIES.includes(name)) throw new Error('development_plane_capability_denied');
    if (this.#state !== 'READY' || !this.#child) throw new Error('development_plane_not_ready');
    const safePayload = validatePayload(name, payload);
    const requestId = this.#uuid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.has(requestId)) return;
        this.#pending.delete(requestId);
        this.#appendTranscript(name, 'TIMEOUT', null);
        reject(new Error('development_plane_request_timeout'));
      }, this.#timeoutMs);
      this.#pending.set(requestId, {
        capability: name,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#child.postMessage({
        protocol: DEVELOPMENT_PLANE_PROTOCOL,
        type: 'REQUEST',
        request_id: requestId,
        capability: name,
        payload: safePayload,
        authority_effect: false,
      });
    });
  }

  stop() {
    this.#stopRequested = true;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    const child = this.#child;
    if (!child) {
      this.#state = 'STOPPED';
      return false;
    }
    this.#state = 'STOPPING';
    try { child.kill(); } catch {}
    return true;
  }

  async stopAndWait(timeoutMs = 2000) {
    this.#stopRequested = true;
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
    const child = this.#child;
    if (!child) {
      this.#state = 'STOPPED';
      return { ok: true, state: 'STOPPED', last_exit_code: this.#lastExitCode, cooperative_shutdown_ack: this.#cooperativeShutdownAck };
    }
    this.#state = 'STOPPING';
    const wait = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('development_plane_shutdown_timeout')), Math.max(50, Number(timeoutMs) || 2000));
      const onExit = () => {
        clearTimeout(timer);
        child.off('exit', onExit);
        resolve();
      };
      child.on('exit', onExit);
    });
    try {
      child.postMessage({ protocol: DEVELOPMENT_PLANE_PROTOCOL, type: 'CONTROL', control: 'SHUTDOWN', authority_effect: false });
    } catch {
      try { child.kill(); } catch {}
    }
    await wait;
    return { ok: true, state: this.#state, last_exit_code: this.#lastExitCode, cooperative_shutdown_ack: this.#cooperativeShutdownAck };
  }

  #appendTranscript(capability, status, detail) {
    this.#transcript.push({ at: new Date(this.#clock()).toISOString(), capability, status, detail });
    if (this.#transcript.length > MAX_TRANSCRIPT) this.#transcript.splice(0, this.#transcript.length - MAX_TRANSCRIPT);
  }

  #retainResult(capability, result) {
    this.#lastResults.set(capability, structuredClone(result));
    if (this.#lastResults.size > MAX_RESULTS) {
      const first = this.#lastResults.keys().next().value;
      this.#lastResults.delete(first);
    }
    this.#appendTranscript(capability, 'OK', null);
  }

  #scheduleRestart() {
    if (this.#stopRequested || this.#restartTimer) return;
    const delay = Math.min(this.#restartMaxMs, this.#restartBaseMs * (2 ** this.#restartAttempt));
    this.#restartAttempt += 1;
    this.#state = 'RESTART_PENDING';
    this.#restartTimer = setTimeout(async () => {
      this.#restartTimer = null;
      if (this.#stopRequested || this.#child) return;
      try {
        await this.start();
      } catch {
        this.#scheduleRestart();
      }
    }, delay);
  }

  #onMessage(child, message) {
    if (this.#child !== child || !message || message.protocol !== DEVELOPMENT_PLANE_PROTOCOL) return;
    if (message.type === 'SHUTDOWN_ACK') {
      if (message.version === DEVELOPMENT_PLANE_VERSION && message.authority_effect === false) this.#cooperativeShutdownAck = true;
      return;
    }
    if (message.type === 'READY') {
      const exactCaps = Array.isArray(message.capabilities)
        && message.capabilities.length === DEVELOPMENT_PLANE_CAPABILITIES.length
        && DEVELOPMENT_PLANE_CAPABILITIES.every((capability) => message.capabilities.includes(capability));
      if (message.version !== DEVELOPMENT_PLANE_VERSION || !exactCaps) {
        this.#lastError = 'development_plane_capability_handshake_mismatch';
        this.#state = 'LOST';
        try { child.kill(); } catch {}
        const waiter = this.#pending.get('__READY__');
        this.#pending.delete('__READY__');
        waiter?.reject(new Error('development_plane_capability_handshake_mismatch'));
        this.#scheduleRestart();
        return;
      }
      this.#state = 'READY';
      this.#startedAt = new Date(this.#clock()).toISOString();
      this.#restartAttempt = 0;
      const waiter = this.#pending.get('__READY__');
      this.#pending.delete('__READY__');
      waiter?.resolve(this.snapshot());
      return;
    }
    if (message.type !== 'RESPONSE' || typeof message.request_id !== 'string') return;
    const pending = this.#pending.get(message.request_id);
    if (!pending) return;
    this.#pending.delete(message.request_id);
    if (message.ok === true) {
      this.#retainResult(pending.capability, message.result);
      pending.resolve(message.result);
    } else {
      this.#appendTranscript(pending.capability, 'ERROR', String(message.error || 'UNKNOWN'));
      pending.reject(new Error(`development_plane_remote_error:${String(message.error || 'UNKNOWN')}`));
    }
  }

  #onExit(child, code) {
    if (this.#child !== child) return;
    this.#lastExitCode = Number.isInteger(code) ? code : null;
    this.#child = null;
    const planned = this.#stopRequested || this.#state === 'STOPPING';
    this.#state = planned ? 'STOPPED' : 'LOST';
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject?.(new Error(planned ? 'development_plane_stopped' : 'development_plane_process_lost'));
    }
    if (!planned) this.#scheduleRestart();
  }
}
