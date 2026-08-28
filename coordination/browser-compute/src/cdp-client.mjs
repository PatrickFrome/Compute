import { TextDecoder } from 'node:util';

export const DEFAULT_CDP_PIPE_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export class NulJsonFrameDecoder {
  #segments = [];
  #bufferedBytes = 0;
  #decoder = new TextDecoder('utf-8', { fatal: true });
  #maxFrameBytes;
  #onMessage;

  constructor({ maxFrameBytes = DEFAULT_CDP_PIPE_MAX_FRAME_BYTES, onMessage } = {}) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1024) throw new Error('cdp_pipe_frame_limit_invalid');
    if (typeof onMessage !== 'function') throw new Error('cdp_pipe_message_handler_required');
    this.#maxFrameBytes = maxFrameBytes;
    this.#onMessage = onMessage;
  }

  push(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (incoming.length === 0) return;
    let start = 0;
    let delimiter;
    while ((delimiter = incoming.indexOf(0, start)) >= 0) {
      const tail = incoming.subarray(start, delimiter);
      const frameBytes = this.#bufferedBytes + tail.length;
      if (frameBytes === 0) throw new Error('cdp_pipe_empty_frame');
      if (frameBytes > this.#maxFrameBytes) throw new Error('cdp_pipe_frame_too_large');
      const frame = this.#segments.length === 0 ? tail : Buffer.concat([...this.#segments, tail], frameBytes);
      this.#segments = [];
      this.#bufferedBytes = 0;
      let message;
      try {
        message = JSON.parse(this.#decoder.decode(frame));
      } catch (_) {
        throw new Error('cdp_pipe_json_invalid');
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('cdp_pipe_message_invalid');
      this.#onMessage(message);
      start = delimiter + 1;
    }
    if (start < incoming.length) {
      const remainder = incoming.subarray(start);
      this.#bufferedBytes += remainder.length;
      if (this.#bufferedBytes > this.#maxFrameBytes) throw new Error('cdp_pipe_frame_too_large');
      this.#segments.push(Buffer.from(remainder));
    }
  }

  finish() {
    if (this.#bufferedBytes !== 0) throw new Error('cdp_pipe_truncated_frame');
  }
}

export class CdpPipeClient {
  #writable;
  #readable;
  #maxFrameBytes;
  #nextId = 1;
  #pending = new Map();
  #events = new Map();
  #decoder = null;
  #connected = false;
  #closed = false;
  #listeners = [];
  #closeListeners = new Set();

  constructor({ writable, readable, maxFrameBytes = DEFAULT_CDP_PIPE_MAX_FRAME_BYTES } = {}) {
    this.#writable = writable;
    this.#readable = readable;
    this.#maxFrameBytes = maxFrameBytes;
  }

  async connect() {
    if (this.#connected) return this;
    if (this.#closed) throw new Error('cdp_pipe_client_closed');
    if (typeof this.#writable?.write !== 'function' || typeof this.#readable?.on !== 'function') throw new Error('cdp_pipe_streams_invalid');
    this.#decoder = new NulJsonFrameDecoder({
      maxFrameBytes: this.#maxFrameBytes,
      onMessage: (message) => this.#onMessage(message)
    });
    const listen = (stream, event, listener) => {
      stream.on(event, listener);
      this.#listeners.push([stream, event, listener]);
    };
    listen(this.#readable, 'data', (chunk) => {
      try { this.#decoder.push(chunk); }
      catch (error) { this.abort(error); }
    });
    listen(this.#readable, 'end', () => {
      try { this.#decoder.finish(); }
      catch (error) { this.abort(error); return; }
      this.abort(new Error('cdp_pipe_read_ended'));
    });
    listen(this.#readable, 'close', () => this.abort(new Error('cdp_pipe_read_closed')));
    listen(this.#readable, 'error', (error) => this.abort(new Error(`cdp_pipe_read_error:${error?.message || error}`)));
    listen(this.#writable, 'close', () => this.abort(new Error('cdp_pipe_write_closed')));
    listen(this.#writable, 'error', (error) => this.abort(new Error(`cdp_pipe_write_error:${error?.message || error}`)));
    this.#connected = true;
    return this;
  }

  get connected() { return this.#connected && !this.#closed; }
  get pendingCount() { return this.#pending.size; }

  #onMessage(message) {
    if (Number.isInteger(message.id)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      const responseSessionId = typeof message.sessionId === 'string' && message.sessionId ? message.sessionId : null;
      if (responseSessionId !== pending.sessionId) {
        const error = new Error('cdp_session_response_mismatch');
        pending.reject(error);
        this.abort(error);
        return;
      }
      if (message.error) pending.reject(new Error(`cdp_error:${message.error.code}:${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (typeof message.method === 'string' && message.method) {
      for (const listener of this.#events.get(message.method) || []) {
        try { listener(message.params || {}, message.sessionId || null); } catch (_) {}
      }
    }
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #detachListeners() {
    for (const [stream, event, listener] of this.#listeners) stream.off?.(event, listener);
    this.#listeners = [];
  }

  on(method, listener) {
    if (typeof method !== 'string' || !method || typeof listener !== 'function') throw new Error('cdp_event_listener_invalid');
    const list = this.#events.get(method) || [];
    list.push(listener);
    this.#events.set(method, list);
    return () => this.#events.set(method, (this.#events.get(method) || []).filter((fn) => fn !== listener));
  }

  onClose(listener) {
    if (typeof listener !== 'function') throw new Error('cdp_close_listener_invalid');
    if (this.#closed) {
      queueMicrotask(() => { try { listener(new Error('cdp_pipe_client_closed')); } catch (_) {} });
      return () => {};
    }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  rejectSession(sessionId, error = new Error('cdp_session_detached')) {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('cdp_session_id_invalid');
    const rejection = error instanceof Error ? error : new Error(String(error));
    let rejected = 0;
    for (const [id, pending] of this.#pending) {
      if (pending.sessionId !== sessionId) continue;
      this.#pending.delete(id);
      pending.reject(rejection);
      rejected += 1;
    }
    return rejected;
  }

  call(method, params = {}, { sessionId = null, timeoutMs = 15000 } = {}) {
    if (!this.connected) return Promise.reject(new Error('cdp_not_connected'));
    if (typeof method !== 'string' || !method || !Number.isInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error('cdp_call_invalid'));
    if (sessionId != null && (typeof sessionId !== 'string' || !sessionId)) return Promise.reject(new Error('cdp_session_id_invalid'));
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const frame = Buffer.from(`${JSON.stringify(message)}\0`, 'utf8');
    if (frame.length - 1 > this.#maxFrameBytes) return Promise.reject(new Error('cdp_pipe_frame_too_large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`cdp_call_timeout:${method}`));
      }, timeoutMs);
      const pending = {
        sessionId: typeof sessionId === 'string' && sessionId ? sessionId : null,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      };
      this.#pending.set(id, pending);
      try {
        this.#writable.write(frame, (error) => {
          if (!error) return;
          if (this.#pending.delete(id)) pending.reject(new Error(`cdp_pipe_write_failed:${error?.message || error}`));
        });
      } catch (error) {
        if (this.#pending.delete(id)) pending.reject(new Error(`cdp_pipe_write_failed:${error?.message || error}`));
      }
    });
  }

  abort(error = new Error('cdp_pipe_aborted')) {
    if (this.#closed) return;
    this.#closed = true;
    this.#connected = false;
    this.#detachListeners();
    const rejection = error instanceof Error ? error : new Error(String(error));
    this.#failAll(rejection);
    for (const listener of this.#closeListeners) {
      try { listener(rejection); } catch (_) {}
    }
    this.#closeListeners.clear();
    try { this.#writable.destroy?.(); } catch (_) {}
    try { this.#readable.destroy?.(); } catch (_) {}
  }

  async close() {
    if (this.#closed) return;
    this.abort(new Error('cdp_client_closed'));
  }
}
