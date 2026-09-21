// T3-11 supervisor loopback RPC primary: a loopback-only HTTP RPC surface for
// the SAME fenced supervisor command executor that serves remote DB-leased
// commands. Local callers (CLI, operator tooling) issue supervisor commands
// through this native loopback endpoint instead of a remote edge roundtrip;
// the chat -> edge -> DB-lease path remains as the remote fallback. The server
// is bound to 127.0.0.1, authenticated with a per-session bearer token
// (timing-safe compare), and never fabricates authority: every effect flag in
// the response comes from the executor itself.

import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const SUPERVISOR_LOOPBACK_RPC_SCHEMA = 'metaengine.supervisor.loopback-rpc.v1';
export const SUPERVISOR_LOOPBACK_RPC_METHODS = Object.freeze({
  'supervisor.health': 'READ_ONLY',
  'supervisor.snapshot': 'READ_ONLY',
  'supervisor.command': 'SUPERVISOR_FENCE',
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_MANIFEST_PATH = path.join(os.homedir(), '.a2', 'supervisor-loopback.json');

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function tokenEquals(expected, provided) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(provided || ''), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(payload);
}

export class SupervisorLoopbackRpcServer {
  #executeCommand;
  #snapshotProvider;
  #host;
  #port;
  #token;
  #manifestPath;
  #server = null;
  #state = 'STOPPED';
  #startedAt = null;
  #requestsTotal = 0;
  #errorsTotal = 0;
  #lastError = null;

  constructor({
    executeCommand,
    snapshotProvider = null,
    host = '127.0.0.1',
    port = 0,
    token = null,
    manifestPath = DEFAULT_MANIFEST_PATH,
  } = {}) {
    if (typeof executeCommand !== 'function') throw new Error('supervisor_loopback_executor_required');
    if (snapshotProvider != null && typeof snapshotProvider !== 'function') throw new Error('supervisor_loopback_snapshot_provider_invalid');
    const bindHost = String(host || '127.0.0.1');
    if (!LOOPBACK_HOSTS.has(bindHost)) throw new Error('supervisor_loopback_host_not_loopback');
    this.#executeCommand = executeCommand;
    this.#snapshotProvider = snapshotProvider;
    this.#host = bindHost;
    this.#port = Number.isSafeInteger(Number(port)) && Number(port) >= 0 ? Number(port) : 0;
    this.#token = String(token || randomBytes(32).toString('hex'));
    this.#manifestPath = String(manifestPath || DEFAULT_MANIFEST_PATH);
  }

  get state() { return this.#state; }

  snapshot() {
    return Object.freeze({
      schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA,
      state: this.#state,
      host: this.#host,
      port: this.#server ? this.#port : null,
      methods: SUPERVISOR_LOOPBACK_RPC_METHODS,
      requests_total: this.#requestsTotal,
      errors_total: this.#errorsTotal,
      last_error: this.#lastError,
      started_at: this.#startedAt,
      token_exposed: false,
      command_transport_authority: 'SHARED_FENCED_EXECUTOR',
      authority_effect: false,
    });
  }

  async start() {
    if (this.#server) return this.snapshot();
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => { this.#handle(req, res); });
      server.once('error', reject);
      server.listen(this.#port, this.#host, () => resolve(server));
    }).then((server) => {
      this.#server = server;
      this.#port = server.address().port;
      this.#state = 'LISTENING';
      this.#startedAt = new Date().toISOString();
    });
    try {
      await fs.mkdir(path.dirname(this.#manifestPath), { recursive: true });
      await fs.writeFile(this.#manifestPath, JSON.stringify({
        schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA,
        url: `http://${this.#host}:${this.#port}/rpc`,
        token: this.#token,
        pid: process.pid,
        methods: SUPERVISOR_LOOPBACK_RPC_METHODS,
      }, null, 2) + '\n', { mode: 0o600 });
    } catch (error) {
      this.#lastError = clip(error?.message || error, 240);
    }
    return this.snapshot();
  }

  async stop() {
    const server = this.#server;
    if (!server) { this.#state = 'STOPPED'; return this.snapshot(); }
    this.#state = 'STOPPING';
    await new Promise((resolve) => { server.close(() => resolve()); });
    this.#server = null;
    this.#state = 'STOPPED';
    try { await fs.unlink(this.#manifestPath); } catch { /* best effort */ }
    return this.snapshot();
  }

  #reject(res, status, code, message) {
    this.#errorsTotal += 1;
    this.#lastError = clip(code, 240);
    jsonResponse(res, status, { ok: false, schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA, error: code, message: clip(message, 240) });
  }

  #handle(req, res) {
    this.#requestsTotal += 1;
    try {
      if (req.method !== 'POST' || req.url !== '/rpc') {
        this.#reject(res, req.method !== 'POST' ? 405 : 404, 'supervisor_loopback_route_invalid', 'POST /rpc only');
        return;
      }
      const auth = String(req.headers.authorization || '');
      const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!tokenEquals(this.#token, provided)) {
        this.#reject(res, 401, 'supervisor_loopback_token_invalid', 'bearer token required');
        return;
      }
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy();
          this.#reject(res, 413, 'supervisor_loopback_body_too_large', 'body exceeds 256KB');
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          this.#reject(res, 400, 'supervisor_loopback_body_invalid', 'JSON body required');
          return;
        }
        this.#dispatch(body, res).catch((error) => {
          this.#reject(res, 500, 'supervisor_loopback_internal_error', error?.message || error);
        });
      });
    } catch (error) {
      this.#reject(res, 500, 'supervisor_loopback_internal_error', error?.message || error);
    }
  }

  async #dispatch(body, res) {
    const method = String(body?.method || '');
    const effect = SUPERVISOR_LOOPBACK_RPC_METHODS[method];
    if (!effect) {
      this.#reject(res, 400, 'supervisor_loopback_method_unknown', `unknown method: ${clip(method, 96) || '(none)'}`);
      return;
    }
    if (method === 'supervisor.health') {
      jsonResponse(res, 200, {
        ok: true,
        schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA,
        state: this.#state,
        authority_effect: false,
      });
      return;
    }
    if (method === 'supervisor.snapshot') {
      const snapshot = this.#snapshotProvider ? await this.#snapshotProvider() : null;
      jsonResponse(res, 200, {
        ok: true,
        schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA,
        result: snapshot,
        authority_effect: false,
      });
      return;
    }
    const command = body?.params?.command;
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      this.#reject(res, 400, 'supervisor_loopback_command_invalid', 'params.command object required');
      return;
    }
    let result = null;
    let error = null;
    try {
      result = await this.#executeCommand(structuredClone(command));
    } catch (thrown) {
      error = thrown;
    }
    if (error) {
      jsonResponse(res, 200, {
        ok: false,
        schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA,
        error: 'supervisor_loopback_command_failed',
        message: clip(error?.message || error, 240),
        authority_effect: false,
      });
      return;
    }
    jsonResponse(res, 200, {
      ok: true,
      schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA,
      result,
      authority_effect: result?.authority_effect === true,
    });
  }
}
