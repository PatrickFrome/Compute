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
  'client.connection-status': 'READ_ONLY',
  'client.work-readiness': 'READ_ONLY',
  'supervisor.command': 'SUPERVISOR_FENCE',
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_MANIFEST_PATH = path.join(os.homedir(), '.a2', 'supervisor-loopback.json');

// These methods expose the installed Client's existing observation owners.
// Keep the response projection explicit: future owner fields must never turn
// this local read lane into a key, device payload, prompt or command export.
const CLIENT_READ_CONTRACTS = Object.freeze({
  'client.connection-status': Object.freeze({
    schema: 'metaengine.client.connection-status.v1',
    requiredFields: Object.freeze([
      'local_runtime_ready', 'secure_device_key_ready', 'device_enrolled', 'enrollment_state',
      'admin_ready', 'access_tier', 'admin_scopes', 'admin_grant_epoch', 'cloud_control_state',
      'automatic_reconnect', 'reconnect_uses_existing_supervisor_cycle', 'second_connection_scheduler',
      'local_shell_survives_cloud_outage', 'network_availability_guaranteed', 'legacy_daemon_feed_is_authority',
      'master_secret_embedded', 'service_role_embedded', 'cloudflare_token_embedded', 'automatic_effect_retry_allowed',
    ]),
    fields: Object.freeze({
      local_runtime_ready: 'boolean', secure_device_key_ready: 'boolean', device_enrolled: 'boolean',
      enrollment_state: 'string:48', admin_ready: 'boolean', access_tier: 'nullable-string:32',
      admin_scopes: 'strings:16:64', admin_grant_epoch: 'nullable-count', admin_status_checked_at: 'nullable-string:64',
      cloud_control_state: 'string:48', last_heartbeat_at: 'nullable-string:64',
      last_connection_success_at: 'nullable-string:64', last_connection_failure_at: 'nullable-string:64',
      connection_consecutive_failures: 'count', auth_recovery_count: 'count',
      last_auth_recovery_at: 'nullable-string:64', last_auth_recovery_reason: 'nullable-string:96',
      auth_recovery_in_flight: 'boolean', recoverable_auth_reasons: 'strings:8:96',
      admin_denial_auto_bypass: 'false', invalid_signature_auto_bypass: 'false', request_replayed_after_auth_recovery: 'false',
      automatic_reconnect: 'boolean', reconnect_uses_existing_supervisor_cycle: 'boolean', second_connection_scheduler: 'false',
      local_shell_survives_cloud_outage: 'boolean', network_availability_guaranteed: 'false', legacy_daemon_feed_is_authority: 'false',
      master_secret_embedded: 'false', service_role_embedded: 'false', cloudflare_token_embedded: 'false', automatic_effect_retry_allowed: 'false',
      fallback_mode: 'string:48', fallback_ready: 'boolean', fallback_enabled: 'boolean', cloud_health: 'string:48',
    }),
  }),
  'client.work-readiness': Object.freeze({
    schema: 'metaengine.client.work-readiness.v1',
    requireAllFields: true,
    fields: Object.freeze({
      observed_at: 'string:64', state: 'string:16', reason: 'nullable-string:96', label: 'string:80', detail: 'string:320',
      execution_ready: 'boolean', heartbeat_fresh: 'boolean', generation_floor: 'nullable-count', local_generation_floor: 'nullable-count',
      supervisor_state: 'nullable-string:48', supervisor_cycle_seq: 'nullable-count', proven_agent_count: 'count',
      active_agent_count: 'nullable-count', bound_unverified_agent_count: 'nullable-count', useful_work_verified: 'false',
      recovery_effect_exposed: 'false', scheduler_authority: 'false', automatic_retry_allowed: 'false',
    }),
  }),
});

function projectClientReadField(value, descriptor) {
  const [kind, bound, itemBound] = descriptor.split(':');
  if (kind.startsWith('nullable-') && value === null) return null;
  if (kind === 'boolean') { if (typeof value === 'boolean') return value; }
  else if (kind === 'false') { if (value === false) return false; }
  else if (kind === 'count' || kind === 'nullable-count') {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } else if (kind === 'string' || kind === 'nullable-string') {
    if (typeof value === 'string') return value.slice(0, Number(bound));
  } else if (kind === 'strings') {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value.slice(0, Number(bound)).map((item) => item.slice(0, Number(itemBound)));
    }
  }
  throw new Error('client_observation_field_invalid');
}

