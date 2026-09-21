import crypto from 'node:crypto';

// GLM agent-platform session monitor.
//
// chat.z.ai exposes no named STOP/CONTINUE/SEND controls (live recon
// 2026-09-19), so the ChatGPT control-counting state machine cannot observe a
// GLM conversation. This monitor keeps the exact same public contract
// (observe / get / remove / snapshot / nextRecovery / markRecovery) and the
// same row shape, but drives GENERATING from semantic-frame digest churn:
//
//   - the caller marks a generation started right after a proven Enter submit
//     (markGenerationStarted) — the only authoritative entry signal;
//   - while GENERATING, every digest change / network activity / external
//     progress refreshes last_progress_at (adaptive soft/hard stall floors
//     unchanged from the ChatGPT monitor);
//   - a quiet settle window (settleMs) after the last progress flips the row to
//     IDLE with terminal_ready — the wake machinery's completion signal;
//   - recovery is ESCALATE-only: navigation-class recovery stays forbidden
//     (2026-09-17 P0) and STOP needs an exact semantic_ref button the monitor
//     cannot resolve on chat.z.ai, so a hard stall escalates to the operator.

export const AGENT_SESSION_MONITOR_VERSION = '1.0.0';
export const AGENT_SESSION_MONITOR_SCHEMA = 'metaengine.agent-session-monitor.snapshot.v1';

const PLATFORM_CHAT_RE = /^https:\/\/chat\.z\.ai\/(?:c\/[a-z0-9-]+.*)?$/i;
const PHYSICAL_BROKEN = new Set(['RENDERER_GONE','LOAD_FAILED']);

function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }
function iso(ms) { return new Date(ms).toISOString(); }
function clip(value, max = 160) { return String(value ?? '').slice(0, max); }
function median(values) {
  if (!values.length) return null;
  const rows = [...values].sort((a, b) => a - b);
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
}

function frameDigest(frame) {
  const targetShape = (frame?.semantic_targets || []).slice(0, 160).map((row) => `${clip(row?.role, 32)}:${clip(row?.name, 180)}`).sort();
  return sha256(JSON.stringify({
    url: clip(frame?.url, 1200),
    title: clip(frame?.title, 240),
    text: clip(frame?.text_excerpt, 12000),
    targets: targetShape,
  }));
}

function newRow(tabId, now) {
  return {
    tab_id: String(tabId),
    state: 'UNKNOWN',
    state_since: iso(now),
    generation_epoch: 0,
    generation_started_at: null,
    last_progress_at: null,
    last_progress_source: null,
    settle_started_at: null,
    last_digest: null,
    recent_generation_ms: [],
    recovery_attempts: 0,
    continue_attempted_epoch: null,
    reload_attempted_epoch: null,
    stop_attempted_epoch: null,
    physical_health: 'UNKNOWN',
    controls: { stop: 0, continue: 0, retry: 0, send: 0 },
    progress_age_ms: null,
    adaptive_baseline_ms: null,
    adaptive_soft_ms: null,
    adaptive_hard_ms: null,
    network_active: false,
    external_progress: false,
    soft_stall: false,
    hard_stall: false,
    terminal_ready: false,
    last_observed_at: iso(now),
    authority_effect: false,
  };
}

export class AgentSessionMonitor {
  #clock; #rows = new Map(); #settleMs; #softFloorMs; #hardFloorMs; #hardCeilingMs; #maxRecoveryAttempts;

  constructor({
    clock = () => Date.now(),
    settleMs = 5000,
    softStallFloorMs = 90_000,
    hardStallFloorMs = 4 * 60_000,
    hardStallCeilingMs = 15 * 60_000,
    maxRecoveryAttempts = 3,
  } = {}) {
    this.#clock = clock;
    this.#settleMs = Math.max(1500, Number(settleMs) || 5000);
    this.#softFloorMs = Math.max(30_000, Number(softStallFloorMs) || 90_000);
    this.#hardFloorMs = Math.max(this.#softFloorMs * 2, Number(hardStallFloorMs) || 4 * 60_000);
    this.#hardCeilingMs = Math.max(this.#hardFloorMs, Number(hardStallCeilingMs) || 15 * 60_000);
    this.#maxRecoveryAttempts = Math.max(1, Number(maxRecoveryAttempts) || 3);
  }

  #row(tabId) {
    const id = String(tabId || '');
    if (!id) throw new Error('agent_monitor_tab_id_required');
    if (!this.#rows.has(id)) this.#rows.set(id, newRow(id, this.#clock()));
    return this.#rows.get(id);
  }

  #thresholds(row) {
    const baseline = median(row.recent_generation_ms.slice(-12));
    const soft = Math.max(this.#softFloorMs, baseline ? baseline * 1.75 : 0);
    const hard = Math.min(this.#hardCeilingMs, Math.max(this.#hardFloorMs, baseline ? baseline * 3 : 0));
    return { soft: Math.round(soft), hard: Math.round(hard), baseline_ms: baseline == null ? null : Math.round(baseline) };
  }

  #touch(row, now, source) {
    row.last_progress_at = iso(now);
    row.last_progress_source = source;
    row.settle_started_at = null;
  }

  // The only authoritative GENERATING entry: the caller proves an Enter submit
  // through the native control contract before marking.
  markGenerationStarted(tabId) {
    const now = this.#clock();
    const row = this.#row(tabId);
    row.generation_epoch += 1;
    row.generation_started_at = iso(now);
    row.state = 'GENERATING';
    this.#touch(row, now, 'GENERATION_STARTED');
    row.recovery_attempts = 0;
    row.terminal_ready = false;
    row.state_since = iso(now);
    return this.get(tabId);
  }

