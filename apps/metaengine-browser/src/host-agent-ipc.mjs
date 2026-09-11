import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  HOST_AGENT_MAX_FRAME_BYTES,
  HOST_AGENT_PROTOCOL_SCHEMA,
  HostAgentNonceWindow,
  createHostAgentNonce,
  serializeHostAgentFrame,
  signHostAgentFrame,
  verifyHostAgentFrame,
} from './host-agent-protocol.mjs';

const MAX_BUFFER_BYTES = HOST_AGENT_MAX_FRAME_BYTES * 2;

function hashEndpointMaterial(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 24);
}

export function hostAgentEndpoint({ userDataPath, platform = process.platform } = {}) {
  const material = path.resolve(String(userDataPath || os.tmpdir()));
  const suffix = hashEndpointMaterial(material);
  if (platform === 'win32') return `\\\\.\\pipe\\metaengine-host-agent-${suffix}`;
  return path.join(os.tmpdir(), `metaengine-host-agent-${suffix}.sock`);
}

function parseFrames(state, chunk) {
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const total = state.buffer.byteLength + incoming.byteLength;
  if (total > MAX_BUFFER_BYTES) throw new Error('host_agent_ipc_buffer_overflow');
  state.buffer = state.buffer.byteLength === 0
    ? incoming
    : Buffer.concat([state.buffer, incoming], total);
  const frames = [];
  for (;;) {
    const newline = state.buffer.indexOf(0x0a);
    if (newline < 0) break;
    const line = state.buffer.subarray(0, newline);
    state.buffer = state.buffer.subarray(newline + 1);
    if (line.byteLength === 0) continue;
    if (line.byteLength > HOST_AGENT_MAX_FRAME_BYTES) throw new Error('host_agent_ipc_frame_too_large');
    let frame;
    try {
      frame = JSON.parse(line.toString('utf8'));
    } catch {
      throw new Error('host_agent_ipc_json_invalid');
    }
    frames.push(frame);
  }
  return frames;
}

function writeFrame(socket, frame) {
  socket.write(`${serializeHostAgentFrame(frame)}\n`, 'utf8');
}

async function handleServerFrame(socket, raw, sessionKey, table, nonceWindow) {
  let request;
  try {
    request = verifyHostAgentFrame(raw, sessionKey, { consumeNonce: (nonce) => nonceWindow.consume(nonce) });
    if (request.kind !== 'REQUEST') throw new Error('host_agent_server_request_kind_required');
    const handler = table.get(request.op);
    if (!handler) throw new Error(`host_agent_server_op_unhandled:${request.op}`);
    // request.payload is already the protocol boundary's defensive copy.
    const result = await handler(request.payload, request);
    // signHostAgentFrame owns the single defensive copy before the response crosses IPC.
    const payload = result && typeof result === 'object' && !Array.isArray(result)
      ? { ok: true, result }
      : { ok: true, result: { value: result ?? null } };
    writeFrame(socket, signHostAgentFrame({
      schema: HOST_AGENT_PROTOCOL_SCHEMA,
      kind: 'RESPONSE',
      request_id: request.request_id,
      nonce: createHostAgentNonce(),
      op: request.op,
      payload,
    }, sessionKey));
  } catch (error) {
    if (!request) {
      socket.destroy();
      return;
    }
    try {
      writeFrame(socket, signHostAgentFrame({
        schema: HOST_AGENT_PROTOCOL_SCHEMA,
        kind: 'RESPONSE',
        request_id: request.request_id,
        nonce: createHostAgentNonce(),
        op: request.op,
        payload: { ok: false, error: String(error?.message || error).slice(0, 240) },
      }, sessionKey));
    } catch {
      socket.destroy();
    }
  }
}

export function createHostAgentServer({ endpoint, sessionKey, handlers = {}, netModule = net } = {}) {
  if (!endpoint) throw new Error('host_agent_server_endpoint_required');
  const table = new Map(Object.entries(handlers));
  for (const [op, handler] of table) {
    if (typeof handler !== 'function') throw new Error(`host_agent_server_handler_invalid:${op}`);
  }
  const nonceWindow = new HostAgentNonceWindow();
  const sockets = new Set();
  let listening = false;

  const server = netModule.createServer((socket) => {
    sockets.add(socket);
    const state = { buffer: Buffer.alloc(0) };
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      let frames;
      try {
        frames = parseFrames(state, chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const raw of frames) {
        void handleServerFrame(socket, raw, sessionKey, table, nonceWindow)
          .catch(() => socket.destroy());
      }
    });
  });

  return Object.freeze({
    async start() {
      if (listening) return this.snapshot();
      if (process.platform !== 'win32' && typeof endpoint === 'string') await rm(endpoint, { force: true });
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
      if (process.platform !== 'win32' && typeof endpoint === 'string') await rm(endpoint, { force: true });
    },
    snapshot() {
      return Object.freeze({
        schema: 'metaengine.host-agent.ipc-server.v1',
        endpoint_kind: process.platform === 'win32' ? 'WINDOWS_NAMED_PIPE' : 'LOCAL_SOCKET',
        listening,
        connections: sockets.size,
        authenticated_frames_only: true,
        replay_protection: nonceWindow.snapshot(),
        binary_frame_accumulator: true,
        redundant_payload_clones: 0,
        raw_shell: false,
        raw_cdp_passthrough: false,
        authority_effect: false,
      });
    },
  });
}

