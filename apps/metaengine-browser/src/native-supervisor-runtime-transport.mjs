import {
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  nativeSupervisorRuntimeUrl,
  nativeSupervisorSigningPath,
} from './native-supervisor-endpoints.mjs';

export const NATIVE_SUPERVISOR_RUNTIME_TRANSPORT_SCHEMA = 'metaengine.native-supervisor.runtime-transport.v1';
const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON_BYTES = 1024 * 1024;

function jsonBody(payload) {
  const bodyText = JSON.stringify(payload ?? {});
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_JSON_BYTES) throw new Error('native_supervisor_transport_body_too_large');
  return bodyText;
}

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

async function decodeJson(response) {
  const body = await response.json().catch(() => ({}));
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export class NativeSupervisorRuntimeTransport {
  #identity;
  #fetch;
  #requests = 0;
  #lastStatus = null;

  constructor({ identity, fetchImpl = globalThis.fetch } = {}) {
    if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
      throw new Error('native_supervisor_transport_identity_required');
    }
    if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_transport_fetch_required');
    this.#identity = identity;
    this.#fetch = fetchImpl;
  }

  async #request(pathname, { method = 'POST', payload = null } = {}) {
    const methodUpper = String(method || '').toUpperCase();
    if (!['GET', 'POST'].includes(methodUpper)) throw new Error('native_supervisor_transport_method_denied');
    const bodyText = methodUpper === 'GET' ? '' : jsonBody(payload);
    const signingPath = nativeSupervisorSigningPath(pathname);
    const headers = await this.#identity.deviceHeaders(methodUpper, signingPath, bodyText);
    const init = { method: methodUpper, headers, cache: 'no-store' };
    if (methodUpper !== 'GET') init.body = bodyText;
    this.#requests += 1;
    const response = await this.#fetch(nativeSupervisorRuntimeUrl(pathname), init);
    this.#lastStatus = Number(response?.status || 0) || null;
    return response;
  }

  async postState(payload) {
    requireObject(payload, 'native_supervisor_transport_state_payload_invalid');
    const response = await this.#request('/v1/state', { payload });
    const body = await decodeJson(response);
    if (response.status !== 202) throw new Error(`native_supervisor_transport_state_http_${response.status}:${body?.error || body?.reason || 'unknown'}`);
    return Object.freeze({ status: response.status, body, authority_effect: false });
  }

  async waitBatch({ supervisor_mode, max_batch, max_tab_mutations, wait_ms } = {}) {
    const payload = {
      supervisor_mode: String(supervisor_mode || '').toUpperCase(),
      max_batch: Number(max_batch),
      max_tab_mutations: Number(max_tab_mutations),
      wait_ms: Number(wait_ms),
    };
    if (!['OFF','MONITOR','CONTROL'].includes(payload.supervisor_mode)) throw new Error('native_supervisor_transport_mode_invalid');
    if (!Number.isSafeInteger(payload.max_batch) || payload.max_batch < 1 || payload.max_batch > 256) throw new Error('native_supervisor_transport_max_batch_invalid');
    if (!Number.isSafeInteger(payload.max_tab_mutations) || payload.max_tab_mutations < 0 || payload.max_tab_mutations > payload.max_batch) throw new Error('native_supervisor_transport_max_tab_mutations_invalid');
    if (!Number.isSafeInteger(payload.wait_ms) || payload.wait_ms < 0 || payload.wait_ms > 30000) throw new Error('native_supervisor_transport_wait_ms_invalid');
    const response = await this.#request('/v1/commands/wait-batch', { payload });
    const body = await decodeJson(response);
    if (!response.ok || !Array.isArray(body?.commands)) throw new Error(`native_supervisor_transport_wait_batch_http_${response.status}:${body?.error || 'invalid_batch'}`);
    return Object.freeze({
      status: response.status,
      commands: Object.freeze(body.commands.map((row) => structuredClone(row))),
      transport_delivery_is_authority: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }

  async postResultBatch(results) {
    if (!Array.isArray(results) || results.length < 1 || results.length > 256) throw new Error('native_supervisor_transport_results_invalid');
    const response = await this.#request('/v1/commands/result-batch', { payload: { results } });
    const body = await decodeJson(response);
    if (!response.ok) throw new Error(`native_supervisor_transport_result_batch_http_${response.status}:${body?.error || 'unknown'}`);
    return Object.freeze({ status: response.status, body, transport_delivery_is_authority: false, authority_effect: false });
  }

  async postCommandResult(commandId, payload) {
    const id = String(commandId || '');
    if (!COMMAND_ID_RE.test(id)) throw new Error('native_supervisor_transport_command_id_invalid');
    requireObject(payload, 'native_supervisor_transport_result_payload_invalid');
    const response = await this.#request(`/v1/commands/${id}/result`, { payload });
    const body = await decodeJson(response);
    if (!response.ok) throw new Error(`native_supervisor_transport_result_http_${response.status}:${body?.error || 'unknown'}`);
    return Object.freeze({ status: response.status, body, transport_delivery_is_authority: false, authority_effect: false });
  }

  async postCognitiveDeltas(payload) {
    requireObject(payload, 'native_supervisor_transport_cognitive_payload_invalid');
    const response = await this.#request('/v1/cognitive/deltas', { payload });
    const body = await decodeJson(response);
    if (!response.ok) throw new Error(`native_supervisor_transport_cognitive_http_${response.status}:${body?.error || 'unknown'}`);
    return Object.freeze({ status: response.status, body, authority_effect: false });
  }

  async workspaceSnapshot() {
    const response = await this.#request('/v1/devos/workspace-snapshot', { method: 'GET' });
    const body = await decodeJson(response);
    if (!response.ok) throw new Error(`native_supervisor_transport_workspace_http_${response.status}:${body?.error || 'unknown'}`);
    return Object.freeze({ status: response.status, body, authority_effect: false });
  }

  snapshot() {
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_RUNTIME_TRANSPORT_SCHEMA,
      runtime_signing_path: NATIVE_SUPERVISOR_RUNTIME_PATH,
      requests: this.#requests,
      last_status: this.#lastStatus,
      enrollment_authority: false,
      legacy_command_next: false,
      command_scheduler: false,
      browser_execution_authority: false,
      timers: false,
      automatic_retry: false,
      transport_delivery_is_authority: false,
      arbitrary_origin: false,
      authority_effect: false,
    });
  }
}
