import net from 'node:net';

export const BROWSER_GUARDIAN_UPDATE_ACTUATOR_PIPE = '\\\\.\\pipe\\METAENGINEBrowserGuardianUpdateV1';
export const BROWSER_GUARDIAN_UPDATE_ACTUATOR_RESULT_SCHEMA = 'metaengine.browser-guardian.update-actuator-result.v1';
const MAX_WIRE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 135_000;

function exactLine(value, label, pattern) {
  const text = String(value ?? '');
  if (/[\r\n]/.test(text) || !pattern.test(text)) throw new Error(`${label}_invalid`);
  return text;
}

function exactUuid(value, label) {
  return exactLine(value, label, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).toLowerCase();
}

function exactNonce(value) {
  return exactLine(value, 'guardian_request_nonce', /^[A-Za-z0-9_-]{32,128}$/);
}

function exactSha(value, length, label) {
  const text = String(value ?? '').trim().toLowerCase();
  const pattern = length === 40 ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/;
  if (!pattern.test(text)) throw new Error(`${label}_invalid`);
  return text;
}

function exactDevVersion(value) {
  return exactLine(value, 'guardian_release_version', /^\d+\.\d+\.\d+-dev\.\d+\.1$/);
}

function exactJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256'
      || !/^[A-Za-z0-9_-]{43}$/.test(String(jwk.x || ''))
      || !/^[A-Za-z0-9_-]{43}$/.test(String(jwk.y || ''))) {
    throw new Error('guardian_device_public_jwk_invalid');
  }
  return { x: String(jwk.x), y: String(jwk.y) };
}

function exactSignature(value) {
  return exactLine(value, 'guardian_device_signature', /^[A-Za-z0-9_-]{86}$/);
}

function wire(lines) {
  const value = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(value, 'utf8') > MAX_WIRE_BYTES) throw new Error('guardian_update_actuator_wire_too_large');
  return value;
}

function normalizeResult(value) {
  if (!value || value.schema !== BROWSER_GUARDIAN_UPDATE_ACTUATOR_RESULT_SCHEMA) {
    throw new Error('guardian_update_actuator_result_schema_invalid');
  }
  if (value.automatic_retry_allowed !== false
      || value.caller_supplied_path_used !== false
      || value.caller_supplied_url_used !== false
      || value.caller_supplied_shell_used !== false
      || value.authority_effect !== false) {
    throw new Error('guardian_update_actuator_result_authority_invalid');
  }
  const state = String(value.state || '').toUpperCase();
  if (!['OWNER_BOUND', 'DISPATCHED', 'READY', 'NO_EFFECT_PROVEN', 'AMBIGUOUS'].includes(state)) {
    throw new Error('guardian_update_actuator_result_state_invalid');
  }
  const pid = Number(value.pid || 0);
  const sessionId = Number(value.session_id || 0);
  const clientPid = Number(value.client_pid || 0);
  const creationTime = Number(value.creation_time_100ns || 0);
  return Object.freeze({
    ...structuredClone(value),
    state,
    pid: Number.isSafeInteger(pid) && pid > 0 ? pid : 0,
    session_id: Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : 0,
    client_pid: Number.isSafeInteger(clientPid) && clientPid > 0 ? clientPid : 0,
    creation_time_100ns: Number.isSafeInteger(creationTime) && creationTime > 0 ? creationTime : 0,
  });
}

export function requestGuardianUpdatePipe(wireRequest, {
  pipeName = BROWSER_GUARDIAN_UPDATE_ACTUATOR_PIPE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (process.platform !== 'win32') throw new Error('guardian_update_actuator_windows_required');
  const request = String(wireRequest || '');
  if (!request.endsWith('\n') || Buffer.byteLength(request, 'utf8') > MAX_WIRE_BYTES) {
    throw new Error('guardian_update_actuator_wire_invalid');
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (error, value = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    socket.setTimeout(Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    socket.once('connect', () => socket.write(request, 'utf8'));
    socket.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_WIRE_BYTES) return finish(new Error('guardian_update_actuator_response_too_large'));
      chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      if (text.slice(newline + 1).trim() !== '') return finish(new Error('guardian_update_actuator_response_trailing_data'));
      let parsed;
      try { parsed = JSON.parse(text.slice(0, newline)); }
      catch { return finish(new Error('guardian_update_actuator_response_json_invalid')); }
      return finish(null, normalizeResult(parsed));
    });
    socket.once('timeout', () => finish(new Error('guardian_update_actuator_pipe_timeout')));
    socket.once('error', (error) => finish(new Error(`guardian_update_actuator_pipe_error:${String(error?.message || error).slice(0, 180)}`)));
    socket.once('end', () => {
      if (!settled) finish(new Error('guardian_update_actuator_pipe_ended_without_result'));
    });
  });
}

