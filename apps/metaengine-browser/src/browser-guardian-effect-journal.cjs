'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { durableWriteJson } = require('./durable-json-file.cjs');

const BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA = 'metaengine.browser-guardian.effect-journal.v1';
const BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION = '1.0.0';
const EFFECT_ACTIONS = new Set(['START_CHILD','RESTART_EXACT_CHILD','ACTIVATE_CANDIDATE','ROLLBACK_CANDIDATE']);
const UNRESOLVED_EFFECT_STATES = new Set(['EFFECT_ATTEMPTED','EFFECT_DISPATCHED','AMBIGUOUS']);
const TERMINAL_STATES = new Set(['CONFIRMED','NO_EFFECT_PROVEN']);

function journalPath(statePath) {
  const base = String(statePath || '');
  if (!base) throw new Error('guardian_effect_journal_state_path_required');
  return `${base}.guardian-effect-journal-v1.json`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function bindingFrom(value) {
  const guardianId = String(value?.guardian_instance_id || '').trim();
  const executable = String(value?.executable || '').trim();
  if (!guardianId || !executable) throw new Error('guardian_effect_binding_invalid');
  return Object.freeze({ guardian_instance_id: guardianId, executable });
}

function sameBinding(row, binding) {
  return row?.guardian_instance_id === binding.guardian_instance_id
    && String(row?.executable || '') === binding.executable;
}

function releaseFrom(value) {
  const releaseId = String(value?.release_id || '').trim();
  const artifactSha256 = String(value?.artifact_sha256 || '').toLowerCase();
  if (!releaseId || !/^[0-9a-f]{64}$/.test(artifactSha256)) throw new Error('guardian_effect_release_invalid');
  return Object.freeze({ release_id: releaseId, artifact_sha256: artifactSha256 });
}

function planIdentity(plan) {
  if (!plan || plan.schema !== 'metaengine.browser-guardian.plan.v1') throw new Error('guardian_effect_plan_schema_invalid');
  const action = String(plan.action || '').toUpperCase();
  if (!EFFECT_ACTIONS.has(action) || plan.process_effect_candidate !== true || plan.requires_external_executor !== true) {
    throw new Error('guardian_effect_plan_not_effectful');
  }
  for (const field of ['actuation_eligible','automatic_retry_allowed','browser_authority','task_authority','scheduler_authority','page_model_text_authority','release_authority','authority_effect']) {
    if (plan[field] !== false) throw new Error(`guardian_effect_plan_authority_invalid:${field}`);
  }
  const targetRelease = releaseFrom(plan.target_release);
  const identity = {
    action,
    target_release: targetRelease,
    exact_pid: null,
    exact_process_incarnation_id: null,
    process_absence_proven: false,
  };
  if (action === 'START_CHILD') {
    if (plan.process_absence_proven !== true) throw new Error('guardian_effect_start_absence_unproven');
    identity.process_absence_proven = true;
  } else if (action === 'RESTART_EXACT_CHILD') {
    const pid = Number(plan.exact_pid || 0);
    const incarnation = String(plan.exact_process_incarnation_id || '').trim();
    if (!Number.isSafeInteger(pid) || pid < 1 || !incarnation) throw new Error('guardian_effect_restart_binding_invalid');
    identity.exact_pid = pid;
    identity.exact_process_incarnation_id = incarnation;
  }
  return Object.freeze(identity);
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('guardian_effect_journal_json_invalid');
    throw error;
  }
}

function validateRow(row, binding = null) {
  if (!row || row.schema !== BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA || row.version !== BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION) throw new Error('guardian_effect_journal_schema_invalid');
  if (!Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1) throw new Error('guardian_effect_journal_sequence_invalid');
  if (!Number.isSafeInteger(Number(row.effect_generation)) || Number(row.effect_generation) < 1) throw new Error('guardian_effect_generation_invalid');
  if (!/^[0-9a-f]{64}$/.test(String(row.plan_digest || ''))) throw new Error('guardian_effect_plan_digest_invalid');
  if (row.automatic_retry_allowed !== false || row.browser_authority !== false || row.task_authority !== false || row.scheduler_authority !== false || row.release_authority !== false || row.authority_effect !== false) throw new Error('guardian_effect_journal_authority_invalid');
  const rowBinding = bindingFrom(row);
  if (binding && !sameBinding(row, binding)) throw new Error('guardian_effect_journal_binding_drift');
  return Object.freeze({ ...row, ...rowBinding });
}

class BrowserGuardianEffectJournal {
  #path;
  #row = null;
  #writeTail = Promise.resolve();

  constructor({ statePath } = {}) {
    this.#path = journalPath(statePath);
  }

