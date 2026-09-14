import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_MANIFEST = path.join(os.homedir(), '.a2', 'compute-bridge.json');
const DEFAULT_NATIVE_STATE_ROOT = process.env.A2_COMPUTE_STATE_ROOT
  ? path.resolve(process.env.A2_COMPUTE_STATE_ROOT)
  : path.join(os.homedir(), '.metaengine', 'a2-compute-browser');
const NATIVE_CONTROL_TOKEN = 'control-token';
const MAX_NATIVE_FRAME_BYTES = 1024 * 1024;
const READ_ONLY_METHODS = new Set(['runtime.health', 'profile.list', 'context.list', 'target.list', 'target.semantic_snapshot', 'receipt.get', 'receipt.verify']);
const NATIVE_RECOVERABLE_REASON_CODES = new Set(['MANIFEST_NOT_PRESENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'CONNECTION_REFUSED']);

export const COMPUTE_HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  STARTING: 'STARTING',
  UNAVAILABLE_CONFIG: 'UNAVAILABLE_CONFIG',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
});

export function validateBridgeManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('compute_bridge_manifest_invalid');
  const url = new URL(String(input.url || ''));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase()) || url.pathname !== '/rpc') {
    throw new Error('compute_bridge_endpoint_not_loopback_rpc');
  }
  const token = String(input.token || '');
  if (!token || token.length > 4096) throw new Error('compute_bridge_token_invalid');
  return Object.freeze({ url: url.href, token });
}

export function nativeComputeRpcEndpoint(root = DEFAULT_NATIVE_STATE_ROOT, {
  platform = process.platform,
  username = os.userInfo().username,
} = {}) {
  if (platform === 'win32') {
    const user = String(username || 'user').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    return `\\\\.\\pipe\\metaengine-a2-compute-browser-${user}`;
  }
  return path.join(path.resolve(root), 'control.sock');
}

export function classifyComputeBridgeFailure(error) {
  const message = String(error?.message || error || '').slice(0, 500);
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (code === 'ENOENT') return Object.freeze({ state: COMPUTE_HEALTH_STATES.STARTING, reason_code: 'MANIFEST_NOT_PRESENT', outage_proven: false });
  if (/compute_bridge_(manifest_invalid|endpoint_not_loopback_rpc|token_invalid)/.test(message) || error instanceof SyntaxError) {
    return Object.freeze({ state: COMPUTE_HEALTH_STATES.UNAVAILABLE_CONFIG, reason_code: 'MANIFEST_INVALID', outage_proven: false });
  }
  if (['ECONNREFUSED','ECONNRESET','EPIPE'].includes(code) || /ECONNREFUSED|connection refused/i.test(message)) {
    return Object.freeze({ state: COMPUTE_HEALTH_STATES.OFFLINE, reason_code: code || 'CONNECTION_REFUSED', outage_proven: true });
  }
  if (/^compute_bridge_http_5\d\d$/.test(message)) {
    return Object.freeze({ state: COMPUTE_HEALTH_STATES.DEGRADED, reason_code: 'BRIDGE_HTTP_5XX', outage_proven: false });
  }
  if (/AbortError|aborted|timeout|deadline/i.test(`${error?.name || ''}:${message}`)) {
    return Object.freeze({ state: COMPUTE_HEALTH_STATES.UNKNOWN, reason_code: 'HEALTH_TIMEOUT', outage_proven: false });
  }
  return Object.freeze({ state: COMPUTE_HEALTH_STATES.UNKNOWN, reason_code: 'HEALTH_UNAVAILABLE', outage_proven: false });
}

