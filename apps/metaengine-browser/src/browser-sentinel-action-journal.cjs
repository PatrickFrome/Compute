'use strict';

const fs = require('node:fs/promises');
const { durableWriteJson } = require('./durable-json-file.cjs');

const SENTINEL_ACTION_JOURNAL_SCHEMA = 'metaengine.browser-sentinel.action-journal.v1';
const SENTINEL_ACTION_JOURNAL_VERSION = '1.0.0';
const TERMINATION_STATES = new Set(['PARENT_TERMINATION_INTENT','PARENT_TERMINATION_CONFIRMED','PARENT_TERMINATION_AMBIGUOUS']);
const RELAUNCH_STATES = new Set(['RELAUNCH_INTENT','RELAUNCH_DISPATCHED','RELAUNCH_FAILED','RELAUNCH_AMBIGUOUS']);

function actionJournalPath(statePath) {
  return `${String(statePath)}.action-journal-v1.json`;
}

function bindingFrom(value) {
  const token = String(value?.token || '');
  const parentPid = Number(value?.parent_pid || 0);
  const executable = String(value?.executable || '');
  if (!token || !Number.isSafeInteger(parentPid) || parentPid < 1 || !executable) throw new Error('sentinel_action_binding_invalid');
  return Object.freeze({ token, parent_pid: parentPid, executable });
}

function sameBinding(row, binding) {
  return row?.token === binding.token
    && Number(row?.parent_pid) === binding.parent_pid
    && String(row?.executable || '') === binding.executable;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; if (error instanceof SyntaxError) throw new Error('sentinel_action_journal_json_invalid'); throw error; }
}

function validateRow(row, binding = null) {
  if (!row || row.schema !== SENTINEL_ACTION_JOURNAL_SCHEMA || row.version !== SENTINEL_ACTION_JOURNAL_VERSION) throw new Error('sentinel_action_journal_schema_invalid');
  if (!Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1) throw new Error('sentinel_action_journal_sequence_invalid');
  if (row.automatic_retry_allowed !== false || row.authority_effect !== false) throw new Error('sentinel_action_journal_authority_invalid');
  const rowBinding = bindingFrom(row);
  if (binding && !sameBinding(row, binding)) throw new Error('sentinel_action_journal_binding_drift');
  return Object.freeze({ ...row, ...rowBinding });
}

class BrowserSentinelActionJournal {
  #statePath;
  #path;
  #row = null;
  #writeTail = Promise.resolve();

  constructor({ statePath } = {}) {
    if (!statePath) throw new Error('sentinel_action_journal_state_path_required');
    this.#statePath = String(statePath);
    this.#path = actionJournalPath(this.#statePath);
  }