  async init(bindingSource) {
    const binding = bindingFrom(bindingSource);
    const existing = await readJson(this.#path);
    if (existing) this.#row = validateRow(existing, binding);
    return this.snapshot();
  }

  snapshot() { return this.#row ? structuredClone(this.#row) : null; }
  unresolvedEffect() { return UNRESOLVED_EFFECT_STATES.has(String(this.#row?.state || '')); }
  resumableIntent() { return String(this.#row?.state || '') === 'INTENT_RECORDED'; }
  terminal() { return TERMINAL_STATES.has(String(this.#row?.state || '')); }

  #enqueue(operation) {
    const current = this.#writeTail.then(operation);
    this.#writeTail = current.catch(() => {});
    return current;
  }

  async #commit(bindingSource, state, fields = {}) {
    const binding = bindingFrom(bindingSource);
    if (this.#row && !sameBinding(this.#row, binding)) throw new Error('guardian_effect_journal_binding_drift');
    const sequence = Number(this.#row?.sequence || 0) + 1;
    const next = {
      schema: BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA,
      version: BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION,
      ...binding,
      sequence,
      state,
      ...fields,
      recorded_at: new Date().toISOString(),
      automatic_retry_allowed: false,
      browser_authority: false,
      task_authority: false,
      scheduler_authority: false,
      release_authority: false,
      authority_effect: false,
    };
    await durableWriteJson(this.#path, next, { sequence });
    this.#row = validateRow(next, binding);
    return this.snapshot();
  }

  beginEffect(bindingSource, plan) {
    return this.#enqueue(async () => {
      const identity = planIdentity(plan);
      const digest = sha256Json(identity);
      if (this.resumableIntent()) {
        if (this.#row.plan_digest !== digest) throw new Error('guardian_effect_unresolved_intent_plan_drift');
        return this.snapshot();
      }
      if (this.unresolvedEffect()) throw new Error(`guardian_effect_unresolved:${this.#row.state}`);
      const effectGeneration = Number(this.#row?.effect_generation || 0) + 1;
      return this.#commit(bindingSource, 'INTENT_RECORDED', {
        effect_id: crypto.randomUUID(),
        effect_generation: effectGeneration,
        plan_digest: digest,
        plan: identity,
        physical_effect_attempted: false,
        effect_barrier_crossed: false,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: null,
      });
    });
  }

  markEffectAttempted(bindingSource, effectId) {
    return this.#enqueue(async () => {
      if (!this.resumableIntent() || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_attempt_transition_invalid');
      return this.#commit(bindingSource, 'EFFECT_ATTEMPTED', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: null,
      });
    });
  }

  markDispatched(bindingSource, effectId, { pid, process_incarnation_id = null, result = 'spawn_dispatched' } = {}) {
    return this.#enqueue(async () => {
      if (String(this.#row?.state || '') !== 'EFFECT_ATTEMPTED' || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_dispatch_transition_invalid');
      const exactPid = Number(pid || 0);
      const incarnation = String(process_incarnation_id || '').trim() || null;
      if (!Number.isSafeInteger(exactPid) || exactPid < 1) throw new Error('guardian_effect_dispatched_pid_invalid');
      return this.#commit(bindingSource, 'EFFECT_DISPATCHED', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: exactPid,
        dispatched_process_incarnation_id: incarnation,
        result: String(result || 'spawn_dispatched').slice(0, 240),
      });
    });
  }

  confirmEffect(bindingSource, effectId, proof = {}) {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED','EFFECT_DISPATCHED','AMBIGUOUS'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_confirm_transition_invalid');
      const release = releaseFrom(proof.release);
      if (release.release_id !== this.#row.plan.target_release.release_id || release.artifact_sha256 !== this.#row.plan.target_release.artifact_sha256) throw new Error('guardian_effect_confirm_release_drift');
      const pid = Number(proof.pid || 0);
      const incarnation = String(proof.process_incarnation_id || '').trim();
      if (!Number.isSafeInteger(pid) || pid < 1 || !incarnation || proof.exact_ready_binding !== true) throw new Error('guardian_effect_confirm_proof_invalid');
      const priorDispatchedPid = Number(this.#row.dispatched_pid || 0);
      if (Number.isSafeInteger(priorDispatchedPid) && priorDispatchedPid > 0 && priorDispatchedPid !== pid) throw new Error('guardian_effect_confirm_pid_drift');
      return this.#commit(bindingSource, 'CONFIRMED', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: priorDispatchedPid > 0 ? priorDispatchedPid : pid,
        dispatched_process_incarnation_id: incarnation,
        result: state === 'AMBIGUOUS' ? 'late_exact_ready_reconciliation' : 'exact_ready_successor_binding',
      });
    });
  }

  proveNoEffect(bindingSource, effectId, evidence = {}) {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['INTENT_RECORDED','EFFECT_ATTEMPTED','EFFECT_DISPATCHED'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_no_effect_transition_invalid');
      if (evidence.effect_absent_proven !== true) throw new Error('guardian_effect_absence_proof_required');
      if (state === 'EFFECT_DISPATCHED') {
        const pid = Number(evidence.pid || 0);
        if (!Number.isSafeInteger(pid) || pid < 1 || pid !== Number(this.#row.dispatched_pid) || evidence.exact_pid_absent !== true) throw new Error('guardian_effect_dispatched_absence_proof_invalid');
      }
      return this.#commit(bindingSource, 'NO_EFFECT_PROVEN', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: state !== 'INTENT_RECORDED',
        effect_barrier_crossed: state !== 'INTENT_RECORDED',
        dispatched_pid: this.#row.dispatched_pid || null,
        dispatched_process_incarnation_id: this.#row.dispatched_process_incarnation_id || null,
        result: String(evidence.reason || 'exact_process_effect_absent').slice(0, 240),
      });
    });
  }

  markAmbiguous(bindingSource, effectId, detail = 'process_effect_outcome_unknown') {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED','EFFECT_DISPATCHED'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_ambiguous_transition_invalid');
      return this.#commit(bindingSource, 'AMBIGUOUS', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: this.#row.dispatched_pid || null,
        dispatched_process_incarnation_id: this.#row.dispatched_process_incarnation_id || null,
        result: String(detail || 'process_effect_outcome_unknown').slice(0, 240),
      });
    });
  }
}

module.exports = Object.freeze({
  BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA,
  BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION,
  journalPath,
  BrowserGuardianEffectJournal,
});
