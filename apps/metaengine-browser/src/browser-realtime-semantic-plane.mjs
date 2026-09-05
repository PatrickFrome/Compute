import { nativeBrowserCdpPool } from './browser-persistent-cdp-session.mjs';

export const BROWSER_REALTIME_SEMANTIC_PLANE_SCHEMA = 'metaengine.browser.realtime-semantic-plane.v1';

const SAFE_ROLES = new Set(['textbox','searchbox','combobox','button','checkbox','radio','switch','tab','menuitem','link']);
const TEXT_INPUT_ROLES = new Set(['textbox','searchbox','combobox']);
const DEFAULT_EVENT_LIMIT = 2048;
const MAX_TARGETS = 64;

const clip = (value, max = 240) => String(value ?? '').slice(0, max);
const axRawValue = (node, key) => String(node?.[key]?.value ?? '');
const axValue = (node, key) => axRawValue(node, key).trim();

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeCall(target, method, fallback = null) {
  try {
    if (!target || typeof target[method] !== 'function') return fallback;
    return target[method]();
  } catch {
    return fallback;
  }
}

function uniqueSemanticTargets(nodes = []) {
  const candidates = [];
  const counts = new Map();
  for (const node of nodes) {
    if (node?.ignored === true) continue;
    const role = axValue(node, 'role').toLowerCase();
    const name = axValue(node, 'name');
    const backendNodeId = Number(node?.backendDOMNodeId || 0);
    if (!SAFE_ROLES.has(role) || !name || !Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
    const key = `${role}\u0000${name}`;
    counts.set(key, Number(counts.get(key) || 0) + 1);
    const row = { role, name: clip(name, 240), backend_node_id: backendNodeId };
    if (TEXT_INPUT_ROLES.has(role)) {
      const value = axRawValue(node, 'value');
      row.value_length = value.length;
      row.value_exposed = false;
    }
    candidates.push(row);
  }
  return candidates.filter((row) => counts.get(`${row.role}\u0000${row.name}`) === 1).slice(0, 160);
}

function textExcerpt(nodes = []) {
  const parts = [];
  let size = 0;
  for (const node of nodes) {
    if (node?.ignored === true) continue;
    const role = axValue(node, 'role').toLowerCase();
    const name = axValue(node, 'name');
    if (!name || !['statictext','heading','paragraph','listitem','article','status','alert'].includes(role)) continue;
    parts.push(name);
    size += name.length + 1;
    if (size >= 12000) break;
  }
  return clip(parts.join('\n'), 12000);
}

function viewportProjection(metrics) {
  const viewport = metrics?.cssVisualViewport || metrics?.visualViewport || null;
  if (!viewport) return null;
  return Object.freeze({
    width: Number(viewport.clientWidth || viewport.width || 0),
    height: Number(viewport.clientHeight || viewport.height || 0),
    page_x: Number(viewport.pageX || 0),
    page_y: Number(viewport.pageY || 0),
    scale: Number(viewport.scale || 1),
  });
}

function targetIdOf(webContents) {
  const exact = safeCall(webContents, 'getOrCreateDevToolsTargetId', null);
  return exact ? clip(exact, 160) : `webcontents:${Number(webContents?.id) || 0}`;
}

function eventDetails(method, params = {}) {
  const detail = { method: clip(method, 160) };
  if (method === 'Page.frameNavigated') {
    detail.url = clip(params?.frame?.url, 1200);
    detail.frame_id = clip(params?.frame?.id, 160);
  } else if (method === 'Page.navigatedWithinDocument') {
    detail.url = clip(params?.url, 1200);
    detail.frame_id = clip(params?.frameId, 160);
  } else if (method === 'Page.lifecycleEvent') {
    detail.lifecycle = clip(params?.name, 120);
    detail.frame_id = clip(params?.frameId, 160);
  } else if (method === 'Network.requestWillBeSent') {
    detail.request_id = clip(params?.requestId, 160);
    detail.url = clip(params?.request?.url, 1200);
    detail.http_method = clip(params?.request?.method, 24);
    detail.resource_type = clip(params?.type, 80);
  } else if (method === 'Network.responseReceived') {
    detail.request_id = clip(params?.requestId, 160);
    detail.url = clip(params?.response?.url, 1200);
    detail.status = Number(params?.response?.status || 0) || null;
    detail.mime_type = clip(params?.response?.mimeType, 120);
  } else if (method === 'Network.webSocketCreated') {
    detail.request_id = clip(params?.requestId, 160);
    detail.url = clip(params?.url, 1200);
  } else if (method === 'Network.loadingFailed') {
    detail.request_id = clip(params?.requestId, 160);
    detail.reason = clip(params?.errorText, 240);
  } else if (method === 'Runtime.executionContextCreated') {
    detail.context_id = Number(params?.context?.id || 0) || null;
    detail.origin = clip(params?.context?.origin, 600);
    detail.name = clip(params?.context?.name, 160);
  } else if (method === 'Runtime.executionContextDestroyed') {
    detail.context_id = Number(params?.executionContextId || 0) || null;
  } else if (method === 'Accessibility.nodesUpdated') {
    detail.node_count = Array.isArray(params?.nodes) ? params.nodes.length : 0;
  } else if (method.startsWith('DOM.')) {
    detail.node_id = Number(params?.nodeId || params?.parentNodeId || 0) || null;
  } else if (method === 'METAENGINE.DebuggerDetached') {
    detail.reason = clip(params?.reason, 160);
  }
  return detail;
}

export class BrowserRealtimeSemanticPlane {
  #getTargets;
  #pool;
  #clock;
  #eventLimit;
  #onChange;
  #rows = new Map();
  #events = [];
  #sequence = 0;
  #droppedEvents = 0;
  #started = false;

  constructor({ getTargets, pool = nativeBrowserCdpPool, clock = () => Date.now(), eventLimit = DEFAULT_EVENT_LIMIT, onChange = null } = {}) {
    if (typeof getTargets !== 'function') throw new Error('realtime_semantic_targets_provider_required');
    if (!pool || typeof pool.ensure !== 'function' || typeof pool.send !== 'function' || typeof pool.subscribe !== 'function') {
      throw new Error('realtime_semantic_cdp_pool_required');
    }
    if (onChange != null && typeof onChange !== 'function') throw new Error('realtime_semantic_onchange_invalid');
    this.#getTargets = getTargets;
    this.#pool = pool;
    this.#clock = clock;
    this.#eventLimit = boundedInt(eventLimit, DEFAULT_EVENT_LIMIT, 64, 8192);
    this.#onChange = onChange;
  }

  #emit(row, method, params = {}) {
    this.#sequence += 1;
    const event = Object.freeze({
      schema: 'metaengine.browser.semantic-event.v1',
      seq: this.#sequence,
      tab_id: row?.tabId || null,
      web_contents_id: row?.webContentsId || null,
      target_id: row?.targetId || null,
      observed_at: new Date(this.#clock()).toISOString(),
      ...eventDetails(method, params),
      raw_params_exposed: false,
      authority_effect: false,
    });
    this.#events.push(event);
    if (this.#events.length > this.#eventLimit) {
      const drop = this.#events.length - this.#eventLimit;
      this.#events.splice(0, drop);
      this.#droppedEvents += drop;
    }
    try { this.#onChange?.(event); } catch {}
    return event;
  }

  #projectNodes(row) {
    const nodes = [...row.nodes.values()];
    row.semanticTargets = uniqueSemanticTargets(nodes);
    row.textExcerpt = textExcerpt(nodes);
    row.semanticRevision += 1;
  }

  #scheduleRefresh(row) {
    row.dirty = true;
    if (row.refreshScheduled || !this.#rows.has(row.tabId)) return;
    row.refreshScheduled = true;
    setImmediate(() => {
      row.refreshScheduled = false;
      if (!this.#rows.has(row.tabId)) return;
      void this.#refreshRow(row).catch(() => {});
    });
  }

  #handleEvent(row, envelope) {
    if (!this.#rows.has(row.tabId)) return;
    const method = String(envelope?.method || '');
    const params = envelope?.params && typeof envelope.params === 'object' ? envelope.params : {};
    row.lastEventAt = envelope?.observed_at || new Date(this.#clock()).toISOString();

    if (method === 'Accessibility.nodesUpdated' && Array.isArray(params.nodes)) {
      for (const node of params.nodes) {
        const nodeId = String(node?.nodeId || '');
        if (nodeId) row.nodes.set(nodeId, node);
      }
      this.#projectNodes(row);
      row.dirty = false;
    } else if (method === 'Accessibility.loadComplete') {
      this.#scheduleRefresh(row);
    } else if (method === 'DOM.documentUpdated') {
      row.documentGeneration += 1;
      row.nodes.clear();
      row.semanticTargets = [];
      row.textExcerpt = '';
      this.#scheduleRefresh(row);
    } else if (method.startsWith('DOM.')) {
      this.#scheduleRefresh(row);
    } else if (method === 'Page.frameNavigated' || method === 'Page.navigatedWithinDocument') {
      const url = method === 'Page.frameNavigated' ? params?.frame?.url : params?.url;
      if (url) row.url = clip(url, 1200);
      this.#scheduleRefresh(row);
    }

    if (method === 'Runtime.executionContextCreated') {
      const contextId = Number(params?.context?.id || 0);
      if (contextId) row.runtimeContexts.add(contextId);
    } else if (method === 'Runtime.executionContextDestroyed') {
      row.runtimeContexts.delete(Number(params?.executionContextId || 0));
    } else if (method === 'Runtime.executionContextsCleared') {
      row.runtimeContexts.clear();
    }

    if (method === 'Network.requestWillBeSent') {
      const requestId = String(params?.requestId || '');
      if (requestId) row.networkInflight.add(requestId);
      row.networkRequests += 1;
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      row.networkInflight.delete(String(params?.requestId || ''));
    } else if (method === 'Network.webSocketCreated') {
      const requestId = String(params?.requestId || '');
      if (requestId) row.webSockets.add(requestId);
    } else if (method === 'Network.webSocketClosed') {
      row.webSockets.delete(String(params?.requestId || ''));
    }

    if (method === 'METAENGINE.DebuggerDetached') {
      row.cdpReady = false;
      row.lastError = `CDP_DETACHED:${clip(params?.reason, 160)}`;
      this.#scheduleRefresh(row);
    }

    this.#emit(row, method, params);
  }

  async #refreshRow(row) {
    if (row.refreshPromise) {
      row.refreshPending = true;
      return row.refreshPromise;
    }
    row.refreshPromise = (async () => {
      const [tree, metrics] = await Promise.all([
        this.#pool.send(row.webContents, 'Accessibility.getFullAXTree'),
        this.#pool.send(row.webContents, 'Page.getLayoutMetrics').catch(() => null),
      ]);
      row.nodes.clear();
      for (const node of Array.isArray(tree?.nodes) ? tree.nodes : []) {
        const nodeId = String(node?.nodeId || '');
        if (nodeId) row.nodes.set(nodeId, node);
      }
      this.#projectNodes(row);
      row.viewport = viewportProjection(metrics);
      row.url = clip(safeCall(row.webContents, 'getURL', row.url || ''), 1200);
      row.title = clip(safeCall(row.webContents, 'getTitle', row.title || ''), 240);
      row.osPid = Number(safeCall(row.webContents, 'getOSProcessId', 0)) || null;
      row.refreshedAt = new Date(this.#clock()).toISOString();
      row.lastError = null;
      row.dirty = false;
      row.cdpReady = true;
      return this.#targetProjection(row, true);
    })().catch((error) => {
      row.lastError = clip(error?.message || error, 300);
      row.dirty = true;
      throw error;
    }).finally(() => {
      row.refreshPromise = null;
      if (row.refreshPending) {
        row.refreshPending = false;
        this.#scheduleRefresh(row);
      }
    });
    return row.refreshPromise;
  }

  #targetProjection(row, includeText) {
    return Object.freeze({
      tab_id: row.tabId,
      web_contents_id: row.webContentsId,
      target_id: row.targetId,
      os_pid: row.osPid,
      url: row.url,
      title: row.title,
      cdp_ready: row.cdpReady,
      document_generation: row.documentGeneration,
      semantic_revision: row.semanticRevision,
      semantic_targets: row.semanticTargets.map((item) => ({ ...item })),
      text_excerpt: includeText ? row.textExcerpt : null,
      text_excerpt_available: Boolean(row.textExcerpt),
      viewport: row.viewport ? { ...row.viewport } : null,
      dirty: row.dirty,
      refresh_in_flight: row.refreshPromise != null,
      runtime_context_count: row.runtimeContexts.size,
      network_requests_observed: row.networkRequests,
      network_inflight_count: row.networkInflight.size,
      websocket_count: row.webSockets.size,
      last_event_at: row.lastEventAt,
      refreshed_at: row.refreshedAt,
      last_error: row.lastError,
      input_values_exposed: false,
      raw_cdp_exposed: false,
      authority_effect: false,
    });
  }

  async attach(tabIdRaw, webContents) {
    const tabId = String(tabIdRaw || '').trim();
    if (!tabId) throw new Error('realtime_semantic_tab_id_required');
    if (!webContents || safeCall(webContents, 'isDestroyed', true) === true) throw new Error('realtime_semantic_webcontents_unavailable');
    const webContentsId = Number(webContents.id);
    if (!Number.isSafeInteger(webContentsId) || webContentsId < 1) throw new Error('realtime_semantic_webcontents_id_invalid');

    const existing = this.#rows.get(tabId);
    if (existing?.webContents === webContents) return this.#targetProjection(existing, true);
    if (existing) this.detach(tabId);

    const row = {
      tabId,
      webContents,
      webContentsId,
      targetId: targetIdOf(webContents),
      osPid: Number(safeCall(webContents, 'getOSProcessId', 0)) || null,
      url: clip(safeCall(webContents, 'getURL', ''), 1200),
      title: clip(safeCall(webContents, 'getTitle', ''), 240),
      nodes: new Map(),
      semanticTargets: [],
      textExcerpt: '',
      viewport: null,
      documentGeneration: 1,
      semanticRevision: 0,
      runtimeContexts: new Set(),
      networkInflight: new Set(),
      networkRequests: 0,
      webSockets: new Set(),
      lastEventAt: null,
      refreshedAt: null,
      lastError: null,
      dirty: true,
      cdpReady: false,
      refreshPromise: null,
      refreshPending: false,
      refreshScheduled: false,
      unsubscribe: null,
    };
    this.#rows.set(tabId, row);
    row.unsubscribe = this.#pool.subscribe(webContents, (event) => this.#handleEvent(row, event));
    try {
      await this.#pool.ensure(webContents);
      row.cdpReady = true;
      await this.#refreshRow(row);
      this.#emit(row, 'METAENGINE.TargetAttached', {});
      return this.#targetProjection(row, true);
    } catch (error) {
      row.lastError = clip(error?.message || error, 300);
      row.cdpReady = false;
      throw error;
    }
  }

  detach(tabIdRaw) {
    const tabId = String(tabIdRaw || '').trim();
    const row = this.#rows.get(tabId);
    if (!row) return false;
    this.#rows.delete(tabId);
    try { row.unsubscribe?.(); } catch {}
    this.#pool.release(row.webContents);
    this.#emit(row, 'METAENGINE.TargetDetached', {});
    return true;
  }

  async syncTargets() {
    let targets = [];
    try { targets = this.#getTargets() || []; } catch { targets = []; }
    const normalized = targets.slice(0, MAX_TARGETS)
      .map((row) => ({ tabId: String(row?.tab_id || row?.tabId || '').trim(), webContents: row?.webContents || row?.web_contents || null }))
      .filter((row) => row.tabId && row.webContents && safeCall(row.webContents, 'isDestroyed', true) !== true);
    const desired = new Set(normalized.map((row) => row.tabId));
    for (const tabId of [...this.#rows.keys()]) if (!desired.has(tabId)) this.detach(tabId);
    await Promise.allSettled(normalized.map((row) => this.attach(row.tabId, row.webContents)));
    return this.snapshot({ includeText: false, eventLimit: 0 });
  }

  async start() {
    if (this.#started) return this.snapshot({ includeText: false, eventLimit: 0 });
    this.#started = true;
    await this.syncTargets();
    return this.snapshot({ includeText: false, eventLimit: 0 });
  }

  stop() {
    if (!this.#started) return false;
    this.#started = false;
    for (const tabId of [...this.#rows.keys()]) this.detach(tabId);
    return true;
  }

  async refreshTab(tabIdRaw) {
    const tabId = String(tabIdRaw || '').trim();
    let row = this.#rows.get(tabId);
    if (!row) {
      await this.syncTargets();
      row = this.#rows.get(tabId);
    }
    if (!row) throw new Error('realtime_semantic_tab_not_found');
    return this.#refreshRow(row);
  }

  target(tabIdRaw, { includeText = true } = {}) {
    const row = this.#rows.get(String(tabIdRaw || '').trim());
    return row ? this.#targetProjection(row, includeText === true) : null;
  }

  eventsSince(sequence = 0, limit = 256) {
    const after = boundedInt(sequence, 0, 0, Number.MAX_SAFE_INTEGER);
    const bounded = boundedInt(limit, 256, 1, 1024);
    return Object.freeze(this.#events.filter((row) => row.seq > after).slice(-bounded).map((row) => ({ ...row })));
  }

  snapshot({ includeText = false, eventsSince = null, eventLimit = 128 } = {}) {
    const events = eventsSince == null
      ? this.#events.slice(-boundedInt(eventLimit, 128, 0, 1024))
      : this.eventsSince(eventsSince, eventLimit);
    const targets = [...this.#rows.values()].map((row) => this.#targetProjection(row, includeText === true));
    return Object.freeze({
      schema: BROWSER_REALTIME_SEMANTIC_PLANE_SCHEMA,
      running: this.#started,
      sequence: this.#sequence,
      target_count: targets.length,
      ready_count: targets.filter((row) => row.cdp_ready).length,
      dirty_count: targets.filter((row) => row.dirty).length,
      targets,
      events,
      dropped_events: this.#droppedEvents,
      event_driven: true,
      persistent_cdp_sessions: true,
      attach_per_command: false,
      refresh_coalescing: 'ONE_IN_FLIGHT_PLUS_ONE_PENDING_NO_TIMER',
      page_text_available: true,
      input_values_exposed: false,
      secrets_extracted: false,
      raw_cdp_passthrough: false,
      control_authority: false,
      command_leasing: false,
      second_scheduler: false,
      authority_effect: false,
    });
  }
}
