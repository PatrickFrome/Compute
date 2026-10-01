import net from 'node:net';

import { requestBrowserGuardianEnrollmentTicket } from './browser-guardian-enrollment-ticket-client.mjs';

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
  #ticketProvider;

  constructor({
    identity,
    transport = requestGuardianUpdatePipe,
    enrollmentTicketProvider = null,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!identity || typeof identity.guardianOwnerChallenge !== 'function'
        || typeof identity.guardianUpdateActuatorProof !== 'function') {
      throw new Error('guardian_update_actuator_identity_required');
    }
    if (typeof transport !== 'function') throw new Error('guardian_update_actuator_transport_required');
    if (enrollmentTicketProvider != null && typeof enrollmentTicketProvider !== 'function') {
      throw new Error('guardian_enrollment_ticket_provider_invalid');
    }
    this.#identity = identity;
    this.#transport = transport;
    this.#ticketProvider = enrollmentTicketProvider || (() => requestBrowserGuardianEnrollmentTicket({
      identity: this.#identity,
      fetchImpl,
    }));
  }

  async #ownerProbeRaw({ command_id, request_nonce, ticket = null } = {}) {
    const commandId = exactUuid(command_id, 'guardian_command_id');
    const requestNonce = exactNonce(request_nonce);
    const ticketValue = ticket == null ? null : exactLine(ticket.ticket, 'guardian_enrollment_ticket', /^[A-Za-z0-9_-]{43}$/);
    const ticketSha256 = ticket == null ? null : exactSha(ticket.ticket_sha256, 64, 'guardian_enrollment_ticket_sha256');
    const proof = await this.#identity.guardianOwnerChallenge({
      command_id: commandId,
      request_nonce: requestNonce,
      ...(ticketSha256 ? { enrollment_ticket_sha256: ticketSha256 } : {}),
    });
    if (ticketSha256 && String(proof.enrollment_ticket_sha256 || '').toLowerCase() !== ticketSha256) {
      throw new Error('guardian_enrollment_ticket_proof_binding_mismatch');
    }
    const jwk = exactJwk(proof.public_jwk);
    const request = wire([
      'wire_schema=metaengine.browser-guardian.owner-challenge-request.v1',
      `command_id=${commandId}`,
      `request_nonce=${requestNonce}`,
      ...(ticketValue ? [`enrollment_ticket=${ticketValue}`, `enrollment_ticket_sha256=${ticketSha256}`] : []),
      `public_jwk_x=${jwk.x}`,
      `public_jwk_y=${jwk.y}`,
      `signature=${exactSignature(proof.signature)}`,
    ]);
    const result = normalizeResult(await this.#transport(request));
    return { result, proof };
  }

  #assertOwnerBound(result, proof) {
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

  async observeOwner({ command_id, request_nonce } = {}) {
    const { result, proof } = await this.#ownerProbeRaw({ command_id, request_nonce });
    if (result.state === 'OWNER_BOUND') return this.#assertOwnerBound(result, proof);
    if (result.state === 'NO_EFFECT_PROVEN' && result.effect_absent_proven === true) return result;
    if (result.state === 'AMBIGUOUS') return result;
    throw new Error(`guardian_owner_observation_invalid:${result.state}:${result.reason}`);
  }

  async probeOwner({ command_id, request_nonce } = {}) {
    const result = await this.observeOwner({ command_id, request_nonce });
    if (result.state !== 'OWNER_BOUND') {
      throw new Error(`guardian_owner_probe_unproven:${result.state}:${result.reason}`);
    }
    return result;
  }

  async ensureOwnerBound({ command_id, request_nonce } = {}) {
    const first = await this.#ownerProbeRaw({ command_id, request_nonce });
    if (first.result.state === 'OWNER_BOUND') return this.#assertOwnerBound(first.result, first.proof);
    if (first.result.state !== 'NO_EFFECT_PROVEN'
        || first.result.reason !== 'OWNER_ENROLLMENT_TICKET_REQUIRED'
        || first.result.effect_absent_proven !== true) {
      throw new Error(`guardian_owner_probe_unproven:${first.result.state}:${first.result.reason}`);
    }

    const ticket = await this.#ticketProvider();
    if (!ticket || ticket.single_use !== true || ticket.persisted_locally !== false) {
      throw new Error('guardian_enrollment_ticket_provider_result_invalid');
    }

    let second;
    try {
      second = await this.#ownerProbeRaw({ command_id, request_nonce, ticket });
    } catch (error) {
      const ambiguous = new Error(`guardian_owner_enrollment_result_unknown:${String(error?.message || error).slice(0,180)}`);
      ambiguous.code = 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS';
      throw ambiguous;
    }
    if (second.result.state === 'OWNER_BOUND') {
      // Enrollment really changed the store, so its receipt must not pretend
      // effect absence. Prove the saved owner using an independent read-only
      // challenge before allowing any installer dispatch.
      try {
        if (second.result.owner_binding_proven !== true || second.result.device_binding_proven !== true
            || String(second.result.device_key_fingerprint_sha256 || '').toLowerCase()
              !== String(second.proof.key_fingerprint_sha256 || '').toLowerCase()) {
          throw new Error('guardian_owner_enrollment_binding_invalid');
        }
        const readback = await this.#ownerProbeRaw({ command_id, request_nonce });
        return this.#assertOwnerBound(readback.result, readback.proof);
      } catch (error) {
        const ambiguous = new Error(`guardian_owner_enrollment_readback_unknown:${String(error?.message || error).slice(0,180)}`);
        ambiguous.code = 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS';
        throw ambiguous;
      }
    }
    if (second.result.state === 'NO_EFFECT_PROVEN' && second.result.effect_absent_proven === true) {
      throw new Error(`guardian_owner_enrollment_no_effect:${second.result.reason}`);
    }
    const ambiguous = new Error(`guardian_owner_enrollment_ambiguous:${second.result.state}:${second.result.reason}`);
    ambiguous.code = 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS';
    throw ambiguous;
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
    read_only_owner_probe_precedes_enrollment: true,
    read_only_owner_observation_exposed: true,
    exact_ticket_required_reason: 'OWNER_ENROLLMENT_TICKET_REQUIRED',
    single_use_admin_ticket_required_for_first_binding: true,
    ticket_bound_device_signature_required: true,
    owner_enrollment_transport_loss_outcome: 'AMBIGUOUS',
    automatic_owner_enrollment_retry_allowed: false,
    caller_supplied_path_allowed: false,
    caller_supplied_url_allowed: false,
    caller_supplied_shell_allowed: false,
    native_effect_barrier_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