function nativeRpcConnect(endpoint, requestLine, timeoutMs, connectImpl = net.createConnection) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    let socket;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch {}
      operation(value);
    };
    const timer = setTimeout(() => {
      const error = new Error('compute_native_rpc_timeout');
      error.name = 'AbortError';
      finish(reject, error);
    }, timeoutMs);
    timer.unref?.();

    try {
      socket = connectImpl(endpoint);
    } catch (error) {
      finish(reject, error);
      return;
    }
    socket.setNoDelay?.(true);
    socket.once('error', (error) => finish(reject, error));
    socket.once('connect', () => socket.write(`${requestLine}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer, 'utf8') > MAX_NATIVE_FRAME_BYTES) {
        finish(reject, new Error('compute_native_rpc_frame_too_large'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      try { finish(resolve, JSON.parse(line)); }
      catch { finish(reject, new Error('compute_native_rpc_json_invalid')); }
    });
    socket.once('close', () => {
      if (!settled) finish(reject, new Error('compute_native_rpc_closed_without_response'));
    });
  });
}

export class ComputeBridgeClient {
  constructor({
    manifestPath = process.env.METAENGINE_COMPUTE_BRIDGE_MANIFEST || DEFAULT_MANIFEST,
    fetchImpl = globalThis.fetch,
    timeoutMs = 1500,
    nativeStateRoot = DEFAULT_NATIVE_STATE_ROOT,
    nativeEndpoint = null,
    nativeConnectImpl = net.createConnection,
  } = {}) {
    this.manifestPath = manifestPath;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(25, Math.min(10000, Number(timeoutMs) || 1500));
    this.nativeStateRoot = path.resolve(nativeStateRoot);
    this.nativeTokenPath = path.join(this.nativeStateRoot, NATIVE_CONTROL_TOKEN);
    this.nativeEndpoint = nativeEndpoint || nativeComputeRpcEndpoint(this.nativeStateRoot);
    this.nativeConnectImpl = nativeConnectImpl;
  }

  async readManifest() {
    const raw = await fs.readFile(this.manifestPath, 'utf8');
    return validateBridgeManifest(JSON.parse(raw));
  }

  async callReadOnly(method, params = {}) {
    if (!READ_ONLY_METHODS.has(method)) throw new Error('compute_bridge_method_not_read_only');
    const manifest = await this.readManifest();
    const response = await this.fetchImpl(manifest.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${manifest.token}` },
      body: JSON.stringify({ method, params, id: `shell-${crypto.randomUUID()}` }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`compute_bridge_http_${response.status}`);
    const body = await response.json();
    if (!body?.ok || body.effect_class !== 'READ_ONLY' || body.web_authority_effect !== false) throw new Error('compute_bridge_read_contract_failed');
    return body.result;
  }

  async callNativeReadOnly(method, params = {}) {
    if (!READ_ONLY_METHODS.has(method)) throw new Error('compute_bridge_method_not_read_only');
    const token = String(await fs.readFile(this.nativeTokenPath, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('compute_native_rpc_token_invalid');
    const id = `shell-native-${crypto.randomUUID()}`;
    const body = await nativeRpcConnect(
      this.nativeEndpoint,
      JSON.stringify({ id, token, method, params }),
      this.timeoutMs,
      this.nativeConnectImpl,
    );
    if (body?.id !== id || body?.ok !== true || body?.effect_class !== 'READ_ONLY' || body?.web_authority_effect !== false) {
      throw new Error(`compute_native_rpc_read_contract_failed:${body?.error || 'invalid_response'}`);
    }
    return body.result;
  }

  async health() {
    const generatedAt = new Date().toISOString();
    try {
      const result = await this.callReadOnly('runtime.health', {});
      const degraded = result?.ok === false;
      return Object.freeze({
        schema: 'metaengine.compute-bridge.health.v2',
        state: degraded ? COMPUTE_HEALTH_STATES.DEGRADED : COMPUTE_HEALTH_STATES.HEALTHY,
        available: true,
        outage_proven: false,
        reason_code: degraded ? 'RUNTIME_HEALTH_DEGRADED' : null,
        result,
        error: null,
        generated_at: generatedAt,
        automatic_remediation: false,
        transport: 'LOOPBACK_HTTP_RPC',
        timeout_ms: this.timeoutMs,
        authority_effect: false,
      });
    } catch (httpError) {
      const classified = classifyComputeBridgeFailure(httpError);
      if (NATIVE_RECOVERABLE_REASON_CODES.has(classified.reason_code)) {
        try {
          const result = await this.callNativeReadOnly('runtime.health', {});
          const degraded = result?.ok === false;
          return Object.freeze({
            schema: 'metaengine.compute-bridge.health.v2',
            state: degraded ? COMPUTE_HEALTH_STATES.DEGRADED : COMPUTE_HEALTH_STATES.HEALTHY,
            available: true,
            outage_proven: false,
            reason_code: degraded ? 'RUNTIME_HEALTH_DEGRADED' : 'HTTP_BRIDGE_RECOVERED_VIA_NATIVE_RPC',
            result,
            error: null,
            generated_at: generatedAt,
            automatic_remediation: true,
            remediation: 'NATIVE_RPC_ATTACH',
            transport: 'NATIVE_RPC',
            timeout_ms: this.timeoutMs,
            authority_effect: false,
          });
        } catch (nativeError) {
          return Object.freeze({
            schema: 'metaengine.compute-bridge.health.v2',
            state: classified.state,
            available: false,
            outage_proven: classified.outage_proven,
            reason_code: classified.reason_code,
            result: null,
            error: String(httpError?.message || httpError).slice(0, 500),
            native_attach_error: String(nativeError?.message || nativeError).slice(0, 500),
            generated_at: generatedAt,
            automatic_remediation: false,
            transport: 'UNAVAILABLE',
            timeout_ms: this.timeoutMs,
            authority_effect: false,
          });
        }
      }
      return Object.freeze({
        schema: 'metaengine.compute-bridge.health.v2',
        state: classified.state,
        available: false,
        outage_proven: classified.outage_proven,
        reason_code: classified.reason_code,
        result: null,
        error: String(httpError?.message || httpError).slice(0, 500),
        generated_at: generatedAt,
        automatic_remediation: false,
        transport: 'UNAVAILABLE',
        timeout_ms: this.timeoutMs,
        authority_effect: false,
      });
    }
  }
}

export const COMPUTE_BRIDGE_POLICY = Object.freeze({
  transport: 'LOOPBACK_TYPED_RPC_WITH_NATIVE_ATTACH',
  shell_actuation_enabled: false,
  read_only_methods: [...READ_ONLY_METHODS].sort(),
  raw_cdp_exposed: false,
  token_exposed_to_renderer: false,
  native_attach_read_only: true,
  second_daemon_started_for_recovery: false,
});