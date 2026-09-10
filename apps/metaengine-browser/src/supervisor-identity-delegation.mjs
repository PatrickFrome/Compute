import crypto from 'node:crypto';
import { NATIVE_SUPERVISOR_RUNTIME_PATH } from './native-supervisor-client-base.mjs';

export const SUPERVISOR_IDENTITY_DELEGATION_SCHEMA = 'metaengine.supervisor-identity-delegation.v1';
export const SUPERVISOR_IDENTITY_DELEGATION_MAX_BODY_BYTES = 512 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_HEADER_NAMES = Object.freeze([
  'content-type',
  'x-a2-chat-bridge-client',
  'x-a2-device-profile',
  'x-a2-device-id',
  'x-a2-device-timestamp',
  'x-a2-device-nonce',
  'x-a2-device-body-sha256',
  'x-a2-device-signature',
]);

function bodySha256(bodyText) {
  return crypto.createHash('sha256').update(String(bodyText || ''), 'utf8').digest('hex');
}

function normalizeMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('supervisor_identity_delegation_method_denied');
  return method;
}

function normalizeRequestPath(value) {
  const requestPath = String(value || '').trim();
  if (!requestPath.startsWith('/') || requestPath.includes('?') || requestPath.includes('#') || requestPath.includes('\\')) {
    throw new Error('supervisor_identity_delegation_path_invalid');
  }
  let decoded;
  try { decoded = decodeURIComponent(requestPath); } catch { throw new Error('supervisor_identity_delegation_path_invalid'); }
  if (decoded !== requestPath || decoded.includes('..') || decoded.includes('//')) throw new Error('supervisor_identity_delegation_path_invalid');
  return requestPath;
}

