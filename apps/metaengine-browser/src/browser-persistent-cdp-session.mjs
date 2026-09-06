export const BROWSER_PERSISTENT_CDP_SESSION_SCHEMA = 'metaengine.browser.persistent-cdp-session.v1';

const DEFAULT_PROTOCOL_VERSION = '1.3';
const MAX_SUBTARGETS = 256;
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

function subtargetProjection(row) {
  return Object.freeze({
    target_id: row.targetId,
    session_id: row.sessionId,
    type: row.type,
    subtype: row.subtype,
    url: row.url,
    title: row.title,
    opener_id: row.openerId,
    browser_context_id: row.browserContextId,
    attached: row.attached === true,
    nested_auto_attach: row.nestedAutoAttach === true,
    event_count: row.eventCount,
    last_method: row.lastMethod,
    attached_at: row.attachedAt,
    last_event_at: row.lastEventAt,
    raw_event_payload_exposed: false,
    authority_effect: false,
  });
}

function rowProjection(row) {
  const subtargets = [...row.subtargets.values()].map(subtargetProjection);
  return Object.freeze({
    schema: BROWSER_PERSISTENT_CDP_SESSION_SCHEMA,
    web_contents_id: row.id,
    target_id: row.targetId,
    os_pid: Number(safeCall(row.webContents, 'getOSProcessId', 0)) || null,
    attached: row.dbg?.isAttached?.() === true,
    ready: row.ready === true,
    event_stream_capable: row.eventCapable === true,
    attachment_generation: row.attachmentGeneration,
    document_generation: row.documentGeneration,
    binding_generation: row.bindingGeneration,
    subtarget_generation: row.subtargetGeneration,
    attached_at: row.attachedAt,
    last_event_at: row.lastEventAt,
    last_detach_reason: row.lastDetachReason,
    last_error: row.lastError,
    subscriber_count: row.subscribers.size,
    domains: row.ready && row.eventCapable
      ? ['PAGE','DOM','ACCESSIBILITY','RUNTIME','NETWORK', ...(row.targetAutoAttachEnabled ? ['TARGET'] : [])]
      : [],
    target_auto_attach_enabled: row.targetAutoAttachEnabled === true,
    target_auto_attach_flatten: row.targetAutoAttachEnabled === true,
    target_wait_for_debugger_on_start: false,
    target_auto_attach_last_error: row.targetAutoAttachLastError,
    subtarget_count: subtargets.length,
    attached_subtarget_count: subtargets.filter((item) => item.attached).length,
    subtarget_capacity: MAX_SUBTARGETS,
    subtarget_overflow_count: row.subtargetOverflowCount,
    subtarget_nested_auto_attach_failures: row.subtargetNestedAutoAttachFailures,
    subtargets,
    root_document_generation_ignores_subtarget_sessions: true,
    subtarget_raw_event_payloads_exposed: false,
    raw_cdp_passthrough: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  });
}

function emitEnvelope(row, method, params = {}, sessionId = null, extra = {}) {
  row.lastEventAt = new Date().toISOString();
  const envelope = Object.freeze({
    schema: 'metaengine.browser.cdp-event.v1',
    web_contents_id: row.id,
    target_id: row.targetId,
    attachment_generation: row.attachmentGeneration,
    document_generation: row.documentGeneration,
    binding_generation: row.bindingGeneration,
    subtarget_generation: row.subtargetGeneration,
    method: clip(method, 160),
    params,
    session_id: sessionId ? clip(sessionId, 160) : null,
    root_session: !sessionId,
    observed_at: row.lastEventAt,
    ...extra,
    authority_effect: false,
  });
  for (const subscriber of [...row.subscribers]) {
    try { subscriber(envelope); } catch {}
  }
  return envelope;
}

function targetInfoProjection(info = {}) {
  return Object.freeze({
    target_id: clip(info?.targetId, 192) || null,
    type: clip(info?.type, 80) || null,
    subtype: clip(info?.subtype, 80) || null,
    url: clip(info?.url, 1200) || null,
    title: clip(info?.title, 240) || null,
    opener_id: clip(info?.openerId, 192) || null,
    browser_context_id: clip(info?.browserContextId, 192) || null,
  });
}

