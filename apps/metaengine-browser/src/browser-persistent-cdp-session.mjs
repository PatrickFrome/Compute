export const BROWSER_PERSISTENT_CDP_SESSION_SCHEMA = 'metaengine.browser.persistent-cdp-session.v1';

const DEFAULT_PROTOCOL_VERSION = '1.3';
const clip = (value, max = 240) => String(value ?? '').slice(0, max);

function liveWebContents(webContents) {
  if (!webContents || typeof webContents !== 'object') return false;
  try { return webContents.isDestroyed?.() !== true; } catch { return false; }
}

function exactId(webContents) {
  const id = Number(webContents?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('persistent_cdp_webcontents_id_invalid');
  return id;
}

function safeCall(target, method, fallback = null) {
  try {
    if (!target || typeof target[method] !== 'function') return fallback;
    return target[method]();
  } catch {
    return fallback;
  }
}

function targetIdOf(webContents) {
  const exact = safeCall(webContents, 'getOrCreateDevToolsTargetId', null);
  return exact ? clip(exact, 160) : `webcontents:${exactId(webContents)}`;
}

function rowProjection(row) {
  return Object.freeze({
    schema: BROWSER_PERSISTENT_CDP_SESSION_SCHEMA,
    web_contents_id: row.id,
    target_id: row.targetId,
    os_pid: Number(safeCall(row.webContents, 'getOSProcessId', 0)) || null,
    attached: row.dbg?.isAttached?.() === true,
    ready: row.ready === true,
    attachment_generation: row.attachmentGeneration,
    attached_at: row.attachedAt,
    last_event_at: row.lastEventAt,
    last_detach_reason: row.lastDetachReason,
    last_error: row.lastError,
    subscriber_count: row.subscribers.size,
    domains: row.ready ? ['PAGE','DOM','ACCESSIBILITY','RUNTIME','NETWORK'] : [],
    raw_cdp_passthrough: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  });
}

export class PersistentBrowserCdpSessionPool {
  #rows = new Map();
  #protocolVersion;

  constructor({ protocolVersion = DEFAULT_PROTOCOL_VERSION } = {}) {
    this.#protocolVersion = clip(protocolVersion || DEFAULT_PROTOCOL_VERSION, 16);
  }

  #row(webContents) {
    if (!liveWebContents(webContents)) throw new Error('persistent_cdp_webcontents_unavailable');
    const id = exactId(webContents);
    const existing = this.#rows.get(id);
    if (existing?.webContents === webContents) return existing;
    if (existing) this.release(existing.webContents);

    const dbg = webContents.debugger;
    if (!dbg || typeof dbg.attach !== 'function' || typeof dbg.sendCommand !== 'function' || typeof dbg.on !== 'function') {
      throw new Error('persistent_cdp_debugger_unavailable');
    }

    const row = {
      id,
      webContents,
      dbg,
      targetId: targetIdOf(webContents),
      subscribers: new Set(),
      ensurePromise: null,
      ready: false,
      attachedByPool: false,
      attachmentGeneration: 0,
      attachedAt: null,
      lastEventAt: null,
      lastDetachReason: null,
      lastError: null,
      reattachScheduled: false,
      messageHandler: null,
      detachHandler: null,
      destroyedHandler: null,
    };

    row.messageHandler = (_event, method, params = {}, sessionId = null) => {
      row.lastEventAt = new Date().toISOString();
      const envelope = Object.freeze({
        schema: 'metaengine.browser.cdp-event.v1',
        web_contents_id: row.id,
        target_id: row.targetId,
        attachment_generation: row.attachmentGeneration,
        method: clip(method, 160),
        params,
        session_id: sessionId ? clip(sessionId, 160) : null,
        observed_at: row.lastEventAt,
        authority_effect: false,
      });
      for (const subscriber of [...row.subscribers]) {
        try { subscriber(envelope); } catch {}
      }
    };

    row.detachHandler = (_event, reason) => {
      row.ready = false;
      row.attachedByPool = false;
      row.lastDetachReason = clip(reason || 'UNKNOWN', 160);
      row.lastEventAt = new Date().toISOString();
      for (const subscriber of [...row.subscribers]) {
        try {
          subscriber(Object.freeze({
            schema: 'metaengine.browser.cdp-event.v1',
            web_contents_id: row.id,
            target_id: row.targetId,
            attachment_generation: row.attachmentGeneration,
            method: 'METAENGINE.DebuggerDetached',
            params: { reason: row.lastDetachReason },
            session_id: null,
            observed_at: row.lastEventAt,
            authority_effect: false,
          }));
        } catch {}
      }
      this.#scheduleOneReattach(row);
    };

    row.destroyedHandler = () => { this.release(webContents); };
    dbg.on('message', row.messageHandler);
    dbg.on('detach', row.detachHandler);
    webContents.once?.('destroyed', row.destroyedHandler);
    this.#rows.set(id, row);
    return row;
  }

  #scheduleOneReattach(row) {
    if (row.reattachScheduled || !liveWebContents(row.webContents)) return;
    row.reattachScheduled = true;
    setImmediate(() => {
      row.reattachScheduled = false;
      if (!liveWebContents(row.webContents) || !this.#rows.has(row.id)) return;
      void this.ensure(row.webContents).catch(() => {});
    });
  }

  async #initialize(row) {
    if (!liveWebContents(row.webContents)) throw new Error('persistent_cdp_webcontents_unavailable');
    if (!row.dbg.isAttached()) {
      row.dbg.attach(this.#protocolVersion);
      row.attachedByPool = true;
    }

    // Keep the domains hot for the lifetime of the WebContents. Required domains
    // fail closed; Network telemetry is useful but may be unavailable on some
    // Chromium targets, so only that optional enable is fail-soft.
    await row.dbg.sendCommand('Page.enable');
    await row.dbg.sendCommand('DOM.enable');
    await row.dbg.sendCommand('Accessibility.enable');
    await row.dbg.sendCommand('Runtime.enable');
    await row.dbg.sendCommand('Page.setLifecycleEventsEnabled', { enabled: true });
    await row.dbg.sendCommand('Network.enable').catch(() => null);
    await row.dbg.sendCommand('DOM.getDocument', { depth: 1, pierce: true }).catch(() => null);

    row.ready = true;
    row.attachmentGeneration += 1;
    row.attachedAt = new Date().toISOString();
    row.lastDetachReason = null;
    row.lastError = null;
    return rowProjection(row);
  }

  async ensure(webContents) {
    const row = this.#row(webContents);
    if (row.ready && row.dbg.isAttached()) return rowProjection(row);
    if (row.ensurePromise) return row.ensurePromise;
    row.ensurePromise = this.#initialize(row)
      .catch((error) => {
        row.ready = false;
        row.lastError = clip(error?.message || error, 300);
        throw error;
      })
      .finally(() => { row.ensurePromise = null; });
    return row.ensurePromise;
  }

  subscribe(webContents, listener) {
    if (typeof listener !== 'function') throw new Error('persistent_cdp_listener_required');
    const row = this.#row(webContents);
    row.subscribers.add(listener);
    return () => { row.subscribers.delete(listener); };
  }

  async send(webContents, method, params = {}, sessionId = null) {
    const name = clip(method, 160);
    if (!name || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(name)) throw new Error('persistent_cdp_method_invalid');
    const row = this.#row(webContents);
    await this.ensure(webContents);
    try {
      return await row.dbg.sendCommand(name, params ?? {}, sessionId || undefined);
    } catch (error) {
      row.lastError = clip(error?.message || error, 300);
      row.ready = row.dbg.isAttached() === true;
      throw error;
    }
  }

  release(webContents) {
    if (!webContents || typeof webContents !== 'object') return false;
    let id;
    try { id = exactId(webContents); } catch { return false; }
    const row = this.#rows.get(id);
    if (!row || row.webContents !== webContents) return false;
    this.#rows.delete(id);
    row.subscribers.clear();
    try { row.dbg.off?.('message', row.messageHandler); } catch {}
    try { row.dbg.off?.('detach', row.detachHandler); } catch {}
    try { webContents.off?.('destroyed', row.destroyedHandler); } catch {}
    if (row.attachedByPool && row.dbg.isAttached?.()) {
      try { row.dbg.detach(); } catch {}
    }
    row.ready = false;
    return true;
  }

  snapshot() {
    const sessions = [...this.#rows.values()].map(rowProjection);
    return Object.freeze({
      schema: BROWSER_PERSISTENT_CDP_SESSION_SCHEMA,
      session_count: sessions.length,
      ready_count: sessions.filter((row) => row.ready).length,
      attached_count: sessions.filter((row) => row.attached).length,
      sessions,
      attach_per_command: false,
      persistent_transport: true,
      raw_cdp_passthrough: false,
      control_authority: false,
      command_leasing: false,
      second_scheduler: false,
      authority_effect: false,
    });
  }
}

export const nativeBrowserCdpPool = new PersistentBrowserCdpSessionPool();

export async function withPersistentBrowserDebugger(webContents, fn) {
  if (typeof fn !== 'function') throw new Error('persistent_cdp_callback_required');
  await nativeBrowserCdpPool.ensure(webContents);
  const adapter = Object.freeze({
    sendCommand: (method, params = {}, sessionId = null) => nativeBrowserCdpPool.send(webContents, method, params, sessionId),
  });
  return fn(adapter);
}

export function releasePersistentBrowserDebugger(webContents) {
  return nativeBrowserCdpPool.release(webContents);
}
