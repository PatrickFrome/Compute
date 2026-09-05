const clip = (value, max = 240) => String(value ?? '').slice(0, max);
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clone = (value) => value == null ? value : structuredClone(value);

function normalizeProcessMetric(metric = {}) {
  const cpu = metric?.cpu && typeof metric.cpu === 'object' ? metric.cpu : {};
  const memory = metric?.memory && typeof metric.memory === 'object' ? metric.memory : {};
  return Object.freeze({
    pid: finite(metric?.pid),
    type: clip(metric?.type || 'Unknown', 80),
    creation_time_ms: finite(metric?.creationTime),
    cpu: Object.freeze({
      percent_cpu_usage: finite(cpu?.percentCPUUsage),
      idle_wakeups_per_second: finite(cpu?.idleWakeupsPerSecond),
    }),
    memory: Object.freeze({
      working_set_kb: finite(memory?.workingSetSize),
      peak_working_set_kb: finite(memory?.peakWorkingSetSize),
      private_bytes_kb: finite(memory?.privateBytes),
      shared_bytes_kb: finite(memory?.sharedBytes),
    }),
    sandboxed: metric?.sandboxed === true,
    integrity_level: metric?.integrityLevel ? clip(metric.integrityLevel, 80) : null,
  });
}

function normalizeWebContents(contents) {
  const destroyed = contents?.isDestroyed?.() === true;
  const safeCall = (fn, fallback = null) => {
    if (destroyed || typeof fn !== 'function') return fallback;
    try { return fn(); } catch { return fallback; }
  };
  return Object.freeze({
    webcontents_id: finite(contents?.id),
    type: clip(safeCall(contents?.getType?.bind(contents), 'unknown'), 80),
    url: clip(safeCall(contents?.getURL?.bind(contents), ''), 1200),
    title: clip(safeCall(contents?.getTitle?.bind(contents), ''), 240),
    loading: safeCall(contents?.isLoading?.bind(contents), false) === true,
    loading_main_frame: safeCall(contents?.isLoadingMainFrame?.bind(contents), false) === true,
    waiting_for_response: safeCall(contents?.isWaitingForResponse?.bind(contents), false) === true,
    destroyed,
  });
}

export class BrowserLiveProcessPlane {
  #getAppMetrics;
  #getWebContents;
  #now;
  #maxEvents;
  #sequence = 0;
  #events = [];
  #current = null;

  constructor({ getAppMetrics, getWebContents, now = () => new Date(), maxEvents = 256 } = {}) {
    if (typeof getAppMetrics !== 'function') throw new Error('browser_live_process_metrics_provider_required');
    if (typeof getWebContents !== 'function') throw new Error('browser_live_webcontents_provider_required');
    if (typeof now !== 'function') throw new Error('browser_live_clock_required');
    this.#getAppMetrics = getAppMetrics;
    this.#getWebContents = getWebContents;
    this.#now = now;
    this.#maxEvents = Math.max(32, Math.min(2048, Number(maxEvents) || 256));
  }

  #timestamp() {
    const value = this.#now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  #pushEvent(kind, details = {}) {
    const event = Object.freeze({
      sequence: ++this.#sequence,
      kind: clip(String(kind || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_'), 80),
      observed_at: this.#timestamp(),
      details: details && typeof details === 'object' ? clone(details) : {},
      page_data_authority: false,
      control_authority: false,
      authority_effect: false,
    });
    this.#events.push(event);
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents);
    return event;
  }

  record(kind, details = {}) {
    return this.#pushEvent(kind, details);
  }

