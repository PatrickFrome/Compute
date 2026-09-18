import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { evaluateGuardianOwnerEnrollmentEvidence } from '../src/browser-guardian-owner-enrollment-evidence.mjs';

const nonce = 'abcdefghijklmnopqrstuvwxyzABCDE_1234567890-xyz';
const nonceHash = crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');

function fixture() {
  return {
    challenge: { nonce },
    transport: {
      local_only: true,
      pipe_reject_remote_clients: true,
      explicit_dacl: true,
      default_dacl_used: false,
      first_pipe_instance: true,
      overlapped_io: true,
      pipe_nowait_used: false,
      generic_write_granted: false,
      client_create_pipe_instance_allowed: false,
      client_message_read_before_impersonation: true,
      impersonation_succeeded: true,
      revert_to_self_succeeded: true,
      client_pid: 4242,
    },
    token: {
      identity_source: 'IMPERSONATED_PIPE_CLIENT_TOKEN',
      user_sid: 'S-1-5-21-111-222-333-1001',
      session_id: 7,
      token_user_readback: true,
      token_session_id_readback: true,
      client_supplied_sid_used: false,
      client_supplied_session_id_used: false,
    },
    device: {
      enrolled: true,
      key_fingerprint_sha256: 'a'.repeat(64),
      challenge_signature_verified: true,
      challenge_nonce_sha256: nonceHash,
      transport_client_pid_bound: true,
    },
  };
}

test('proven token and device binding remains evidence-only', () => {
  const out = evaluateGuardianOwnerEnrollmentEvidence(fixture());
  assert.equal(out.state, 'EVIDENCE_PROVEN');
  assert.equal(out.owner_sid_binding_candidate, true);
  assert.equal(out.expected_owner_sid_candidate, 'S-1-5-21-111-222-333-1001');
  assert.equal(out.token_session_id, 7);
  assert.match(out.enrollment_evidence_sha256, /^[a-f0-9]{64}$/);
  for (const field of [
    'durable_enrollment_allowed', 'wts_execution_allowed', 'process_effect_allowed',
    'scm_effect_allowed', 'browser_authority', 'task_authority', 'scheduler_authority',
    'page_model_text_authority', 'release_authority', 'automatic_retry_allowed', 'authority_effect',
  ]) assert.equal(out[field], false, `${field} must remain false`);
});

for (const [name, mutate, reason] of [
  ['default DACL', (x) => { x.transport.default_dacl_used = true; }, 'EXPLICIT_PIPE_DACL_UNPROVEN'],
  ['remote pipe', (x) => { x.transport.pipe_reject_remote_clients = false; }, 'LOCAL_ONLY_PIPE_UNPROVEN'],
  ['pipe squatting protection missing', (x) => { x.transport.first_pipe_instance = false; }, 'FIRST_PIPE_INSTANCE_UNPROVEN'],
  ['PIPE_NOWAIT fake async', (x) => { x.transport.pipe_nowait_used = true; }, 'OVERLAPPED_IO_CONTRACT_UNPROVEN'],
  ['generic write exposes pipe-instance creation', (x) => { x.transport.generic_write_granted = true; }, 'PIPE_INSTANCE_CREATION_RIGHT_EXPOSED'],
  ['impersonation before message read', (x) => { x.transport.client_message_read_before_impersonation = false; }, 'CLIENT_MESSAGE_IMPERSONATION_ORDER_UNPROVEN'],
  ['impersonation failure', (x) => { x.transport.impersonation_succeeded = false; }, 'PIPE_CLIENT_IMPERSONATION_UNPROVEN'],
  ['RevertToSelf failure', (x) => { x.transport.revert_to_self_succeeded = false; }, 'PIPE_CLIENT_IMPERSONATION_UNPROVEN'],
  ['client supplied SID used', (x) => { x.token.client_supplied_sid_used = true; }, 'CLIENT_SUPPLIED_IDENTITY_REJECTED'],
  ['token session readback missing', (x) => { x.token.token_session_id_readback = false; }, 'TOKEN_IDENTITY_READBACK_UNPROVEN'],
  ['unenrolled device', (x) => { x.device.enrolled = false; }, 'DEVICE_IDENTITY_UNPROVEN'],
  ['challenge signature missing', (x) => { x.device.challenge_signature_verified = false; }, 'DEVICE_CHALLENGE_SIGNATURE_UNPROVEN'],
  ['challenge replay/mismatch', (x) => { x.device.challenge_nonce_sha256 = 'b'.repeat(64); }, 'DEVICE_CHALLENGE_BINDING_MISMATCH'],
  ['pipe process not bound to device proof', (x) => { x.device.transport_client_pid_bound = false; }, 'DEVICE_PROCESS_BINDING_UNPROVEN'],
]) {
  test(`holds on ${name}`, () => {
    const input = fixture();
    mutate(input);
    const out = evaluateGuardianOwnerEnrollmentEvidence(input);
    assert.equal(out.state, 'HOLD');
    assert.equal(out.reason, reason);
    assert.equal(out.owner_sid_binding_candidate, false);
    assert.equal(out.wts_execution_allowed, false);
    assert.equal(out.process_effect_allowed, false);
    assert.equal(out.authority_effect, false);
  });
}