export class HostAgentClient {
  #endpoint;
  #sessionKey;
  #net;
  #socket = null;
  #bufferState = { buffer: Buffer.alloc(0) };
  #pending = new Map();
  #nonceWindow = new HostAgentNonceWindow();
  #connectPromise = null;

  constructor({ endpoint, sessionKey, netModule = net } = {}) {
    if (!endpoint) throw new Error('host_agent_client_endpoint_required');
    this.#endpoint = endpoint;
    this.#sessionKey = sessionKey;
    this.#net = netModule;
  }

  async connect() {
    if (this.#socket && !this.#socket.destroyed) return this.snapshot();
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = new Promise((resolve, reject) => {
      const socket = this.#net.createConnection(this.#endpoint);
      const fail = (error) => {
        socket.destroy();
        if (this.#socket === socket) this.#socket = null;
        reject(error);
      };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        this.#socket = socket;
        this.#bufferState = { buffer: Buffer.alloc(0) };
        socket.on('error', (error) => {
          this.#failPending(error);
          socket.destroy();
        });
        socket.on('close', () => {
          if (this.#socket === socket) this.#socket = null;
          this.#failPending(new Error('host_agent_ipc_closed'));
        });
        socket.on('data', (chunk) => this.#onData(chunk));
        resolve(this.snapshot());
      });
    }).finally(() => { this.#connectPromise = null; });
    return this.#connectPromise;
  }

  #failPending(error) {
    for (const row of this.#pending.values()) {
      clearTimeout(row.timer);
      row.reject(error);
    }
    this.#pending.clear();
  }

  #onData(chunk) {
    try {
      const frames = parseFrames(this.#bufferState, chunk);
      for (const raw of frames) {
        const frame = verifyHostAgentFrame(raw, this.#sessionKey, { consumeNonce: (nonce) => this.#nonceWindow.consume(nonce) });
        if (frame.kind !== 'RESPONSE') throw new Error('host_agent_client_response_kind_required');
        const pending = this.#pending.get(frame.request_id);
        if (!pending || pending.op !== frame.op) throw new Error('host_agent_client_response_unmatched');
        this.#pending.delete(frame.request_id);
        clearTimeout(pending.timer);
        if (frame.payload?.ok !== true) pending.reject(new Error(String(frame.payload?.error || 'host_agent_request_failed')));
        // verifyHostAgentFrame already detached this payload from the socket parser object.
        else pending.resolve(frame.payload.result);
      }
    } catch (error) {
      this.#socket?.destroy();
      this.#failPending(error);
    }
  }

  async request(op, payload = {}, { timeoutMs = 5000 } = {}) {
    await this.connect();
    const requestId = `req:${crypto.randomUUID()}`;
    const frame = signHostAgentFrame({
      schema: HOST_AGENT_PROTOCOL_SCHEMA,
      kind: 'REQUEST',
      request_id: requestId,
      nonce: createHostAgentNonce(),
      op,
      payload,
    }, this.#sessionKey);
    const timeout = Math.max(100, Math.min(60000, Number(timeoutMs) || 5000));
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`host_agent_request_timeout:${op}`));
      }, timeout);
      timer.unref?.();
      this.#pending.set(requestId, { op: String(op || '').toUpperCase(), resolve, reject, timer });
    });
    writeFrame(this.#socket, frame);
    return promise;
  }

  close() {
    this.#socket?.destroy();
    this.#socket = null;
    this.#failPending(new Error('host_agent_client_closed'));
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.host-agent.ipc-client.v1',
      connected: Boolean(this.#socket && !this.#socket.destroyed),
      pending_requests: this.#pending.size,
      authenticated_frames_only: true,
      replay_protection: this.#nonceWindow.snapshot(),
      binary_frame_accumulator: true,
      redundant_payload_clones: 0,
      authority_effect: false,
    });
  }
}
