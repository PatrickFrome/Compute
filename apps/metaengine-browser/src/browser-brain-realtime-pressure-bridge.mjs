export const BROWSER_BRAIN_REALTIME_PRESSURE_BRIDGE_SCHEMA = 'metaengine.browser.brain-realtime-pressure-bridge.v1';

const CRASH_WINDOW_MS = 30_000;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function processType(row = {}) {
  return String(row.type || '').trim().toLowerCase();
}

function isRenderer(row = {}) {
  const type = processType(row);
  return type === 'tab' || type === 'renderer' || type.includes('renderer');
}

function isMain(row = {}) {
  const type = processType(row);
  return type === 'browser' || type === 'main';
}

function cellKey(value = {}) {
  if (value.tab_id) return `tab:${String(value.tab_id)}`;
  if (Number.isSafeInteger(Number(value.web_contents_id))) return `wc:${Number(value.web_contents_id)}`;
  return null;
}

function boundedLiveCells(snapshot = {}) {
  const explicit = finite(snapshot.semantic_plane?.target_count);
  if (explicit != null && explicit > 0) return Math.max(1, Math.min(512, Math.trunc(explicit)));
  const live = Array.isArray(snapshot.web_contents)
    ? snapshot.web_contents.filter((row) => row && row.destroyed !== true).length
    : 0;
  return Math.max(1, Math.min(512, live || 1));
}

export function projectRealtimeProcessPressure(snapshot = {}, extraSample = {}) {
  const processes = Array.isArray(snapshot.processes) ? snapshot.processes : [];
  const renderers = processes.filter(isRenderer);
  const main = processes.find(isMain) || null;
  const rendererCpu = renderers.map((row) => finite(row.cpu_percent)).filter((value) => value != null);
  const mainWorkingSetKb = finite(main?.memory_working_set_kb);

  return Object.freeze({
    ...extraSample,
    observed_at: snapshot.observed_at || extraSample.observed_at || null,
    live_cells: boundedLiveCells(snapshot),
    max_renderer_cpu_percent: rendererCpu.length ? Math.max(...rendererCpu) : null,
    main_working_set_mb: mainWorkingSetKb == null ? null : mainWorkingSetKb / 1024,
    process_plane_sequence: Number.isSafeInteger(Number(snapshot.sequence)) ? Number(snapshot.sequence) : null,
    process_plane_running: snapshot.running === true,
    authority_effect: false,
  });
}

export class BrowserBrainRealtimePressureBridge {
  #adaptiveRuntime;
  #clock;
  #getExtraSample;
  #unresponsive = new Set();
  #crashes = [];
  #lastSequence = -1;
  #lastProjection = null;

  constructor({ adaptiveRuntime, clock = () => Date.now(), getExtraSample = null } = {}) {
    if (!adaptiveRuntime || typeof adaptiveRuntime.observePressure !== 'function') {
      throw new Error('browser_brain_realtime_pressure_bridge_runtime_required');
    }
    if (typeof clock !== 'function') throw new Error('browser_brain_realtime_pressure_bridge_clock_required');
    if (getExtraSample != null && typeof getExtraSample !== 'function') {
      throw new Error('browser_brain_realtime_pressure_bridge_extra_sample_invalid');
    }
    this.#adaptiveRuntime = adaptiveRuntime;
    this.#clock = clock;
    this.#getExtraSample = getExtraSample;
  }

  #observeLifecycle(events = []) {
    for (const event of events) {
      const seq = Number(event?.seq);
      if (!Number.isSafeInteger(seq) || seq <= this.#lastSequence) continue;
      this.#lastSequence = seq;
      const key = cellKey(event);
      if (event.type === 'WEB_CONTENTS_UNRESPONSIVE' && key) this.#unresponsive.add(key);
      if ((event.type === 'WEB_CONTENTS_RESPONSIVE' || event.type === 'WEB_CONTENTS_DESTROYED') && key) {
        this.#unresponsive.delete(key);
      }
      if (event.type === 'RENDER_PROCESS_GONE' || event.type === 'CHILD_PROCESS_GONE') {
        const at = Date.parse(event.observed_at || '') || this.#clock();
        this.#crashes.push(at);
        if (key) this.#unresponsive.delete(key);
      }
    }
    const cutoff = this.#clock() - CRASH_WINDOW_MS;
    this.#crashes = this.#crashes.filter((at) => at >= cutoff);
  }

  observe(snapshot = {}) {
    if (!snapshot || snapshot.schema !== 'metaengine.browser.realtime-process-plane.v1') {
      throw new Error('browser_brain_realtime_pressure_bridge_snapshot_invalid');
    }
    this.#observeLifecycle(Array.isArray(snapshot.events) ? snapshot.events : []);
    const extra = this.#getExtraSample ? (this.#getExtraSample(snapshot) || {}) : {};
    const projection = projectRealtimeProcessPressure(snapshot, {
      ...extra,
      unresponsive_cells: this.#unresponsive.size,
      recent_crashes: this.#crashes.length,
    });
    const budget = this.#adaptiveRuntime.observePressure(projection);
    this.#lastProjection = projection;
    return Object.freeze({
      schema: BROWSER_BRAIN_REALTIME_PRESSURE_BRIDGE_SCHEMA,
      projection,
      budget,
      event_driven: true,
      reuses_process_plane_sampler: true,
      dedicated_timer: false,
      second_scheduler: false,
      command_leasing: false,
      execution_authority: false,
      automatic_effect_retry: false,
      authority_effect: false,
    });
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_REALTIME_PRESSURE_BRIDGE_SCHEMA,
      last_projection: this.#lastProjection,
      unresponsive_cells: this.#unresponsive.size,
      recent_crashes: this.#crashes.length,
      last_process_sequence: this.#lastSequence,
      event_driven: true,
      dedicated_timer: false,
      second_scheduler: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}
