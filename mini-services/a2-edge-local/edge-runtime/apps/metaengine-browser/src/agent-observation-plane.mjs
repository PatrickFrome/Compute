// Agent observation plane — bounded real-time telemetry for every browser
// process surface (2026-09-19 operator directive: browser, supervisors and
// agents must see absolutely all browser processes in real time and act with
// maximum variability).
//
// Borrowed mechanics (2026 agent-browser landscape research):
//   - Playwright MCP exposes console log monitoring and per-tab network
//     observation as first-class read-only tools; METAENGINE had only
//     aggregate counters, so this plane adds bounded per-tab ring buffers.
//   - Agent observability best practice (Laminar/Langfuse-class tooling):
//     one structured trace covering processes, tool usage and decision
//     signals; SYSTEM_TELEMETRY is that single-trace read lane.
//
// Security contract: read-only, bounded, metadata-only. Console messages are
// clipped, network rows carry method/status/timing but no request or response
// bodies, and nothing here grants authority of any kind.

export const AGENT_OBSERVATION_PLANE_SCHEMA = 'metaengine.browser.agent-observation-plane.v1';
export const AGENT_OBSERVATION_PLANE_VERSION = '1.0.0';

const MAX_CONSOLE_PER_TAB = 64;
const MAX_NETWORK_PER_TAB = 64;
const MAX_HEALTH_PER_TAB = 16;
const MAX_MESSAGE_CHARS = 500;
const MAX_URL_CHARS = 300;
const MAX_TABS_IN_SUMMARY = 40;

function nowIso() { return new Date().toISOString(); }
function clip(value, max) { return String(value ?? '').slice(0, max); }

function ringPush(rows, entry, cap) {
  rows.push(entry);
  if (rows.length > cap) rows.splice(0, rows.length - cap);
}

function normalizeLevel(level) {
  const value = String(level ?? '').toLowerCase();
  if (['error', 'warning', 'info', 'debug', 'verbose', 'log'].includes(value)) return value === 'verbose' ? 'debug' : value;
  const numeric = Number(level);
  if (numeric === 3) return 'error';
  if (numeric === 2) return 'warning';
  if (numeric === 1) return 'info';
  if (numeric === 0) return 'verbose';
  return 'info';
}

export class AgentObservationPlane {
  #clock;
  #tabs = new Map(); // webContentsId -> {console, network, health, seq}

  constructor({ clock = () => Date.now() } = {}) {
    this.#clock = clock;
  }

