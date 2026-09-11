export const VERIFIED_EXECUTION_OUTCOME_SCHEMA = 'metaengine.verified-execution-outcome.v1';

export const VERIFIED_EXECUTION_TERMINAL_STATE = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  NO_EFFECT_PROVEN: 'NO_EFFECT_PROVEN',
  FAILED_PRE_EFFECT: 'FAILED_PRE_EFFECT',
  FENCED: 'FENCED',
  AMBIGUOUS: 'AMBIGUOUS',
});

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalBoolean(value, name) {
  if (value == null) return false;
  if (typeof value !== 'boolean') throw new Error(`verified_execution_outcome_${name}_invalid`);
  return value;
}

export function classifyVerifiedExecutionOutcome(value = {}) {
  if (!plainObject(value)) throw new Error('verified_execution_outcome_input_invalid');

  const dispatchStarted = optionalBoolean(value.dispatch_started, 'dispatch_started');
  const effectConfirmed = optionalBoolean(value.effect_confirmed, 'effect_confirmed');
  const noEffectProven = optionalBoolean(value.no_effect_proven, 'no_effect_proven');
  const failedPreEffect = optionalBoolean(value.failed_pre_effect, 'failed_pre_effect');
  const fencedPreEffect = optionalBoolean(value.fenced_pre_effect, 'fenced_pre_effect');
  const explicitConflict = optionalBoolean(value.evidence_conflict, 'evidence_conflict');

  const contradictoryEvidence = explicitConflict
    || (effectConfirmed && noEffectProven)
    || (!dispatchStarted && (effectConfirmed || noEffectProven))
    || (dispatchStarted && (failedPreEffect || fencedPreEffect))
    || (failedPreEffect && fencedPreEffect);

  let state;
  let reason;

  if (contradictoryEvidence) {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS;
    reason = 'EVIDENCE_CONFLICT';
  } else if (!dispatchStarted && fencedPreEffect) {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.FENCED;
    reason = 'PRE_EFFECT_FENCE';
  } else if (!dispatchStarted && failedPreEffect) {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.FAILED_PRE_EFFECT;
    reason = 'PRE_EFFECT_FAILURE';
  } else if (dispatchStarted && effectConfirmed) {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.CONFIRMED;
    reason = 'POSITIVE_READBACK';
  } else if (dispatchStarted && noEffectProven) {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.NO_EFFECT_PROVEN;
    reason = 'NEGATIVE_READBACK';
  } else if (dispatchStarted) {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS;
    reason = 'POST_DISPATCH_EFFECT_UNKNOWN';
  } else {
    state = VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS;
    reason = 'TERMINAL_EVIDENCE_INSUFFICIENT';
  }

  return Object.freeze({
    schema: VERIFIED_EXECUTION_OUTCOME_SCHEMA,
    state,
    reason,
    dispatch_started: dispatchStarted,
    effect_confirmed: effectConfirmed,
    no_effect_proven: noEffectProven,
    failed_pre_effect: failedPreEffect,
    fenced_pre_effect: fencedPreEffect,
    evidence_conflict: contradictoryEvidence,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
