import { clientGoalExecutionProofMatchesProgress } from './client-control-contract.mjs';
import { clientUsefulWorkProofMatchesExecution, clientUsefulWorkProofSameArtifact } from './client-useful-work-proof.mjs';

const SCHEMA = 'metaengine.client.goal-journal.v1';
const ENTRY_SCHEMA = 'metaengine.client.goal-journal-entry.v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATES = new Set([
  'SUBMITTING','ADMITTED','RECONCILE_REQUIRED',
  'READY','LEASED','RUNNING','RESULT_READY','BLOCKED',
  'COMPLETED','FAILED','AMBIGUOUS','FENCED',
]);

const clone = (value) => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();

function requestId(value) {
  const out = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(out)) throw new Error('client_goal_journal_request_id_invalid');
  return out;
}

function goalText(value) {
  if (typeof value !== 'string') throw new Error('client_goal_journal_goal_invalid');
  const out = value.trim();
  if (!out || out.length > 480) throw new Error('client_goal_journal_goal_invalid');
  return out;
}

function safeError(value) {
  return String(value?.message || value || '').slice(0, 240) || null;
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client_goal_journal_entry_invalid');
  const id = requestId(value.request_id);
  const goal = goalText(value.goal);
  const state = String(value.state || '').toUpperCase();
  if (!STATES.has(state)) throw new Error('client_goal_journal_state_invalid');
  if (value.authority_effect !== false || value.automatic_retry_allowed !== false) {
    throw new Error('client_goal_journal_authority_invalid');
  }
  const progress = value.progress && typeof value.progress === 'object' && !Array.isArray(value.progress)
    ? Object.freeze(clone(value.progress))
    : null;
  const executionProof = clientGoalExecutionProofMatchesProgress(value.execution_proof, progress)
    ? Object.freeze(clone(value.execution_proof))
    : null;
  const usefulWorkProof = clientUsefulWorkProofMatchesExecution(value.useful_work_proof, executionProof)
    ? Object.freeze(clone(value.useful_work_proof))
    : null;
  return Object.freeze({
    schema: ENTRY_SCHEMA,
    request_id: id,
    goal,
    state,
    receipt: value.receipt && typeof value.receipt === 'object' && !Array.isArray(value.receipt)
      ? Object.freeze(clone(value.receipt))
      : null,
    progress,
    execution_proof: executionProof,
    useful_work_proof: usefulWorkProof,
    last_error: value.last_error == null ? null : String(value.last_error).slice(0, 240),
    created_at: String(value.created_at || nowIso()),
    updated_at: String(value.updated_at || nowIso()),
    local_correlation_only: true,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function emptyState() {
  return Object.freeze({
    schema: SCHEMA,
    entries: Object.freeze([]),
    local_correlation_only: true,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export class ClientGoalJournal {
  #loadState;
  #saveState;
  #maxEntries;
  #state = emptyState();
  #loaded = false;
  #writeTail = Promise.resolve();

  constructor({ loadState, saveState, maxEntries = 32 } = {}) {
    if (typeof loadState !== 'function' || typeof saveState !== 'function') {
      throw new Error('client_goal_journal_storage_required');
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 128) {
      throw new Error('client_goal_journal_max_entries_invalid');
    }
    this.#loadState = loadState;
    this.#saveState = saveState;
    this.#maxEntries = maxEntries;
  }

  async load() {
    if (this.#loaded) return this.snapshot();
    let raw = null;
    try { raw = await this.#loadState(); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (raw != null) {
      if (
        !raw || typeof raw !== 'object' || Array.isArray(raw)
        || raw.schema !== SCHEMA
        || raw.authority_effect !== false
        || raw.automatic_retry_allowed !== false
        || !Array.isArray(raw.entries)
        || raw.entries.length > this.#maxEntries
      ) throw new Error('client_goal_journal_snapshot_invalid');
      const seen = new Set();
      const entries = raw.entries.map((row) => {
        const normalized = normalizeEntry(row);
        if (seen.has(normalized.request_id)) throw new Error('client_goal_journal_request_duplicate');
        seen.add(normalized.request_id);
        return normalized;
      });
      this.#state = Object.freeze({ ...emptyState(), entries: Object.freeze(entries) });
    }
    this.#loaded = true;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze(clone(this.#state));
  }

  latest() {
    return this.#state.entries.at(-1) || null;
  }

  get(rawRequestId) {
    const id = requestId(rawRequestId);
    return this.#state.entries.find((row) => row.request_id === id) || null;
  }

  #replace(id, change) {
    const write = this.#writeTail.then(async () => {
      if (!this.#loaded) await this.load();
      const existing = this.get(id);
      const next = change(existing);
      if (next === existing) return existing;
      const normalized = normalizeEntry(next);
      const entries = this.#state.entries.filter(row => row.request_id !== id);
      entries.push(normalized);
      while (entries.length > this.#maxEntries) entries.shift();
      const state = Object.freeze({ ...emptyState(), entries: Object.freeze(entries) });
      // Do not publish an in-memory state that failed to become durable.
      await this.#saveState(clone(state));
      this.#state = state;
      return normalized;
    });
    this.#writeTail = write.catch(() => {});
    return write;
  }

  async begin({ request_id, goal }) {
    if (!this.#loaded) await this.load();
    const id = requestId(request_id);
    const text = goalText(goal);
    const observed = nowIso();
    return this.#replace(id, existing => {
      if (existing && existing.goal !== text) throw new Error('client_goal_journal_request_collision');
      if (existing) return existing;
      return {
        schema: ENTRY_SCHEMA,
        request_id: id,
        goal: text,
        state: 'SUBMITTING',
        receipt: null,
        progress: null,
        execution_proof: null,
        useful_work_proof: null,
        last_error: null,
        created_at: observed,
        updated_at: observed,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordSubmission(receipt) {
    const id = requestId(receipt?.request_id);
    if (receipt?.schema !== 'metaengine.client.goal-submission.v1' || receipt?.exact_request_correlation !== true) {
      throw new Error('client_goal_journal_receipt_invalid');
    }
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      return {
        ...existing,
        state: 'ADMITTED',
        receipt: clone(receipt),
        last_error: null,
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordProgress(progress) {
    const id = requestId(progress?.request_id);
    if (progress?.schema !== 'metaengine.client.goal-progress.v1') throw new Error('client_goal_journal_progress_invalid');
    const state = progress.found === true ? String(progress.task_state || '').toUpperCase() : 'RECONCILE_REQUIRED';
    if (!STATES.has(state)) throw new Error('client_goal_journal_progress_state_invalid');
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      const executionProof = clientGoalExecutionProofMatchesProgress(existing.execution_proof, progress)
        ? existing.execution_proof : null;
      const usefulWorkProof = clientUsefulWorkProofMatchesExecution(existing.useful_work_proof, executionProof)
        ? existing.useful_work_proof : null;
      return {
        ...existing,
        state,
        progress: clone(progress),
        execution_proof: executionProof,
        useful_work_proof: usefulWorkProof,
        last_error: progress.found === true ? null : existing.last_error,
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordExecutionProof(proof) {
    const id = requestId(proof?.request_id);
    if (
      proof?.schema !== 'metaengine.client.goal-execution-proof.v1'
      || proof?.authority_effect !== false
      || proof?.automatic_retry_allowed !== false
    ) throw new Error('client_goal_journal_execution_proof_invalid');
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if (!clientGoalExecutionProofMatchesProgress(proof, existing.progress)) {
        throw new Error('client_goal_journal_execution_proof_progress_drift');
      }
      const usefulWorkProof = clientUsefulWorkProofMatchesExecution(existing.useful_work_proof, proof)
        ? existing.useful_work_proof : null;
      return {
        ...existing,
        execution_proof: clone(proof),
        useful_work_proof: usefulWorkProof,
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordUsefulWorkProof(proof) {
    const id = requestId(proof?.request_id);
    if (
      proof?.schema !== 'metaengine.client-v1.useful-work-proof.v1'
      || proof?.found !== true
      || proof?.user_goal_to_verified_artifact_readback !== true
      || proof?.authority_effect !== false
      || proof?.automatic_retry_allowed !== false
    ) throw new Error('client_goal_journal_useful_work_proof_invalid');
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if (!clientUsefulWorkProofMatchesExecution(proof, existing.execution_proof)) {
        throw new Error('client_goal_journal_useful_work_execution_drift');
      }
      if (existing.useful_work_proof) {
        if (!clientUsefulWorkProofSameArtifact(existing.useful_work_proof, proof)) {
          throw new Error('client_goal_journal_useful_work_proof_collision');
        }
        return existing;
      }
      return {
        ...existing,
        useful_work_proof: clone(proof),
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async markReconcileRequired(rawRequestId, error = null) {
    const id = requestId(rawRequestId);
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      return {
        ...existing,
        state: 'RECONCILE_REQUIRED',
        last_error: safeError(error),
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }
}

export const CLIENT_GOAL_JOURNAL_SCHEMA = SCHEMA;
