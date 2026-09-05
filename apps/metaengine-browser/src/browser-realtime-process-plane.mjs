import { BrowserRealtimeSemanticPlane } from './browser-realtime-semantic-plane.mjs';

export const BROWSER_REALTIME_PROCESS_PLANE_SCHEMA = 'metaengine.browser.realtime-process-plane.v1';

const DEFAULT_SAMPLE_MS = 250;
const DEFAULT_EVENT_LIMIT = 512;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function text(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeCall(target, method, fallback = null) {
  try {
    if (!target || typeof target[method] !== 'function') return fallback;
    return target[method]();
  } catch {
    return fallback;
  }
}

function metricProjection(metric = {}) {
  const memory = metric.memory && typeof metric.memory === 'object' ? metric.memory : {};
  const cpu = metric.cpu && typeof metric.cpu === 'object' ? metric.cpu : {};
  const pid = Number.isSafeInteger(Number(metric.pid)) ? Number(metric.pid) : null;
  const creationTimeMs = number(metric.creationTime ?? metric.creation_time_ms);
  const processKey = pid != null && creationTimeMs != null ? `${pid}:${creationTimeMs}` : null;
  return Object.freeze({
    pid,
    creation_time_ms: creationTimeMs,
    process_key: processKey,
    process_identity_complete: processKey != null,
    type: text(metric.type, 80),
    name: text(metric.name, 160),
    service_name: text(metric.serviceName ?? metric.service_name, 160),
    cpu_percent: number(cpu.percentCPUUsage),
    cpu_idle_wakeups_per_second: number(cpu.idleWakeupsPerSecond),
    memory_working_set_kb: number(memory.workingSetSize),
    memory_peak_working_set_kb: number(memory.peakWorkingSetSize),
    memory_private_bytes_kb: number(memory.privateBytes),
    integrity_level: text(metric.integrityLevel ?? metric.integrity_level, 80),
    sandboxed: typeof metric.sandboxed === 'boolean' ? metric.sandboxed : null,
    authority_effect: false,
  });
}

function webContentsProjection(contents, resolveTabId) {
  const id = Number(contents?.id);
  const osPid = Number(safeCall(contents, 'getOSProcessId', 0));
  const destroyed = safeCall(contents, 'isDestroyed', false) === true;
  const url = destroyed ? '' : String(safeCall(contents, 'getURL', '') || '');
  const title = destroyed ? '' : String(safeCall(contents, 'getTitle', '') || '');
  let tabId = null;
  try { tabId = resolveTabId?.(Number.isSafeInteger(id) ? id : null) || null; } catch {}
  return Object.freeze({
    web_contents_id: Number.isSafeInteger(id) ? id : null,
    os_pid: Number.isSafeInteger(osPid) && osPid > 0 ? osPid : null,
    type: text(safeCall(contents, 'getType', null), 80),
    tab_id: tabId ? text(tabId, 96) : null,
    semantic_key: tabId ? text(tabId, 96) : (Number.isSafeInteger(id) ? `webcontents:${id}` : null),
    url: text(url, 1200),
    title: text(title, 240),
    destroyed,
    loading: destroyed ? false : safeCall(contents, 'isLoading', false) === true,
    loading_main_frame: destroyed ? false : safeCall(contents, 'isLoadingMainFrame', false) === true,
    crashed: destroyed ? false : safeCall(contents, 'isCrashed', false) === true,
    focused: destroyed ? false : safeCall(contents, 'isFocused', false) === true,
    audio_muted: destroyed ? null : safeCall(contents, 'isAudioMuted', null),
    currently_audible: destroyed ? null : safeCall(contents, 'isCurrentlyAudible', null),
    authority_effect: false,
  });
}

function normalizeEventDetails(details = {}) {
  const value = details && typeof details === 'object' ? details : {};
  return Object.freeze({
    web_contents_id: Number.isSafeInteger(Number(value.web_contents_id)) ? Number(value.web_contents_id) : null,
    os_pid: Number.isSafeInteger(Number(value.os_pid)) && Number(value.os_pid) > 0 ? Number(value.os_pid) : null,
    tab_id: text(value.tab_id, 96),
    target_id: text(value.target_id, 160),
    process_type: text(value.process_type ?? value.type, 80),
    reason: text(value.reason, 160),
    semantic_method: text(value.semantic_method, 160),
    semantic_sequence: Number.isSafeInteger(Number(value.semantic_sequence)) ? Number(value.semantic_sequence) : null,
    exit_code: Number.isInteger(Number(value.exit_code ?? value.exitCode)) ? Number(value.exit_code ?? value.exitCode) : null,
    service_name: text(value.service_name ?? value.serviceName, 160),
    name: text(value.name, 160),
    authority_effect: false,
  });
}

export class BrowserRealtimeProcessPlane {
  #app;
  #getWebContents;
  #resolveTabId;
  #clock;
  #sampleMs;
  #eventLimit;
  #onChange;
  #timer = null;
  #started = false;
  #sequence = 0;
  #observedAt = null;
  #processes = [];
  #webContents = [];
  #events = [];
  #droppedEvents = 0;
  #wired = new Map();
  #appListeners = [];
  #semanticPlane = null;
  #semanticStartPromise = null;
  #semanticLastError = null;

  constructor({
    app,
    getWebContents,
    resolveTabId = null,
    clock = () => Date.now(),
    sampleMs = DEFAULT_SAMPLE_MS,
    eventLimit = DEFAULT_EVENT_LIMIT,
    onChange = null,
  } = {}) {
    if (!app || typeof app.getAppMetrics !== 'function' || typeof app.on !== 'function') {
      throw new Error('browser_realtime_process_plane_app_required');
    }
    if (typeof getWebContents !== 'function') throw new Error('browser_realtime_process_plane_webcontents_required');
    if (resolveTabId != null && typeof resolveTabId !== 'function') throw new Error('browser_realtime_process_plane_tab_resolver_invalid');
    if (onChange != null && typeof onChange !== 'function') throw new Error('browser_realtime_process_plane_onchange_invalid');
    this.#app = app;
    this.#getWebContents = getWebContents;
    this.#resolveTabId = resolveTabId;
    this.#clock = clock;
    this.#sampleMs = boundedInt(sampleMs, DEFAULT_SAMPLE_MS, 50, 5000);
    this.#eventLimit = boundedInt(eventLimit, DEFAULT_EVENT_LIMIT, 32, 4096);
    this.#onChange = onChange;
  }

  #emit(type, details = {}) {
    this.#sequence += 1;
    const event = Object.freeze({
      seq: this.#sequence,
      type: text(type, 96) || 'UNKNOWN',
      observed_at: new Date(this.#clock()).toISOString(),
      ...normalizeEventDetails(details),
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

  #tabIdFor(contents) {
    try { return this.#resolveTabId?.(Number(contents?.id)) || null; } catch { return null; }
  }

  #semanticTargets() {
    let contents = [];
    try { contents = this.#getWebContents() || []; } catch {}
    return contents.slice(0, 64)
      .filter((row) => safeCall(row, 'isDestroyed', true) !== true)
      .map((row) => {
        const id = Number(row?.id);
        const tabId = this.#tabIdFor(row);
        return {
          tab_id: tabId || (Number.isSafeInteger(id) ? `webcontents:${id}` : ''),
          webContents: row,
        };
      })
      .filter((row) => row.tab_id);
  }

  #startSemanticPlane() {
    if (this.#semanticStartPromise) return this.#semanticStartPromise;
    if (!this.#semanticPlane) {
      this.#semanticPlane = new BrowserRealtimeSemanticPlane({
        getTargets: () => this.#semanticTargets(),
        eventLimit: 4096,
        onChange: (event) => {
          this.#emit('SEMANTIC_EVENT', {
            web_contents_id: event?.web_contents_id,
            tab_id: event?.tab_id,
            target_id: event?.target_id,
            semantic_method: event?.method,
            semantic_sequence: event?.seq,
          });
        },
      });
    }
    this.#semanticStartPromise = this.#semanticPlane.start()
      .then((snapshot) => {
        this.#semanticLastError = null;
        return snapshot;
      })
      .catch((error) => {
        this.#semanticLastError = text(error?.message || error, 300);
        return null;
      })
      .finally(() => { this.#semanticStartPromise = null; });
    return this.#semanticStartPromise;
  }

  #syncSemanticTargets() {
    if (!this.#semanticPlane) {
      void this.#startSemanticPlane();
      return;
    }
    void this.#semanticPlane.syncTargets().catch((error) => {
      this.#semanticLastError = text(error?.message || error, 300);
    });
  }

  #wireContents(contents) {
    const id = Number(contents?.id);
    if (!Number.isSafeInteger(id) || this.#wired.has(id) || typeof contents?.on !== 'function') return;
    const bindings = [];
    const bind = (name, handler) => {
      contents.on(name, handler);
      bindings.push([name, handler]);
    };
    const basic = () => ({
      web_contents_id: id,
      os_pid: safeCall(contents, 'getOSProcessId', null),
      tab_id: this.#tabIdFor(contents),
      process_type: safeCall(contents, 'getType', null),
    });
    bind('destroyed', () => {
      this.#emit('WEB_CONTENTS_DESTROYED', basic());
      this.#unwireContents(id);
      this.refresh('WEB_CONTENTS_DESTROYED');
    });
    bind('render-process-gone', (_event, details = {}) => {
      this.#emit('RENDER_PROCESS_GONE', { ...basic(), reason: details.reason, exit_code: details.exitCode });
      this.refresh('RENDER_PROCESS_GONE');
    });
    bind('unresponsive', () => this.#emit('WEB_CONTENTS_UNRESPONSIVE', basic()));
    bind('responsive', () => this.#emit('WEB_CONTENTS_RESPONSIVE', basic()));
    bind('did-start-loading', () => this.#emit('WEB_CONTENTS_LOADING_STARTED', basic()));
    bind('did-stop-loading', () => this.#emit('WEB_CONTENTS_LOADING_STOPPED', basic()));
    bind('focus', () => this.#emit('WEB_CONTENTS_FOCUSED', basic()));
    bind('blur', () => this.#emit('WEB_CONTENTS_BLURRED', basic()));
    this.#wired.set(id, { contents, bindings });
  }

  #unwireContents(id) {
    const row = this.#wired.get(id);
    if (!row) return;
    for (const [name, handler] of row.bindings) {
      try { row.contents.off?.(name, handler); } catch {}
    }
    this.#wired.delete(id);
  }

  refresh(reason = 'METRICS_SAMPLE') {
    let metrics = [];
    let contents = [];
    try { metrics = this.#app.getAppMetrics() || []; } catch {}
    try { contents = this.#getWebContents() || []; } catch {}
    for (const wc of contents) this.#wireContents(wc);
    this.#processes = Object.freeze(metrics.slice(0, 512).map(metricProjection));
    this.#webContents = Object.freeze(contents.slice(0, 512).map((wc) => webContentsProjection(wc, this.#resolveTabId)));
    this.#observedAt = new Date(this.#clock()).toISOString();
    if (reason !== 'METRICS_SAMPLE') {
      this.#emit('PROCESS_CENSUS_REFRESHED', { reason });
      this.#syncSemanticTargets();
    } else {
      try { this.#onChange?.(Object.freeze({ seq: this.#sequence, type: 'METRICS_SAMPLE', observed_at: this.#observedAt, authority_effect: false })); } catch {}
    }
    return this.snapshot();
  }

  start() {
    if (this.#started) return this.snapshot();
    this.#started = true;
    const bindApp = (name, handler) => {
      this.#app.on(name, handler);
      this.#appListeners.push([name, handler]);
    };
    bindApp('web-contents-created', (_event, contents) => {
      this.#wireContents(contents);
      this.#emit('WEB_CONTENTS_CREATED', {
        web_contents_id: Number(contents?.id),
        os_pid: safeCall(contents, 'getOSProcessId', null),
        tab_id: this.#tabIdFor(contents),
        process_type: safeCall(contents, 'getType', null),
      });
      this.refresh('WEB_CONTENTS_CREATED');
    });
    bindApp('child-process-gone', (_event, details = {}) => {
      this.#emit('CHILD_PROCESS_GONE', {
        process_type: details.type,
        reason: details.reason,
        exit_code: details.exitCode,
        service_name: details.serviceName,
        name: details.name,
      });
      this.refresh('CHILD_PROCESS_GONE');
    });
    bindApp('browser-window-created', () => {
      this.#emit('BROWSER_WINDOW_CREATED');
      this.refresh('BROWSER_WINDOW_CREATED');
    });
    this.refresh('START');
    void this.#startSemanticPlane();
    this.#timer = setInterval(() => this.refresh('METRICS_SAMPLE'), this.#sampleMs);
    this.#timer.unref?.();
    return this.snapshot();
  }

  stop() {
    if (!this.#started) return false;
    this.#started = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    try { this.#semanticPlane?.stop?.(); } catch {}
    this.#semanticPlane = null;
    this.#semanticStartPromise = null;
    for (const [name, handler] of this.#appListeners) {
      try { this.#app.off?.(name, handler); } catch {}
    }
    this.#appListeners = [];
    for (const id of [...this.#wired.keys()]) this.#unwireContents(id);
    return true;
  }

  eventsSince(sequence = 0, limit = 256) {
    const after = Number.isSafeInteger(Number(sequence)) ? Number(sequence) : 0;
    const bounded = boundedInt(limit, 256, 1, 1024);
    return Object.freeze(this.#events.filter((row) => row.seq > after).slice(-bounded).map((row) => ({ ...row })));
  }

  semanticSnapshot({ includeText = true, eventsSince = null, eventLimit = 128 } = {}) {
    return this.#semanticPlane?.snapshot({ includeText, eventsSince, eventLimit }) || Object.freeze({
      schema: 'metaengine.browser.realtime-semantic-plane.v1',
      running: false,
      state: this.#semanticLastError || 'STARTING',
      target_count: 0,
      targets: [],
      events: [],
      persistent_cdp_sessions: true,
      attach_per_command: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  snapshot({ eventsSince = null, eventLimit = 128 } = {}) {
    const events = eventsSince == null
      ? this.#events.slice(-boundedInt(eventLimit, 128, 0, 1024))
      : this.eventsSince(eventsSince, eventLimit);
    const byPid = new Map();
    const processKeyByPid = new Map();
    for (const processRow of this.#processes) {
      if (processRow.pid && processRow.process_key) processKeyByPid.set(processRow.pid, processRow.process_key);
    }
    for (const row of this.#webContents) {
      if (!row.os_pid) continue;
      const list = byPid.get(row.os_pid) || [];
      list.push({
        web_contents_id: row.web_contents_id,
        tab_id: row.tab_id,
        semantic_key: row.semantic_key,
        type: row.type,
        process_key: processKeyByPid.get(row.os_pid) || null,
      });
      byPid.set(row.os_pid, list);
    }
    return Object.freeze({
      schema: BROWSER_REALTIME_PROCESS_PLANE_SCHEMA,
      running: this.#started,
      sequence: this.#sequence,
      observed_at: this.#observedAt,
      sample_interval_ms: this.#sampleMs,
      process_count: this.#processes.length,
      web_contents_count: this.#webContents.length,
      processes: this.#processes.map((row) => ({ ...row, web_contents: byPid.get(row.pid) || [] })),
      web_contents: this.#webContents.map((row) => ({
        ...row,
        process_key: row.os_pid ? processKeyByPid.get(row.os_pid) || null : null,
      })),
      semantic_plane: this.semanticSnapshot({ includeText: false, eventLimit: 64 }),
      semantic_plane_last_error: this.#semanticLastError,
      events: events.map((row) => ({ ...row })),
      dropped_events: this.#droppedEvents,
      event_driven_lifecycle: true,
      periodic_resource_sampling: true,
      process_metrics_source: 'ELECTRON_APP_GET_APP_METRICS',
      process_identity_source: 'ELECTRON_PROCESS_METRIC_PID_PLUS_CREATION_TIME',
      process_identity_pid_reuse_safe: true,
      renderer_identity_source: 'ELECTRON_WEB_CONTENTS_OS_PID_PLUS_PROCESS_METRIC_CREATION_TIME',
      semantic_source: 'PERSISTENT_CDP_PAGE_DOM_ACCESSIBILITY_RUNTIME_NETWORK',
      persistent_cdp_sessions: true,
      cdp_attach_per_command: false,
      page_content_exposed: false,
      semantic_page_text_available_on_explicit_read: true,
      control_authority: false,
      command_leasing: false,
      second_scheduler: false,
      authority_effect: false,
    });
  }
}
