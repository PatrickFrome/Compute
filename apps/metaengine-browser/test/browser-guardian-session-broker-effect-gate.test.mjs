import assert from 'node:assert/strict';
import test from 'node:test';
import { gateBrowserGuardianSessionBrokerEffect } from '../src/browser-guardian-session-broker-effect-gate.mjs';

const binding = Object.freeze({
  service_name: 'METAENGINEBrowserGuardian',
  broker_executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINEBrowserSessionBroker.exe',
  expected_owner_sid: 'S-1-5-21-1000-2000-3000-1001',
});

function plan(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.session-broker-plan.v1',
    action: 'START_BROKER',
    process_effect_candidate: true,
    requires_user_session_executor: true,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    authority_effect: false,
    selected_session: { session_id: 7, user_sid: binding.expected_owner_sid, state: 'ACTIVE' },
    broker_absence_proven: true,
    ...overrides,
  };
}

function journal(state, overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.session-broker-effect-journal.v1',
    version: '1.0.0',
    ...binding,
    state,
    effect_id: 'effect-a',
    effect_generation: 3,
    plan: {
      action: 'START_BROKER',
      broker_executable: binding.broker_executable,
      broker_absence_proven: true,
      selected_session: { session_id: 7, user_sid: binding.expected_owner_sid, state: 'ACTIVE' },
    },
    ...overrides,
  };
}

function zeroAuthority(row) {
  for (const field of [
    'actuation_eligible', 'automatic_retry_allowed', 'browser_authority', 'task_authority',
    'scheduler_authority', 'page_model_text_authority', 'release_authority',
    'session_token_authority', 'process_effect_authority', 'authority_effect',
  ]) assert.equal(row[field], false, `${field} must remain false`);
}

test('missing durable journal can only request intent recording', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({ plan: plan(), binding });
  assert.equal(out.step, 'RECORD_INTENT');
  assert.equal(out.executor_candidate, false);
  zeroAuthority(out);
});

test('only exact INTENT_RECORDED identity may produce one executor candidate', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: plan(),
    journal_snapshot: journal('INTENT_RECORDED'),
    binding,
  });
  assert.equal(out.step, 'ATTEMPT_EXACT_START');
  assert.equal(out.executor_candidate, true);
  assert.equal(out.requires_user_session_executor, true);
  assert.equal(out.effect_id, 'effect-a');
  assert.equal(out.effect_generation, 3);
  zeroAuthority(out);
});

test('effect barrier states are reconcile-only and never become another attempt', () => {
  for (const state of ['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS']) {
    const out = gateBrowserGuardianSessionBrokerEffect({ plan: plan(), journal_snapshot: journal(state), binding });
    assert.equal(out.step, 'RECONCILE_ONLY');
    assert.equal(out.executor_candidate, false);
    zeroAuthority(out);
  }
});

test('confirmed broker permanently blocks raw START_BROKER even if planner observation says absent', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: plan({ broker_absence_proven: true }),
    journal_snapshot: journal('CONFIRMED'),
    binding,
  });
  assert.equal(out.step, 'HOLD_CONFIRMED');
  assert.equal(out.executor_candidate, false);
  zeroAuthority(out);
});

test('NO_EFFECT_PROVEN requires a new durable intent generation before another attempt', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: plan(),
    journal_snapshot: journal('NO_EFFECT_PROVEN'),
    binding,
  });
  assert.equal(out.step, 'RECORD_INTENT');
  assert.equal(out.previous_effect_generation, 3);
  assert.equal(out.executor_candidate, false);
});

test('durable binding or plan identity drift fails closed', () => {
  const bindingDrift = gateBrowserGuardianSessionBrokerEffect({
    plan: plan(),
    journal_snapshot: journal('INTENT_RECORDED', { expected_owner_sid: 'S-1-5-21-1000-2000-3000-1002' }),
    binding,
  });
  assert.equal(bindingDrift.step, 'HOLD_JOURNAL_BINDING_DRIFT');

  const planDrift = gateBrowserGuardianSessionBrokerEffect({
    plan: plan(),
    journal_snapshot: journal('INTENT_RECORDED', {
      plan: {
        action: 'START_BROKER',
        broker_executable: binding.broker_executable,
        broker_absence_proven: true,
        selected_session: { session_id: 8, user_sid: binding.expected_owner_sid, state: 'ACTIVE' },
      },
    }),
    binding,
  });
  assert.equal(planDrift.step, 'HOLD_JOURNAL_PLAN_DRIFT');
  assert.equal(planDrift.executor_candidate, false);
});

test('authority-bearing or unproven start plans are rejected before journal state matters', () => {
  assert.throws(
    () => gateBrowserGuardianSessionBrokerEffect({ plan: plan({ session_token_authority: true }), binding }),
    /guardian_session_broker_effect_gate_plan_authority_invalid:session_token_authority/,
  );
  assert.throws(
    () => gateBrowserGuardianSessionBrokerEffect({ plan: plan({ broker_absence_proven: false }), binding }),
    /guardian_session_broker_effect_gate_absence_unproven/,
  );
});

test('RESTART_EXACT_BROKER is held for a separate two-phase protocol', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: plan({ action: 'RESTART_EXACT_BROKER' }),
    journal_snapshot: journal('CONFIRMED'),
    binding,
  });
  assert.equal(out.step, 'HOLD_UNSUPPORTED_RESTART');
  assert.equal(out.executor_candidate, false);
  zeroAuthority(out);
});

test('non-effect planner actions do not reach the executor boundary', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: { schema: 'metaengine.browser-guardian.session-broker-plan.v1', action: 'HOLD_NO_SESSION' },
    journal_snapshot: null,
    binding,
  });
  assert.equal(out.step, 'HOLD_PLAN');
  assert.equal(out.executor_candidate, false);
  assert.equal(out.planner_action, 'HOLD_NO_SESSION');
});
