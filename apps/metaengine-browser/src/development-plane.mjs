import crypto from 'node:crypto';

export const DEVELOPMENT_PLANE_VERSION = '0.2.0';
export const DEVELOPMENT_PLANE_PROTOCOL = 'metaengine.development-plane.v1';
export const DEVELOPMENT_PLANE_CAPABILITIES = Object.freeze([
  'HEALTH',
  'CAPABILITIES',
  'PROCESS_METRICS',
  'REPO_HEAD_READ',
  'CANDIDATE_CAPSULE_CREATE',
  'CANDIDATE_CAPSULE_VERIFY',
]);

const PAYLOAD_CAPABILITIES = new Set(['CANDIDATE_CAPSULE_CREATE', 'CANDIDATE_CAPSULE_VERIFY']);
const MAX_REQUEST_PAYLOAD_BYTES = 256 * 1024;

function clone(value) { return value == null ? value : structuredClone(value); }
function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export class DevelopmentPlane {
  #spawn;
  #clock;
  #uuid;
  #timeoutMs;
  #child = null;
  #state = 'STOPPED';
  #startedAt = null;
  #lastExitCode = null;
  #pending = new Map();
  #readyWait = null;
  #stopWait = null;
  #shutdownAck = false;

  constructor({ spawnWorker, clock = () => Date.now(), uuid = () => crypto.randomUUID(), timeout_ms = 5000 } = {}) {
    if (typeof spawnWorker !== 'function') throw new Error('development_plane_spawn_invalid');
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 100 || timeout_ms > 60000) throw new Error('development_plane_timeout_invalid');
    this.#spawn = spawnWorker;
    this.#clock = clock;
    this.#uuid = uuid;
    this.#timeoutMs = timeout_ms;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.development-plane.snapshot.v1',
      version: DEVELOPMENT_PLANE_VERSION,
      protocol: DEVELOPMENT_PLANE_PROTOCOL,
      state: this.#state,
      pid: this.#child?.pid ?? null,
      started_at: this.#startedAt,
      last_exit_code: this.#lastExitCode,
      capabilities: [...DEVELOPMENT_PLANE_CAPABILITIES],
      candidate_capsules: true,
      candidate_capsules_executable: false,
      candidate_capsule_max_payload_bytes: MAX_REQUEST_PAYLOAD_BYTES,
      direct_promote_current: false,
      arbitrary_eval: false,
      page_command_authority: false,
      browser_actuation_authority: false,
      automatic_restart: false,
      verified_shutdown_required: true,
      cooperative_shutdown: true,
      authority_effect: false,
    });
  }

  async start() {
    if (this.#state === 'READY') return this.snapshot();
    if (this.#state === 'STARTING' && this.#readyWait) return this.#readyWait;
    if (this.#child) throw new Error('development_plane_child_already_present');
    this.#state = 'STARTING';
    this.#lastExitCode = null;
    this.#shutdownAck = false;
    const child = this.#spawn();
    if (!child || typeof child.on !== 'function' || typeof child.postMessage !== 'function' || typeof child.kill !== 'function') {
      this.#state = 'LOST';
      throw new Error('development_plane_child_invalid');
    }
    this.#child = child;
    child.on('message', (message) => this.#onMessage(message));
    child.on('exit', (code) => this.#onExit(code));
    child.on('error', () => {});
    this.#readyWait = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#state === 'STARTING') {
          this.#state = 'LOST';
          try { this.#child?.kill(); } catch {}
          reject(new Error('development_plane_ready_timeout'));
        }
      }, this.#timeoutMs);
      this.#pending.set('__READY__', { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    }).finally(() => { this.#readyWait = null; });
    return this.#readyWait;
  }

  async request(capability, payload = null) {
    const cap = String(capability || '').toUpperCase();
    if (!DEVELOPMENT_PLANE_CAPABILITIES.includes(cap)) throw new Error('development_plane_capability_denied');
    if (this.#state !== 'READY' || !this.#child) throw new Error('development_plane_not_ready');
    let normalizedPayload = null;
    if (PAYLOAD_CAPABILITIES.has(cap)) {
      if (!plainObject(payload)) throw new Error('development_plane_payload_required');
      const encoded = JSON.stringify(payload);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_PAYLOAD_BYTES) throw new Error('development_plane_payload_too_large');
      normalizedPayload = clone(payload);
    } else if (payload !== null && payload !== undefined) {
      throw new Error('development_plane_payload_denied');
    }
    const requestId = `req_${String(this.#uuid()).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error('development_plane_request_timeout'));
      }, this.#timeoutMs);
      this.#pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(clone(value)); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#child.postMessage({
        protocol: DEVELOPMENT_PLANE_PROTOCOL,
        type: 'REQUEST',
        request_id: requestId,
        capability: cap,
        payload: normalizedPayload,
        authority_effect: false,
      });
    });
  }

  stop() {
    if (!this.#child) {
      this.#state = 'STOPPED';
      return false;
    }
    const child = this.#child;
    this.#state = 'STOPPING';
    const killed = child.kill();
    if (!killed) this.#state = 'LOST';
    return killed;
  }

  async stopAndWait(timeout_ms = this.#timeoutMs) {
    if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 100 || timeout_ms > 60000) throw new Error('development_plane_stop_timeout_invalid');
    if (!this.#child) {
      this.#state = 'STOPPED';
      return Object.freeze({ ok: true, state: 'STOPPED', last_exit_code: this.#lastExitCode, already_stopped: true, cooperative_shutdown_ack: this.#shutdownAck, authority_effect: false });
    }
    if (this.#stopWait) return this.#stopWait;
    const child = this.#child;
    this.#state = 'STOPPING';
    this.#shutdownAck = false;
    this.#stopWait = new Promise((resolve, reject) => {
      let settled = false;
      let fallbackTimer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        child.off?.('exit', onExit);
        fn(value);
      };
      const onExit = (code) => finish(resolve, Object.freeze({
        ok: true,
        state: 'STOPPED',
        last_exit_code: Number.isInteger(code) ? code : this.#lastExitCode,
        already_stopped: false,
        cooperative_shutdown_ack: this.#shutdownAck,
        authority_effect: false,
      }));
      const timer = setTimeout(() => {
        this.#state = 'LOST';
        try { child.kill(); } catch {}
        finish(reject, new Error('development_plane_stop_timeout'));
      }, timeout_ms);
      child.on('exit', onExit);
      try {
        child.postMessage({
          protocol: DEVELOPMENT_PLANE_PROTOCOL,
          type: 'CONTROL',
          control: 'SHUTDOWN',
          authority_effect: false,
        });
      } catch {
        try { child.kill(); } catch {}
      }
      fallbackTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill(); } catch {}
      }, Math.min(1500, Math.max(100, Math.floor(timeout_ms / 2))));
    }).finally(() => { this.#stopWait = null; });
    return this.#stopWait;
  }

  #onMessage(message) {
    if (!message || message.protocol !== DEVELOPMENT_PLANE_PROTOCOL) return;
    if (message.type === 'SHUTDOWN_ACK') {
      if (this.#state === 'STOPPING') this.#shutdownAck = true;
      return;
    }
    if (message.type === 'READY') {
      if (this.#state !== 'STARTING') return;
      const advertised = Array.isArray(message.capabilities) ? [...message.capabilities].sort() : [];
      const expected = [...DEVELOPMENT_PLANE_CAPABILITIES].sort();
      if (message.version !== DEVELOPMENT_PLANE_VERSION || advertised.length !== expected.length || advertised.some((x, i) => x !== expected[i])) {
        const waiter = this.#pending.get('__READY__');
        this.#pending.delete('__READY__');
        this.#state = 'LOST';
        try { this.#child?.kill(); } catch {}
        waiter?.reject(new Error('development_plane_capability_handshake_mismatch'));
        return;
      }
      this.#state = 'READY';
      this.#startedAt = new Date(this.#clock()).toISOString();
      const waiter = this.#pending.get('__READY__');
      this.#pending.delete('__READY__');
      waiter?.resolve(this.snapshot());
      return;
    }
    if (message.type !== 'RESPONSE' || typeof message.request_id !== 'string') return;
    const pending = this.#pending.get(message.request_id);
    if (!pending) return;
    this.#pending.delete(message.request_id);
    if (message.ok === true) pending.resolve(message.result);
    else pending.reject(new Error(`development_plane_remote_error:${String(message.error || 'UNKNOWN')}`));
  }

  #onExit(code) {
    this.#lastExitCode = Number.isInteger(code) ? code : null;
    this.#child = null;
    if (this.#state === 'STOPPING') this.#state = 'STOPPED';
    else this.#state = 'LOST';
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject(new Error('development_plane_process_lost'));
    }
  }
}