  observe({ tab_id, frame, physical_health = 'HEALTHY', network_active = false, external_progress = false } = {}) {
    const now = this.#clock();
    const row = this.#row(tab_id);
    const previousState = row.state;
    const digest = frameDigest(frame);
    const changed = row.last_digest !== null && row.last_digest !== digest;
    const url = String(frame?.url || '');
    const isChat = PLATFORM_CHAT_RE.test(url);
    row.last_observed_at = iso(now);
    row.physical_health = String(physical_health || 'UNKNOWN').toUpperCase();
    row.last_digest = digest;
    row.network_active = network_active === true;
    row.external_progress = external_progress === true;

    if (row.physical_health === 'UNRESPONSIVE') {
      row.state = 'UNRESPONSIVE';
      row.terminal_ready = false;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }
    if (PHYSICAL_BROKEN.has(row.physical_health)) {
      row.state = 'BROKEN';
      row.terminal_ready = false;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }
    if (!isChat) {
      row.state = 'NOT_AGENT_PLATFORM_CONVERSATION';
      row.terminal_ready = false;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }

    if (['GENERATING','STALLED'].includes(row.state)) {
      if (changed || row.network_active || row.external_progress) {
        this.#touch(row, now, changed ? 'DOM' : row.external_progress ? 'EXTERNAL' : 'NETWORK');
        if (row.state === 'STALLED') row.state = 'GENERATING';
      }
      const progressAge = row.last_progress_at ? now - new Date(row.last_progress_at).getTime() : 0;
      const thresholds = this.#thresholds(row);
      row.progress_age_ms = progressAge;
      row.adaptive_baseline_ms = thresholds.baseline_ms;
      row.adaptive_soft_ms = thresholds.soft;
      row.adaptive_hard_ms = thresholds.hard;
      row.soft_stall = progressAge >= thresholds.soft;
      row.hard_stall = progressAge >= thresholds.hard;
      if (row.hard_stall) {
        row.state = 'STALLED';
        row.terminal_ready = false;
        row.state_since = previousState === row.state ? row.state_since : iso(now);
        return this.get(tab_id);
      }
      if (!row.settle_started_at) row.settle_started_at = iso(now);
      const settleAge = now - new Date(row.settle_started_at).getTime();
      if (settleAge >= this.#settleMs) {
        row.state = 'IDLE';
        row.terminal_ready = true;
        row.soft_stall = false;
        row.hard_stall = false;
        row.progress_age_ms = null;
        if (row.generation_started_at) {
          const duration = now - new Date(row.generation_started_at).getTime();
          if (duration > 0 && duration < 6 * 60 * 60 * 1000) row.recent_generation_ms = [...row.recent_generation_ms, duration].slice(-12);
          row.generation_started_at = null;
        }
      } else {
        row.state = 'GENERATING';
        row.terminal_ready = false;
      }
      const thresholdsAfter = this.#thresholds(row);
      row.adaptive_baseline_ms = thresholdsAfter.baseline_ms;
      row.adaptive_soft_ms = thresholdsAfter.soft;
      row.adaptive_hard_ms = thresholdsAfter.hard;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }

    row.state = 'IDLE';
    row.terminal_ready = true;
    row.soft_stall = false;
    row.hard_stall = false;
    row.progress_age_ms = null;
    const thresholds = this.#thresholds(row);
    row.adaptive_baseline_ms = thresholds.baseline_ms;
    row.adaptive_soft_ms = thresholds.soft;
    row.adaptive_hard_ms = thresholds.hard;
    row.state_since = previousState === row.state ? row.state_since : iso(now);
    return this.get(tab_id);
  }

  nextRecovery(tabId) {
    const row = this.#row(tabId);
    if (row.recovery_attempts >= this.#maxRecoveryAttempts) return { action: 'ESCALATE', reason: 'RECOVERY_BUDGET_EXHAUSTED', authority_effect: false };
    // v1 (2026-09-19): chat.z.ai exposes no named continuation control and no
    // addressable stop control (unnamed buttons stay hidden from semantic
    // targets), so every GLM recovery path escalates to the operator instead
    // of actuating. Navigation-class recovery remains forbidden.
    if (['BROKEN','UNRESPONSIVE','STALLED','INTERRUPTED'].includes(row.state)) {
      return { action: 'ESCALATE', reason: `GLM_UNRESOLVED_${row.state}`, authority_effect: false };
    }
    return { action: 'NONE', reason: 'NO_RECOVERY_NEEDED', authority_effect: false };
  }

  markRecovery(tabId, action) {
    const row = this.#row(tabId);
    const normalized = String(action || '').toUpperCase();
    row.recovery_attempts += 1;
    row.state = 'RECOVERING';
    row.state_since = iso(this.#clock());
    if (normalized === 'CONTINUE_GENERATION') row.continue_attempted_epoch = row.generation_epoch;
    if (normalized === 'STOP_GENERATION') row.stop_attempted_epoch = row.generation_epoch;
    row.terminal_ready = false;
    return this.get(tabId);
  }

  get(tabId) { const row = this.#rows.get(String(tabId || '')); return row ? structuredClone(row) : null; }
  remove(tabId) { this.#rows.delete(String(tabId || '')); }
  snapshot() {
    return {
      schema: AGENT_SESSION_MONITOR_SCHEMA,
      version: AGENT_SESSION_MONITOR_VERSION,
      generation_signal: 'SEMANTIC_FRAME_DIGEST_CHURN',
      named_control_signals: false,
      tabs: [...this.#rows.values()].map((row) => structuredClone(row)),
      persisted_response_text: false,
      authority_effect: false,
    };
  }
}
