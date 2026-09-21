'use strict';

const EXECUTOR_SCHEMA = 'metaengine.browser-guardian.activation-executor.v1';
const DISPATCH_STATES = new Set(['DISPATCHED', 'NO_EFFECT_PROVEN', 'AMBIGUOUS']);
const OBSERVATION_STATES = new Set(['READY', 'NO_EFFECT_PROVEN', 'UNRESOLVED']);

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

function requireActivationPlan(plan) {
  if (!plan || plan.schema !== 'metaengine.browser-guardian.plan.v1' || String(plan.action || '').toUpperCase() !== 'ACTIVATE_CANDIDATE') {
    throw new Error('guardian_activation_executor_plan_invalid');
  }
  if (plan.process_effect_candidate !== true || plan.requires_external_executor !== true) {
    throw new Error('guardian_activation_executor_plan_not_eligible');
  }
  for (const field of [
    'actuation_eligible',
    'automatic_retry_allowed',
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'page_model_text_authority',
    'release_authority',
    'authority_effect',
  ]) {
    if (plan[field] !== false) throw new Error(`guardian_activation_executor_plan_authority_invalid:${field}`);
  }
  if (!plan.target_release?.release_id || !/^[0-9a-f]{64}$/i.test(String(plan.target_release?.artifact_sha256 || ''))) {
    throw new Error('guardian_activation_executor_release_invalid');
  }
  return plan;
}

function requireJournal(journal) {
  for (const method of [
    'beginEffect',
    'markEffectAttempted',
    'markDispatched',
    'confirmEffect',
    'proveNoEffect',
    'markAmbiguous',
    'snapshot',
    'unresolvedEffect',
  ]) {
    if (typeof journal?.[method] !== 'function') throw new Error(`guardian_activation_executor_journal_method_required:${method}`);
  }
  return journal;
}

function normalizeDispatch(value) {
  const state = String(value?.state || '').toUpperCase();
  if (!DISPATCH_STATES.has(state)) return { state: 'AMBIGUOUS', reason: 'DISPATCH_OUTCOME_INVALID' };
  if (state === 'DISPATCHED') {
    const pid = Number(value?.pid || 0);
    const incarnation = String(value?.process_incarnation_id || '').trim();
    if (!Number.isSafeInteger(pid) || pid < 1 || !incarnation) return { state: 'AMBIGUOUS', reason: 'DISPATCH_IDENTITY_INVALID' };
    return {
      state,
      pid,
      process_incarnation_id: incarnation,
      reason: String(value?.reason || 'activation_dispatched').slice(0, 240),
    };
  }
  if (state === 'NO_EFFECT_PROVEN') {
    if (value?.effect_absent_proven !== true) return { state: 'AMBIGUOUS', reason: 'NO_EFFECT_PROOF_INVALID' };
    return { state, reason: String(value?.reason || 'activation_effect_absent').slice(0, 240) };
  }
  return { state, reason: String(value?.reason || 'activation_outcome_unknown').slice(0, 240) };
}

function normalizeObservation(value) {
  const state = String(value?.state || '').toUpperCase();
  if (!OBSERVATION_STATES.has(state)) return { state: 'UNRESOLVED', reason: 'OBSERVATION_INVALID' };
  if (state === 'READY') {
    const pid = Number(value?.pid || 0);
    const incarnation = String(value?.process_incarnation_id || '').trim();
    if (!Number.isSafeInteger(pid) || pid < 1 || !incarnation || value?.exact_ready_binding !== true) {
      return { state: 'UNRESOLVED', reason: 'READY_PROOF_INVALID' };
    }
    return {
      state,
      pid,
      process_incarnation_id: incarnation,
      release: value.release,
      exact_ready_binding: true,
    };
  }
  if (state === 'NO_EFFECT_PROVEN') {
    if (value?.effect_absent_proven !== true) return { state: 'UNRESOLVED', reason: 'NO_EFFECT_PROOF_INVALID' };
    return { state, reason: String(value?.reason || 'post_dispatch_effect_absent').slice(0, 240) };
  }
  return { state, reason: String(value?.reason || 'bounded_activation_observation_unresolved').slice(0, 240) };
}

/**
 * Executes at most one external ACTIVATE_CANDIDATE effect for an already verified
 * Guardian plan. This module intentionally has no filesystem, shell, URL, release
 * discovery, retry-loop, or Electron updater authority. The injected external
 * dispatcher is the only OS-effect adapter and is called only after the durable
 * Guardian journal crosses its write-ahead effect barrier.
 */
