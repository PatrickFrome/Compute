import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_MANIFEST = path.join(os.homedir(), '.a2', 'compute-bridge.json');
const READ_ONLY_METHODS = new Set(['runtime.health', 'profile.list', 'context.list', 'target.list', 'target.semantic_snapshot', 'receipt.get', 'receipt.verify']);

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

export class ComputeBridgeClient {
  constructor({ manifestPath = process.env.METAENGINE_COMPUTE_BRIDGE_MANIFEST || DEFAULT_MANIFEST, fetchImpl = globalThis.fetch } = {}) {
    this.manifestPath = manifestPath;
    this.fetchImpl = fetchImpl;
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
    });
    if (!response.ok) throw new Error(`compute_bridge_http_${response.status}`);
    const body = await response.json();
    if (!body?.ok || body.effect_class !== 'READ_ONLY' || body.web_authority_effect !== false) throw new Error('compute_bridge_read_contract_failed');
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
        authority_effect: false,
      });
    } catch (error) {
      const classified = classifyComputeBridgeFailure(error);
      return Object.freeze({
        schema: 'metaengine.compute-bridge.health.v2',
        state: classified.state,
        available: false,
        outage_proven: classified.outage_proven,
        reason_code: classified.reason_code,
        result: null,
        error: String(error?.message || error).slice(0, 500),
        generated_at: generatedAt,
        automatic_remediation: false,
        authority_effect: false,
      });
    }
  }
}

export const COMPUTE_BRIDGE_POLICY = Object.freeze({
  transport: 'LOOPBACK_TYPED_RPC',
  shell_actuation_enabled: false,
  read_only_methods: [...READ_ONLY_METHODS].sort(),
  raw_cdp_exposed: false,
  token_exposed_to_renderer: false,
});
