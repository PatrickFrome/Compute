import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTraceRecorderV1, verifyTraceReplayV1, TraceReplayError } from '../coordination/browser-shared/trace-replay-v1.mjs';

const D = (v) => `sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
const SOURCE = '2c61104b7eb27e56c9955e602f12bc6b2ea68302';
function err(fn, code) { assert.throws(fn, (e) => e instanceof TraceReplayError && e.code === code); }

function baseTrace(outcome = 'COMMITTED') {
  const r = createTraceRecorderV1({ traceId: 'trace.r13.001', sourceCommit: SOURCE });
  r.record({ event_id: 'evt.decision', event_type: 'DECISION_RECORDED', subject_id: 'action.001', parent_event_ids: [], evidence_digest: D('decision'), outcome: null });
  r.record({ event_id: 'evt.intent', event_type: 'EFFECT_INTENT_RECORDED', subject_id: 'action.001', parent_event_ids: ['evt.decision'], evidence_digest: D('intent'), outcome: null });
  r.record({ event_id: 'evt.obs', event_type: 'EFFECT_OBSERVATION_RECORDED', subject_id: 'action.001', parent_event_ids: ['evt.intent'], evidence_digest: D('observation'), outcome: null });
  r.record({ event_id: 'evt.terminal', event_type: 'TERMINAL_RECORDED', subject_id: 'action.001', parent_event_ids: ['evt.obs'], evidence_digest: D('terminal'), outcome });
  return r.snapshot();
}

test('replay verifies hash chain and returns derived terminal state only', () => {
  const trace = baseTrace('COMMITTED');
  const replay = verifyTraceReplayV1(trace);
  assert.equal(replay.event_count, 4);
  assert.deepEqual(replay.terminal_outcomes, [{ subject_id: 'action.001', outcome: 'COMMITTED' }]);
  assert.equal(replay.replay_executes_effects, false);
  assert.equal(replay.authority_effect, false);
  assert.equal(replay.actuation_eligible, false);
});

test('ambiguity survives replay unchanged', () => {
  const replay = verifyTraceReplayV1(baseTrace('AMBIGUOUS'));
  assert.deepEqual(replay.terminal_outcomes, [{ subject_id: 'action.001', outcome: 'AMBIGUOUS' }]);
  assert.deepEqual(replay.ambiguous_subject_ids, ['action.001']);
});

test('aborted subject may terminate before effect intent', () => {
  const r = createTraceRecorderV1({ traceId: 'trace.r13.abort', sourceCommit: SOURCE });
  r.record({ event_id: 'evt.abort.decision', event_type: 'DECISION_RECORDED', subject_id: 'action.abort', parent_event_ids: [], evidence_digest: D('decision'), outcome: null });
  r.record({ event_id: 'evt.abort.term', event_type: 'TERMINAL_RECORDED', subject_id: 'action.abort', parent_event_ids: ['evt.abort.decision'], evidence_digest: D('abort'), outcome: 'ABORTED' });
  assert.equal(verifyTraceReplayV1(r.snapshot()).terminal_outcomes[0].outcome, 'ABORTED');
});

test('effectful terminal requires prior effect intent', () => {
  const r = createTraceRecorderV1({ traceId: 'trace.r13.nointent', sourceCommit: SOURCE });
  r.record({ event_id: 'evt.nointent.decision', event_type: 'DECISION_RECORDED', subject_id: 'action.nointent', parent_event_ids: [], evidence_digest: D('decision'), outcome: null });
  err(() => r.record({ event_id: 'evt.nointent.term', event_type: 'TERMINAL_RECORDED', subject_id: 'action.nointent', parent_event_ids: ['evt.nointent.decision'], evidence_digest: D('terminal'), outcome: 'NO_EFFECT' }), 'trace_terminal_effect_intent_missing');
});

test('future or missing causal parent is rejected at record time', () => {
  const r = createTraceRecorderV1({ traceId: 'trace.r13.parent', sourceCommit: SOURCE });
  err(() => r.record({ event_id: 'evt.child', event_type: 'DECISION_RECORDED', subject_id: 'action.parent', parent_event_ids: ['evt.future'], evidence_digest: D('x'), outcome: null }), 'trace_parent_must_precede_child');
});

test('terminal outcome is single assignment', () => {
  const r = createTraceRecorderV1({ traceId: 'trace.r13.terminal', sourceCommit: SOURCE });
  r.record({ event_id: 'evt.intent', event_type: 'EFFECT_INTENT_RECORDED', subject_id: 'action.term', parent_event_ids: [], evidence_digest: D('intent'), outcome: null });
  r.record({ event_id: 'evt.term1', event_type: 'TERMINAL_RECORDED', subject_id: 'action.term', parent_event_ids: ['evt.intent'], evidence_digest: D('term1'), outcome: 'COMMITTED' });
  err(() => r.record({ event_id: 'evt.term2', event_type: 'TERMINAL_RECORDED', subject_id: 'action.term', parent_event_ids: ['evt.term1'], evidence_digest: D('term2'), outcome: 'AMBIGUOUS' }), 'trace_subject_already_terminal');
});

test('tampered evidence or hash chain is rejected by replay', () => {
  const trace = structuredClone(baseTrace());
  trace.events[2].evidence_digest = D('tampered');
  err(() => verifyTraceReplayV1(trace), 'trace_event_hash_invalid');

  const trace2 = structuredClone(baseTrace());
  trace2.events[3].prev_hash = D('wrong-prev');
  err(() => verifyTraceReplayV1(trace2), 'trace_prev_hash_invalid');
});

test('event envelope cannot switch source commit mid-trace', () => {
  const trace = structuredClone(baseTrace());
  trace.events[1].source_commit = '0'.repeat(40);
  err(() => verifyTraceReplayV1(trace), 'trace_event_envelope_mismatch');
});

test('non-terminal events cannot smuggle terminal outcome', () => {
  const r = createTraceRecorderV1({ traceId: 'trace.r13.outcome', sourceCommit: SOURCE });
  err(() => r.record({ event_id: 'evt.bad', event_type: 'DECISION_RECORDED', subject_id: 'action.bad', parent_event_ids: [], evidence_digest: D('bad'), outcome: 'COMMITTED' }), 'trace_non_terminal_outcome_forbidden');
});

test('trace envelope cannot claim replay authority or execution', () => {
  for (const field of ['authority_effect', 'actuation_eligible', 'replay_executes_effects']) {
    const trace = structuredClone(baseTrace());
    trace[field] = true;
    err(() => verifyTraceReplayV1(trace), 'trace_replay_authority_invalid');
  }
});
