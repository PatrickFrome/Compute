import crypto from 'node:crypto';

export const HOST_AGENT_PROTOCOL_SCHEMA = 'metaengine.host-agent.ipc.v1';
export const HOST_AGENT_MAX_FRAME_BYTES = 64 * 1024;
export const HOST_AGENT_MAX_PAYLOAD_BYTES = 48 * 1024;
export const HOST_AGENT_ALLOWED_OPS = Object.freeze([
  'PING',
  'HOST_STATUS',
  'SOURCE_STATUS',
  'DEV_QUERY',
  'CONTROL_CONTEXT_GET',
  'CONTROL_RUN_SUBMIT',
  'CONTROL_RUN_STATUS',
  'CONTROL_EMERGENCY_STOP',
  'BROWSER_STATUS',
  'BROWSER_PLAN_EXECUTE',
  'BROWSER_PLAN_CANCEL',
]);

const OPS = new Set(HOST_AGENT_ALLOWED_OPS);
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{43}$/;

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
const digest = (value) => crypto.createHash('sha256').update(value).digest('base64url');

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function decodeKey(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(text)) throw new Error('host_agent_session_key_invalid');
  const key = Buffer.from(text, 'base64url');
  if (key.byteLength < 32 || key.byteLength > 64) throw new Error('host_agent_session_key_invalid');
  return key;
}

function normalizeUnsignedFrame(frame) {
  if (!plainObject(frame)) throw new Error('host_agent_frame_invalid');
  const unknown = Object.keys(frame).filter((key) => !['schema','kind','request_id','nonce','op','payload','auth_tag'].includes(key));
  if (unknown.length) throw new Error(`host_agent_frame_field_unknown:${unknown[0]}`);
  if (frame.schema !== HOST_AGENT_PROTOCOL_SCHEMA) throw new Error('host_agent_frame_schema_invalid');
  const kind = String(frame.kind || '').trim().toUpperCase();
  if (!['REQUEST','RESPONSE','EVENT'].includes(kind)) throw new Error('host_agent_frame_kind_invalid');
  const requestId = String(frame.request_id || '').trim();
  if (!REQUEST_ID_RE.test(requestId)) throw new Error('host_agent_request_id_invalid');
  const nonce = String(frame.nonce || '').trim();
  if (!NONCE_RE.test(nonce)) throw new Error('host_agent_nonce_invalid');
  const op = String(frame.op || '').trim().toUpperCase();
  if (!OPS.has(op)) throw new Error('host_agent_op_denied');
  const payload = frame.payload == null ? {} : frame.payload;
  if (!plainObject(payload)) throw new Error('host_agent_payload_invalid');
  if (byteLength(payload) > HOST_AGENT_MAX_PAYLOAD_BYTES) throw new Error('host_agent_payload_too_large');
  return Object.freeze({
    schema: HOST_AGENT_PROTOCOL_SCHEMA,
    kind,
    request_id: requestId,
    nonce,
    op,
    payload: structuredClone(payload),
  });
}

function material(frame) {
  const normalized = normalizeUnsignedFrame(frame);
  return [
    normalized.schema,
    normalized.kind,
    normalized.request_id,
    normalized.nonce,
    normalized.op,
    digest(Buffer.from(JSON.stringify(normalized.payload), 'utf8')),
  ].join('\n');
}

export function createHostAgentSessionKey() {
  return crypto.randomBytes(32).toString('base64url');
}

export function createHostAgentNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

export function signHostAgentFrame(frame, sessionKey) {
  const normalized = normalizeUnsignedFrame(frame);
  const authTag = crypto.createHmac('sha256', decodeKey(sessionKey)).update(material(normalized), 'utf8').digest('base64url');
  const signed = Object.freeze({ ...normalized, auth_tag: authTag });
  if (byteLength(signed) > HOST_AGENT_MAX_FRAME_BYTES) throw new Error('host_agent_frame_too_large');
  return signed;
}

export function verifyHostAgentFrame(frame, sessionKey, { consumeNonce = null } = {}) {
  if (!plainObject(frame)) throw new Error('host_agent_frame_invalid');
  const supplied = String(frame.auth_tag || '');
  if (!AUTH_RE.test(supplied)) throw new Error('host_agent_auth_tag_invalid');
  const normalized = normalizeUnsignedFrame(frame);
  const expected = crypto.createHmac('sha256', decodeKey(sessionKey)).update(material(normalized), 'utf8').digest();
  const actual = Buffer.from(supplied, 'base64url');
  if (actual.byteLength !== expected.byteLength || !crypto.timingSafeEqual(actual, expected)) throw new Error('host_agent_auth_failed');
  if (consumeNonce != null) {
    if (typeof consumeNonce !== 'function') throw new Error('host_agent_nonce_consumer_invalid');
    if (consumeNonce(normalized.nonce) !== true) throw new Error('host_agent_nonce_replayed');
  }
  return Object.freeze({ ...normalized, authenticated: true, authority_effect: false });
}

export class HostAgentNonceWindow {
  #max;
  #seen = new Set();
  #order = [];

  constructor({ max = 4096 } = {}) {
    if (!Number.isSafeInteger(max) || max < 32 || max > 65536) throw new Error('host_agent_nonce_window_invalid');
    this.#max = max;
  }

  consume(nonce) {
    const value = String(nonce || '');
    if (!NONCE_RE.test(value) || this.#seen.has(value)) return false;
    this.#seen.add(value);
    this.#order.push(value);
    while (this.#order.length > this.#max) this.#seen.delete(this.#order.shift());
    return true;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.host-agent.nonce-window.v1',
      retained: this.#order.length,
      max: this.#max,
      authority_effect: false,
    });
  }
}

export function hostAgentProtocolManifest() {
  return Object.freeze({
    schema: 'metaengine.host-agent.ipc-manifest.v1',
    protocol: HOST_AGENT_PROTOCOL_SCHEMA,
    max_frame_bytes: HOST_AGENT_MAX_FRAME_BYTES,
    max_payload_bytes: HOST_AGENT_MAX_PAYLOAD_BYTES,
    allowed_ops: [...HOST_AGENT_ALLOWED_OPS],
    authentication: 'HMAC_SHA256_SESSION_KEY',
    replay_protection: 'BOUNDED_NONCE_WINDOW',
    arbitrary_eval: false,
    raw_shell: false,
    raw_cdp_passthrough: false,
    page_model_authority: false,
    authority_effect: false,
  });
}
