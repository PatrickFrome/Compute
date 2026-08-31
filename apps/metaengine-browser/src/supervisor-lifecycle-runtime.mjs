import { SupervisorLifecycleRuntime as CoreSupervisorLifecycleRuntime } from './supervisor-lifecycle-runtime-core.mjs';
import { chatGptControlMatches } from './chatgpt-ui-controls.mjs';

const TERMINAL = new Set(['LOST', 'RETIRED', 'PROVISIONING_AMBIGUOUS']);
const clone = (value) => value == null ? value : structuredClone(value);
function generating(frame) {
  return Boolean(frame?.semantic_targets?.some((x) => x?.role === 'button' && chatGptControlMatches('STOP', x?.name)));
}
function rotate(rows, offset) {
  if (!rows.length) return [];
  const start = Math.abs(Number(offset) || 0) % rows.length;
  return [...rows.slice(start), ...rows.slice(0, start)];
}

/**
 * Compatibility wrapper around the exact GREEN continuity core. It bounds only
 * lifecycle-observation CAPTURE effects; all send/retry/retirement semantics
 * remain inside the already-tested core runtime.
 */
export class SupervisorLifecycleRuntime {
  #core; #execute; #workerTabs = new Set(); #allowedWorkerCaptures = new Set();
  #frameCache = new Map(); #cursor = 0; #budget; #lastPlan = null;
  #lastProgressSignature = null; #lastProgressAt = Date.now(); #watchdogMs;
  #watchdogKicks = 0; #kicking = false;

  constructor(options = {}) {
    if (typeof options.getState !== 'function' || typeof options.executeCommand !== 'function') {
      throw new Error('supervisor_lifecycle_dependencies_required');
    }
    this.#execute = options.executeCommand;
    this.#budget = Math.max(1, Math.min(16, Number(options.workerObservationBudget) || 4));
    this.#watchdogMs = Math.max(60_000, Number(options.progressWatchdogMs) || 90_000);

    const wrappedGetState = async () => {
      const state = await options.getState();
      this.#planWorkerCaptures(state);
      return state;
    };
    const wrappedExecute = async (command) => this.#executeBounded(command);
    this.#core = new CoreSupervisorLifecycleRuntime({ ...options, getState: wrappedGetState, executeCommand: wrappedExecute });
  }

  #planWorkerCaptures(state) {
    const liveTabs = (state?.fleet?.agents || [])
      .filter((a) => a?.tab_id && !TERMINAL.has(String(a?.lifecycle_state || '').toUpperCase()))
      .map((a) => String(a.tab_id));
    this.#workerTabs = new Set(liveTabs);
    const hot = liveTabs.filter((id) => generating(this.#frameCache.get(id)));
    const cold = liveTabs.filter((id) => !hot.includes(id));
    const ordered = [...rotate(hot, this.#cursor), ...rotate(cold, this.#cursor)];
    this.#allowedWorkerCaptures = new Set(ordered.slice(0, this.#budget));
    this.#cursor = liveTabs.length ? (this.#cursor + this.#budget) % liveTabs.length : 0;
    this.#lastPlan = {
      fleet_size: liveTabs.length,
      actual_capture_budget: this.#budget,
      selected_tabs: [...this.#allowedWorkerCaptures],
      cached_tabs: [...this.#frameCache.keys()].filter((id) => this.#workerTabs.has(id)).length,
      authority_effect: false,
    };
  }

  async #executeBounded(command) {
    if (command?.action !== 'CAPTURE') return this.#execute(command);
    const tabId = String(command?.payload?.tab_id || '');
    if (!this.#workerTabs.has(tabId)) return this.#execute(command);
    if (this.#allowedWorkerCaptures.has(tabId)) {
      const frame = await this.#execute(command);
      this.#frameCache.set(tabId, clone(frame));
      return frame;
    }
    if (this.#frameCache.has(tabId)) return clone(this.#frameCache.get(tabId));
    throw new Error('supervisor_worker_capture_budget_deferred');
  }

  #progress(snapshot) {
    const ks = snapshot?.keepalive || {};
    const signature = JSON.stringify([
      Number(ks.cycle_seq || 0),
      String(ks.last_completed_cycle_at || ''),
      String(ks.active_wake?.wake_id || ''),
      String(ks.pending_wake?.wake_id || ''),
      String(snapshot?.supervisor_generation || ''),
    ]);
    const now = Date.now();
    if (signature !== this.#lastProgressSignature) {
      this.#lastProgressSignature = signature;
      this.#lastProgressAt = now;
    }
    const blockedState = ['WAKE_AMBIGUOUS','ROLLOVER_REQUIRED','ROLLOVER_AMBIGUOUS','RECOVERING'].includes(String(ks.state || ''));
    const safeKick = snapshot?.supervisor_generation === 'IDLE'
      && Array.isArray(ks.queued_wakes) && ks.queued_wakes.length > 0
      && !ks.active_wake && !ks.pending_wake && !blockedState
      && now - this.#lastProgressAt >= this.#watchdogMs;
    return { safeKick, age_ms: Math.max(0, now - this.#lastProgressAt) };
  }

  snapshot() {
    const base = this.#core.snapshot();
    const progress = this.#progress(base);
    return {
      ...base,
      continuous_service: {
        ...(base?.continuous_service || {}),
        worker_capture_budget: this.#budget,
        worker_observation_mode: 'BOUNDED_PRIORITY_ROUND_ROBIN_CACHE_V1',
        progress_watchdog_ms: this.#watchdogMs,
      },
      worker_observation: clone(this.#lastPlan),
      progress_watchdog: {
        state: progress.safeKick ? 'DEADLINE' : 'HEALTHY',
        progress_age_ms: progress.age_ms,
        kicks: this.#watchdogKicks,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
    };
  }

  isQuiescent() { return this.#core.isQuiescent(); }

  async start() {
    await this.#core.start();
    return this.snapshot();
  }

  async cycle(args = {}) {
    await this.#core.cycle(args);
    let snap = this.snapshot();
    if (snap.progress_watchdog?.state === 'DEADLINE' && !this.#kicking) {
      // A watchdog kick is only a forced observation/reconciliation pass. The
      // core still owns canWake(), ambiguity fences and the sole Send effect.
      this.#kicking = true;
      try {
        this.#watchdogKicks += 1;
        await this.#core.cycle({ force: true });
        this.#lastProgressAt = Date.now();
      } finally {
        this.#kicking = false;
      }
      snap = this.snapshot();
    }
    return snap;
  }
}
