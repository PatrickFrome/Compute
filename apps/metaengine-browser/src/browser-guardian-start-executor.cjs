'use strict';

const EXECUTOR_SCHEMA = 'metaengine.browser-guardian.start-executor.v1';
const DISPATCH_STATES = new Set(['DISPATCHED','NO_EFFECT_PROVEN','AMBIGUOUS']);
const OBSERVATION_STATES = new Set(['READY','PID_ABSENT','UNRESOLVED']);
const ADMISSION_MODULE = import('./browser-guardian-process-effect-admission.mjs');
const DISPATCH_PERMIT_MODULE = import('./browser-guardian-process-effect-dispatch-permit.mjs');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function result(state, reason, extra = {}) {
  return freeze({
    schema: EXECUTOR_SCHEMA,
    state,
    reason,
    physical_dispatch_count: 0,
    physical_dispatch_allowed: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    release_authority: false,
    authority_effect: false,
    ...extra,
  });
}

function requireStartPlan(plan) {
  if (!plan || plan.schema !== 'metaengine.browser-guardian.plan.v1' || String(plan.action || '') !== 'START_CHILD') {
    throw new Error('guardian_start_executor_plan_invalid');
  }
  if (plan.process_effect_candidate !== true || plan.requires_external_executor !== true || plan.process_absence_proven !== true) {
    throw new Error('guardian_start_executor_plan_not_eligible');
  }
  for (const field of ['actuation_eligible','automatic_retry_allowed','browser_authority','task_authority','scheduler_authority','page_model_text_authority','release_authority','authority_effect']) {
    if (plan[field] !== false) throw new Error(`guardian_start_executor_plan_authority_invalid:${field}`);
  }
  return plan;
}

function requireJournal(journal) {
  for (const method of ['beginEffect','markEffectAttempted','markDispatched','confirmEffect','proveNoEffect','markAmbiguous','snapshot','unresolvedEffect']) {
    if (typeof journal?.[method] !== 'function') throw new Error(`guardian_start_executor_journal_method_required:${method}`);
  }
  return journal;
}

function normalizeDispatch(value) {
  const state = String(value?.state || '').toUpperCase();
  if (!DISPATCH_STATES.has(state)) return { state: 'AMBIGUOUS', reason: 'DISPATCH_OUTCOME_INVALID' };
  if (state === 'DISPATCHED') {
    const pid = Number(value?.pid || 0);
    if (!Number.isSafeInteger(pid) || pid < 1) return { state: 'AMBIGUOUS', reason: 'DISPATCH_PID_INVALID' };
    return { state, pid, process_incarnation_id: String(value?.process_incarnation_id || '').trim() || null, reason: String(value?.reason || 'spawn_dispatched').slice(0, 240) };
  }
  if (state === 'NO_EFFECT_PROVEN') {
    if (value?.effect_absent_proven !== true) return { state: 'AMBIGUOUS', reason: 'NO_EFFECT_PROOF_INVALID' };
    return { state, reason: String(value?.reason || 'dispatch_effect_absent').slice(0, 240) };
  }
  return { state, reason: String(value?.reason || 'dispatch_outcome_unknown').slice(0, 240) };
}

function normalizeObservation(value) {
  const state = String(value?.state || '').toUpperCase();
  if (!OBSERVATION_STATES.has(state)) return { state: 'UNRESOLVED', reason: 'OBSERVATION_INVALID' };
  if (state === 'READY') {
    const pid = Number(value?.pid || 0);
    const processIncarnationId = String(value?.process_incarnation_id || '').trim();
    if (!Number.isSafeInteger(pid) || pid < 1 || !processIncarnationId || value?.exact_ready_binding !== true) {
      return { state: 'UNRESOLVED', reason: 'READY_PROOF_INVALID' };
    }
    return { state, pid, process_incarnation_id: processIncarnationId, release: value.release, exact_ready_binding: true };
  }
  if (state === 'PID_ABSENT') {
    const pid = Number(value?.pid || 0);
    if (!Number.isSafeInteger(pid) || pid < 1 || value?.exact_pid_absent !== true || value?.effect_absent_proven !== true) {
      return { state: 'UNRESOLVED', reason: 'PID_ABSENCE_PROOF_INVALID' };
    }
    return { state, pid, exact_pid_absent: true, effect_absent_proven: true, reason: String(value?.reason || 'exact_dispatched_pid_absent').slice(0, 240) };
  }
  return { state, reason: String(value?.reason || 'bounded_observation_unresolved').slice(0, 240) };
}

function sameRelease(left, right) {
  return String(left?.release_id || '') === String(right?.release_id || '')
    && String(left?.artifact_sha256 || '').toLowerCase() === String(right?.artifact_sha256 || '').toLowerCase();
}

