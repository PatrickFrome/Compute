import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA,
  evaluateGuardianOwnerEnrollmentPlan,
} from '../src/browser-guardian-owner-enrollment-plan.mjs';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

function evidence(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.owner-enrollment-evidence.v1',
    version: '1.0.0',
    state: 'EVIDENCE_PROVEN',
    reason: 'TOKEN_AND_DEVICE_BOUND_OWNER_CANDIDATE',
    owner_sid_binding_candidate: true,
    expected_owner_sid_candidate: 'S-1-5-21-100-200-300-1001',
    token_session_id: 7,
    device_key_fingerprint_sha256: H1,
    enrollment_evidence_sha256: H2,
    durable_enrollment_allowed: false,
    wts_execution_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

test('proven evidence with durable absence yields one CAS-only enrollment candidate', () => {
  const plan = evaluateGuardianOwnerEnrollmentPlan({ evidence: evidence(), durable: null });
  assert.equal(plan.action, 'ENROLL_EXPECTED_OWNER_SID');
  assert.equal(plan.durable_write_candidate, true);
  assert.equal(plan.exact_current_state_cas_required, true);
  assert.equal(plan.expected_absence_required, true);
  assert.equal(plan.durable_enrollment_allowed, false);
  assert.equal(plan.authority_effect, false);
  assert.deepEqual(plan.candidate_record, {
    schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA,
    expected_owner_sid: 'S-1-5-21-100-200-300-1001',
    enrollment_evidence_sha256: H2,
    device_key_fingerprint_sha256: H1,
  });
  assert.equal('token_session_id' in plan.candidate_record, false);
  assert.equal('observed_token_session_id' in plan.candidate_record, false);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.candidate_record), true);
});

test('exact durable owner is level-triggered noop even when interactive session reincarnates', () => {
  const plan = evaluateGuardianOwnerEnrollmentPlan({
    evidence: evidence({ token_session_id: 19 }),
    durable: {
      schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA,
      expected_owner_sid: 's-1-5-21-100-200-300-1001',
      enrollment_evidence_sha256: H2,
      device_key_fingerprint_sha256: H1,
    },
  });
  assert.equal(plan.action, 'NOOP_ENROLLED_EXACT');
  assert.equal(plan.durable_expected_owner_sid, 'S-1-5-21-100-200-300-1001');
  assert.equal(plan.observed_token_session_id, 19);
  assert.equal(plan.durable_write_candidate, false);
});

test('existing different owner SID is fail-closed and cannot be auto-replaced', () => {
  const plan = evaluateGuardianOwnerEnrollmentPlan({
    evidence: evidence(),
    durable: { expected_owner_sid: 'S-1-5-21-999-888-777-1002' },
  });
  assert.equal(plan.action, 'HOLD_OWNER_MISMATCH');
  assert.equal(plan.replacement_protocol_required, true);
  assert.equal(plan.owner_replacement_allowed, false);
  assert.equal(plan.automatic_retry_allowed, false);
});

test('authority-bearing or non-proven evidence is rejected', () => {
  for (const candidate of [
    evidence({ state: 'HOLD' }),
    evidence({ durable_enrollment_allowed: true }),
    evidence({ process_effect_allowed: true }),
    evidence({ authority_effect: true }),
    evidence({ expected_owner_sid_candidate: 'not-a-sid' }),
    evidence({ enrollment_evidence_sha256: 'bad' }),
  ]) {
    const plan = evaluateGuardianOwnerEnrollmentPlan({ evidence: candidate, durable: null });
    assert.equal(plan.action, 'HOLD');
    assert.equal(plan.reason, 'OWNER_ENROLLMENT_EVIDENCE_INVALID');
    assert.equal(plan.durable_write_candidate, false);
  }
});

test('malformed durable material cannot be interpreted as absence', () => {
  for (const durable of [
    'bad',
    { schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA, enrollment_evidence_sha256: H2 },
    { expected_owner_sid: 'not-a-sid' },
    { expected_owner_sid: 'S-1-5-21-100-200-300-1001', enrollment_evidence_sha256: 'bad' },
    { expected_owner_sid: 'S-1-5-21-100-200-300-1001', schema: 'wrong.schema' },
  ]) {
    const plan = evaluateGuardianOwnerEnrollmentPlan({ evidence: evidence(), durable });
    assert.equal(plan.action, 'HOLD');
    assert.equal(plan.reason, 'DURABLE_OWNER_ENROLLMENT_STATE_INVALID');
  }
});

test('planner never grants WTS, process, SCM, Browser, scheduler, retry, or journal authority', () => {
  const plans = [
    evaluateGuardianOwnerEnrollmentPlan({ evidence: evidence(), durable: null }),
    evaluateGuardianOwnerEnrollmentPlan({ evidence: evidence(), durable: { expected_owner_sid: 'S-1-5-21-100-200-300-1001' } }),
    evaluateGuardianOwnerEnrollmentPlan({ evidence: evidence(), durable: { expected_owner_sid: 'S-1-5-21-999-888-777-1002' } }),
  ];
  for (const plan of plans) {
    for (const field of [
      'durable_enrollment_allowed',
      'journal_mutation_allowed',
      'wts_execution_allowed',
      'process_effect_allowed',
      'scm_effect_allowed',
      'browser_authority',
      'task_authority',
      'scheduler_authority',
      'page_model_text_authority',
      'release_authority',
      'session_token_authority',
      'automatic_retry_allowed',
      'retry_loop_allowed',
      'second_scheduler_allowed',
      'authority_effect',
    ]) assert.equal(plan[field], false, `${plan.action}:${field}`);
  }
});