  refresh(reason = 'REFRESH') {
    const processes = (this.#getAppMetrics() || [])
      .map(normalizeProcessMetric)
      .sort((a, b) => Number(a.pid || 0) - Number(b.pid || 0));
    const contents = (this.#getWebContents() || [])
      .map(normalizeWebContents)
      .sort((a, b) => Number(a.webcontents_id || 0) - Number(b.webcontents_id || 0));
    const event = this.#pushEvent('CENSUS_REFRESH', {
      reason: clip(reason, 80),
      process_count: processes.length,
      webcontents_count: contents.length,
    });
    this.#current = Object.freeze({
      schema: 'metaengine.browser.live-process-plane.v1',
      sequence: event.sequence,
      observed_at: event.observed_at,
      process_count: processes.length,
      webcontents_count: contents.length,
      processes,
      webcontents: contents,
      event_driven: true,
      polling_loop: false,
      page_body_exposed: false,
      command_authority: false,
      scheduler_authority: false,
      authority_effect: false,
    });
    return this.snapshot();
  }

  snapshot({ eventLimit = 64 } = {}) {
    const limit = Math.max(0, Math.min(this.#maxEvents, Number(eventLimit) || 0));
    const base = this.#current || Object.freeze({
      schema: 'metaengine.browser.live-process-plane.v1',
      sequence: this.#sequence,
      observed_at: null,
      process_count: 0,
      webcontents_count: 0,
      processes: [],
      webcontents: [],
      event_driven: true,
      polling_loop: false,
      page_body_exposed: false,
      command_authority: false,
      scheduler_authority: false,
      authority_effect: false,
    });
    return Object.freeze({
      ...clone(base),
      events: limit ? clone(this.#events.slice(-limit)) : [],
      event_buffer_size: this.#events.length,
    });
  }
}

export function bindBrowserLiveProcessPlaneEvents({ app, webContentsModule, plane } = {}) {
  if (!app || typeof app.on !== 'function') throw new Error('browser_live_process_app_required');
  if (!webContentsModule || typeof webContentsModule.getAllWebContents !== 'function') throw new Error('browser_live_process_webcontents_module_required');
  if (!plane || typeof plane.record !== 'function' || typeof plane.refresh !== 'function') throw new Error('browser_live_process_plane_required');
  const observed = new Set();
  const wire = (contents) => {
    const id = Number(contents?.id || 0);
    if (!Number.isSafeInteger(id) || id < 1 || observed.has(id)) return;
    observed.add(id);
    plane.record('WEB_CONTENTS_CREATED', { webcontents_id: id, type: contents?.getType?.() || null });
    const refresh = (kind, details = {}) => {
      plane.record(kind, { webcontents_id: id, ...details });
      plane.refresh(kind);
    };
    contents.on?.('did-start-loading', () => refresh('WEB_CONTENTS_LOADING'));
    contents.on?.('did-stop-loading', () => refresh('WEB_CONTENTS_LOADED'));
    contents.on?.('did-navigate', (_event, url) => refresh('WEB_CONTENTS_NAVIGATED', { url: clip(url, 1200) }));
    contents.on?.('did-navigate-in-page', (_event, url) => refresh('WEB_CONTENTS_NAVIGATED_IN_PAGE', { url: clip(url, 1200) }));
    contents.on?.('page-title-updated', (_event, title) => refresh('WEB_CONTENTS_TITLE', { title: clip(title, 240) }));
    contents.on?.('render-process-gone', (_event, details = {}) => refresh('RENDER_PROCESS_GONE', {
      reason: clip(details?.reason, 80),
      exit_code: finite(details?.exitCode),
    }));
    contents.on?.('destroyed', () => {
      observed.delete(id);
      refresh('WEB_CONTENTS_DESTROYED');
    });
  };
  for (const contents of webContentsModule.getAllWebContents()) wire(contents);
  app.on('web-contents-created', (_event, contents) => {
    wire(contents);
    plane.refresh('WEB_CONTENTS_CREATED');
  });
  app.on('child-process-gone', (_event, details = {}) => {
    plane.record('CHILD_PROCESS_GONE', {
      type: clip(details?.type, 80),
      reason: clip(details?.reason, 80),
      exit_code: finite(details?.exitCode),
      service_name: details?.serviceName ? clip(details.serviceName, 120) : null,
      name: details?.name ? clip(details.name, 120) : null,
    });
    plane.refresh('CHILD_PROCESS_GONE');
  });
  plane.refresh('EVENT_BINDING_READY');
  return Object.freeze({
    event_driven: true,
    polling_loop: false,
    command_authority: false,
    authority_effect: false,
  });
}
