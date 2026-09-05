import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_GUARDIAN_OWNER_READBACK_PROOF_SCHEMA,
  BROWSER_GUARDIAN_DEVICE_BINDING_PROOF_SCHEMA,
  browserGuardianOwnerSessionBindingContract,
  evaluateGuardianOwnerBoundSessionBrokerController,
} from '../src/browser-guardian-owner-session-binding.mjs';

const SID = 'S-1-5-21-100-200-300-1001';
const DEVICE = 'b'.repeat(64);
const EVIDENCE = 'a'.repeat(64);
const NOW = 1780000000000;
const binding = {
  service_name: 'METAENGINEBrowserGuardian',
  broker_executable: 'C:\\Program Files\\METAENGINE\\Guardian\\METAENGINEBrowserSessionBroker.exe',
};

const owner = (extra = {}) => ({
  schema: BROWSER_GUARDIAN_OWNER_READBACK_PROOF_SCHEMA,
  source: 'NATIVE_OWNER_STORE_READBACK',
  root_trusted: true,
  present: true,
  corrupt: false,
  outcome: 'EFFECT_EXACT',
  readback_verified: true,
  observed_at_ms: NOW - 1000,
  record: {
    expected_owner_sid: SID,
    enrollment_evidence_sha256: EVIDENCE,
    device_key_fingerprint_sha256: DEVICE,
  },
  authority_effect: false,
  ...extra,
});

const device = (extra = {}) => ({
  schema: BROWSER_GUARDIAN_DEVICE_BINDING_PROOF_SCHEMA,
  source: 'ENROLLED_DEVICE_CHALLENGE',
  challenge_verified: true,
  process_binding_verified: true,
  replay_protection_verified: true,
  device_key_fingerprint_sha256: DEVICE,
  observed_at_ms: NOW - 500,
  authority_effect: false,
  ...extra,
});

const observed = (sessions = [{ session_id: 3, user_sid: SID, state: 'ACTIVE' }]) => ({
  sessions,
  broker: null,
  broker_absence_proven: true,
  broker_restart_history_ms: [],
});

test('expected owner SID can only come from durable readback', () => {
  const out = evaluateGuardianOwnerBoundSessionBrokerController({
    desired: { state: 'RUNNING', expected_owner_sid: SID },
    observed: observed(),
    binding,
    durable_owner_readback: owner(),
    device_binding_proof: device(),
    now_ms: NOW,
  });
  assert.equal(out.step, 'HOLD');
  assert.equal(out.reason, 'CALLER_SUPPLIED_OWNER_SID_FORBIDDEN');
});

test('durable owner plus exact enrolled-device proof produces only a journal intent candidate', () => {
  const out = evaluateGuardianOwnerBoundSessionBrokerController({
    desired: { state: 'RUNNING' },
    observed: observed(),
    binding,
    durable_owner_readback: owner(),
    device_binding_proof: device(),
    now_ms: NOW,
  });
  assert.equal(out.step, 'RECORD_INTENT');
  assert.equal(out.expected_owner_sid, SID);
  assert.equal(out.durable_owner_binding_proven, true);
  assert.equal(out.device_binding_proven, true);
  assert.equal(out.record_intent_candidate, true);
  assert.equal(out.wts_execution_allowed, false);
  assert.equal(out.process_effect_allowed, false);
});

test('device mismatch, stale readback, or another active SID fail closed', () => {
  const wrongDevice = evaluateGuardianOwnerBoundSessionBrokerController({
    desired: { state: 'RUNNING' }, observed: observed(), binding,
    durable_owner_readback: owner(),
    device_binding_proof: device({ device_key_fingerprint_sha256: 'c'.repeat(64) }),
    now_ms: NOW,
  });
  assert.equal(wrongDevice.reason, 'ENROLLED_DEVICE_BINDING_NOT_EXACT');

  const stale = evaluateGuardianOwnerBoundSessionBrokerController({
    desired: { state: 'RUNNING' }, observed: observed(), binding,
    durable_owner_readback: owner({ observed_at_ms: NOW - 31000 }),
    device_binding_proof: device(),
    now_ms: NOW,
  });
  assert.equal(stale.reason, 'DURABLE_OWNER_READBACK_NOT_EXACT');

  const otherSid = evaluateGuardianOwnerBoundSessionBrokerController({
    desired: { state: 'RUNNING' },
    observed: observed([{ session_id: 3, user_sid: 'S-1-5-21-999-888-777-1002', state: 'ACTIVE' }]),
    binding,
    durable_owner_readback: owner(),
    device_binding_proof: device(),
    now_ms: NOW,
  });
  assert.equal(otherSid.step, 'HOLD');
  assert.equal(otherSid.controller.planner_action, 'HOLD_NO_SESSION');
});

test('bridge contract preserves existing one-attempt journal and never grants physical authority', () => {
  const contract = browserGuardianOwnerSessionBindingContract();
  assert.equal(contract.durable_owner_readback_required, true);
  assert.equal(contract.caller_supplied_owner_sid_allowed, false);
  assert.equal(contract.enrolled_device_challenge_required, true);
  assert.equal(contract.active_wts_session_must_match_durable_owner, true);
  assert.equal(contract.existing_one_attempt_journal_required, true);
  assert.equal(contract.direct_wts_execution_allowed, false);
  assert.equal(contract.automatic_retry_allowed, false);
});