  async init(bindingSource) {
    const binding = bindingFrom(bindingSource);
    const existing = await readJson(this.#path);
    if (existing) this.#row = validateRow(existing, binding);
    return this.snapshot();
  }

  snapshot() {
    return this.#row ? structuredClone(this.#row) : null;
  }

  terminationAttempted() {
    return TERMINATION_STATES.has(String(this.#row?.state || '')) || RELAUNCH_STATES.has(String(this.#row?.state || ''));
  }

  relaunchAttempted() {
    return RELAUNCH_STATES.has(String(this.#row?.state || ''));
  }

  async #commit(bindingSource, state, fields = {}) {
    const binding = bindingFrom(bindingSource);
    if (this.#row && !sameBinding(this.#row, binding)) throw new Error('sentinel_action_journal_binding_drift');
    const sequence = Number(this.#row?.sequence || 0) + 1;
    const next = {
      schema: SENTINEL_ACTION_JOURNAL_SCHEMA,
      version: SENTINEL_ACTION_JOURNAL_VERSION,
      ...binding,
      sequence,
      state,
      ...fields,
      recorded_at: new Date().toISOString(),
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    await durableWriteJson(this.#path, next, { sequence });
    this.#row = validateRow(next, binding);
    return this.snapshot();
  }

  #enqueue(operation) {
    const current = this.#writeTail.then(operation);
    this.#writeTail = current.catch(() => {});
    return current;
  }

  beginTermination(bindingSource, decision = {}) {
    return this.#enqueue(async () => {
      if (this.terminationAttempted()) throw new Error(`sentinel_action_termination_already_attempted:${this.#row?.state || 'UNKNOWN'}`);
      return this.#commit(bindingSource, 'PARENT_TERMINATION_INTENT', {
        reason: String(decision?.state || 'PROGRESS_STALE').slice(0, 120),
        progress_at: decision?.progress_at || null,
        physical_effect_attempted: false,
        effect_barrier_crossed: true,
      });
    });
  }

  markTermination(bindingSource, outcome, detail = null) {
    return this.#enqueue(async () => {
      if (String(this.#row?.state || '') !== 'PARENT_TERMINATION_INTENT') throw new Error('sentinel_action_termination_transition_invalid');
      const state = String(outcome || '').toUpperCase();
      if (!['PARENT_TERMINATION_CONFIRMED','PARENT_TERMINATION_AMBIGUOUS'].includes(state)) throw new Error('sentinel_action_termination_outcome_invalid');
      return this.#commit(bindingSource, state, {
        reason: this.#row.reason || null,
        progress_at: this.#row.progress_at || null,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        result: detail == null ? null : String(detail).slice(0, 240),
      });
    });
  }

  beginRelaunch(bindingSource, reason = 'PARENT_ABSENT') {
    return this.#enqueue(async () => {
      if (this.relaunchAttempted()) throw new Error(`sentinel_action_relaunch_already_attempted:${this.#row?.state || 'UNKNOWN'}`);
      return this.#commit(bindingSource, 'RELAUNCH_INTENT', {
        reason: String(reason || 'PARENT_ABSENT').slice(0, 120),
        prior_state: this.#row?.state || null,
        physical_effect_attempted: false,
        effect_barrier_crossed: true,
      });
    });
  }

  markRelaunch(bindingSource, outcome = {}) {
    return this.#enqueue(async () => {
      if (String(this.#row?.state || '') !== 'RELAUNCH_INTENT') throw new Error('sentinel_action_relaunch_transition_invalid');
      const state = String(outcome?.lifecycle || '').toUpperCase();
      if (!['RELAUNCH_DISPATCHED','RELAUNCH_FAILED','RELAUNCH_AMBIGUOUS'].includes(state)) throw new Error('sentinel_action_relaunch_outcome_invalid');
      const pid = Number(outcome?.pid || 0);
      return this.#commit(bindingSource, state, {
        reason: this.#row.reason || null,
        prior_state: this.#row.prior_state || null,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        relaunch_pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
        result: String(outcome?.result || '').slice(0, 240),
      });
    });
  }

  failClosed(bindingSource, detail = null) {
    return this.#enqueue(async () => {
      const current = String(this.#row?.state || '');
      if (current === 'RELAUNCH_INTENT') {
        return this.#commit(bindingSource, 'RELAUNCH_AMBIGUOUS', {
          reason: this.#row.reason || null,
          prior_state: this.#row.prior_state || null,
          physical_effect_attempted: true,
          effect_barrier_crossed: true,
          result: String(detail || 'worker_error_after_relaunch_barrier').slice(0, 240),
        });
      }
      if (current === 'PARENT_TERMINATION_INTENT') {
        return this.#commit(bindingSource, 'PARENT_TERMINATION_AMBIGUOUS', {
          reason: this.#row.reason || null,
          progress_at: this.#row.progress_at || null,
          physical_effect_attempted: true,
          effect_barrier_crossed: true,
          result: String(detail || 'worker_error_after_termination_barrier').slice(0, 240),
        });
      }
      if (this.relaunchAttempted() || this.terminationAttempted()) return this.snapshot();
      return this.#commit(bindingSource, 'SENTINEL_ERROR', {
        physical_effect_attempted: false,
        effect_barrier_crossed: false,
        result: String(detail || 'worker_error').slice(0, 240),
      });
    });
  }
}

module.exports = Object.freeze({
  SENTINEL_ACTION_JOURNAL_SCHEMA,
  SENTINEL_ACTION_JOURNAL_VERSION,
  actionJournalPath,
  BrowserSentinelActionJournal,
});
