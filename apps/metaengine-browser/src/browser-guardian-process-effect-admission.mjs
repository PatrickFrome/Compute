export const BROWSER_GUARDIAN_PROCESS_EFFECT_ADMISSION_VERSION = '1.0.0';
export const BROWSER_GUARDIAN_PROCESS_EFFECT_ADMISSION_SCHEMA = 'metaengine.browser-guardian.process-effect-admission.v1';

const EFFECT_ACTIONS = new Set([
  'START_CHILD',
  'RESTART_EXACT_CHILD',
  'ACTIVATE_CANDIDATE',
  'ROLLBACK_CANDIDATE',
]);
const BARRIER_STATES = new Set(['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS']);
const SHA256 = /^[0-9a-f]{64}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function nonEmpty(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function releaseIdentity(value) {
  const releaseId = nonEmpty(value?.release_id);
  const artifactSha256 = String(value?.artifact_sha256 || '').trim().toLowerCase();
  if (!releaseId || !SHA256.test(artifactSha256)) return null;
  return freeze({ release_id: releaseId, artifact_sha256: artifactSha256 });
}

function zeroAuthority(value) {
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
    if (value?.[field] !== false) return false;
  }
  return true;
}

function effectIdentity(plan) {
  if (!plan || plan.schema !== 'metaengine.browser-guardian.plan.v1') return null;
  const action = String(plan.action || '').toUpperCase();
  if (!EFFECT_ACTIONS.has(action)
      || plan.process_effect_candidate !== true
      || plan.requires_external_executor !== true
      || !zeroAuthority(plan)) return null;

  const targetRelease = releaseIdentity(plan.target_release);
  if (!targetRelease) return null;
  const identity = {
    action,
    target_release: targetRelease,
    exact_pid: null,
    exact_process_incarnation_id: null,
    process_absence_proven: false,
  };

  if (action === 'START_CHILD') {
    if (plan.process_absence_proven !== true) return null;
    identity.process_absence_proven = true;
  } else if (action === 'RESTART_EXACT_CHILD') {
    identity.exact_pid = positiveInt(plan.exact_pid);
    identity.exact_process_incarnation_id = nonEmpty(plan.exact_process_incarnation_id);
    if (!identity.exact_pid || !identity.exact_process_incarnation_id) return null;
  }
  return freeze(identity);
}

function sameRelease(left, right) {
  const a = releaseIdentity(left);
  const b = releaseIdentity(right);
  return Boolean(a && b && a.release_id === b.release_id && a.artifact_sha256 === b.artifact_sha256);
}

function journalMatches(identity, journal) {
  const rowPlan = journal?.plan;
  if (!rowPlan || String(rowPlan.action || '').toUpperCase() !== identity.action) return false;
  if (!sameRelease(rowPlan.target_release, identity.target_release)) return false;
  if (identity.action === 'START_CHILD') return rowPlan.process_absence_proven === true;
  if (identity.action === 'RESTART_EXACT_CHILD') {
    return positiveInt(rowPlan.exact_pid) === identity.exact_pid
      && nonEmpty(rowPlan.exact_process_incarnation_id) === identity.exact_process_incarnation_id;
  }
  return true;
}

function decision(action, reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_PROCESS_EFFECT_ADMISSION_SCHEMA,
    version: BROWSER_GUARDIAN_PROCESS_EFFECT_ADMISSION_VERSION,
    action,
    reason,
    executor_dispatch_eligible: action === 'ATTEMPT_EXACT_EFFECT',
    process_effect_candidate: action === 'ATTEMPT_EXACT_EFFECT',
    requires_external_executor: action === 'ATTEMPT_EXACT_EFFECT',
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
    ...extra,
  });
}

/**
 * Pure admission boundary between a Guardian plan and the existing durable effect
 * journal. It never starts, kills, activates or rolls back anything.
 *
 * The only state that can expose a single exact executor attempt is an already
 * persisted INTENT_RECORDED row matching the exact plan identity. Once the effect
 * barrier is crossed, every later observation is reconciliation-only, including
 * AMBIGUOUS. Supervisors may restart forever; the physical effect may not replay.
 */
export function evaluateBrowserGuardianProcessEffectAdmission({ plan = null, effect_journal = null } = {}) {
  const identity = effectIdentity(plan);
  if (!identity) return decision('HOLD', 'PROCESS_EFFECT_PLAN_INVALID_OR_NON_EFFECTFUL');

  if (!effect_journal) {
    return decision('RECORD_INTENT', 'DURABLE_INTENT_REQUIRED_BEFORE_EFFECT', { plan_identity: identity });
  }
  if (effect_journal.effect_domain && String(effect_journal.effect_domain).toUpperCase() !== 'PROCESS') {
    return decision('HOLD', 'EFFECT_JOURNAL_DOMAIN_MISMATCH', { plan_identity: identity });
  }
  if (!journalMatches(identity, effect_journal)) {
    return decision('HOLD', 'EFFECT_JOURNAL_PLAN_DRIFT', { plan_identity: identity });
  }

  const state = String(effect_journal.state || '').toUpperCase();
  const effectId = nonEmpty(effect_journal.effect_id);
  const generation = positiveInt(effect_journal.effect_generation);
  if (!effectId || !generation) {
    return decision('HOLD', 'EFFECT_JOURNAL_IDENTITY_INVALID', { plan_identity: identity });
  }

  if (state === 'INTENT_RECORDED') {
    return decision('ATTEMPT_EXACT_EFFECT', 'DURABLE_INTENT_EXACTLY_MATCHED', {
      effect_id: effectId,
      effect_generation: generation,
      plan_identity: identity,
    });
  }
  if (BARRIER_STATES.has(state)) {
    return decision('RECONCILE_ONLY', 'EFFECT_BARRIER_ALREADY_CROSSED_NO_REPLAY', {
      effect_id: effectId,
      effect_generation: generation,
      journal_state: state,
      plan_identity: identity,
    });
  }
  if (state === 'CONFIRMED') {
    return decision('HOLD_CONFIRMED', 'EXACT_EFFECT_ALREADY_CONFIRMED', {
      effect_id: effectId,
      effect_generation: generation,
      plan_identity: identity,
    });
  }
  if (state === 'NO_EFFECT_PROVEN') {
    return decision('RECORD_INTENT', 'PRIOR_GENERATION_PROVEN_NO_EFFECT', {
      prior_effect_id: effectId,
      prior_effect_generation: generation,
      plan_identity: identity,
    });
  }
  return decision('HOLD', 'EFFECT_JOURNAL_STATE_INVALID', {
    effect_id: effectId,
    effect_generation: generation,
    journal_state: state || null,
    plan_identity: identity,
  });
}
