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
  'BROWSER_EFFECT_BINDING_PREPARE',
  'BROWSER_PLAN_EXECUTE',
  'BROWSER_PLAN_CANCEL',
]);

const OPS = new Set(HOST_AGENT_ALLOWED_OPS);
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{32}$/;
const AUTH_RE = /^[A-Za-z0-9_-]{43}$/;
const FRAME_META = new WeakMap();
const NONCE_EPOCH_BYTES = 16;
const NONCE_SEQUENCE_BYTES = 8;
const NONCE_BYTES = NONCE_EPOCH_BYTES + NONCE_SEQUENCE_BYTES;
const MAX_NONCE_SEQUENCE = (1n << 64n) - 1n;
const NONCE_REORDER_WINDOW = 256n;
const NONCE_REORDER_MASK = (1n << NONCE_REORDER_WINDOW) - 1n;
let compatibilityNonceSequence = null;

const digest = (value) => crypto.createHash('sha256').update(value).digest('base64url');

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function decodeKey(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(text)) throw new Error('host_agent_session_key_invalid');
  const key = Buffer.from(text, 'base64url');
  if (key.byteLength < 32 || key.byteLength > 64) throw new Error('host_agent_session_key_invalid');
  return key;
}

function decodeSequencedNonce(value) {
  const text = String(value || '').trim();
  if (!NONCE_RE.test(text)) return null;
  let raw;
  try { raw = Buffer.from(text, 'base64url'); } catch { return null; }
  if (raw.byteLength !== NONCE_BYTES) return null;
  const sequence = raw.readBigUInt64BE(NONCE_EPOCH_BYTES);
  if (sequence === 0n) return null;
  return Object.freeze({
    epoch: raw.subarray(0, NONCE_EPOCH_BYTES).toString('hex'),
    sequence,
  });
}

function payloadJson(value) {
  let serialized;
  try { serialized = JSON.stringify(value ?? {}); } catch { throw new Error('host_agent_payload_json_invalid'); }
  if (serialized == null) throw new Error('host_agent_payload_json_invalid');
  if (Buffer.byteLength(serialized, 'utf8') > HOST_AGENT_MAX_PAYLOAD_BYTES) throw new Error('host_agent_payload_too_large');
  return serialized;
}

function normalizeUnsignedFrame(frame, { freezePayload = false } = {}) {
  if (!plainObject(frame)) throw new Error('host_agent_frame_invalid');
  const unknown = Object.keys(frame).filter((key) => !['schema','kind','request_id','nonce','op','payload','auth_tag'].includes(key));
  if (unknown.length) throw new Error(`host_agent_frame_field_unknown:${unknown[0]}`);
  if (frame.schema !== HOST_AGENT_PROTOCOL_SCHEMA) throw new Error('host_agent_frame_schema_invalid');
  const kind = String(frame.kind || '').trim().toUpperCase();
  if (!['REQUEST','RESPONSE','EVENT'].includes(kind)) throw new Error('host_agent_frame_kind_invalid');
  const requestId = String(frame.request_id || '').trim();
  if (!REQUEST_ID_RE.test(requestId)) throw new Error('host_agent_request_id_invalid');
  const nonce = String(frame.nonce || '').trim();
  if (!decodeSequencedNonce(nonce)) throw new Error('host_agent_nonce_invalid');
  const op = String(frame.op || '').trim().toUpperCase();
  if (!OPS.has(op)) throw new Error('host_agent_op_denied');
  const sourcePayload = frame.payload == null ? {} : frame.payload;
  if (!plainObject(sourcePayload)) throw new Error('host_agent_payload_invalid');

  const payload = structuredClone(sourcePayload);
  if (freezePayload) deepFreeze(payload);
  const serializedPayload = payloadJson(payload);
  const normalized = Object.freeze({
    schema: HOST_AGENT_PROTOCOL_SCHEMA,
    kind,
    request_id: requestId,
    nonce,
    op,
    payload,
  });
  FRAME_META.set(normalized, Object.freeze({ payloadJson: serializedPayload }));
  return normalized;
}

function materialFromNormalized(frame) {
  const serializedPayload = FRAME_META.get(frame)?.payloadJson ?? payloadJson(frame.payload);
  return [
    frame.schema,
    frame.kind,
    frame.request_id,
    frame.nonce,
    frame.op,
    digest(Buffer.from(serializedPayload, 'utf8')),
  ].join('\n');
}

function cacheSignedWire(frame, payload) {
  const wireJson = JSON.stringify(frame);
  if (Buffer.byteLength(wireJson, 'utf8') > HOST_AGENT_MAX_FRAME_BYTES) throw new Error('host_agent_frame_too_large');
  FRAME_META.set(frame, Object.freeze({ payloadJson: payload, wireJson }));
  return frame;
}