function exactStartDispatchPermit(permit, intent, plan) {
  if (!permit
      || permit.schema !== 'metaengine.browser-guardian.process-effect-dispatch-permit.v1'
      || permit.action !== 'DISPATCH_EXACT_EFFECT_ONCE'
      || permit.executor_dispatch_eligible !== true
      || permit.single_dispatch_only !== true
      || permit.durable_effect_barrier_crossed !== true
      || permit.automatic_retry_allowed !== false
      || permit.browser_authority !== false
      || permit.task_authority !== false
      || permit.scheduler_authority !== false
      || permit.page_model_text_authority !== false
      || permit.release_authority !== false
      || permit.authority_effect !== false
      || permit.effect_action !== 'START_CHILD'
      || permit.process_absence_proven !== true
      || permit.exact_pid !== null
      || permit.exact_process_incarnation_id !== null
      || String(permit.effect_id || '') !== String(intent?.effect_id || '')
      || Number(permit.effect_generation) !== Number(intent?.effect_generation)
      || !sameRelease(permit.target_release, plan?.target_release)) return false;
  return true;
}

/**
 * Executes at most one START_CHILD process effect for one already-approved Guardian
 * plan. There is no retry loop here. Every physical dispatch is preceded by a durable
 * journal intent, canonical process-effect admission, EFFECT_ATTEMPTED barrier and
 * exact one-shot dispatch permit. The injected dispatch adapter must classify its own
 * OS effect outcome; thrown/unknown outcomes are treated ambiguous.
 */