function upsertSubtarget(row, targetInfo = {}, sessionId = null) {
  const info = targetInfoProjection(targetInfo);
  const targetId = info.target_id;
  if (!targetId || targetId === row.targetId) return null;
  const now = new Date().toISOString();
  const prior = row.subtargets.get(targetId) || null;
  const next = {
    targetId,
    sessionId: sessionId ? clip(sessionId, 160) : (prior?.sessionId || null),
    type: info.type || prior?.type || null,
    subtype: info.subtype || prior?.subtype || null,
    url: info.url || prior?.url || null,
    title: info.title || prior?.title || null,
    openerId: info.opener_id || prior?.openerId || null,
    browserContextId: info.browser_context_id || prior?.browserContextId || null,
    attached: Boolean(sessionId || prior?.attached),
    nestedAutoAttach: prior?.nestedAutoAttach === true,
    eventCount: Number(prior?.eventCount || 0),
    lastMethod: prior?.lastMethod || null,
    attachedAt: prior?.attachedAt || (sessionId ? now : null),
    lastEventAt: now,
  };
  row.subtargets.set(targetId, next);
  if (sessionId) row.subtargetBySession.set(String(sessionId), targetId);
  row.subtargetGeneration += 1;
  while (row.subtargets.size > MAX_SUBTARGETS) {
    const oldestId = row.subtargets.keys().next().value;
    const oldest = row.subtargets.get(oldestId);
    if (oldest?.sessionId) row.subtargetBySession.delete(oldest.sessionId);
    row.subtargets.delete(oldestId);
    row.subtargetOverflowCount += 1;
  }
  return next;
}

function removeSubtarget(row, targetIdRaw = null, sessionIdRaw = null) {
  const sessionId = sessionIdRaw ? String(sessionIdRaw) : null;
  const targetId = targetIdRaw ? String(targetIdRaw) : (sessionId ? row.subtargetBySession.get(sessionId) || null : null);
  if (!targetId) return null;
  const existing = row.subtargets.get(targetId) || null;
  if (!existing) {
    if (sessionId) row.subtargetBySession.delete(sessionId);
    return null;
  }
  if (existing.sessionId) row.subtargetBySession.delete(existing.sessionId);
  row.subtargets.delete(targetId);
  row.subtargetGeneration += 1;
  return existing;
}

export class PersistentBrowserCdpSessionPool {
  #rows = new Map();
  #protocolVersion;

  constructor({ protocolVersion = DEFAULT_PROTOCOL_VERSION } = {}) {
    this.#protocolVersion = clip(protocolVersion || DEFAULT_PROTOCOL_VERSION, 16);
  }