function projectClientReadResult(value, contract) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.hasOwn(value, 'schema') || !Object.hasOwn(value, 'authority_effect')
    || value.schema !== contract.schema || value.authority_effect !== false) {
    throw new Error('client_observation_contract_invalid');
  }
  const requiredFields = contract.requireAllFields ? Object.keys(contract.fields) : contract.requiredFields;
  if (requiredFields.some((field) => !Object.hasOwn(value, field))) throw new Error('client_observation_fields_missing');
  const result = { schema: contract.schema, authority_effect: false };
  for (const [field, descriptor] of Object.entries(contract.fields)) {
    if (Object.hasOwn(value, field)) result[field] = projectClientReadField(value[field], descriptor);
  }
  return result;
}

function hasNoClientReadParams(body) {
  if (!Object.hasOwn(body, 'params')) return true;
  const params = body.params;
  return params != null && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).length === 0;
}

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
  #clientConnectionStatusProvider;
  #clientWorkReadinessProvider;
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
    clientConnectionStatusProvider = null,
    clientWorkReadinessProvider = null,
    host = '127.0.0.1',
    port = 0,
    token = null,
    manifestPath = DEFAULT_MANIFEST_PATH,
  } = {}) {
    if (typeof executeCommand !== 'function') throw new Error('supervisor_loopback_executor_required');
    if (snapshotProvider != null && typeof snapshotProvider !== 'function') throw new Error('supervisor_loopback_snapshot_provider_invalid');
    if (clientConnectionStatusProvider != null && typeof clientConnectionStatusProvider !== 'function') throw new Error('supervisor_loopback_client_connection_status_provider_invalid');
    if (clientWorkReadinessProvider != null && typeof clientWorkReadinessProvider !== 'function') throw new Error('supervisor_loopback_client_work_readiness_provider_invalid');
    const bindHost = String(host || '127.0.0.1');
    if (!LOOPBACK_HOSTS.has(bindHost)) throw new Error('supervisor_loopback_host_not_loopback');
    this.#executeCommand = executeCommand;
    this.#snapshotProvider = snapshotProvider;
    this.#clientConnectionStatusProvider = clientConnectionStatusProvider;
    this.#clientWorkReadinessProvider = clientWorkReadinessProvider;
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
    if (typeof body?.method !== 'string') {
      this.#reject(res, 400, 'supervisor_loopback_method_invalid', 'method string required');
      return;
    }
    const method = body.method;
    if (!Object.hasOwn(SUPERVISOR_LOOPBACK_RPC_METHODS, method)) {
      this.#reject(res, 400, 'supervisor_loopback_method_unknown', `unknown method: ${clip(method, 96) || '(none)'}`);
      return;
    }
    if (Object.hasOwn(CLIENT_READ_CONTRACTS, method)) {
      if (!hasNoClientReadParams(body)) {
        this.#reject(res, 400, 'supervisor_loopback_client_params_forbidden', 'client observation methods accept no parameters');
        return;
      }
      const provider = method === 'client.connection-status'
        ? this.#clientConnectionStatusProvider : this.#clientWorkReadinessProvider;
      if (!provider) {
        this.#reject(res, 503, 'supervisor_loopback_client_provider_unavailable', 'installed client observation is unavailable');
        return;
      }
      let observed;
      try { observed = await provider(); }
      catch {
        this.#reject(res, 500, 'supervisor_loopback_client_read_failed', 'installed client observation failed');
        return;
      }
      let result;
      try { result = projectClientReadResult(observed, CLIENT_READ_CONTRACTS[method]); }
      catch {
        this.#reject(res, 500, 'supervisor_loopback_client_read_invalid', 'installed client observation contract is invalid');
        return;
      }
      jsonResponse(res, 200, { ok: true, schema: SUPERVISOR_LOOPBACK_RPC_SCHEMA, effect_class: 'READ_ONLY', result, authority_effect: false });
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
    if (method !== 'supervisor.command') {
      this.#reject(res, 400, 'supervisor_loopback_method_unknown', 'unknown method');
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