export class BrowserGuardianUpdateActuatorClient {
  #identity;
  #transport;

  constructor({ identity, transport = requestGuardianUpdatePipe } = {}) {
    if (!identity || typeof identity.guardianOwnerChallenge !== 'function'
        || typeof identity.guardianUpdateActuatorProof !== 'function') {
      throw new Error('guardian_update_actuator_identity_required');
    }
    if (typeof transport !== 'function') throw new Error('guardian_update_actuator_transport_required');
    this.#identity = identity;
    this.#transport = transport;
  }

  async probeOwner({ command_id, request_nonce } = {}) {
    const commandId = exactUuid(command_id, 'guardian_command_id');
    const requestNonce = exactNonce(request_nonce);
    const proof = await this.#identity.guardianOwnerChallenge({ command_id: commandId, request_nonce: requestNonce });
    const jwk = exactJwk(proof.public_jwk);
    const request = wire([
      'wire_schema=metaengine.browser-guardian.owner-challenge-request.v1',
      `command_id=${commandId}`,
      `request_nonce=${requestNonce}`,
      `public_jwk_x=${jwk.x}`,
      `public_jwk_y=${jwk.y}`,
      `signature=${exactSignature(proof.signature)}`,
    ]);
    const result = normalizeResult(await this.#transport(request));
    if (result.state !== 'OWNER_BOUND'
        || result.owner_binding_proven !== true
        || result.device_binding_proven !== true
        || result.effect_absent_proven !== true) {
      throw new Error(`guardian_owner_probe_unproven:${result.state}:${result.reason}`);
    }
    if (String(result.device_key_fingerprint_sha256 || '').toLowerCase() !== String(proof.key_fingerprint_sha256 || '').toLowerCase()) {
      throw new Error('guardian_owner_probe_device_fingerprint_mismatch');
    }
    return result;
  }

  async #update(operation, input = {}) {
    const op = String(operation || '').toUpperCase();
    const exact = {
      operation: op,
      effect_id: exactUuid(input.effect_id, 'guardian_effect_id'),
      effect_generation: Number(input.effect_generation),
      command_id: exactUuid(input.command_id, 'guardian_command_id'),
      request_nonce: exactNonce(input.request_nonce),
      release_version: exactDevVersion(input.release_version),
      candidate_git_sha: exactSha(input.candidate_git_sha, 40, 'guardian_candidate_git_sha'),
      installer_sha256: exactSha(input.installer_sha256, 64, 'guardian_installer_sha256'),
      manifest_sha256: exactSha(input.manifest_sha256, 64, 'guardian_manifest_sha256'),
      installed_executable_sha256: exactSha(input.installed_executable_sha256, 64, 'guardian_installed_executable_sha256'),
    };
    if (!Number.isSafeInteger(exact.effect_generation) || exact.effect_generation < 1) throw new Error('guardian_effect_generation_invalid');
    const proof = await this.#identity.guardianUpdateActuatorProof(exact);
    const jwk = exactJwk(proof.public_jwk);
    const request = wire([
      'wire_schema=metaengine.browser-guardian.update-actuator-request.v1',
      `operation=${op}`,
      `effect_id=${exact.effect_id}`,
      `effect_generation=${exact.effect_generation}`,
      `command_id=${exact.command_id}`,
      `request_nonce=${exact.request_nonce}`,
      `release_version=${exact.release_version}`,
      `candidate_git_sha=${exact.candidate_git_sha}`,
      `installer_sha256=${exact.installer_sha256}`,
      `manifest_sha256=${exact.manifest_sha256}`,
      `installed_executable_sha256=${exact.installed_executable_sha256}`,
      `public_jwk_x=${jwk.x}`,
      `public_jwk_y=${jwk.y}`,
      `signature=${exactSignature(proof.signature)}`,
    ]);
    return normalizeResult(await this.#transport(request));
  }

  dispatch(input) { return this.#update('DISPATCH', input); }
  observe(input) { return this.#update('OBSERVE', input); }
}

export function browserGuardianUpdateActuatorClientContract() {
  return Object.freeze({
    schema: 'metaengine.browser-guardian.update-actuator-client.v1',
    fixed_pipe_name: BROWSER_GUARDIAN_UPDATE_ACTUATOR_PIPE,
    enrolled_device_signature_required: true,
    caller_supplied_path_allowed: false,
    caller_supplied_url_allowed: false,
    caller_supplied_shell_allowed: false,
    native_effect_barrier_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
