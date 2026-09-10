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

function parseFrames(state, chunk, onFrame) {
  state.buffer += chunk.toString('utf8');
  if (Buffer.byteLength(state.buffer, 'utf8') > MAX_BUFFER_BYTES) throw new Error('host_agent_ipc_buffer_overflow');
  for (;;) {
    const newline = state.buffer.indexOf('\n');
    if (newline < 0) break;
    const line = state.buffer.slice(0, newline);
    state.buffer = state.buffer.slice(newline + 1);
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, 'utf8') > HOST_AGENT_MAX_FRAME_BYTES) throw new Error('host_agent_ipc_frame_too_large');
    let frame;
    try { frame = JSON.parse(line); } catch { throw new Error('host_agent_ipc_json_invalid'); }
    onFrame(frame);
  }
}

function writeFrame(socket, frame) {
  const line = `${JSON.stringify(frame)}\n`;
  if (Buffer.byteLength(line, 'utf8') > HOST_AGENT_MAX_FRAME_BYTES + 1) throw new Error('host_agent_ipc_frame_too_large');
  socket.write(line, 'utf8');
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
    const state = { buffer: '' };
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      try {
        parseFrames(state, chunk, (raw) => {
          void (async () => {
            let request;
            try {
              request = verifyHostAgentFrame(raw, sessionKey, { consumeNonce: (nonce) => nonceWindow.consume(nonce) });
              if (request.kind !== 'REQUEST') throw new Error('host_agent_server_request_kind_required');
              const handler = table.get(request.op);
              if (!handler) throw new Error(`host_agent_server_op_unhandled:${request.op}`);
              const result = await handler(structuredClone(request.payload), request);
              const payload = result && typeof result === 'object' && !Array.isArray(result)
                ? { ok: true, result: structuredClone(result) }
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
              writeFrame(socket, signHostAgentFrame({
                schema: HOST_AGENT_PROTOCOL_SCHEMA,
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
      if (process.platform !== 'win32' && typeof endpoint === 'string') await rm(endpoint, { force: true }).catch(() => {});
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
      if (process.platform !== 'win32' && typeof endpoint === 'string') await rm(endpoint, { force: true }).catch(() => {});
    },
    snapshot() {
      return Object.freeze({
        schema: 'metaengine.host-agent.ipc-server.v1',
        endpoint_kind: process.platform === 'win32' ? 'WINDOWS_NAMED_PIPE' : 'LOCAL_SOCKET',
        listening,
        connections: sockets.size,
        authenticated_frames_only: true,
        replay_protection: nonceWindow.snapshot(),
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
  #bufferState = { buffer: '' };
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
        if (this.#socket === socket) this.#socket = null;
        reject(error);
      };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        this.#socket = socket;
        this.#bufferState = { buffer: '' };
        socket.on('error', (error) => this.#failPending(error));
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
      parseFrames(this.#bufferState, chunk, (raw) => {
        const frame = verifyHostAgentFrame(raw, this.#sessionKey, { consumeNonce: (nonce) => this.#nonceWindow.consume(nonce) });
        if (frame.kind !== 'RESPONSE') throw new Error('host_agent_client_response_kind_required');
        const pending = this.#pending.get(frame.request_id);
        if (!pending || pending.op !== frame.op) throw new Error('host_agent_client_response_unmatched');
        this.#pending.delete(frame.request_id);
        clearTimeout(pending.timer);
        if (frame.payload?.ok !== true) pending.reject(new Error(String(frame.payload?.error || 'host_agent_request_failed')));
        else pending.resolve(structuredClone(frame.payload.result));
      });
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
      authority_effect: false,
    });
  }
}
