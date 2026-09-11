'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { durableWriteJson } = require('./durable-json-file.cjs');

const BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_SCHEMA = 'metaengine.browser-guardian.session-broker-effect-journal.v1';
const BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_VERSION = '1.0.0';
const PLAN_SCHEMA = 'metaengine.browser-guardian.session-broker-plan.v1';
const UNRESOLVED_EFFECT_STATES = new Set(['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS']);
const SID_RE = /^S-\d-\d+(?:-\d+)+$/i;

function journalPath(statePath) {
  const base = String(statePath || '').trim();
  if (!base) throw new Error('guardian_session_broker_effect_state_path_required');
  return `${base}.guardian-session-broker-effect-journal-v1.json`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function nonEmpty(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function normalizedSid(value) {
  const sid = String(value ?? '').trim().toUpperCase();
  return SID_RE.test(sid) ? sid : null;
}

function finiteInt(value, fallback = -1) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function bindingFrom(value) {
  const serviceName = nonEmpty(value?.service_name);
  const brokerExecutable = nonEmpty(value?.broker_executable);
  const expectedOwnerSid = normalizedSid(value?.expected_owner_sid);
  if (!serviceName || !brokerExecutable || !expectedOwnerSid) {
    throw new Error('guardian_session_broker_effect_binding_invalid');
  }
  return Object.freeze({
    service_name: serviceName,
    broker_executable: brokerExecutable,
    expected_owner_sid: expectedOwnerSid,
  });
}

function sameBinding(row, binding) {
  return row?.service_name === binding.service_name
    && row?.broker_executable === binding.broker_executable
    && row?.expected_owner_sid === binding.expected_owner_sid;
}

function sessionFrom(value) {
  const sessionId = finiteInt(value?.session_id, -1);
  const userSid = normalizedSid(value?.user_sid);
  const state = String(value?.state || '').trim().toUpperCase();
  if (sessionId < 0 || !userSid || state !== 'ACTIVE') {
    throw new Error('guardian_session_broker_effect_session_invalid');
  }
  return Object.freeze({ session_id: sessionId, user_sid: userSid, state: 'ACTIVE' });
}

function planIdentity(plan, binding) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== PLAN_SCHEMA) {
    throw new Error('guardian_session_broker_effect_plan_schema_invalid');
  }
  if (String(plan.action || '').toUpperCase() !== 'START_BROKER') {
    throw new Error('guardian_session_broker_effect_action_not_supported');
  }
  if (plan.process_effect_candidate !== true || plan.requires_user_session_executor !== true) {
    throw new Error('guardian_session_broker_effect_plan_not_effectful');
  }
  for (const field of [
    'actuation_eligible',
    'automatic_retry_allowed',
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'page_model_text_authority',
    'release_authority',
    'session_token_authority',
    'authority_effect',
  ]) {
    if (plan[field] !== false) throw new Error(`guardian_session_broker_effect_plan_authority_invalid:${field}`);
  }
  if (plan.broker_absence_proven !== true) {
    throw new Error('guardian_session_broker_effect_absence_unproven');
  }
  const selectedSession = sessionFrom(plan.selected_session);
  if (selectedSession.user_sid !== binding.expected_owner_sid) {
    throw new Error('guardian_session_broker_effect_owner_sid_drift');
  }
  return Object.freeze({
    action: 'START_BROKER',
    selected_session: selectedSession,
    broker_absence_proven: true,
    broker_executable: binding.broker_executable,
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('guardian_session_broker_effect_journal_json_invalid');
    throw error;
  }
}

function validateRow(row, binding = null) {
  if (!row
      || row.schema !== BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_SCHEMA
      || row.version !== BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_VERSION) {
    throw new Error('guardian_session_broker_effect_journal_schema_invalid');
  }
  if (!Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1) {
    throw new Error('guardian_session_broker_effect_journal_sequence_invalid');
  }
  if (!Number.isSafeInteger(Number(row.effect_generation)) || Number(row.effect_generation) < 1) {
    throw new Error('guardian_session_broker_effect_generation_invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(String(row.plan_digest || ''))) {
    throw new Error('guardian_session_broker_effect_plan_digest_invalid');
  }
  for (const field of [
    'automatic_retry_allowed',
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'page_model_text_authority',
    'release_authority',
    'session_token_authority',
    'process_effect_authority',
    'authority_effect',
  ]) {
    if (row[field] !== false) throw new Error(`guardian_session_broker_effect_journal_authority_invalid:${field}`);
  }
  const rowBinding = bindingFrom(row);
  if (binding && !sameBinding(row, binding)) {
    throw new Error('guardian_session_broker_effect_journal_binding_drift');
  }
  return Object.freeze({ ...row, ...rowBinding });
}

class BrowserGuardianSessionBrokerEffectJournal {
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

  snapshot() {
    return this.#row ? structuredClone(this.#row) : null;
  }

  unresolvedEffect() {
    return UNRESOLVED_EFFECT_STATES.has(String(this.#row?.state || ''));
  }

  resumableIntent() {
    return String(this.#row?.state || '') === 'INTENT_RECORDED';
  }

  confirmed() {
    return String(this.#row?.state || '') === 'CONFIRMED';
  }

  #enqueue(operation) {
    const current = this.#writeTail.then(operation);
    this.#writeTail = current.catch(() => {});
    return current;
  }

  async #commit(bindingSource, state, fields = {}) {
    const binding = bindingFrom(bindingSource);
    if (this.#row && !sameBinding(this.#row, binding)) {
      throw new Error('guardian_session_broker_effect_journal_binding_drift');
    }
    const sequence = Number(this.#row?.sequence || 0) + 1;
    const next = {
      schema: BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_SCHEMA,
      version: BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_VERSION,
      ...binding,
      sequence,
      state,
      ...fields,
      recorded_at: new Date().toISOString(),
      automatic_retry_allowed: false,
      browser_authority: false,
      task_authority: false,
      scheduler_authority: false,
      page_model_text_authority: false,
      release_authority: false,
      session_token_authority: false,
      process_effect_authority: false,
      authority_effect: false,
    };
    await durableWriteJson(this.#path, next, { sequence });
    this.#row = validateRow(next, binding);
    return this.snapshot();
  }

  beginStart(bindingSource, plan) {
    return this.#enqueue(async () => {
      const binding = bindingFrom(bindingSource);
      const identity = planIdentity(plan, binding);
      const digest = sha256Json(identity);

      if (this.confirmed()) {
        throw new Error('guardian_session_broker_effect_confirmed_requires_restart_protocol');
      }
      if (this.resumableIntent()) {
        if (this.#row.plan_digest !== digest) {
          throw new Error('guardian_session_broker_effect_unresolved_intent_plan_drift');
        }
        return this.snapshot();
      }
      if (this.unresolvedEffect()) {
        throw new Error(`guardian_session_broker_effect_unresolved:${this.#row.state}`);
      }

      const effectGeneration = Number(this.#row?.effect_generation || 0) + 1;
      return this.#commit(binding, 'INTENT_RECORDED', {
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
      if (!this.resumableIntent() || String(effectId || '') !== this.#row.effect_id) {
        throw new Error('guardian_session_broker_effect_attempt_transition_invalid');
      }
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

  markDispatched(bindingSource, effectId, { pid, process_incarnation_id } = {}) {
    return this.#enqueue(async () => {
      if (String(this.#row?.state || '') !== 'EFFECT_ATTEMPTED'
          || String(effectId || '') !== this.#row.effect_id) {
        throw new Error('guardian_session_broker_effect_dispatch_transition_invalid');
      }
      const exactPid = finiteInt(pid, 0);
      const incarnation = nonEmpty(process_incarnation_id);
      if (exactPid < 1 || !incarnation) {
        throw new Error('guardian_session_broker_effect_dispatched_identity_invalid');
      }
      return this.#commit(bindingSource, 'EFFECT_DISPATCHED', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: exactPid,
        dispatched_process_incarnation_id: incarnation,
        result: 'broker_spawn_dispatched_suspended',
      });
    });
  }

  confirmEffect(bindingSource, effectId, proof = {}) {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS'].includes(state)
          || String(effectId || '') !== this.#row.effect_id) {
        throw new Error('guardian_session_broker_effect_confirm_transition_invalid');
      }
      const pid = finiteInt(proof.pid, 0);
      const incarnation = nonEmpty(proof.process_incarnation_id);
      const sessionId = finiteInt(proof.session_id, -1);
      const userSid = normalizedSid(proof.user_sid);
      const plannedSession = this.#row.plan?.selected_session;
      if (pid < 1 || !incarnation
          || pid !== Number(this.#row.dispatched_pid)
          || incarnation !== this.#row.dispatched_process_incarnation_id
          || sessionId !== Number(plannedSession?.session_id)
          || userSid !== plannedSession?.user_sid
          || proof.exact_session_binding !== true
          || proof.exact_process_binding !== true
          || proof.kill_on_close_job_binding !== true
          || proof.broker_ready !== true) {
        throw new Error('guardian_session_broker_effect_confirm_proof_invalid');
      }
      return this.#commit(bindingSource, 'CONFIRMED', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: pid,
        dispatched_process_incarnation_id: incarnation,
        result: state === 'AMBIGUOUS'
          ? 'late_exact_broker_binding_reconciliation'
          : 'exact_broker_binding_confirmed',
      });
    });
  }

  proveNoEffect(bindingSource, effectId, evidence = {}) {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['INTENT_RECORDED', 'EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED'].includes(state)
          || String(effectId || '') !== this.#row.effect_id) {
        throw new Error('guardian_session_broker_effect_no_effect_transition_invalid');
      }
      if (evidence.effect_absent_proven !== true || evidence.selected_session_inventory_complete !== true) {
        throw new Error('guardian_session_broker_effect_absence_proof_required');
      }
      if (state === 'EFFECT_DISPATCHED') {
        const pid = finiteInt(evidence.pid, 0);
        const incarnation = nonEmpty(evidence.process_incarnation_id);
        if (pid < 1
            || pid !== Number(this.#row.dispatched_pid)
            || incarnation !== this.#row.dispatched_process_incarnation_id
            || evidence.exact_process_absent !== true) {
          throw new Error('guardian_session_broker_effect_dispatched_absence_proof_invalid');
        }
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
        result: String(evidence.reason || 'exact_broker_process_effect_absent').slice(0, 240),
      });
    });
  }

  markAmbiguous(bindingSource, effectId, detail = 'broker_process_effect_outcome_unknown') {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED'].includes(state)
          || String(effectId || '') !== this.#row.effect_id) {
        throw new Error('guardian_session_broker_effect_ambiguous_transition_invalid');
      }
      return this.#commit(bindingSource, 'AMBIGUOUS', {
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: this.#row.dispatched_pid || null,
        dispatched_process_incarnation_id: this.#row.dispatched_process_incarnation_id || null,
        result: String(detail || 'broker_process_effect_outcome_unknown').slice(0, 240),
      });
    });
  }
}

module.exports = Object.freeze({
  BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_SCHEMA,
  BROWSER_GUARDIAN_SESSION_BROKER_EFFECT_JOURNAL_VERSION,
  journalPath,
  BrowserGuardianSessionBrokerEffectJournal,
});
