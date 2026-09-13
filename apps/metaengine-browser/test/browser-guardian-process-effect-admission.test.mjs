import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSER_GUARDIAN_PROCESS_EFFECT_ADMISSION_SCHEMA,
  evaluateBrowserGuardianProcessEffectAdmission,
} from '../src/browser-guardian-process-effect-admission.mjs';

const RELEASE = Object.freeze({ release_id: 'release-a', artifact_sha256: 'a'.repeat(64) });

function basePlan(action = 'START_CHILD') {
  return {
    schema: 'metaengine.browser-guardian.plan.v1',
    action,
    target_release: RELEASE,
    process_effect_candidate: true,
    requires_external_executor: true,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
    ...(action === 'START_CHILD' ? { process_absence_proven: true } : {}),
  };
}

function journal(plan, state, extra = {}) {
  return {
    effect_domain: 'PROCESS',
    effect_id: '0d4b6adb-8995-4df1-b75f-2be8efe28385',
    effect_generation: 7,
    state,
    plan: {
      action: plan.action,
      target_release: plan.target_release,
      exact_pid: plan.exact_pid ?? null,
      exact_process_incarnation_id: plan.exact_process_incarnation_id ?? null,
      process_absence_proven: plan.process_absence_proven === true,
    },
    ...extra,
  };
}

function assertZeroAuthority(result) {
  assert.equal(result.actuation_eligible, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.browser_authority, false);
  assert.equal(result.task_authority, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.page_model_text_authority, false);
  assert.equal(result.release_authority, false);
  assert.equal(result.authority_effect, false);
}

test('requires durable intent before exposing any executor attempt', () => {
  const plan = basePlan();
  const result = evaluateBrowserGuardianProcessEffectAdmission({ plan });
  assert.equal(result.schema, BROWSER_GUARDIAN_PROCESS_EFFECT_ADMISSION_SCHEMA);
  assert.equal(result.action, 'RECORD_INTENT');
  assert.equal(result.executor_dispatch_eligible, false);
  assertZeroAuthority(result);
});

test('admits exactly one external attempt only from matching INTENT_RECORDED', () => {
  const plan = basePlan();
  const result = evaluateBrowserGuardianProcessEffectAdmission({ plan, effect_journal: journal(plan, 'INTENT_RECORDED') });
  assert.equal(result.action, 'ATTEMPT_EXACT_EFFECT');
  assert.equal(result.executor_dispatch_eligible, true);
  assert.equal(result.effect_generation, 7);
  assertZeroAuthority(result);
});

test('attempted, dispatched and ambiguous generations are reconciliation-only', () => {
  const plan = basePlan();
  for (const state of ['EFFECT_ATTEMPTED', 'EFFECT_DISPATCHED', 'AMBIGUOUS']) {
    const result = evaluateBrowserGuardianProcessEffectAdmission({ plan, effect_journal: journal(plan, state) });
    assert.equal(result.action, 'RECONCILE_ONLY');
    assert.equal(result.executor_dispatch_eligible, false);
    assert.equal(result.automatic_retry_allowed, false);
  }
});

test('restart is fenced to exact pid and process incarnation', () => {
  const plan = {
    ...basePlan('RESTART_EXACT_CHILD'),
    exact_pid: 4242,
    exact_process_incarnation_id: 'incarnation-9',
  };
  const drifted = journal(plan, 'INTENT_RECORDED');
  drifted.plan = { ...drifted.plan, exact_process_incarnation_id: 'incarnation-old' };
  const result = evaluateBrowserGuardianProcessEffectAdmission({ plan, effect_journal: drifted });
  assert.equal(result.action, 'HOLD');
  assert.equal(result.reason, 'EFFECT_JOURNAL_PLAN_DRIFT');
  assert.equal(result.executor_dispatch_eligible, false);
});

test('non-effect or heartbeat-quarantined NOOP can never reach the executor', () => {
  const result = evaluateBrowserGuardianProcessEffectAdmission({
    plan: {
      schema: 'metaengine.browser-guardian.health-admission.v1',
      action: 'NOOP',
      reason: 'SPLIT_HEARTBEAT_FENCE_REJECTED',
      process_effect_candidate: false,
      requires_external_executor: false,
      actuation_eligible: false,
      automatic_retry_allowed: false,
      browser_authority: false,
      task_authority: false,
      scheduler_authority: false,
      page_model_text_authority: false,
      release_authority: false,
      authority_effect: false,
    },
  });
  assert.equal(result.action, 'HOLD');
  assert.equal(result.executor_dispatch_eligible, false);
});

test('NO_EFFECT_PROVEN permits only a new durable intent, never direct replay', () => {
  const plan = basePlan();
  const result = evaluateBrowserGuardianProcessEffectAdmission({ plan, effect_journal: journal(plan, 'NO_EFFECT_PROVEN') });
  assert.equal(result.action, 'RECORD_INTENT');
  assert.equal(result.executor_dispatch_eligible, false);
  assert.equal(result.prior_effect_generation, 7);
});