function allowedRoute(method, requestPath) {
  const prefix = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1`;
  if (method === 'POST' && requestPath === `${prefix}/state`) return 'STATE';
  if (method === 'POST' && requestPath === `${prefix}/cognitive/deltas`) return 'COGNITIVE_DELTAS';
  if (method === 'GET' && requestPath === `${prefix}/devos/workspace-snapshot`) return 'WORKSPACE_SNAPSHOT';
  if (method === 'POST' && requestPath === `${prefix}/commands/next`) return 'COMMAND_NEXT';
  if (method === 'POST' && requestPath === `${prefix}/commands/wait-batch`) return 'COMMAND_WAIT_BATCH';
  if (method === 'POST' && requestPath === `${prefix}/commands/result-batch`) return 'COMMAND_RESULT_BATCH';
  const resultPrefix = `${prefix}/commands/`;
  if (method === 'POST' && requestPath.startsWith(resultPrefix) && requestPath.endsWith('/result')) {
    const commandId = requestPath.slice(resultPrefix.length, -'/result'.length);
    if (UUID_RE.test(commandId)) return 'COMMAND_RESULT';
  }
  throw new Error('supervisor_identity_delegation_route_denied');
}

function normalizeBody(method, value) {
  const bodyText = value == null ? '' : String(value);
  if (Buffer.byteLength(bodyText, 'utf8') > SUPERVISOR_IDENTITY_DELEGATION_MAX_BODY_BYTES) {
    throw new Error('supervisor_identity_delegation_body_too_large');
  }
  if (method === 'GET') {
    if (bodyText !== '') throw new Error('supervisor_identity_delegation_get_body_denied');
    return bodyText;
  }
  let decoded;
  try { decoded = JSON.parse(bodyText); } catch { throw new Error('supervisor_identity_delegation_json_required'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('supervisor_identity_delegation_json_required');
  return bodyText;
}

export function normalizeSupervisorIdentityDelegationRequest(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('supervisor_identity_delegation_request_invalid');
  const unknown = Object.keys(value).filter((key) => !['method', 'request_path', 'body_text'].includes(key));
  if (unknown.length) throw new Error(`supervisor_identity_delegation_field_unknown:${unknown[0]}`);
  const method = normalizeMethod(value.method);
  const requestPath = normalizeRequestPath(value.request_path);
  const route = allowedRoute(method, requestPath);
  const bodyText = normalizeBody(method, value.body_text);
  return Object.freeze({
    schema: SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
    method,
    request_path: requestPath,
    route,
    body_text: bodyText,
    body_sha256: bodySha256(bodyText),
    authority_effect: false,
  });
}

function normalizeHeaders(value, identityState, request) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('supervisor_identity_delegation_headers_invalid');
  const keys = Object.keys(value).sort();
  const expected = [...DEVICE_HEADER_NAMES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('supervisor_identity_delegation_headers_invalid');
  }
  if (value['content-type'] !== 'application/json') throw new Error('supervisor_identity_delegation_content_type_invalid');
  if (String(value['x-a2-chat-bridge-client'] || '') !== String(identityState.client_id || '')) throw new Error('supervisor_identity_delegation_client_drift');
  if (String(value['x-a2-device-id'] || '') !== String(identityState.device_id || '')) throw new Error('supervisor_identity_delegation_device_drift');
  if (String(value['x-a2-device-body-sha256'] || '') !== request.body_sha256) throw new Error('supervisor_identity_delegation_body_digest_drift');
  if (!String(value['x-a2-device-profile'] || '')) throw new Error('supervisor_identity_delegation_profile_missing');
  if (!String(value['x-a2-device-timestamp'] || '')) throw new Error('supervisor_identity_delegation_timestamp_missing');
  if (!String(value['x-a2-device-nonce'] || '')) throw new Error('supervisor_identity_delegation_nonce_missing');
  if (!String(value['x-a2-device-signature'] || '')) throw new Error('supervisor_identity_delegation_signature_missing');
  return Object.freeze(Object.fromEntries(DEVICE_HEADER_NAMES.map((name) => [name, String(value[name])])));
}

function safeIdentitySnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('supervisor_identity_delegation_identity_invalid');
  const clientId = String(value.client_id || '');
  const deviceId = String(value.device_id || '');
  if (!UUID_RE.test(clientId) || !UUID_RE.test(deviceId)) throw new Error('supervisor_identity_delegation_identity_invalid');
  return Object.freeze({
    schema: SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
    client_id: clientId,
    device_id: deviceId,
    profile: value.profile ? String(value.profile) : null,
    public_jwk: value.public_jwk ? structuredClone(value.public_jwk) : null,
    key_fingerprint_sha256: value.key_fingerprint_sha256 ? String(value.key_fingerprint_sha256) : null,
    enrolled: true,
    private_key_exported: false,
    enrollment_authority: false,
    authority_effect: false,
  });
}

export class SupervisorIdentityDelegationSigner {
  #identity;

  constructor({ identity } = {}) {
    if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
      throw new Error('supervisor_identity_delegation_signer_identity_required');
    }
    this.#identity = identity;
  }

  async snapshot() {
    return safeIdentitySnapshot(await this.#identity.ensure());
  }

  async signDeviceRequest(value) {
    const request = normalizeSupervisorIdentityDelegationRequest(value);
    const identityState = safeIdentitySnapshot(await this.#identity.ensure());
    // Timestamp and nonce are deliberately not caller-controlled. The Browser-owned
    // identity creates fresh signing material for every delegated request.
    const headers = normalizeHeaders(
      await this.#identity.deviceHeaders(request.method, request.request_path, request.body_text),
      identityState,
      request,
    );
    return Object.freeze({
      schema: SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
      route: request.route,
      method: request.method,
      request_path: request.request_path,
      body_sha256: request.body_sha256,
      headers,
      private_key_exported: false,
      enrollment_authority: false,
      authority_effect: false,
    });
  }
}

export class DelegatedSupervisorIdentity {
  #readSnapshot;
  #signDeviceRequest;
  #snapshot = null;

  constructor({ readSnapshot, signDeviceRequest } = {}) {
    if (typeof readSnapshot !== 'function') throw new Error('delegated_supervisor_identity_snapshot_reader_required');
    if (typeof signDeviceRequest !== 'function') throw new Error('delegated_supervisor_identity_signer_required');
    this.#readSnapshot = readSnapshot;
    this.#signDeviceRequest = signDeviceRequest;
  }

  async ensure() {
    this.#snapshot = safeIdentitySnapshot(await this.#readSnapshot());
    return this.snapshot();
  }

  snapshot() {
    return this.#snapshot ? structuredClone(this.#snapshot) : null;
  }

  async deviceHeaders(method, requestPath, bodyText) {
    const request = normalizeSupervisorIdentityDelegationRequest({ method, request_path: requestPath, body_text: bodyText });
    const identityState = this.#snapshot || await this.ensure();
    const receipt = await this.#signDeviceRequest({ method: request.method, request_path: request.request_path, body_text: request.body_text });
    if (!receipt || receipt.schema !== SUPERVISOR_IDENTITY_DELEGATION_SCHEMA) throw new Error('delegated_supervisor_identity_receipt_invalid');
    if (receipt.method !== request.method || receipt.request_path !== request.request_path || receipt.body_sha256 !== request.body_sha256) {
      throw new Error('delegated_supervisor_identity_receipt_drift');
    }
    return normalizeHeaders(receipt.headers, identityState, request);
  }

  async enrollmentHeaders() { throw new Error('delegated_supervisor_identity_enrollment_forbidden'); }
  async bindEnrollmentRequest() { throw new Error('delegated_supervisor_identity_enrollment_forbidden'); }
  async clearEnrollmentRequest() { throw new Error('delegated_supervisor_identity_enrollment_forbidden'); }
  async bindDevice() { throw new Error('delegated_supervisor_identity_enrollment_forbidden'); }
}

export function supervisorIdentityDelegationManifest() {
  return Object.freeze({
    schema: SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
    max_body_bytes: SUPERVISOR_IDENTITY_DELEGATION_MAX_BODY_BYTES,
    methods: ['GET', 'POST'],
    routes: [
      'POST /v1/state',
      'POST /v1/cognitive/deltas',
      'GET /v1/devos/workspace-snapshot',
      'POST /v1/commands/next',
      'POST /v1/commands/wait-batch',
      'POST /v1/commands/result-batch',
      'POST /v1/commands/{uuid}/result',
    ],
    enrollment_authority: false,
    arbitrary_origin: false,
    arbitrary_headers: false,
    caller_timestamp: false,
    caller_nonce: false,
    private_key_exported: false,
    browser_safe_storage_owner: true,
    host_agent_compatible_identity_interface: true,
    authority_effect: false,
  });
}
