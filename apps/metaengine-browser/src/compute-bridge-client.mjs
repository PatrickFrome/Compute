import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(os.homedir(), '.a2', 'compute-bridge.json');
const READ_ONLY_METHODS = new Set(['runtime.health', 'profile.list', 'context.list', 'target.list', 'target.semantic_snapshot', 'receipt.get', 'receipt.verify']);
const AUTOSTART_RECOVERABLE_STATES = new Set(['STARTING', 'OFFLINE']);

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

export function resolveBundledComputeBridgeRoot({ resourcesPath = process.resourcesPath || null, moduleDir = MODULE_DIR } = {}) {
  if (resourcesPath) return path.join(resourcesPath, 'a2-compute-browser');
  return path.resolve(moduleDir, '..', '..', '..', 'coordination', 'browser-compute');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchBundledComputeBridge({ runtimeRoot, workerPath }) {
  if (!process.versions?.electron) throw new Error('compute_bridge_autostart_requires_electron');
  const electron = await import('electron');
  if (!electron?.utilityProcess?.fork) throw new Error('compute_bridge_autostart_utility_process_unavailable');
  const child = electron.utilityProcess.fork(workerPath, ['serve', '--bridge-port=0'], {
    env: {
      ...process.env,
      METAENGINE_COMPUTE_BRIDGE_ROOT: runtimeRoot,
    },
  });
  return child;
}

export class ComputeBridgeClient {
  constructor({
    manifestPath = process.env.METAENGINE_COMPUTE_BRIDGE_MANIFEST || DEFAULT_MANIFEST,
    fetchImpl = globalThis.fetch,
    timeoutMs = 1500,
    autoStart = Boolean(process.versions?.electron) && process.env.METAENGINE_DISABLE_COMPUTE_BRIDGE_AUTOSTART !== '1',
    autoStartTimeoutMs = 5000,
    autoStartPollMs = 100,
    launchBridge = null,
    runtimeRoot = null,
    workerPath = path.join(MODULE_DIR, 'compute-bridge-worker.cjs'),
  } = {}) {
    this.manifestPath = manifestPath;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(25, Math.min(10000, Number(timeoutMs) || 1500));
    this.autoStart = autoStart === true;
    this.autoStartTimeoutMs = Math.max(250, Math.min(15000, Number(autoStartTimeoutMs) || 5000));
    this.autoStartPollMs = Math.max(25, Math.min(1000, Number(autoStartPollMs) || 100));
    this.launchBridge = launchBridge;
    this.runtimeRoot = runtimeRoot || resolveBundledComputeBridgeRoot();
    this.workerPath = workerPath;
    this.autoStartPromise = null;
    this.ownedBridgeProcess = null;
    this.lastAutoStartError = null;
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

  async #healthOnce() {
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
        timeout_ms: this.timeoutMs,
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
        timeout_ms: this.timeoutMs,
        authority_effect: false,
      });
    }
  }

  #autostartAllowed(health) {
    if (!this.autoStart || !AUTOSTART_RECOVERABLE_STATES.has(String(health?.state || ''))) return false;
    if (this.launchBridge) return true;
    return path.resolve(this.manifestPath) === path.resolve(DEFAULT_MANIFEST);
  }

  async #launchAndWaitForHealth() {
    const launcher = this.launchBridge || launchBundledComputeBridge;
    let launchError = null;
    if (!this.ownedBridgeProcess) {
      try {
        const child = await launcher({
          runtimeRoot: this.runtimeRoot,
          workerPath: this.workerPath,
          manifestPath: this.manifestPath,
        });
        this.ownedBridgeProcess = child || null;
        if (child && typeof child.once === 'function') {
          child.once('exit', () => {
            if (this.ownedBridgeProcess === child) this.ownedBridgeProcess = null;
          });
        }
      } catch (error) {
        launchError = error;
        this.lastAutoStartError = String(error?.message || error).slice(0, 500);
      }
    }

    const deadline = Date.now() + this.autoStartTimeoutMs;
    let observed = await this.#healthOnce();
    while (!observed.available && Date.now() < deadline) {
      if (launchError) break;
      await sleep(this.autoStartPollMs);
      observed = await this.#healthOnce();
    }
    return Object.freeze({
      ...observed,
      automatic_remediation: true,
      remediation: 'BUNDLED_DAEMON_AUTOSTART',
      remediation_error: launchError ? String(launchError?.message || launchError).slice(0, 500) : null,
      authority_effect: false,
    });
  }

  async health() {
    const initial = await this.#healthOnce();
    if (!this.#autostartAllowed(initial)) return initial;
    if (!this.autoStartPromise) {
      this.autoStartPromise = this.#launchAndWaitForHealth().finally(() => {
        this.autoStartPromise = null;
      });
    }
    return this.autoStartPromise;
  }
}

export const COMPUTE_BRIDGE_POLICY = Object.freeze({
  transport: 'LOOPBACK_TYPED_RPC',
  shell_actuation_enabled: false,
  read_only_methods: [...READ_ONLY_METHODS].sort(),
  raw_cdp_exposed: false,
  token_exposed_to_renderer: false,
  bundled_daemon_autostart: true,
  autostart_recoverable_states: [...AUTOSTART_RECOVERABLE_STATES].sort(),
});
