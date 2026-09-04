import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateGuardianSessionBrokerPlan } from '../src/browser-guardian-session-broker-core.mjs';
import { evaluateGuardianSessionBrokerController } from '../src/browser-guardian-session-broker-controller.mjs';

const ownerSid = 'S-1-5-21-1000';
const binding = {
  service_name: 'METAENGINEBrowserGuardian',
  broker_executable: 'METAENGINE Browser Test.exe',
  expected_owner_sid: ownerSid,
};
const desired = {
  state: 'RUNNING',
  external_stop_requested: false,
  expected_owner_sid: ownerSid,
};
const observed = {
  sessions: [{ session_id: 3, user_sid: ownerSid, state: 'ACTIVE' }],
  broker: null,
  broker_absence_proven: true,
  broker_restart_history_ms: [],
};
const now = 1_000_000;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function exactPlan() {
  return evaluateGuardianSessionBrokerPlan({ desired, observed, now_ms: now });
}

function journal(state = 'INTENT_RECORDED', overrides = {}) {
  const plan = {
    action: 'START_BROKER',
    broker_executable: binding.broker_executable,
    broker_absence_proven: true,
    selected_session: { session_id: 3, user_sid: ownerSid, state: 'ACTIVE' },
  };
  const attempted = ['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS', 'CONFIRMED'].includes(state);
  const dispatched = ['EFFECT_DISPATCHED', 'CONFIRMED'].includes(state);
  return {
    schema: 'metaengine.browser-guardian.session-broker-effect-journal.v1',
    version: '1.0.0',
    service_name: binding.service_name,
    broker_executable: binding.broker_executable,
    expected_owner_sid: ownerSid,
    state,
    effect_id: '11111111-2222-4333-8444-555555555555',
    effect_generation: 1,
    plan,
    plan_digest: sha256Json(plan),
    physical_effect_attempted: attempted,
    effect_barrier_crossed: attempted,
    dispatched_pid: dispatched ? 4242 : null,
    dispatched_process_incarnation_id: dispatched ? 'proc-session-broker-1' : null,
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
}

function assertNoAuthority(row) {
  assert.equal(row.physical_effect_attempted, false);
  assert.equal(row.wts_execution_allowed, false);
  assert.equal(row.scm_start_allowed, false);
  assert.equal(row.process_effect_allowed, false);
  assert.equal(row.journal_mutation_allowed, false);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.retry_loop_allowed, false);
  assert.equal(row.second_scheduler_allowed, false);
  assert.equal(row.browser_authority, false);
  assert.equal(row.task_authority, false);
  assert.equal(row.page_model_text_authority, false);
  assert.equal(row.release_authority, false);
  assert.equal(row.session_token_authority, false);
  assert.equal(row.authority_effect, false);
}

test('fresh exact START_BROKER plan with no journal requests RECORD_INTENT only', () => {
  const result = evaluateGuardianSessionBrokerController({ desired, observed, binding, now_ms: now });
  assert.equal(result.step, 'RECORD_INTENT');
  assert.equal(result.record_intent_candidate, true);
  assertNoAuthority(result);
});

test('exact durable INTENT_RECORDED projects ONE_ATTEMPT_CANDIDATE without WTS authority', () => {
  const result = evaluateGuardianSessionBrokerController({
    desired, observed, binding, now_ms: now, journal_snapshot: journal('INTENT_RECORDED'),
  });
  assert.equal(result.step, 'ONE_ATTEMPT_CANDIDATE');
  assert.equal(result.one_attempt_candidate, true);
  assert.equal(result.effect_id, '11111111-2222-4333-8444-555555555555');
  assertNoAuthority(result);
});

test('crossed effect barrier always projects RECONCILE and never another attempt', () => {
  for (const state of ['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS']) {
    const result = evaluateGuardianSessionBrokerController({
      desired, observed, binding, now_ms: now, journal_snapshot: journal(state),
    });
    assert.equal(result.step, 'RECONCILE', state);
    assert.equal(result.reconcile_required, true, state);
    assert.equal(result.one_attempt_candidate, false, state);
    assertNoAuthority(result);
  }
});

test('confirmed broker journal holds instead of raw start replay', () => {
  const result = evaluateGuardianSessionBrokerController({
    desired, observed, binding, now_ms: now, journal_snapshot: journal('CONFIRMED'),
  });
  assert.equal(result.step, 'HOLD');
  assert.equal(result.gate_step, 'HOLD_CONFIRMED');
  assertNoAuthority(result);
});

test('session ambiguity, binding drift and invalid durable journal fail closed', () => {
  const cases = [
    { observed: { ...observed, sessions: [] }, binding, journal_snapshot: null },
    { observed, binding: { ...binding, expected_owner_sid: 'S-1-5-21-9999' }, journal_snapshot: null },
    { observed, binding, journal_snapshot: { ...journal(), plan_digest: '0'.repeat(64) } },
  ];
  for (const input of cases) {
    const result = evaluateGuardianSessionBrokerController({ desired, now_ms: now, ...input });
    assert.equal(result.step, 'HOLD');
    assertNoAuthority(result);
  }
});

test('restart and SCM escalation stay outside controller effect authority', () => {
  const staleObserved = {
    ...observed,
    broker: {
      pid: 111,
      process_incarnation_id: 'old-broker',
      session_id: 3,
      user_sid: ownerSid,
      heartbeat_at_ms: now - 60_000,
    },
    broker_absence_proven: false,
  };
  const restart = evaluateGuardianSessionBrokerController({ desired, observed: staleObserved, binding, now_ms: now });
  assert.equal(restart.step, 'HOLD');
  assertNoAuthority(restart);

  const escalation = evaluateGuardianSessionBrokerController({
    desired,
    observed: { ...staleObserved, broker_restart_history_ms: [now - 1_000, now - 2_000, now - 3_000] },
    binding,
    now_ms: now,
  });
  assert.equal(escalation.step, 'HOLD');
  assert.equal(escalation.reason, 'scm_recovery_is_outside_controller_authority');
  assertNoAuthority(escalation);
});

test('controller source has no executor, timer, scheduler, spawn or service-start primitive', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = await fs.readFile(path.resolve(here, '../src/browser-guardian-session-broker-controller.mjs'), 'utf8');
  for (const forbidden of [
    /CreateProcessAsUserW/i,
    /WTSQueryUserToken/i,
    /StartServiceW/i,
    /Start-Process/i,
    /child_process/i,
    /\bspawn\s*\(/i,
    /\bexec(?:File)?\s*\(/i,
    /setInterval\s*\(/i,
    /setTimeout\s*\(/i,
    /schedule/i,
    /retry\s*\(/i,
  ]) {
    assert.equal(forbidden.test(raw), false, `forbidden controller primitive: ${forbidden}`);
  }
});
