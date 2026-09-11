import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { HostAgentNonceWindow, createHostAgentNonce } from './host-agent-protocol.mjs';
import {
  DelegatedSupervisorIdentity,
  SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
} from './supervisor-identity-delegation.mjs';

export const SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA = 'metaengine.supervisor-identity-signer.ipc.v1';
export const SUPERVISOR_IDENTITY_SIGNER_MAX_FRAME_BYTES = 640 * 1024;
const MAX_BUFFER_BYTES = SUPERVISOR_IDENTITY_SIGNER_MAX_FRAME_BYTES * 2;
const REQUEST_ID_RE = /^sign:[0-9a-f-]{36}$/i;
const AUTH_TAG_RE = /^[A-Za-z0-9_-]{43}$/;
const OPS = new Set(['SNAPSHOT', 'SIGN_DEVICE']);

function endpointHash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 24);
}

export function supervisorIdentitySignerEndpoint({ userDataPath, platform = process.platform } = {}) {
  const material = path.resolve(String(userDataPath || os.tmpdir()));
  const suffix = endpointHash(material);
  if (platform === 'win32') return `\\\\.\\pipe\\metaengine-identity-signer-${suffix}`;
  return path.join(os.tmpdir(), `metaengine-identity-signer-${suffix}.sock`);
}

function decodeSessionKey(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(text)) throw new Error('supervisor_identity_signer_session_key_invalid');
  const key = Buffer.from(text, 'base64url');
  if (key.byteLength < 32 || key.byteLength > 64) throw new Error('supervisor_identity_signer_session_key_invalid');
  return key;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function payloadDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? {}), 'utf8').digest('base64url');
}

function normalizeUnsignedFrame(value) {
  if (!plainObject(value)) throw new Error('supervisor_identity_signer_frame_invalid');
  const unknown = Object.keys(value).filter((key) => !['schema','kind','request_id','nonce','op','payload','auth_tag'].includes(key));
  if (unknown.length) throw new Error(`supervisor_identity_signer_frame_field_unknown:${unknown[0]}`);
  if (value.schema !== SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA) throw new Error('supervisor_identity_signer_schema_invalid');
  const kind = String(value.kind || '').toUpperCase();
  if (!['REQUEST', 'RESPONSE'].includes(kind)) throw new Error('supervisor_identity_signer_kind_invalid');
  const requestId = String(value.request_id || '');
  if (!REQUEST_ID_RE.test(requestId)) throw new Error('supervisor_identity_signer_request_id_invalid');
  const nonce = String(value.nonce || '');
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(nonce)) throw new Error('supervisor_identity_signer_nonce_invalid');
  const op = String(value.op || '').toUpperCase();
  if (!OPS.has(op)) throw new Error('supervisor_identity_signer_op_denied');
  const payload = value.payload == null ? {} : value.payload;
  if (!plainObject(payload)) throw new Error('supervisor_identity_signer_payload_invalid');
  const normalized = Object.freeze({ schema: SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA, kind, request_id: requestId, nonce, op, payload: structuredClone(payload) });
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > SUPERVISOR_IDENTITY_SIGNER_MAX_FRAME_BYTES - 128) {
    throw new Error('supervisor_identity_signer_payload_too_large');
  }
  return normalized;
}

function signingMaterial(value) {
  const frame = normalizeUnsignedFrame(value);
  return [frame.schema, frame.kind, frame.request_id, frame.nonce, frame.op, payloadDigest(frame.payload)].join('\n');
}

function signFrame(value, sessionKey) {
  const frame = normalizeUnsignedFrame(value);
  const authTag = crypto.createHmac('sha256', decodeSessionKey(sessionKey)).update(signingMaterial(frame), 'utf8').digest('base64url');
  const signed = Object.freeze({ ...frame, auth_tag: authTag });
  if (Buffer.byteLength(JSON.stringify(signed), 'utf8') > SUPERVISOR_IDENTITY_SIGNER_MAX_FRAME_BYTES) throw new Error('supervisor_identity_signer_frame_too_large');
  return signed;
}

