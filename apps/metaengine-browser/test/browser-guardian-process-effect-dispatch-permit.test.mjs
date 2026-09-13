import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBrowserGuardianProcessEffectAdmission } from '../src/browser-guardian-process-effect-admission.mjs';
import {
  BROWSER_GUARDIAN_PROCESS_EFFECT_DISPATCH_PERMIT_SCHEMA,
  buildBrowserGuardianProcessEffectDispatchPermit,
} from '../src/browser-guardian-process-effect-dispatch-permit.mjs';

const RELEASE = Object.freeze({ release_id: 'release-a', artifact_sha256: 'a'.repeat(64) });

function plan(action = 'START_CHILD') {
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

function journal(sourcePlan, state = 'INTENT_RECORDED') {
  return {
    effect_domain: 'PROCESS',
    effect_id: '0d4b6adb-8995-4df1-b75f-2be8efe28385',
    effect_generation: 7,
    state,
    plan: {
      action: sourcePlan.action,
      target_release: sourcePlan.target_release,
      exact_pid: sourcePlan.exact_pid ?? null,
      exact_process_incarnation_id: sourcePlan.exact_process_incarnation_id ?? null,
      process_absence_proven: sourcePlan.process_absence_proven === true,
    },
  };
}

function admitted(sourcePlan) {
  return evaluateBrowserGuardianProcessEffectAdmission({
    plan: sourcePlan,
    effect_journal: journal(sourcePlan, 'INTENT_RECORDED'),
  });
}

function assertZeroAuthority(result) {
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.browser_authority, false);
  assert.equal(result.task_authority, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.page_model_text_authority, false);
  assert.equal(result.release_authority, false);
  assert.equal(result.authority_effect, false);
}

test('requires the durable EFFECT_ATTEMPTED barrier before native dispatch', () => {
  const sourcePlan = plan();
  const result = buildBrowserGuardianProcessEffectDispatchPermit({ admission: admitted(sourcePlan) });
  assert.equal(result.schema, BROWSER_GUARDIAN_PROCESS_EFFECT_DISPATCH_PERMIT_SCHEMA);
  assert.equal(result.action, 'HOLD');
  assert.equal(result.reason, 'DURABLE_EFFECT_ATTEMPT_BARRIER_REQUIRED');
  assert.equal(result.executor_dispatch_eligible, false);
  assertZeroAuthority(result);
});

test('emits a one-shot permit only for the same exact attempted generation', () => {
  const sourcePlan = plan();
  const result = buildBrowserGuardianProcessEffectDispatchPermit({
    admission: admitted(sourcePlan),
    attempted_journal: journal(sourcePlan, 'EFFECT_ATTEMPTED'),
  });
  assert.equal(result.action, 'DISPATCH_EXACT_EFFECT_ONCE');
  assert.equal(result.executor_dispatch_eligible, true);
  assert.equal(result.single_dispatch_only, true);
  assert.equal(result.durable_effect_barrier_crossed, true);
  assert.equal(result.effect_generation, 7);
  assertZeroAuthority(result);
});

test('rejects effect-id or generation drift after the durable CAS', () => {
  const sourcePlan = plan();
  const attempted = journal(sourcePlan, 'EFFECT_ATTEMPTED');
  attempted.effect_generation = 8;
  const result = buildBrowserGuardianProcessEffectDispatchPermit({
    admission: admitted(sourcePlan),
    attempted_journal: attempted,
  });
  assert.equal(result.action, 'HOLD');
  assert.equal(result.reason, 'EFFECT_ATTEMPT_GENERATION_DRIFT');
});

test('AMBIGUOUS is never a dispatch barrier and can never mint a permit', () => {
  const sourcePlan = plan();
  const result = buildBrowserGuardianProcessEffectDispatchPermit({
    admission: admitted(sourcePlan),
    attempted_journal: journal(sourcePlan, 'AMBIGUOUS'),
  });
  assert.equal(result.action, 'HOLD');
  assert.equal(result.executor_dispatch_eligible, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('restart permit remains fenced to exact pid and process incarnation', () => {
  const sourcePlan = {
    ...plan('RESTART_EXACT_CHILD'),
    exact_pid: 4242,
    exact_process_incarnation_id: 'pid:4242:created_100ns:99',
  };
  const attempted = journal(sourcePlan, 'EFFECT_ATTEMPTED');
  attempted.plan = { ...attempted.plan, exact_process_incarnation_id: 'pid:4242:created_100ns:98' };
  const result = buildBrowserGuardianProcessEffectDispatchPermit({
    admission: admitted(sourcePlan),
    attempted_journal: attempted,
  });
  assert.equal(result.action, 'HOLD');
  assert.equal(result.reason, 'EFFECT_ATTEMPT_PLAN_DRIFT');
});

test('a crossed-barrier admission result cannot be reused to mint another permit', () => {
  const sourcePlan = plan();
  const crossedAdmission = evaluateBrowserGuardianProcessEffectAdmission({
    plan: sourcePlan,
    effect_journal: journal(sourcePlan, 'EFFECT_ATTEMPTED'),
  });
  assert.equal(crossedAdmission.action, 'RECONCILE_ONLY');
  const result = buildBrowserGuardianProcessEffectDispatchPermit({
    admission: crossedAdmission,
    attempted_journal: journal(sourcePlan, 'EFFECT_ATTEMPTED'),
  });
  assert.equal(result.action, 'HOLD');
  assert.equal(result.reason, 'EXACT_EFFECT_ADMISSION_REQUIRED');
});