async function executeGuardianCandidateActivation({
  plan,
  journal,
  binding,
  revalidateCandidate,
  dispatchActivation,
  observeActivation,
} = {}) {
  requireActivationPlan(plan);
  requireJournal(journal);
  if (typeof revalidateCandidate !== 'function') throw new Error('guardian_activation_executor_revalidator_required');
  if (typeof dispatchActivation !== 'function') throw new Error('guardian_activation_executor_dispatch_required');
  if (typeof observeActivation !== 'function') throw new Error('guardian_activation_executor_observer_required');

  if (journal.unresolvedEffect()) {
    const row = journal.snapshot();
    return result('HELD_UNRESOLVED', 'PRIOR_GUARDIAN_EFFECT_UNRESOLVED', {
      effect_id: row?.effect_id || null,
      effect_generation: Number(row?.effect_generation || 0) || null,
      journal_state: row?.state || null,
    });
  }

  const intent = await journal.beginEffect(binding, plan);
  const effectId = intent.effect_id;

  let preflight;
  try {
    preflight = await revalidateCandidate({
      plan,
      effect_id: effectId,
      effect_generation: intent.effect_generation,
    });
  } catch (error) {
    preflight = { proven: false, reason: `candidate_revalidation_error:${String(error?.message || error).slice(0, 160)}` };
  }
  if (preflight?.proven !== true) {
    const closed = await journal.proveNoEffect(binding, effectId, {
      effect_absent_proven: true,
      reason: String(preflight?.reason || 'candidate_revalidation_failed_before_effect').slice(0, 240),
    });
    return result('PRE_EFFECT_FENCED', 'CANDIDATE_REVALIDATION_FAILED', {
      effect_id: effectId,
      effect_generation: closed.effect_generation,
      journal_state: closed.state,
    });
  }

  await journal.markEffectAttempted(binding, effectId);

  let dispatch;
  try {
    dispatch = normalizeDispatch(await dispatchActivation({
      plan,
      effect_id: effectId,
      effect_generation: intent.effect_generation,
    }));
  } catch (error) {
    dispatch = { state: 'AMBIGUOUS', reason: `activation_dispatch_error:${String(error?.message || error).slice(0, 180)}` };
  }

  if (dispatch.state === 'NO_EFFECT_PROVEN') {
    const closed = await journal.proveNoEffect(binding, effectId, {
      effect_absent_proven: true,
      reason: dispatch.reason,
    });
    return result('NO_EFFECT_PROVEN', 'ACTIVATION_EFFECT_ABSENT', {
      effect_id: effectId,
      effect_generation: closed.effect_generation,
      journal_state: closed.state,
    });
  }

  if (dispatch.state !== 'DISPATCHED') {
    const ambiguous = await journal.markAmbiguous(binding, effectId, dispatch.reason);
    return result('AMBIGUOUS', 'ACTIVATION_OUTCOME_UNKNOWN', {
      effect_id: effectId,
      effect_generation: ambiguous.effect_generation,
      journal_state: ambiguous.state,
      physical_dispatch_count: 1,
    });
  }

  await journal.markDispatched(binding, effectId, {
    pid: dispatch.pid,
    process_incarnation_id: dispatch.process_incarnation_id,
    result: dispatch.reason,
  });

  let observation;
  try {
    observation = normalizeObservation(await observeActivation({
      plan,
      effect_id: effectId,
      effect_generation: intent.effect_generation,
      pid: dispatch.pid,
      process_incarnation_id: dispatch.process_incarnation_id,
    }));
  } catch (error) {
    observation = { state: 'UNRESOLVED', reason: `activation_observation_error:${String(error?.message || error).slice(0, 180)}` };
  }

  if (observation.state === 'READY') {
    try {
      const confirmed = await journal.confirmEffect(binding, effectId, {
        release: observation.release,
        pid: observation.pid,
        process_incarnation_id: observation.process_incarnation_id,
        exact_ready_binding: true,
      });
      return result('CONFIRMED', 'EXACT_ACTIVATED_SUCCESSOR_PROVEN', {
        effect_id: effectId,
        effect_generation: confirmed.effect_generation,
        journal_state: confirmed.state,
        pid: confirmed.dispatched_pid,
        process_incarnation_id: confirmed.dispatched_process_incarnation_id,
        physical_dispatch_count: 1,
      });
    } catch (error) {
      const ambiguous = await journal.markAmbiguous(binding, effectId, `activation_ready_reconciliation_failed:${String(error?.message || error).slice(0, 160)}`);
      return result('AMBIGUOUS', 'READY_PROOF_DID_NOT_MATCH_ACTIVATION', {
        effect_id: effectId,
        effect_generation: ambiguous.effect_generation,
        journal_state: ambiguous.state,
        physical_dispatch_count: 1,
      });
    }
  }

  if (observation.state === 'NO_EFFECT_PROVEN') {
    try {
      const closed = await journal.proveNoEffect(binding, effectId, {
        effect_absent_proven: true,
        reason: observation.reason,
      });
      return result('NO_EFFECT_PROVEN', 'ACTIVATION_EFFECT_PROVEN_ABSENT', {
        effect_id: effectId,
        effect_generation: closed.effect_generation,
        journal_state: closed.state,
        physical_dispatch_count: 1,
      });
    } catch (error) {
      const ambiguous = await journal.markAmbiguous(binding, effectId, `activation_absence_reconciliation_failed:${String(error?.message || error).slice(0, 160)}`);
      return result('AMBIGUOUS', 'ABSENCE_PROOF_DID_NOT_MATCH_ACTIVATION', {
        effect_id: effectId,
        effect_generation: ambiguous.effect_generation,
        journal_state: ambiguous.state,
        physical_dispatch_count: 1,
      });
    }
  }

  const ambiguous = await journal.markAmbiguous(binding, effectId, observation.reason);
  return result('AMBIGUOUS', 'BOUNDED_ACTIVATION_READBACK_UNRESOLVED', {
    effect_id: effectId,
    effect_generation: ambiguous.effect_generation,
    journal_state: ambiguous.state,
    physical_dispatch_count: 1,
  });
}

module.exports = Object.freeze({
  EXECUTOR_SCHEMA,
  executeGuardianCandidateActivation,
});