function verifyFrame(value, sessionKey, consumeNonce) {
  if (!plainObject(value) || !AUTH_TAG_RE.test(String(value.auth_tag || ''))) throw new Error('supervisor_identity_signer_auth_invalid');
  const frame = normalizeUnsignedFrame(value);
  const expected = crypto.createHmac('sha256', decodeSessionKey(sessionKey)).update(signingMaterial(frame), 'utf8').digest();
  const actual = Buffer.from(String(value.auth_tag), 'base64url');
  if (actual.byteLength !== expected.byteLength || !crypto.timingSafeEqual(actual, expected)) throw new Error('supervisor_identity_signer_auth_failed');
  if (typeof consumeNonce !== 'function' || consumeNonce(frame.nonce) !== true) throw new Error('supervisor_identity_signer_nonce_replayed');
  return Object.freeze({ ...frame, authenticated: true, authority_effect: false });
}

function parseFrames(state, chunk, onFrame) {
  state.buffer += chunk.toString('utf8');
  if (Buffer.byteLength(state.buffer, 'utf8') > MAX_BUFFER_BYTES) throw new Error('supervisor_identity_signer_buffer_overflow');
  for (;;) {
    const newline = state.buffer.indexOf('\n');
    if (newline < 0) return;
    const line = state.buffer.slice(0, newline);
    state.buffer = state.buffer.slice(newline + 1);
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > SUPERVISOR_IDENTITY_SIGNER_MAX_FRAME_BYTES) throw new Error('supervisor_identity_signer_frame_too_large');
    let frame;
    try { frame = JSON.parse(line); } catch { throw new Error('supervisor_identity_signer_json_invalid'); }
    onFrame(frame);
  }
}

function writeFrame(socket, frame) {
  socket.write(`${JSON.stringify(frame)}\n`, 'utf8');
}

export function createSupervisorIdentitySignerServer({ endpoint, sessionKey, signer, netModule = net } = {}) {
  if (!endpoint) throw new Error('supervisor_identity_signer_endpoint_required');
  if (!signer || typeof signer.snapshot !== 'function' || typeof signer.signDeviceRequest !== 'function') {
    throw new Error('supervisor_identity_signer_required');
  }
  decodeSessionKey(sessionKey);
  const nonceWindow = new HostAgentNonceWindow();
  const sockets = new Set();
  let listening = false;

  const server = netModule.createServer((socket) => {
    sockets.add(socket);
    const state = { buffer: '' };
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      try {
        parseFrames(state, chunk, (raw) => {
          void (async () => {
            let request;
            try {
              request = verifyFrame(raw, sessionKey, (nonce) => nonceWindow.consume(nonce));
              if (request.kind !== 'REQUEST') throw new Error('supervisor_identity_signer_request_required');
              const result = request.op === 'SNAPSHOT'
                ? await signer.snapshot()
                : await signer.signDeviceRequest(request.payload);
              writeFrame(socket, signFrame({
                schema: SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA,
                kind: 'RESPONSE',
                request_id: request.request_id,
                nonce: createHostAgentNonce(),
                op: request.op,
                payload: { ok: true, result: structuredClone(result) },
              }, sessionKey));
            } catch (error) {
              if (!request) {
                socket.destroy();
                return;
              }
              writeFrame(socket, signFrame({
                schema: SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA,
                kind: 'RESPONSE',
                request_id: request.request_id,
                nonce: createHostAgentNonce(),
                op: request.op,
                payload: { ok: false, error: String(error?.message || error).slice(0, 240) },
              }, sessionKey));
            }
          })();
        });
      } catch {
        socket.destroy();
      }
    });
  });

  return Object.freeze({
    async start() {
      if (listening) return this.snapshot();
      if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => {});
      await new Promise((resolve, reject) => {
        const onError = (error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(endpoint);
      });
      listening = true;
      return this.snapshot();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      if (listening) await new Promise((resolve) => server.close(() => resolve()));
      listening = false;
      if (process.platform !== 'win32') await rm(endpoint, { force: true }).catch(() => {});
    },
    snapshot() {
      return Object.freeze({
        schema: 'metaengine.supervisor-identity-signer.ipc-server.v1',
        endpoint_kind: process.platform === 'win32' ? 'WINDOWS_NAMED_PIPE' : 'LOCAL_SOCKET',
        listening,
        connections: sockets.size,
        authenticated_frames_only: true,
        operations: ['SNAPSHOT', 'SIGN_DEVICE'],
        private_key_exported: false,
        enrollment_authority: false,
        browser_control_authority: false,
        replay_protection: nonceWindow.snapshot(),
        authority_effect: false,
      });
    },
  });
}

