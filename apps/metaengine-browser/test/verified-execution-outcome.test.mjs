import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERIFIED_EXECUTION_OUTCOME_SCHEMA,
  VERIFIED_EXECUTION_TERMINAL_STATE,
  classifyVerifiedExecutionOutcome,
} from '../src/verified-execution-outcome.mjs';

function assertTerminalProof(result, expectedState, expectedReason) {
  assert.equal(result.schema, VERIFIED_EXECUTION_OUTCOME_SCHEMA);
  assert.equal(result.state, expectedState);
  assert.equal(result.reason, expectedReason);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal('retry' in result, false);
  assert.equal('scheduler' in result, false);
  assert.equal('lease' in result, false);
}

test('positive readback after dispatch is CONFIRMED without retry authority', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    effect_confirmed: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.CONFIRMED, 'POSITIVE_READBACK');
});

test('negative readback after dispatch is NO_EFFECT_PROVEN without replay authority', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    no_effect_proven: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.NO_EFFECT_PROVEN, 'NEGATIVE_READBACK');
});

test('independent proof that no effect occurred is terminal even when dispatch never started', () => {
  const result = classifyVerifiedExecutionOutcome({
    no_effect_proven: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.NO_EFFECT_PROVEN, 'PRE_DISPATCH_NO_EFFECT_PROOF');
  assert.equal(result.dispatch_started, false);
  assert.equal(result.evidence_conflict, false);
});

test('pre-effect failure and fence remain distinct terminal outcomes', () => {
  const failed = classifyVerifiedExecutionOutcome({ failed_pre_effect: true });
  assertTerminalProof(failed, VERIFIED_EXECUTION_TERMINAL_STATE.FAILED_PRE_EFFECT, 'PRE_EFFECT_FAILURE');

  const fenced = classifyVerifiedExecutionOutcome({ fenced_pre_effect: true });
  assertTerminalProof(fenced, VERIFIED_EXECUTION_TERMINAL_STATE.FENCED, 'PRE_EFFECT_FENCE');
});

test('unknown outcome after dispatch is AMBIGUOUS and cannot retry automatically', () => {
  const result = classifyVerifiedExecutionOutcome({ dispatch_started: true });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'POST_DISPATCH_EFFECT_UNKNOWN');
  assert.equal(result.evidence_conflict, false);
});

test('contradictory positive and negative terminal proof fails closed as AMBIGUOUS', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    effect_confirmed: true,
    no_effect_proven: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
  assert.equal(result.evidence_conflict, true);
});

test('positive effect proof before dispatch is a chronology conflict', () => {
  const result = classifyVerifiedExecutionOutcome({
    effect_confirmed: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
  assert.equal(result.evidence_conflict, true);
});

test('pre-effect terminal claims after dispatch fail closed as conflicts', () => {
  for (const evidence of [
    { dispatch_started: true, failed_pre_effect: true },
    { dispatch_started: true, fenced_pre_effect: true },
  ]) {
    const result = classifyVerifiedExecutionOutcome(evidence);
    assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
    assert.equal(result.evidence_conflict, true);
  }
});

test('multiple terminal proof claims fail closed instead of selecting a preferred outcome', () => {
  const result = classifyVerifiedExecutionOutcome({
    no_effect_proven: true,
    failed_pre_effect: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
  assert.equal(result.evidence_conflict, true);
});

test('explicit evidence conflict always dominates otherwise valid proof', () => {
  const result = classifyVerifiedExecutionOutcome({
    dispatch_started: true,
    effect_confirmed: true,
    evidence_conflict: true,
  });
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'EVIDENCE_CONFLICT');
});

test('insufficient undispatched evidence is AMBIGUOUS rather than inferred safe', () => {
  const result = classifyVerifiedExecutionOutcome({});
  assertTerminalProof(result, VERIFIED_EXECUTION_TERMINAL_STATE.AMBIGUOUS, 'TERMINAL_EVIDENCE_INSUFFICIENT');
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
  assert.throws(
    () => classifyVerifiedExecutionOutcome(null),
    /verified_execution_outcome_input_invalid/,
  );
});
