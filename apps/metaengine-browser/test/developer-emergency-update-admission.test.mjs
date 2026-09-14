import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEVELOPER_EMERGENCY_UPDATE_ACTION,
  developerEmergencyUpdateContract,
  evaluateDeveloperEmergencyUpdateAdmission,
} from '../src/developer-emergency-update-admission.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const NONCE = 'n'.repeat(32);
const GIT_SHA = 'a'.repeat(40);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function command(payload = {}) {
  return {
    command_id: COMMAND_ID,
    action: DEVELOPER_EMERGENCY_UPDATE_ACTION,
    payload: {
      schema: 'metaengine.developer-emergency-update.v1',
      request_nonce: NONCE,
      release_mode: 'LATEST_TRUSTED',
      ...payload,
    },
  };
}

function ownerBinding(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.owner-session-binding.v1',
    durable_owner_binding_proven: true,
    device_binding_proven: true,
    caller_supplied_owner_sid_allowed: false,
    enrollment_evidence_sha256: SHA_A,
    device_key_fingerprint_sha256: SHA_B,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function releaseGate(overrides = {}) {
  return {
    schema: 'metaengine.browser-fabric.release-authority-gate.v1',
    action: 'AUTHORITY_ADVANCE_CANDIDATE',
    authority_advance_candidate: true,
    requires_separate_journaled_promotion_effect: true,
    release_authority: false,
    automatic_retry_allowed: false,
    candidate_sha: GIT_SHA,
    release_tag: 'v0.7.0-dev.3.1',
    release_version: '0.7.0-dev.3.1',
    installer_sha256: SHA_A,
    installed_executable_sha256: SHA_B,
    manifest_sha256: SHA_C,
    authority_effect: false,
    ...overrides,
  };
}

function recoveryPlan(action = 'STAGE_INACTIVE_SLOT_CANDIDATE', overrides = {}) {
  return {
    schema: 'metaengine.browser-fabric.guardian-recovery-plan.v1',
    action,
    reason: 'TEST',
    requires_existing_guardian_effect_journal: !['NOOP_HEALTHY', 'RECONCILE'].includes(action),
    release_publication_authority: false,
    policy_authority: false,
    direct_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

test('contract defines a narrow developer break-glass path without arbitrary execution', () => {
  const row = developerEmergencyUpdateContract();
  assert.equal(row.action, DEVELOPER_EMERGENCY_UPDATE_ACTION);
  assert.equal(row.bypasses_browser_mode, true);
  assert.equal(row.bypasses_browser_armed_state, true);
  assert.equal(row.bypasses_browser_rollout_policy, true);
  assert.equal(row.bypasses_browser_update_cadence, true);
  assert.equal(row.bypasses_browser_self_update_state, true);
  assert.equal(row.arbitrary_url_allowed, false);
  assert.equal(row.arbitrary_executable_allowed, false);
  assert.equal(row.arbitrary_shell_allowed, false);
  assert.equal(row.ambiguous_effect_retry_allowed, false);
  assert.equal(row.durable_effect_journal_required, true);
});

test('exact owner/device, release and Guardian proofs admit emergency recovery independent of Browser policy state', () => {
  const row = evaluateDeveloperEmergencyUpdateAdmission({
    command: command(),
    owner_binding: ownerBinding(),
    release_gate: releaseGate(),
    guardian_recovery_plan: recoveryPlan(),
  });
  assert.equal(row.state, 'ADMITTED_TO_GUARDIAN_RECOVERY');
  assert.equal(row.admitted, true);
  assert.equal(row.bypass_program_policy, true);
  assert.equal(row.normal_mode_required, false);
  assert.equal(row.normal_armed_required, false);
  assert.equal(row.normal_rollout_required, false);
  assert.equal(row.normal_cadence_required, false);
  assert.equal(row.candidate_sha, GIT_SHA);
  assert.equal(row.direct_effect_allowed, false);
  assert.equal(row.automatic_effect_retry_allowed, false);
});

test('missing durable developer identity proof fails closed', () => {
  const row = evaluateDeveloperEmergencyUpdateAdmission({
    command: command(),
    owner_binding: ownerBinding({ device_binding_proven: false }),
    release_gate: releaseGate(),
    guardian_recovery_plan: recoveryPlan(),
  });
  assert.equal(row.state, 'HOLD');
  assert.equal(row.reason, 'DEVELOPER_OWNER_DEVICE_BINDING_REQUIRED');
  assert.equal(row.admitted, false);
});

test('command cannot inject an arbitrary URL, executable path or extra authority field', () => {
  const row = evaluateDeveloperEmergencyUpdateAdmission({
    command: command({ url: 'https://example.invalid/payload.exe' }),
    owner_binding: ownerBinding(),
    release_gate: releaseGate(),
    guardian_recovery_plan: recoveryPlan(),
  });
  assert.equal(row.state, 'HOLD');
  assert.equal(row.reason, 'EMERGENCY_COMMAND_INVALID');
});

test('optional expected git sha pins developer intent to the verified release', () => {
  const mismatch = evaluateDeveloperEmergencyUpdateAdmission({
    command: command({ expected_git_sha: 'f'.repeat(40) }),
    owner_binding: ownerBinding(),
    release_gate: releaseGate(),
    guardian_recovery_plan: recoveryPlan(),
  });
  assert.equal(mismatch.state, 'HOLD');
  assert.equal(mismatch.reason, 'VERIFIED_RELEASE_GATE_REQUIRED');

  const exact = evaluateDeveloperEmergencyUpdateAdmission({
    command: command({ expected_git_sha: GIT_SHA }),
    owner_binding: ownerBinding(),
    release_gate: releaseGate(),
    guardian_recovery_plan: recoveryPlan('RECONCILE'),
  });
  assert.equal(exact.state, 'ADMITTED_TO_GUARDIAN_RECOVERY');
  assert.equal(exact.guardian_action, 'RECONCILE');
});

test('a recovery plan cannot directly execute or auto-retry an ambiguous effect', () => {
  for (const plan of [
    recoveryPlan('STAGE_INACTIVE_SLOT_CANDIDATE', { direct_effect_allowed: true }),
    recoveryPlan('STAGE_INACTIVE_SLOT_CANDIDATE', { automatic_retry_allowed: true }),
    recoveryPlan('STAGE_INACTIVE_SLOT_CANDIDATE', { requires_existing_guardian_effect_journal: false }),
  ]) {
    const row = evaluateDeveloperEmergencyUpdateAdmission({
      command: command(),
      owner_binding: ownerBinding(),
      release_gate: releaseGate(),
      guardian_recovery_plan: plan,
    });
    assert.equal(row.state, 'HOLD');
    assert.equal(row.reason, 'GUARDIAN_RECOVERY_PLAN_REQUIRED');
  }
});