  async #armAutoAttach(row, sessionId = null) {
    try {
      await row.dbg.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }, sessionId || undefined);
      if (!sessionId) {
        row.targetAutoAttachEnabled = true;
        row.targetAutoAttachLastError = null;
      } else {
        const targetId = row.subtargetBySession.get(String(sessionId));
        const subtarget = targetId ? row.subtargets.get(targetId) : null;
        if (subtarget) subtarget.nestedAutoAttach = true;
      }
      return true;
    } catch (error) {
      if (!sessionId) row.targetAutoAttachLastError = clip(error?.message || error, 300);
      else row.subtargetNestedAutoAttachFailures += 1;
      return false;
    }
  }

  #row(webContents) {
    if (!liveWebContents(webContents)) throw new Error('persistent_cdp_webcontents_unavailable');
    const id = exactId(webContents);
    const existing = this.#rows.get(id);
    if (existing?.webContents === webContents) return existing;
    if (existing) this.release(existing.webContents);

    const dbg = webContents.debugger;
    if (!dbg || typeof dbg.attach !== 'function' || typeof dbg.sendCommand !== 'function') {
      throw new Error('persistent_cdp_debugger_unavailable');
    }
    const eventCapable = typeof dbg.on === 'function';

    const row = {
      id,
      webContents,
      dbg,
      eventCapable,
      targetId: targetIdOf(webContents),
      subscribers: new Set(),
      ensurePromise: null,
      ready: false,
      attachedByPool: false,
      attachmentGeneration: 0,
      documentGeneration: 1,
      bindingGeneration: 0,
      subtargetGeneration: 0,
      subtargets: new Map(),
      subtargetBySession: new Map(),
      subtargetOverflowCount: 0,
      subtargetNestedAutoAttachFailures: 0,
      targetAutoAttachEnabled: false,
      targetAutoAttachLastError: null,
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
      const name = clip(method, 160);

      if (!sessionId && (name === 'DOM.documentUpdated' || (name === 'Page.frameNavigated' && !params?.frame?.parentId))) {
        row.documentGeneration += 1;
        row.bindingGeneration += 1;
      }

      if (!sessionId && name === 'Target.attachedToTarget') {
        const attachedSessionId = clip(params?.sessionId, 160);
        const subtarget = upsertSubtarget(row, params?.targetInfo || {}, attachedSessionId || null);
        if (subtarget) {
          emitEnvelope(row, 'METAENGINE.SubtargetAttached', subtargetProjection(subtarget), attachedSessionId || null, {
            subtarget_event: true,
            subtarget_target_id: subtarget.targetId,
          });
          if (attachedSessionId) void this.#armAutoAttach(row, attachedSessionId);
        }
        return;
      }

      if (!sessionId && name === 'Target.detachedFromTarget') {
        const detachedSessionId = clip(params?.sessionId, 160);
        const targetId = clip(params?.targetId, 192) || row.subtargetBySession.get(detachedSessionId) || null;
        const prior = removeSubtarget(row, targetId, detachedSessionId);
        emitEnvelope(row, 'METAENGINE.SubtargetDetached', {
          target_id: targetId,
          type: prior?.type || null,
          reason: clip(params?.reason, 160) || null,
          raw_event_payload_exposed: false,
        }, detachedSessionId || null, {
          subtarget_event: true,
          subtarget_target_id: targetId,
        });
        return;
      }

      if (!sessionId && (name === 'Target.targetCrashed' || name === 'Inspector.targetCrashed')) {
        const targetId = clip(params?.targetId, 192) || null;
        const prior = removeSubtarget(row, targetId, null);
        emitEnvelope(row, 'METAENGINE.SubtargetCrashed', {
          target_id: targetId,
          type: prior?.type || null,
          status: clip(params?.status, 120) || null,
          error_code: Number.isFinite(Number(params?.errorCode)) ? Number(params.errorCode) : null,
          raw_event_payload_exposed: false,
        }, null, {
          subtarget_event: true,
          subtarget_target_id: targetId,
        });
        return;
      }

      if (sessionId) {
        const targetId = row.subtargetBySession.get(String(sessionId)) || null;
        const subtarget = targetId ? row.subtargets.get(targetId) : null;
        if (subtarget) {
          subtarget.eventCount += 1;
          subtarget.lastMethod = name;
          subtarget.lastEventAt = new Date().toISOString();
        }
        // Subtarget payloads are intentionally not replayed into the root semantic
        // state. Their lifecycle/identity is already represented by bounded attach,
        // detach and crash envelopes above. This prevents worker/iframe DOM events
        // from invalidating the root document-generation fence or flooding cognition.
        return;
      }

      emitEnvelope(row, name, params, null);
    };

    row.detachHandler = (_event, reason) => {
      row.ready = false;
      row.attachedByPool = false;
      row.bindingGeneration += 1;
      row.subtargets.clear();
      row.subtargetBySession.clear();
      row.subtargetGeneration += 1;
      row.targetAutoAttachEnabled = false;
      row.lastDetachReason = clip(reason || 'UNKNOWN', 160);
      emitEnvelope(row, 'METAENGINE.DebuggerDetached', { reason: row.lastDetachReason });
      this.#scheduleOneReattach(row);
    };

    row.destroyedHandler = () => { this.release(webContents); };
    if (eventCapable) {
      dbg.on('message', row.messageHandler);
      dbg.on('detach', row.detachHandler);
    }
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

    if (row.eventCapable) {
      await row.dbg.sendCommand('Page.enable');
      await row.dbg.sendCommand('DOM.enable');
      await row.dbg.sendCommand('Accessibility.enable');
      await row.dbg.sendCommand('Runtime.enable');
      await row.dbg.sendCommand('Page.setLifecycleEventsEnabled', { enabled: true });
      await row.dbg.sendCommand('Network.enable').catch(() => null);
      await row.dbg.sendCommand('DOM.getDocument', { depth: 1, pierce: true }).catch(() => null);
      await this.#armAutoAttach(row);
    }

    row.targetId = targetIdOf(row.webContents);
    row.ready = true;
    row.attachmentGeneration += 1;
    row.bindingGeneration += 1;
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

  identity(webContents, { require_ready = true, require_event_stream = true } = {}) {
    if (!liveWebContents(webContents)) return null;
    let id;
    try { id = exactId(webContents); } catch { return null; }
    const row = this.#rows.get(id);
    if (!row || row.webContents !== webContents) return null;
    const projection = rowProjection(row);
    if (require_ready && (projection.ready !== true || projection.attached !== true)) return null;
    if (require_event_stream && projection.event_stream_capable !== true) return null;
    return projection;
  }

  subscribe(webContents, listener) {
    if (typeof listener !== 'function') throw new Error('persistent_cdp_listener_required');
    const row = this.#row(webContents);
    // Real Electron debugger sessions expose the CDP message stream. Lightweight
    // local/test shims may not. They can still subscribe so a successful physical
    // Input dispatch can produce one synthetic post-dispatch readback edge below;
    // no polling timer or repeated inspection loop is introduced.
    row.subscribers.add(listener);
    return () => { row.subscribers.delete(listener); };
  }

  async send(webContents, method, params = {}, sessionId = null) {
    const name = clip(method, 160);
    if (!name || !/^[A-Za-z][A-Za-z0-9_.]+$/.test(name)) throw new Error('persistent_cdp_method_invalid');
    const row = this.#row(webContents);
    await this.ensure(webContents);
    try {
      const result = await row.dbg.sendCommand(name, params ?? {}, sessionId || undefined);
      if (
        !row.eventCapable
        && name === 'Input.dispatchKeyEvent'
        && String(params?.type || '') === 'keyUp'
        && String(params?.key || '') === 'Enter'
        && row.subscribers.size > 0
      ) {
        emitEnvelope(row, 'METAENGINE.PostDispatch', {
          source_method: name,
          event_stream_capable: false,
        }, null, {
          synthetic_post_dispatch: true,
        });
      }
      return result;
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
    row.subtargets.clear();
    row.subtargetBySession.clear();
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
      event_stream_count: sessions.filter((row) => row.event_stream_capable).length,
      subtarget_count: sessions.reduce((sum, row) => sum + Number(row.subtarget_count || 0), 0),
      attached_subtarget_count: sessions.reduce((sum, row) => sum + Number(row.attached_subtarget_count || 0), 0),
      sessions,
      attach_per_command: false,
      persistent_transport: true,
      binding_generation_event_driven: true,
      document_generation_event_driven: true,
      related_chromium_subtargets_event_driven: true,
      subtarget_auto_attach_flatten: true,
      subtarget_wait_for_debugger_on_start: false,
      root_document_generation_ignores_subtarget_sessions: true,
      eventless_post_dispatch_polling_required: false,
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
    bindingIdentity: () => nativeBrowserCdpPool.identity(webContents, { require_ready: true, require_event_stream: true }),
  });
  return fn(adapter);
}

export async function persistentBrowserDebuggerBinding(webContents) {
  await nativeBrowserCdpPool.ensure(webContents);
  const identity = nativeBrowserCdpPool.identity(webContents, { require_ready: true, require_event_stream: true });
  if (!identity) throw new Error('persistent_cdp_binding_identity_unavailable');
  return identity;
}

export function releasePersistentBrowserDebugger(webContents) {
  return nativeBrowserCdpPool.release(webContents);
}
