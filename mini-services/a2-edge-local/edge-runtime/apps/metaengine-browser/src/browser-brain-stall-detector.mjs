import crypto from 'node:crypto';

export const BROWSER_BRAIN_STALL_DETECTOR_SCHEMA = 'metaengine.browser-brain.stall-detector.v1';
function hash(v) { return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function boundedInt(v, f, min, max) { const n = Number(v); return Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : f; }

export class BrowserBrainStallDetector {
  #threshold; #maxContexts; #states = new Map(); #replans = 0;
  constructor({ noProgressRounds = 3, maxContexts = 1024 } = {}) {
    this.#threshold = boundedInt(noProgressRounds, 3, 2, 16); this.#maxContexts = boundedInt(maxContexts, 1024, 16, 8192);
  }
  observe({ context_id, task_ledger, progress_ledger } = {}) {
    const contextId = String(context_id || '').toLowerCase(); if (!contextId) throw new Error('browser_brain_stall_context_required');
    const material = {
      tasks: (task_ledger?.tasks || []).map((t) => [t.task_id, t.status, t.progress_revision, t.owner_agent_id, t.blocker]),
      artifacts: [...(task_ledger?.artifact_refs || [])].sort(),
      completed: Number(progress_ledger?.completed || 0), failed: Number(progress_ledger?.failed || 0), blocked: Number(progress_ledger?.blocked || 0),
    };
    const fingerprint = hash(material);
    const prior = this.#states.get(contextId);
    const noProgress = prior && prior.fingerprint === fingerprint ? prior.noProgress + 1 : 0;
    const stalled = noProgress >= this.#threshold;
    if (stalled && !prior?.stalled) this.#replans += 1;
    if (!prior && this.#states.size >= this.#maxContexts) this.#states.delete(this.#states.keys().next().value);
    this.#states.set(contextId, { fingerprint, noProgress, stalled });
    return Object.freeze({
      context_id: contextId,
      meaningful_progress: !prior || prior.fingerprint !== fingerprint,
      no_progress_rounds: noProgress,
      threshold: this.#threshold,
      stalled,
      decision: stalled ? 'REPLAN_REQUIRED' : 'CONTINUE',
      automatic_effect_retry_allowed: false,
      user_confirmation_required: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
  snapshot() { return Object.freeze({ schema: BROWSER_BRAIN_STALL_DETECTOR_SCHEMA, context_count: this.#states.size, no_progress_round_threshold: this.#threshold, replan_count: this.#replans, automatic_effect_retry_allowed: false, execution_authority: false, authority_effect: false }); }
}
