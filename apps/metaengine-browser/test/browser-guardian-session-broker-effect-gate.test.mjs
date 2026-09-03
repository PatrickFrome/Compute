import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { gateBrowserGuardianSessionBrokerEffect } from '../src/browser-guardian-session-broker-effect-gate.mjs';

const binding = Object.freeze({
  service_name: 'METAENGINEBrowserGuardian',
  broker_executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINEBrowserSessionBroker.exe',
  expected_owner_sid: 'S-1-5-21-1000-2000-3000-1001',
});
const effectId = '11111111-2222-4333-8444-555555555555';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

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
  const upper = String(state).toUpperCase();
  const dispatched = ['EFFECT_DISPATCHED', 'CONFIRMED'].includes(upper);
  const attempted = ['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS', 'CONFIRMED'].includes(upper);
  const storedPlan = overrides.plan ?? {
    action: 'START_BROKER',
    broker_executable: binding.broker_executable,
    broker_absence_proven: true,
    selected_session: { session_id: 7, user_sid: binding.expected_owner_sid, state: 'ACTIVE' },
  };
  const row = {
    schema: 'metaengine.browser-guardian.session-broker-effect-journal.v1',
    version: '1.0.0',
    ...binding,
    state: upper,
    effect_id: effectId,
    effect_generation: 3,
    plan: storedPlan,
    physical_effect_attempted: attempted,
    effect_barrier_crossed: attempted,
    dispatched_pid: dispatched ? 4242 : null,
    dispatched_process_incarnation_id: dispatched ? 'pid:4242:created_100ns:99' : null,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    process_effect_authority: false,
    authority_effect: false,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'plan_digest')) row.plan_digest = digest(row.plan);
  return row;
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
  assert.equal(out.effect_id, effectId);
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

test('malformed effect id or generation can never become an executor candidate', () => {
  for (const broken of [
    journal('INTENT_RECORDED', { effect_id: 'effect-a' }),
    journal('INTENT_RECORDED', { effect_generation: 0 }),
  ]) {
    const out = gateBrowserGuardianSessionBrokerEffect({ plan: plan(), journal_snapshot: broken, binding });
    assert.equal(out.step, 'HOLD_JOURNAL_INVALID');
    assert.equal(out.reason, 'durable_effect_identity_invalid');
    assert.equal(out.executor_candidate, false);
  }
});

test('stored plan digest drift is rejected before planner identity comparison', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: plan(),
    journal_snapshot: journal('INTENT_RECORDED', { plan_digest: 'f'.repeat(64) }),
    binding,
  });
  assert.equal(out.step, 'HOLD_JOURNAL_INVALID');
  assert.equal(out.reason, 'durable_plan_digest_invalid');
  assert.equal(out.executor_candidate, false);
});

test('impossible state/barrier or partial dispatch combinations fail closed', () => {
  const invalidRows = [
    journal('INTENT_RECORDED', { physical_effect_attempted: true, effect_barrier_crossed: true }),
    journal('EFFECT_ATTEMPTED', { physical_effect_attempted: false, effect_barrier_crossed: false }),
    journal('EFFECT_DISPATCHED', { dispatched_process_incarnation_id: null }),
    journal('CONFIRMED', { dispatched_pid: null, dispatched_process_incarnation_id: null }),
  ];
  for (const row of invalidRows) {
    const out = gateBrowserGuardianSessionBrokerEffect({ plan: plan(), journal_snapshot: row, binding });
    assert.equal(out.step, 'HOLD_JOURNAL_INVALID');
    assert.equal(out.executor_candidate, false);
  }
});

test('authority-bearing durable snapshot cannot reach the executor boundary', () => {
  const out = gateBrowserGuardianSessionBrokerEffect({
    plan: plan(),
    journal_snapshot: journal('INTENT_RECORDED', { process_effect_authority: true }),
    binding,
  });
  assert.equal(out.step, 'HOLD_JOURNAL_INVALID');
  assert.equal(out.reason, 'durable_journal_authority_invalid:process_effect_authority');
  assert.equal(out.executor_candidate, false);
});
