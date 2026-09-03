import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGuardianSessionBrokerPlan } from '../src/browser-guardian-session-broker-core.mjs';

const NOW = 1_000_000;
const OWNER = 'S-1-5-21-111-222-333-1001';
const OTHER = 'S-1-5-21-111-222-333-1002';

function desired(overrides = {}) {
  return {
    state: 'RUNNING',
    external_stop_requested: false,
    expected_owner_sid: OWNER,
    broker_policy: {
      broker_liveness_timeout_ms: 5_000,
      restart_window_ms: 60_000,
      max_restarts_in_window: 3,
    },
    ...overrides,
  };
}

function session(overrides = {}) {
  return { session_id: 4, user_sid: OWNER, state: 'ACTIVE', ...overrides };
}

function broker(overrides = {}) {
  return {
    pid: 4321,
    process_incarnation_id: 'broker-inc-1',
    session_id: 4,
    user_sid: OWNER,
    heartbeat_at_ms: NOW - 250,
    ...overrides,
  };
}

function observed(overrides = {}) {
  return {
    sessions: [session()],
    broker: broker(),
    broker_absence_proven: false,
    broker_restart_history_ms: [],
    ...overrides,
  };
}

function assertZeroAuthority(plan) {
  assert.equal(plan.actuation_eligible, false);
  assert.equal(plan.automatic_retry_allowed, false);
  assert.equal(plan.browser_authority, false);
  assert.equal(plan.task_authority, false);
  assert.equal(plan.scheduler_authority, false);
  assert.equal(plan.page_model_text_authority, false);
  assert.equal(plan.release_authority, false);
  assert.equal(plan.session_token_authority, false);
  assert.equal(plan.authority_effect, false);
}

test('external stop is terminal for user-session broker planning', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired({ external_stop_requested: true }), observed: {}, now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'EXTERNAL_STOP_RECORDED');
  assertZeroAuthority(plan);
});

test('invalid expected owner SID cannot select an interactive user', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired({ expected_owner_sid: 'Patrick' }), observed: observed(), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_NO_SESSION');
  assert.equal(plan.reason, 'EXPECTED_OWNER_SID_INVALID');
  assertZeroAuthority(plan);
});

test('an active session belonging to a different SID is never used as fallback', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ sessions: [session({ user_sid: OTHER })], broker: null }), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_NO_SESSION');
  assert.equal(plan.reason, 'EXPECTED_OWNER_SESSION_NOT_ACTIVE');
});

test('multiple active sessions for the expected SID fail closed as ambiguous', () => {
  const plan = evaluateGuardianSessionBrokerPlan({
    desired: desired(),
    observed: observed({ sessions: [session({ session_id: 4 }), session({ session_id: 9 })] }),
    now_ms: NOW,
  });
  assert.equal(plan.action, 'HOLD_AMBIGUOUS_SESSION');
  assert.equal(plan.reason, 'EXPECTED_OWNER_SESSION_AMBIGUOUS');
  assert.deepEqual(plan.matching_session_ids, [4, 9]);
  assertZeroAuthority(plan);
});

test('broker absence must be positively proven before proposing CreateProcessAsUser', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ broker: null, broker_absence_proven: false }), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_BROKER_IDENTITY');
  assert.equal(plan.reason, 'BROKER_ABSENCE_UNPROVEN');
  assert.equal(plan.process_effect_candidate, false);
});

test('proven absence proposes one external broker start for the exact owner session', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ broker: null, broker_absence_proven: true }), now_ms: NOW });
  assert.equal(plan.action, 'START_BROKER');
  assert.equal(plan.reason, 'EXACT_OWNER_SESSION_BROKER_ABSENCE_PROVEN');
  assert.equal(plan.process_effect_candidate, true);
  assert.equal(plan.requires_user_session_executor, true);
  assert.equal(plan.selected_session.session_id, 4);
  assert.equal(plan.selected_session.user_sid, OWNER);
  assertZeroAuthority(plan);
});

test('broker from another session cannot be killed or adopted', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ broker: broker({ session_id: 9 }) }), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_BROKER_IDENTITY');
  assert.equal(plan.reason, 'BROKER_SESSION_BINDING_MISMATCH');
  assert.equal(plan.process_effect_candidate, false);
});

test('broker from another SID cannot be killed or adopted', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ broker: broker({ user_sid: OTHER }) }), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_BROKER_IDENTITY');
  assert.equal(plan.reason, 'BROKER_SESSION_BINDING_MISMATCH');
  assert.equal(plan.process_effect_candidate, false);
});

test('fresh exact broker is healthy and requires no process effect', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed(), now_ms: NOW });
  assert.equal(plan.action, 'NOOP');
  assert.equal(plan.reason, 'EXACT_OWNER_SESSION_BROKER_HEALTHY');
  assert.equal(plan.exact_pid, 4321);
  assert.equal(plan.exact_process_incarnation_id, 'broker-inc-1');
  assert.equal(plan.process_effect_candidate, false);
  assertZeroAuthority(plan);
});

test('future heartbeat timestamp is rejected instead of appearing fresh', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ broker: broker({ heartbeat_at_ms: NOW + 1 }) }), now_ms: NOW });
  assert.equal(plan.action, 'HOLD_BROKER_IDENTITY');
  assert.equal(plan.reason, 'BROKER_HEARTBEAT_TIMESTAMP_INVALID');
});

test('stale exact broker proposes restart of only its exact incarnation', () => {
  const plan = evaluateGuardianSessionBrokerPlan({ desired: desired(), observed: observed({ broker: broker({ heartbeat_at_ms: NOW - 10_000 }) }), now_ms: NOW });
  assert.equal(plan.action, 'RESTART_EXACT_BROKER');
  assert.equal(plan.reason, 'BROKER_LIVENESS_TIMEOUT');
  assert.equal(plan.exact_pid, 4321);
  assert.equal(plan.exact_process_incarnation_id, 'broker-inc-1');
  assert.equal(plan.process_effect_candidate, true);
  assertZeroAuthority(plan);
});

test('local broker restart storm escalates to SCM recovery rather than spinning', () => {
  const plan = evaluateGuardianSessionBrokerPlan({
    desired: desired(),
    observed: observed({
      broker: broker({ heartbeat_at_ms: NOW - 10_000 }),
      broker_restart_history_ms: [NOW - 100, NOW - 200, NOW - 300],
    }),
    now_ms: NOW,
  });
  assert.equal(plan.action, 'ESCALATE_TO_SCM_RECOVERY');
  assert.equal(plan.reason, 'BROKER_RESTART_INTENSITY_EXCEEDED');
  assert.equal(plan.blocked_reason, 'BROKER_LIVENESS_TIMEOUT');
  assert.equal(plan.restart_count_in_window, 3);
  assert.equal(plan.process_effect_candidate, false);
  assertZeroAuthority(plan);
});

test('restart storm also blocks repeated broker creation after proven absence', () => {
  const plan = evaluateGuardianSessionBrokerPlan({
    desired: desired(),
    observed: observed({
      broker: null,
      broker_absence_proven: true,
      broker_restart_history_ms: [NOW - 100, NOW - 200, NOW - 300],
    }),
    now_ms: NOW,
  });
  assert.equal(plan.action, 'ESCALATE_TO_SCM_RECOVERY');
  assert.equal(plan.blocked_reason, 'EXACT_OWNER_SESSION_BROKER_ABSENCE_PROVEN');
  assert.equal(plan.process_effect_candidate, false);
});
