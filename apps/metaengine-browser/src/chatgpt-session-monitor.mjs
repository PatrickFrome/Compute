import crypto from 'node:crypto';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';

export const CHATGPT_SESSION_MONITOR_VERSION = '1.2.0';

const CHAT_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/(?:c\/[a-z0-9-]+.*)?$/i;
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
function controls(frame) {
  return {
    stop: chatGptControlCount(frame, 'STOP'),
    continue: chatGptControlCount(frame, 'CONTINUE'),
    retry: chatGptControlCount(frame, 'RETRY'),
    send: chatGptControlCount(frame, 'SEND'),
  };
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

export class ChatGptSessionMonitor {
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
    if (!id) throw new Error('chatgpt_monitor_tab_id_required');
    if (!this.#rows.has(id)) this.#rows.set(id, newRow(id, this.#clock()));
    return this.#rows.get(id);
  }

  #thresholds(row) {
    const baseline = median(row.recent_generation_ms.slice(-12));
    const soft = Math.max(this.#softFloorMs, baseline ? baseline * 1.75 : 0);
    const hard = Math.min(this.#hardCeilingMs, Math.max(this.#hardFloorMs, baseline ? baseline * 3 : 0));
    return { soft: Math.round(soft), hard: Math.round(hard), baseline_ms: baseline == null ? null : Math.round(baseline) };
  }

  observe({ tab_id, frame, physical_health = 'HEALTHY', network_active = false, external_progress = false } = {}) {
    const now = this.#clock();
    const row = this.#row(tab_id);
    const previousState = row.state;
    const ctl = controls(frame);
    const digest = frameDigest(frame);
    const changed = row.last_digest !== null && row.last_digest !== digest;
    const url = String(frame?.url || '');
    const isChat = CHAT_RE.test(url);
    row.last_observed_at = iso(now);
    row.physical_health = String(physical_health || 'UNKNOWN').toUpperCase();
    row.controls = ctl;
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
      row.state = 'NOT_CHATGPT_CONVERSATION';
      row.terminal_ready = false;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }

    if (ctl.stop === 1) {
      if (!['GENERATING','STALLED'].includes(previousState)) {
        row.generation_epoch += 1;
        row.generation_started_at = iso(now);
        row.last_progress_at = iso(now);
        row.last_progress_source = 'GENERATION_STARTED';
        row.settle_started_at = null;
        row.recovery_attempts = 0;
      } else if (changed || row.network_active || row.external_progress) {
        row.last_progress_at = iso(now);
        row.last_progress_source = changed ? 'DOM' : row.external_progress ? 'EXTERNAL' : 'NETWORK';
      }
      const progressAge = row.last_progress_at ? now - new Date(row.last_progress_at).getTime() : 0;
      const thresholds = this.#thresholds(row);
      row.progress_age_ms = progressAge;
      row.adaptive_baseline_ms = thresholds.baseline_ms;
      row.adaptive_soft_ms = thresholds.soft;
      row.adaptive_hard_ms = thresholds.hard;
      row.soft_stall = progressAge >= thresholds.soft;
      row.hard_stall = progressAge >= thresholds.hard;
      row.state = row.hard_stall ? 'STALLED' : 'GENERATING';
      row.terminal_ready = false;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }

    if (ctl.continue === 1) {
      row.state = 'INTERRUPTED';
      row.terminal_ready = false;
      row.soft_stall = false;
      row.hard_stall = false;
      row.progress_age_ms = row.last_progress_at ? now - new Date(row.last_progress_at).getTime() : null;
      row.state_since = previousState === row.state ? row.state_since : iso(now);
      return this.get(tab_id);
    }

    if (['GENERATING','STALLED','INTERRUPTED','RECOVERING'].includes(previousState)) {
      if (!row.settle_started_at || changed) row.settle_started_at = iso(now);
      const settleAge = now - new Date(row.settle_started_at).getTime();
      row.state = settleAge >= this.#settleMs ? 'IDLE' : 'SETTLING';
      row.terminal_ready = row.state === 'IDLE';
      row.soft_stall = false;
      row.hard_stall = false;
      row.progress_age_ms = null;
      if (row.terminal_ready && row.generation_started_at) {
        const duration = now - new Date(row.generation_started_at).getTime();
        if (duration > 0 && duration < 6 * 60 * 60 * 1000) row.recent_generation_ms = [...row.recent_generation_ms, duration].slice(-12);
        row.generation_started_at = null;
      }
      const thresholds = this.#thresholds(row);
      row.adaptive_baseline_ms = thresholds.baseline_ms;
      row.adaptive_soft_ms = thresholds.soft;
      row.adaptive_hard_ms = thresholds.hard;
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
    if (row.state === 'INTERRUPTED' && row.controls.continue === 1 && row.continue_attempted_epoch !== row.generation_epoch) {
      return { action: 'CONTINUE_GENERATION', reason: 'UNIQUE_CONTINUATION_CONTROL', authority_effect: false };
    }
    if (['BROKEN','UNRESPONSIVE'].includes(row.state) && row.reload_attempted_epoch !== row.generation_epoch) {
      return { action: 'RELOAD_SAME_CONVERSATION', reason: row.state, authority_effect: false };
    }
    if (row.state === 'STALLED' && row.stop_attempted_epoch !== row.generation_epoch) {
      return { action: 'STOP_GENERATION', reason: 'ADAPTIVE_STALL_CONFIRMED', authority_effect: false };
    }
    if (['BROKEN','UNRESPONSIVE','STALLED','INTERRUPTED'].includes(row.state)) return { action: 'ESCALATE', reason: `UNRESOLVED_${row.state}`, authority_effect: false };
    return { action: 'NONE', reason: 'NO_RECOVERY_NEEDED', authority_effect: false };
  }

  markRecovery(tabId, action) {
    const row = this.#row(tabId);
    const normalized = String(action || '').toUpperCase();
    row.recovery_attempts += 1;
    row.state = 'RECOVERING';
    row.state_since = iso(this.#clock());
    if (normalized === 'CONTINUE_GENERATION') row.continue_attempted_epoch = row.generation_epoch;
    if (normalized === 'RELOAD_SAME_CONVERSATION') row.reload_attempted_epoch = row.generation_epoch;
    if (normalized === 'STOP_GENERATION') row.stop_attempted_epoch = row.generation_epoch;
    row.terminal_ready = false;
    return this.get(tabId);
  }

  get(tabId) { const row = this.#rows.get(String(tabId || '')); return row ? structuredClone(row) : null; }
  remove(tabId) { this.#rows.delete(String(tabId || '')); }
  snapshot() {
    return {
      schema: 'metaengine.chatgpt-session-monitor.snapshot.v1',
      version: CHATGPT_SESSION_MONITOR_VERSION,
      tabs: [...this.#rows.values()].map((row) => structuredClone(row)),
      persisted_response_text: false,
      authority_effect: false,
    };
  }
}
