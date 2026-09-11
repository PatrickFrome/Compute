import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERIFIED_EXECUTION_OUTCOME_SCHEMA,
  VERIFIED_EXECUTION_TERMINAL_STATE,
  classifyVerifiedExecutionOutcome,
} from '../src/verified-execution-outcome.mjs';

function assertFailClosed(result, expectedState, expectedReason) {
  assert.equal(result.schema, VERIFIED_EXECUTION_OUTCOME_SCHEMA);
  assert.equal(result.state, expectedState);
  assert.equal(result.reason, expectedReason);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(Object.isFrozen(result), true);
}

test('positive readback after dispatch is CONFIRMED without retry authority', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    effect_confirmed: true,
  });
  assertFailClosed(result, VERIFIED_EXECUTION_TERMINAL_STATE.CONFIRMED, 'POSITIVE_READBACK');
});

test('negative readback after dispatch is NO_EFFECT_PROVEN without replay authority', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    no_effect_proven: true,
  });
  assertFailClosed(result, VERIFIED_EXECUTION_TERMINAL_STATE.NO_EFFECT_PROVEN, 'NEGATIVE_READBACK');
});

test('pre-effect failure and fence stay distinct before dispatch', () => {
  const failed = classifyVerifiedExecutionOutcome({ failed_pre_effect: true });
  assertFailClosed(failed, VERIFIED_EXECUTION_TERMINAL_STATE.FAILED_PRE_EFFECT, 'PRE_EFFECT_FAILURE');

  const fenced = classifyVerifiedExecutionOutcome({ fenced_pre_effect: true });
  assertFailClosed(fenced, VERIFIED_EXECUTION_TERMINAL_STATE.FENCED, 'PRE_EFFECT_FENCE');
});

test('unknown outcome after dispatch is AMBIGUOUS and cannot retry automatically', () => {
  const result = classifyVerifiedExecutionOutcome({ dispatch_started: true });
  assertFailClosed(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'POST_DISPATCH_EFFECT_UNKNOWN');
  assert.equal(result.evidence_conflict, false);
});

test('contradictory positive and negative readback is AMBIGUOUS', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    effect_confirmed: true,
    no_effect_proven: true,
  });
  assertFailClosed(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
  assert.equal(result.evidence_conflict, true);
});

test('chronologically impossible evidence fails closed as AMBIGUOUS', () => {
  const preDispatchReadback = classifyVerifiedExecutionOutcome({
    dispatch_started: false,
    effect_confirmed: true,
  });
  assertFailClosed(preDispatchReadback, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');

  const postDispatchPreEffectFailure = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    failed_pre_effect: true,
  });
  assertFailClosed(postDispatchPreEffectFailure, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
});

test('insufficient undispatched terminal evidence is AMBIGUOUS rather than inferred safe', () => {
  const result = classifyVerifiedExecutionOutcome({});
  assertFailClosed(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'TERMINAL_EVIDENCE_INSUFFICIENT');
});

test('non-boolean evidence is rejected rather than coerced', () => {
  assert.throws(
    () => classifyVerifiedExecutionOutcome({ dispatch_started: 'yes' }),
    /verified_execution_outcome_dispatch_started_invalid/,
  );
  assert.throws(
    () => classifyVerifiedExecutionOutcome({ no_effect_proven: 1 }),
    /verified_execution_outcome_no_effect_proven_invalid/,
  );
});