export function serializeHostAgentFrame(frame) {
  const cached = FRAME_META.get(frame)?.wireJson;
  if (cached != null) return cached;
  const wireJson = JSON.stringify(frame);
  if (Buffer.byteLength(wireJson, 'utf8') > HOST_AGENT_MAX_FRAME_BYTES) throw new Error('host_agent_frame_too_large');
  return wireJson;
}

export function createHostAgentSessionKey() {
  return crypto.randomBytes(32).toString('base64url');
}

export class HostAgentNonceSequence {
  #epoch;
  #sequence = 0n;

  constructor({ epoch = null } = {}) {
    if (epoch == null) {
      this.#epoch = crypto.randomBytes(NONCE_EPOCH_BYTES);
    } else {
      const decoded = typeof epoch === 'string' ? Buffer.from(epoch, 'base64url') : Buffer.from(epoch);
      if (decoded.byteLength !== NONCE_EPOCH_BYTES) throw new Error('host_agent_nonce_epoch_invalid');
      this.#epoch = Buffer.from(decoded);
    }
  }

  next() {
    if (this.#sequence >= MAX_NONCE_SEQUENCE) throw new Error('host_agent_nonce_sequence_exhausted');
    this.#sequence += 1n;
    const raw = Buffer.allocUnsafe(NONCE_BYTES);
    this.#epoch.copy(raw, 0);
    raw.writeBigUInt64BE(this.#sequence, NONCE_EPOCH_BYTES);
    return raw.toString('base64url');
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.host-agent.nonce-sequence.v1',
      epoch_sha256: crypto.createHash('sha256').update(this.#epoch).digest('hex'),
      emitted: this.#sequence.toString(),
      authority_effect: false,
    });
  }
}

export function createHostAgentNonce() {
  compatibilityNonceSequence ||= new HostAgentNonceSequence();
  return compatibilityNonceSequence.next();
}

export function signHostAgentFrame(frame, sessionKey) {
  const normalized = normalizeUnsignedFrame(frame, { freezePayload: true });
  const serializedPayload = FRAME_META.get(normalized).payloadJson;
  const authTag = crypto.createHmac('sha256', decodeKey(sessionKey)).update(materialFromNormalized(normalized), 'utf8').digest('base64url');
  return cacheSignedWire(Object.freeze({ ...normalized, auth_tag: authTag }), serializedPayload);
}

export function verifyHostAgentFrame(frame, sessionKey, { consumeNonce = null } = {}) {
  if (!plainObject(frame)) throw new Error('host_agent_frame_invalid');
  const supplied = String(frame.auth_tag || '');
  if (!AUTH_RE.test(supplied)) throw new Error('host_agent_auth_tag_invalid');
  const normalized = normalizeUnsignedFrame(frame);
  const expected = crypto.createHmac('sha256', decodeKey(sessionKey)).update(materialFromNormalized(normalized), 'utf8').digest();
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
  #stateByEpoch = new Map();

  constructor({ max = 4096 } = {}) {
    if (!Number.isSafeInteger(max) || max < 32 || max > 65536) throw new Error('host_agent_nonce_window_invalid');
    this.#max = max;
  }

  consume(nonce) {
    const parsed = decodeSequencedNonce(nonce);
    if (!parsed) return false;
    const current = this.#stateByEpoch.get(parsed.epoch);
    if (!current) {
      if (this.#stateByEpoch.size >= this.#max) return false;
      this.#stateByEpoch.set(parsed.epoch, { highWater: parsed.sequence, seen: 1n });
      return true;
    }

    if (parsed.sequence > current.highWater) {
      const delta = parsed.sequence - current.highWater;
      current.seen = delta >= NONCE_REORDER_WINDOW
        ? 1n
        : ((current.seen << delta) & NONCE_REORDER_MASK) | 1n;
      current.highWater = parsed.sequence;
      return true;
    }

    const offset = current.highWater - parsed.sequence;
    if (offset >= NONCE_REORDER_WINDOW) return false;
    const bit = 1n << offset;
    if ((current.seen & bit) !== 0n) return false;
    current.seen |= bit;
    return true;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.host-agent.nonce-window.v2',
      retained: this.#stateByEpoch.size,
      max: this.#max,
      mode: 'SEQUENCED_EPOCH_HIGH_WATER',
      reorder_window: Number(NONCE_REORDER_WINDOW),
      evicts_authenticated_epochs: false,
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
    replay_protection: 'SEQUENCED_EPOCH_HIGH_WATER_NO_EVICTION',
    session_key_rotation: 'REQUIRED_ON_SERVER_PROCESS_RESTART',
    payload_serializations_per_auth: 1,
    cached_signed_wire_serialization: true,
    arbitrary_eval: false,
    raw_shell: false,
    raw_cdp_passthrough: false,
    page_model_authority: false,
    authority_effect: false,
  });
}
