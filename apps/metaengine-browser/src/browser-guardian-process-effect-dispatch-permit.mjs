export const BROWSER_GUARDIAN_PROCESS_EFFECT_DISPATCH_PERMIT_VERSION = '1.0.0';
export const BROWSER_GUARDIAN_PROCESS_EFFECT_DISPATCH_PERMIT_SCHEMA = 'metaengine.browser-guardian.process-effect-dispatch-permit.v1';

const ADMISSION_SCHEMA = 'metaengine.browser-guardian.process-effect-admission.v1';
const EFFECT_ACTIONS = new Set(['START_CHILD', 'RESTART_EXACT_CHILD', 'ACTIVATE_CANDIDATE', 'ROLLBACK_CANDIDATE']);
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
  return { release_id: releaseId, artifact_sha256: artifactSha256 };
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

function sameRelease(left, right) {
  const a = releaseIdentity(left);
  const b = releaseIdentity(right);
  return Boolean(a && b && a.release_id === b.release_id && a.artifact_sha256 === b.artifact_sha256);
}

function samePlanIdentity(identity, journalPlan) {
  const action = String(identity?.action || '').toUpperCase();
  if (!EFFECT_ACTIONS.has(action) || String(journalPlan?.action || '').toUpperCase() !== action) return false;
  if (!sameRelease(identity?.target_release, journalPlan?.target_release)) return false;

  if (action === 'START_CHILD') {
    return identity.process_absence_proven === true && journalPlan.process_absence_proven === true;
  }
  if (action === 'RESTART_EXACT_CHILD') {
    return positiveInt(identity.exact_pid) === positiveInt(journalPlan.exact_pid)
      && nonEmpty(identity.exact_process_incarnation_id) === nonEmpty(journalPlan.exact_process_incarnation_id);
  }
  return true;
}

function decision(action, reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_PROCESS_EFFECT_DISPATCH_PERMIT_SCHEMA,
    version: BROWSER_GUARDIAN_PROCESS_EFFECT_DISPATCH_PERMIT_VERSION,
    action,
    reason,
    executor_dispatch_eligible: action === 'DISPATCH_EXACT_EFFECT_ONCE',
    single_dispatch_only: action === 'DISPATCH_EXACT_EFFECT_ONCE',
    durable_effect_barrier_crossed: action === 'DISPATCH_EXACT_EFFECT_ONCE',
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
 * Converts a previously admitted INTENT_RECORDED generation into a one-shot native
 * dispatch permit only after the same exact generation has durably crossed to
 * EFFECT_ATTEMPTED. The function has no OS/process effect and grants no authority.
 *
 * This closes the crash window between "allowed to attempt" and the physical call:
 * the durable no-replay barrier must exist before an SCM/WTS executor may be invoked.
 */
export function buildBrowserGuardianProcessEffectDispatchPermit({ admission = null, attempted_journal = null } = {}) {
  if (!admission
      || admission.schema !== ADMISSION_SCHEMA
      || admission.action !== 'ATTEMPT_EXACT_EFFECT'
      || admission.executor_dispatch_eligible !== true
      || admission.process_effect_candidate !== true
      || admission.requires_external_executor !== true
      || !zeroAuthority(admission)) {
    return decision('HOLD', 'EXACT_EFFECT_ADMISSION_REQUIRED');
  }

  const effectId = nonEmpty(admission.effect_id);
  const generation = positiveInt(admission.effect_generation);
  const identity = admission.plan_identity;
  if (!effectId || !generation || !identity || !EFFECT_ACTIONS.has(String(identity.action || '').toUpperCase())) {
    return decision('HOLD', 'ADMISSION_IDENTITY_INVALID');
  }

  if (!attempted_journal
      || String(attempted_journal.effect_domain || '').toUpperCase() !== 'PROCESS'
      || String(attempted_journal.state || '').toUpperCase() !== 'EFFECT_ATTEMPTED') {
    return decision('HOLD', 'DURABLE_EFFECT_ATTEMPT_BARRIER_REQUIRED', {
      effect_id: effectId,
      effect_generation: generation,
    });
  }

  if (nonEmpty(attempted_journal.effect_id) !== effectId
      || positiveInt(attempted_journal.effect_generation) !== generation) {
    return decision('HOLD', 'EFFECT_ATTEMPT_GENERATION_DRIFT', {
      effect_id: effectId,
      effect_generation: generation,
    });
  }

  if (!samePlanIdentity(identity, attempted_journal.plan)) {
    return decision('HOLD', 'EFFECT_ATTEMPT_PLAN_DRIFT', {
      effect_id: effectId,
      effect_generation: generation,
    });
  }

  const action = String(identity.action).toUpperCase();
  return decision('DISPATCH_EXACT_EFFECT_ONCE', 'DURABLE_EFFECT_ATTEMPT_BARRIER_EXACTLY_MATCHED', {
    effect_id: effectId,
    effect_generation: generation,
    effect_action: action,
    target_release: releaseIdentity(identity.target_release),
    exact_pid: action === 'RESTART_EXACT_CHILD' ? positiveInt(identity.exact_pid) : null,
    exact_process_incarnation_id: action === 'RESTART_EXACT_CHILD' ? nonEmpty(identity.exact_process_incarnation_id) : null,
    process_absence_proven: action === 'START_CHILD',
  });
}