  #record(webContentsId) {
    const id = Number(webContentsId || 0);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!this.#tabs.has(id)) {
      this.#tabs.set(id, { console: [], network: [], health: [], seq: 0 });
    }
    return this.#tabs.get(id);
  }

  // Wire one remote view. Safe to call repeatedly; listeners live on the
  // webContents so they die with the renderer binding.
  observe(webContents) {
    if (!webContents || typeof webContents.isDestroyed !== 'function') return;
    const record = this.#record(webContents.id);
    if (!record) return;
    if (record.wired) return;
    record.wired = true;
    try {
      webContents.on('console-message', (event, level, message, line, sourceId) => {
        if (webContents.isDestroyed()) return;
        const row = this.#record(webContents.id);
        if (!row) return;
        row.seq += 1;
        ringPush(row.console, {
          seq: row.seq,
          level: normalizeLevel(level ?? event?.level),
          message: clip(message ?? event?.message, MAX_MESSAGE_CHARS),
          line: Number.isSafeInteger(Number(line)) ? Number(line) : null,
          source: clip(sourceId ?? event?.sourceId, 200) || null,
          at: nowIso(),
        }, MAX_CONSOLE_PER_TAB);
      });
    } catch { /* console-message unavailable on this Electron */ }
    try {
      webContents.on('render-process-gone', (event, details) => {
        if (webContents.isDestroyed()) return;
        const row = this.#record(webContents.id);
        if (!row) return;
        row.seq += 1;
        ringPush(row.health, {
          seq: row.seq,
          kind: 'RENDER_PROCESS_GONE',
          reason: clip(details?.reason, 120) || 'UNKNOWN',
          exit_code: Number.isSafeInteger(Number(details?.exitCode)) ? Number(details.exitCode) : null,
          at: nowIso(),
        }, MAX_HEALTH_PER_TAB);
      });
      webContents.on('unresponsive', () => {
        if (webContents.isDestroyed()) return;
        const row = this.#record(webContents.id);
        if (!row) return;
        row.seq += 1;
        ringPush(row.health, { seq: row.seq, kind: 'UNRESPONSIVE', at: nowIso() }, MAX_HEALTH_PER_TAB);
      });
      webContents.on('responsive', () => {
        if (webContents.isDestroyed()) return;
        const row = this.#record(webContents.id);
        if (!row) return;
        row.seq += 1;
        ringPush(row.health, { seq: row.seq, kind: 'RESPONSIVE', at: nowIso() }, MAX_HEALTH_PER_TAB);
      });
    } catch { /* health events unavailable */ }
    try {
      webContents.once('destroyed', () => { this.#tabs.delete(webContents.id); });
    } catch { /* ignore */ }
  }

  // Fed by the tab network activity registry on request completion.
  recordNetwork(webContentsId, { method, url, resource_type, status, duration_ms, error }) {
    const row = this.#record(webContentsId);
    if (!row) return;
    row.seq += 1;
    ringPush(row.network, {
      seq: row.seq,
      method: clip(method, 16) || null,
      url: clip(url, MAX_URL_CHARS),
      resource_type: clip(resource_type, 24) || null,
      status: Number.isSafeInteger(Number(status)) ? Number(status) : null,
      duration_ms: Number.isFinite(Number(duration_ms)) ? Math.max(0, Math.round(Number(duration_ms))) : null,
      error: error === true,
      at: nowIso(),
    }, MAX_NETWORK_PER_TAB);
  }

  forget(webContentsId) {
    this.#tabs.delete(Number(webContentsId || 0));
  }

  telemetryFor(webContentsId, { console_limit = 32, network_limit = 32 } = {}) {
    const id = Number(webContentsId || 0);
    const row = this.#tabs.get(id);
    const consoleLimit = Math.max(0, Math.min(MAX_CONSOLE_PER_TAB, Number(console_limit) || 32));
    const networkLimit = Math.max(0, Math.min(MAX_NETWORK_PER_TAB, Number(network_limit) || 32));
    return Object.freeze({
      schema: AGENT_OBSERVATION_PLANE_SCHEMA,
      version: AGENT_OBSERVATION_PLANE_VERSION,
      webcontents_id: id,
      observed: row != null,
      console_count: row ? row.console.length : 0,
      network_count: row ? row.network.length : 0,
      health_count: row ? row.health.length : 0,
      console: row ? structuredClone(row.console.slice(-consoleLimit)) : [],
      network: row ? structuredClone(row.network.slice(-networkLimit)) : [],
      health: row ? structuredClone(row.health) : [],
      page_content_exposed: false,
      authority_effect: false,
    });
  }

  // Single-trace system digest: every process surface the browser can see.
  // Built from the supervisor state projection (already authority-free and
  // transport-bounded) plus this plane's per-tab summaries.
  systemTelemetry(state = {}) {
    const tabs = Array.isArray(state?.tabs) ? state.tabs.slice(0, MAX_TABS_IN_SUMMARY) : [];
    const fleet = state?.fleet || {};
    const lifecycle = state?.supervisor_lifecycle || {};
    const keepalive = lifecycle?.keepalive || {};
    const devos = lifecycle?.devos_runtime || {};
    const control = state?.control_latency || {};
    const fastLane = control?.fast_lane || {};
    const realtime = state?.realtime_process_plane || {};
    const events = Array.isArray(realtime?.events) ? realtime.events : [];
    const perTab = tabs.map((tab) => {
      const id = Number(String(tab?.tab_id || '').length ? null : 0);
      void id;
      const row = this.#tabs.get(Number(tab?.webcontents_id || 0));
      return {
        tab_id: String(tab?.tab_id || ''),
        kind: clip(tab?.kind, 32) || null,
        role: clip(tab?.role, 16) || null,
        url: clip(tab?.url, 160) || null,
        selected: tab?.selected === true,
        console_errors: row ? row.console.filter((entry) => entry.level === 'error').length : null,
        network_recent: row ? row.network.length : null,
        health_events: row ? row.health.length : null,
      };
    });
    return Object.freeze({
      schema: AGENT_OBSERVATION_PLANE_SCHEMA,
      version: AGENT_OBSERVATION_PLANE_VERSION,
      generated_at: nowIso(),
      shell_version: clip(state?.shell_version, 64) || null,
      started_at: clip(state?.started_at, 64) || null,
      heartbeat_at: clip(state?.heartbeat_at, 64) || null,
      tabs: {
        total: tabs.length,
        census: state?.tab_census || null,
        per_tab: perTab,
      },
      fleet: {
        counts: fleet?.counts || null,
        desired_agents: fleet?.policy?.desired_agents ?? null,
        lifecycle_owner: clip(fleet?.lifecycle_owner, 64) || null,
      },
      supervisor: {
        keepalive_state: clip(keepalive?.state, 32) || null,
        keepalive_cycle_seq: Number.isSafeInteger(Number(keepalive?.cycle_seq)) ? Number(keepalive.cycle_seq) : null,
        admission_state: clip(keepalive?.admission_state, 16) || null,
        conversation_url: keepalive?.conversation_url ? 'BOUND' : null,
        last_error: clip(lifecycle?.last_error, 200) || null,
      },
      devos: {
        execution_mode: clip(devos?.execution_mode, 48) || null,
        admission_state: clip(devos?.admission?.runtime_control_state, 16) || null,
        actuation_allowed: devos?.admission?.actuation_allowed === true,
        idle_in_flight: devos?.idle?.in_flight === true,
        idle_last_at: clip(devos?.idle?.last_at, 64) || null,
        idle_last_error: clip(devos?.idle?.last_error, 200) || null,
      },
      control: {
        pressure_band: clip(fastLane?.scheduler?.pressure_band, 16) || null,
        maintenance_in_flight: fastLane?.maintenance_in_flight === true,
        last_wait_batch_elapsed_ms: Number.isFinite(Number(fastLane?.last_wait_batch_elapsed_ms)) ? Number(fastLane.last_wait_batch_elapsed_ms) : null,
      },
      realtime_plane: {
        running: realtime?.running === true,
        sequence: Number.isSafeInteger(Number(realtime?.sequence)) ? Number(realtime.sequence) : null,
        observed_at: clip(realtime?.observed_at, 64) || null,
        recent_event_types: [...new Set(events.slice(-40).map((event) => clip(event?.semantic_method || event?.type, 48)).filter(Boolean))].slice(0, 12),
      },
      page_content_exposed: false,
      authority_effect: false,
    });
  }

  // Bounded textual digest for agent task prompts (supervisors and fleet
  // agents see the full browser process state with every task).
  promptDigest(state = {}, { max_chars = 1600 } = {}) {
    const t = this.systemTelemetry(state);
    const lines = [
      'SYSTEM TELEMETRY (live browser process digest)',
      `shell=${t.shell_version || 'unknown'} heartbeat=${t.heartbeat_at || 'none'}`,
      `tabs=${t.tabs.total} fleet=${JSON.stringify(t.tabs.census || {})}`,
      `fleet_agents=${JSON.stringify(t.fleet.counts || {})} desired=${t.fleet.desired_agents ?? 'auto'}`,
      `supervisor=${t.supervisor.keepalive_state || 'unknown'} cycle=${t.supervisor.keepalive_cycle_seq ?? '?'} admission=${t.supervisor.admission_state || '?'} conv=${t.supervisor.conversation_url || 'unbound'}`,
      `devos=${t.devos.execution_mode || '?'} admission=${t.devos.admission_state || '?'} actuation=${t.devos.actuation_allowed}`,
      `control_band=${t.control.pressure_band || '?'} maintenance=${t.control.maintenance_in_flight}`,
      `realtime_plane=${t.realtime_plane.running ? 'running' : 'stopped'} seq=${t.realtime_plane.sequence ?? '?'} events=${(t.realtime_plane.recent_event_types || []).join(',') || 'none'}`,
      'per_tab (id|kind|role|sel|console_errors|net|health):',
      ...t.tabs.per_tab.slice(0, 12).map((row) => `  ${row.tab_id.slice(0, 18)}|${row.kind || '?'}|${row.role || '?'}|${row.selected ? 'Y' : 'n'}|${row.console_errors ?? '-'}|${row.network_recent ?? '-'}|${row.health_events ?? '-'}`),
    ];
    if (t.supervisor.last_error) lines.push(`supervisor_last_error=${t.supervisor.last_error}`);
    if (t.devos.idle_last_error) lines.push(`devos_last_error=${t.devos.idle_last_error}`);
    const text = lines.join('\n');
    return text.slice(0, Math.max(200, Number(max_chars) || 1600));
  }
}