async function executeGuardianStartChild({
  plan,
  journal,
  binding,
  revalidateChildAbsence,
  dispatchStart,
  observeDispatched,
} = {}) {
  requireStartPlan(plan);
  requireJournal(journal);
  if (typeof revalidateChildAbsence !== 'function') throw new Error('guardian_start_executor_absence_revalidator_required');
  if (typeof dispatchStart !== 'function') throw new Error('guardian_start_executor_dispatch_required');
  if (typeof observeDispatched !== 'function') throw new Error('guardian_start_executor_observer_required');

  const [{ evaluateBrowserGuardianProcessEffectAdmission }, { buildBrowserGuardianProcessEffectDispatchPermit }] = await Promise.all([
    ADMISSION_MODULE,
    DISPATCH_PERMIT_MODULE,
  ]);

  if (journal.unresolvedEffect()) {
    const row = journal.snapshot();
    return result('HELD_UNRESOLVED', 'PRIOR_PROCESS_EFFECT_UNRESOLVED', {
      effect_id: row?.effect_id || null,
      effect_generation: Number(row?.effect_generation || 0) || null,
      journal_state: row?.state || null,
    });
  }

  const intent = await journal.beginEffect(binding, plan);
  const effectId = intent.effect_id;
  const admission = evaluateBrowserGuardianProcessEffectAdmission({ plan, effect_journal: intent });
  if (admission?.action !== 'ATTEMPT_EXACT_EFFECT'
      || admission?.executor_dispatch_eligible !== true
      || String(admission?.effect_id || '') !== String(effectId)
      || Number(admission?.effect_generation) !== Number(intent.effect_generation)) {
    const closed = await journal.proveNoEffect(binding, effectId, {
      effect_absent_proven: true,
      reason: `process_effect_admission_failed:${String(admission?.reason || 'invalid').slice(0, 180)}`,
    });
    return result('PRE_EFFECT_FENCED', 'PROCESS_EFFECT_ADMISSION_FAILED', {
      effect_id: effectId,
      effect_generation: closed.effect_generation,
      journal_state: closed.state,
    });
  }

  let absence;
  try {
    absence = await revalidateChildAbsence({ plan, effect_id: effectId, effect_generation: intent.effect_generation });
  } catch (error) {
    absence = { proven: false, reason: `absence_revalidation_error:${String(error?.message || error).slice(0,160)}` };
  }
  if (absence?.proven !== true) {
    const closed = await journal.proveNoEffect(binding, effectId, {
      effect_absent_proven: true,
      reason: String(absence?.reason || 'pre_effect_child_absence_not_revalidated').slice(0, 240),
    });
    return result('PRE_EFFECT_FENCED', 'CHILD_ABSENCE_REVALIDATION_FAILED', {
      effect_id: effectId,
      effect_generation: closed.effect_generation,
      journal_state: closed.state,
    });
  }

  const attempted = await journal.markEffectAttempted(binding, effectId);
  const dispatchPermit = buildBrowserGuardianProcessEffectDispatchPermit({ admission, attempted_journal: attempted });
  if (!exactStartDispatchPermit(dispatchPermit, intent, plan)) {
    const closed = await journal.proveNoEffect(binding, effectId, {
      effect_absent_proven: true,
      reason: `process_effect_dispatch_permit_failed:${String(dispatchPermit?.reason || 'invalid').slice(0, 180)}`,
    });
    return result('PRE_DISPATCH_FENCED', 'EXACT_DISPATCH_PERMIT_REQUIRED', {
      effect_id: effectId,
      effect_generation: closed.effect_generation,
      journal_state: closed.state,
    });
  }

  let dispatch;
  try {
    dispatch = normalizeDispatch(await dispatchStart({
      plan,
      effect_id: effectId,
      effect_generation: intent.effect_generation,
      dispatch_permit: dispatchPermit,
    }));
  } catch (error) {
    dispatch = { state: 'AMBIGUOUS', reason: `dispatch_adapter_error:${String(error?.message || error).slice(0,180)}` };
  }

  if (dispatch.state === 'NO_EFFECT_PROVEN') {
    const closed = await journal.proveNoEffect(binding, effectId, { effect_absent_proven: true, reason: dispatch.reason });
    return result('NO_EFFECT_PROVEN', 'DISPATCH_EFFECT_ABSENT', { effect_id: effectId, effect_generation: closed.effect_generation, journal_state: closed.state });
  }

  if (dispatch.state !== 'DISPATCHED') {
    const ambiguous = await journal.markAmbiguous(binding, effectId, dispatch.reason);
    return result('AMBIGUOUS', 'DISPATCH_OUTCOME_UNKNOWN', { effect_id: effectId, effect_generation: ambiguous.effect_generation, journal_state: ambiguous.state, physical_dispatch_count: 1 });
  }

  await journal.markDispatched(binding, effectId, { pid: dispatch.pid, process_incarnation_id: dispatch.process_incarnation_id, result: dispatch.reason });

  let observation;
  try {
    observation = normalizeObservation(await observeDispatched({ plan, effect_id: effectId, effect_generation: intent.effect_generation, pid: dispatch.pid, process_incarnation_id: dispatch.process_incarnation_id }));
  } catch (error) {
    observation = { state: 'UNRESOLVED', reason: `observation_error:${String(error?.message || error).slice(0,180)}` };
  }

  if (observation.state === 'READY') {
    try {
      const confirmed = await journal.confirmEffect(binding, effectId, { release: observation.release, pid: observation.pid, process_incarnation_id: observation.process_incarnation_id, exact_ready_binding: true });
      return result('CONFIRMED', 'EXACT_READY_SUCCESSOR_PROVEN', { effect_id: effectId, effect_generation: confirmed.effect_generation, journal_state: confirmed.state, pid: confirmed.dispatched_pid, process_incarnation_id: confirmed.dispatched_process_incarnation_id, physical_dispatch_count: 1 });
    } catch (error) {
      const ambiguous = await journal.markAmbiguous(binding, effectId, `ready_reconciliation_failed:${String(error?.message || error).slice(0,160)}`);
      return result('AMBIGUOUS', 'READY_PROOF_DID_NOT_MATCH_DISPATCH', { effect_id: effectId, effect_generation: ambiguous.effect_generation, journal_state: ambiguous.state, physical_dispatch_count: 1 });
    }
  }

  if (observation.state === 'PID_ABSENT') {
    try {
      const closed = await journal.proveNoEffect(binding, effectId, { effect_absent_proven: true, pid: observation.pid, exact_pid_absent: true, reason: observation.reason });
      return result('NO_EFFECT_PROVEN', 'EXACT_DISPATCHED_PID_ABSENT', { effect_id: effectId, effect_generation: closed.effect_generation, journal_state: closed.state, physical_dispatch_count: 1 });
    } catch (error) {
      const ambiguous = await journal.markAmbiguous(binding, effectId, `absence_reconciliation_failed:${String(error?.message || error).slice(0,160)}`);
      return result('AMBIGUOUS', 'PID_ABSENCE_PROOF_DID_NOT_MATCH_DISPATCH', { effect_id: effectId, effect_generation: ambiguous.effect_generation, journal_state: ambiguous.state, physical_dispatch_count: 1 });
    }
  }

  const ambiguous = await journal.markAmbiguous(binding, effectId, observation.reason);
  return result('AMBIGUOUS', 'BOUNDED_READBACK_UNRESOLVED', { effect_id: effectId, effect_generation: ambiguous.effect_generation, journal_state: ambiguous.state, physical_dispatch_count: 1 });
}

module.exports = Object.freeze({ EXECUTOR_SCHEMA, executeGuardianStartChild });