export class SupervisorIdentitySignerClient {
  #endpoint;
  #sessionKey;
  #net;
  #socket = null;
  #buffer = { buffer: '' };
  #pending = new Map();
  #nonceWindow = new HostAgentNonceWindow();
  #connectPromise = null;

  constructor({ endpoint, sessionKey, netModule = net } = {}) {
    if (!endpoint) throw new Error('supervisor_identity_signer_client_endpoint_required');
    decodeSessionKey(sessionKey);
    this.#endpoint = endpoint;
    this.#sessionKey = sessionKey;
    this.#net = netModule;
  }

  async connect() {
    if (this.#socket && !this.#socket.destroyed) return this.snapshot();
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = new Promise((resolve, reject) => {
      const socket = this.#net.createConnection(this.#endpoint);
      const fail = (error) => reject(error);
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        this.#socket = socket;
        this.#buffer = { buffer: '' };
        socket.on('error', (error) => this.#fail(error));
        socket.on('close', () => {
          if (this.#socket === socket) this.#socket = null;
          this.#fail(new Error('supervisor_identity_signer_closed'));
        });
        socket.on('data', (chunk) => this.#onData(chunk));
        resolve(this.snapshot());
      });
    }).finally(() => { this.#connectPromise = null; });
    return this.#connectPromise;
  }

  #fail(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #onData(chunk) {
    try {
      parseFrames(this.#buffer, chunk, (raw) => {
        const frame = verifyFrame(raw, this.#sessionKey, (nonce) => this.#nonceWindow.consume(nonce));
        if (frame.kind !== 'RESPONSE') throw new Error('supervisor_identity_signer_response_required');
        const pending = this.#pending.get(frame.request_id);
        if (!pending || pending.op !== frame.op) throw new Error('supervisor_identity_signer_response_unmatched');
        this.#pending.delete(frame.request_id);
        clearTimeout(pending.timer);
        if (frame.payload?.ok !== true) pending.reject(new Error(String(frame.payload?.error || 'supervisor_identity_signer_request_failed')));
        else pending.resolve(structuredClone(frame.payload.result));
      });
    } catch (error) {
      this.#socket?.destroy();
      this.#fail(error);
    }
  }

  async #request(op, payload = {}, timeoutMs = 5000) {
    await this.connect();
    const requestId = `sign:${crypto.randomUUID()}`;
    const frame = signFrame({
      schema: SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA,
      kind: 'REQUEST',
      request_id: requestId,
      nonce: createHostAgentNonce(),
      op,
      payload,
    }, this.#sessionKey);
    const timeout = Math.max(100, Math.min(30000, Number(timeoutMs) || 5000));
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`supervisor_identity_signer_timeout:${op}`));
      }, timeout);
      timer.unref?.();
      this.#pending.set(requestId, { op, resolve, reject, timer });
    });
    writeFrame(this.#socket, frame);
    return result;
  }

  readSnapshot() { return this.#request('SNAPSHOT'); }
  signDeviceRequest(request) { return this.#request('SIGN_DEVICE', request); }

  delegatedIdentity() {
    return new DelegatedSupervisorIdentity({
      readSnapshot: () => this.readSnapshot(),
      signDeviceRequest: (request) => this.signDeviceRequest(request),
    });
  }

  close() {
    this.#socket?.destroy();
    this.#socket = null;
    this.#fail(new Error('supervisor_identity_signer_client_closed'));
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.supervisor-identity-signer.ipc-client.v1',
      connected: Boolean(this.#socket && !this.#socket.destroyed),
      pending_requests: this.#pending.size,
      operations: ['SNAPSHOT', 'SIGN_DEVICE'],
      private_key_material: false,
      enrollment_authority: false,
      browser_control_authority: false,
      replay_protection: this.#nonceWindow.snapshot(),
      authority_effect: false,
    });
  }
}

export function supervisorIdentitySignerIpcManifest() {
  return Object.freeze({
    schema: SUPERVISOR_IDENTITY_SIGNER_IPC_SCHEMA,
    transport: process.platform === 'win32' ? 'WINDOWS_NAMED_PIPE' : 'LOCAL_SOCKET',
    authentication: 'HMAC_SHA256_EPHEMERAL_SESSION',
    operations: ['SNAPSHOT', 'SIGN_DEVICE'],
    signed_envelope_schema: SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
    private_key_exported: false,
    enrollment_authority: false,
    browser_control_authority: false,
    arbitrary_eval: false,
    raw_shell: false,
    raw_cdp: false,
    authority_effect: false,
  });
}
