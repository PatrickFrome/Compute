export class CdpClient {
  #endpoint;
  #socket = null;
  #nextId = 1;
  #pending = new Map();
  #events = new Map();

  constructor(endpoint) { this.#endpoint = endpoint; }

  async connect(timeoutMs = 10000) {
    if (this.#socket) return this;
    if (typeof WebSocket !== 'function') throw new Error('node_websocket_unavailable');
    const socket = new WebSocket(this.#endpoint);
    this.#socket = socket;
    socket.addEventListener('message', (event) => this.#onMessage(event.data));
    socket.addEventListener('close', () => this.#failAll(new Error('cdp_socket_closed')));
    socket.addEventListener('error', () => this.#failAll(new Error('cdp_socket_error')));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp_connect_timeout')), timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp_connect_failed')); }, { once: true });
    });
    return this;
  }

  #onMessage(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (_) { return; }
    if (msg.id) {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`cdp_error:${msg.error.code}:${msg.error.message}`));
      else pending.resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      for (const listener of this.#events.get(msg.method) || []) {
        try { listener(msg.params || {}, msg.sessionId || null); } catch (_) {}
      }
    }
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  on(method, listener) {
    const list = this.#events.get(method) || [];
    list.push(listener);
    this.#events.set(method, list);
    return () => this.#events.set(method, (this.#events.get(method) || []).filter((fn) => fn !== listener));
  }

  call(method, params = {}, { sessionId = null, timeoutMs = 15000 } = {}) {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('cdp_not_connected'));
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`cdp_call_timeout:${method}`)); }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.#socket.send(JSON.stringify(message));
    });
  }

  async close() {
    if (!this.#socket) return;
    const socket = this.#socket;
    this.#socket = null;
    try { socket.close(); } catch (_) {}
    this.#failAll(new Error('cdp_client_closed'));
  }
}
