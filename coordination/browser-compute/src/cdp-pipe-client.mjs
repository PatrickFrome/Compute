const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_ALLOWED_FRAME_BYTES = 100 * 1024 * 1024;

export class CdpPipeClient {
  #pipeWrite;
  #pipeRead;
  #maxFrameBytes;
  #buffer = Buffer.alloc(0);
  #nextId = 1;
  #pending = new Map();
  #events = new Map();
  #connected = false;
  #closed = false;
  #fatalError = null;
  #listeners = null;

  constructor(pipeWrite, pipeRead, { maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
    if (!pipeWrite || typeof pipeWrite.write !== 'function') throw new Error('cdp_pipe_write_invalid');
    if (!pipeRead || typeof pipeRead.on !== 'function') throw new Error('cdp_pipe_read_invalid');
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 64 || maxFrameBytes > MAX_ALLOWED_FRAME_BYTES) throw new Error('cdp_pipe_frame_limit_invalid');
    this.#pipeWrite = pipeWrite;
    this.#pipeRead = pipeRead;
    this.#maxFrameBytes = maxFrameBytes;
  }

  async connect() {
    if (this.#closed) throw new Error('cdp_pipe_closed');
    if (this.#connected) return this;
    const onData = (chunk) => this.#onData(chunk);
    const onEnd = () => this.#failAll(new Error('cdp_pipe_closed'));
    const onClose = () => this.#failAll(new Error('cdp_pipe_closed'));
    const onError = (error) => this.#failAll(new Error(`cdp_pipe_error:${String(error?.message || error)}`));
    this.#listeners = { onData, onEnd, onClose, onError };
    this.#pipeRead.on('data', onData);
    this.#pipeRead.on('end', onEnd);
    this.#pipeRead.on('close', onClose);
    this.#pipeRead.on('error', onError);
    this.#pipeWrite.on?.('error', onError);
    this.#connected = true;
    return this;
  }

  #onData(chunk) {
    if (this.#closed || this.#fatalError) return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, incoming]) : Buffer.from(incoming);

    while (true) {
      const delimiter = this.#buffer.indexOf(0);
      if (delimiter < 0) {
        if (this.#buffer.length > this.#maxFrameBytes) this.#failAll(new Error('cdp_pipe_frame_too_large'));
        return;
      }
      if (delimiter > this.#maxFrameBytes) {
        this.#failAll(new Error('cdp_pipe_frame_too_large'));
        return;
      }
      const frame = this.#buffer.subarray(0, delimiter);
      this.#buffer = this.#buffer.subarray(delimiter + 1);
      if (!frame.length) continue;

      let message;
      try { message = JSON.parse(frame.toString('utf8')); }
      catch (_) {
        this.#failAll(new Error('cdp_pipe_json_invalid'));
        return;
      }
      this.#onMessage(message);
      if (this.#fatalError) return;
    }
  }

  #onMessage(message) {
    if (Number.isInteger(message?.id)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(`cdp_error:${message.error.code}:${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (typeof message?.method === 'string') {
      for (const listener of this.#events.get(message.method) || []) {
        try { listener(message.params || {}, message.sessionId || null); } catch (_) {}
      }
    }
  }

  #failAll(error) {
    if (!this.#fatalError) this.#fatalError = error;
    for (const pending of this.#pending.values()) pending.reject(this.#fatalError);
    this.#pending.clear();
  }

  on(method, listener) {
    if (typeof method !== 'string' || typeof listener !== 'function') throw new Error('cdp_pipe_listener_invalid');
    const list = this.#events.get(method) || [];
    list.push(listener);
    this.#events.set(method, list);
    return () => this.#events.set(method, (this.#events.get(method) || []).filter((fn) => fn !== listener));
  }

  call(method, params = {}, { sessionId = null, timeoutMs = 15000 } = {}) {
    if (!this.#connected || this.#closed) return Promise.reject(new Error('cdp_pipe_not_connected'));
    if (this.#fatalError) return Promise.reject(this.#fatalError);
    if (typeof method !== 'string' || !method) return Promise.reject(new Error('cdp_method_invalid'));
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const payload = Buffer.concat([Buffer.from(JSON.stringify(message), 'utf8'), Buffer.from([0])]);
    if (payload.length - 1 > this.#maxFrameBytes) return Promise.reject(new Error('cdp_pipe_frame_too_large'));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`cdp_call_timeout:${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      try {
        this.#pipeWrite.write(payload, (error) => {
          if (!error) return;
          const pending = this.#pending.get(id);
          if (!pending) return;
          this.#pending.delete(id);
          pending.reject(new Error(`cdp_pipe_write_failed:${String(error?.message || error)}`));
        });
      } catch (error) {
        const pending = this.#pending.get(id);
        if (pending) {
          this.#pending.delete(id);
          pending.reject(new Error(`cdp_pipe_write_failed:${String(error?.message || error)}`));
        }
      }
    });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    const listeners = this.#listeners;
    if (listeners) {
      this.#pipeRead.off?.('data', listeners.onData);
      this.#pipeRead.off?.('end', listeners.onEnd);
      this.#pipeRead.off?.('close', listeners.onClose);
      this.#pipeRead.off?.('error', listeners.onError);
      this.#pipeWrite.off?.('error', listeners.onError);
    }
    this.#listeners = null;
    this.#failAll(new Error('cdp_pipe_client_closed'));
  }
}
