import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  DelegatedSupervisorIdentity,
  SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
  SupervisorIdentityDelegationSigner,
  normalizeSupervisorIdentityDelegationRequest,
  supervisorIdentityDelegationManifest,
} from '../src/supervisor-identity-delegation.mjs';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = '/a2-browser-native-supervisor-v1/v1';

function fakeIdentity() {
  const calls = [];
  const state = {
    profile: 'A2_DEVICE_HTTP_SIGNATURE_V1',
    client_id: CLIENT_ID,
    device_id: DEVICE_ID,
    public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    key_fingerprint_sha256: 'f'.repeat(64),
    enrolled: true,
  };
  return {
    calls,
    async ensure() { return structuredClone(state); },
    async deviceHeaders(method, requestPath, bodyText, options) {
      calls.push({ method, requestPath, bodyText, options });
      const digest = crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex');
      return {
        'content-type': 'application/json',
        'x-a2-chat-bridge-client': CLIENT_ID,
        'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
        'x-a2-device-id': DEVICE_ID,
        'x-a2-device-timestamp': '2026-09-10T19:30:00.000Z',
        'x-a2-device-nonce': 'nonce-generated-by-browser',
        'x-a2-device-body-sha256': digest,
        'x-a2-device-signature': 'signature-generated-by-browser',
      };
    },
  };
}

test('delegation signer signs only canonical supervisor runtime envelopes without caller nonce or timestamp', async () => {
  const identity = fakeIdentity();
  const signer = new SupervisorIdentityDelegationSigner({ identity });
  const body = JSON.stringify({ supervisor_mode: 'CONTROL', max_batch: 64 });
  const receipt = await signer.signDeviceRequest({
    method: 'POST',
    request_path: `${PREFIX}/commands/wait-batch`,
    body_text: body,
  });
  assert.equal(receipt.schema, SUPERVISOR_IDENTITY_DELEGATION_SCHEMA);
  assert.equal(receipt.route, 'COMMAND_WAIT_BATCH');
  assert.equal(receipt.private_key_exported, false);
  assert.equal(receipt.enrollment_authority, false);
  assert.equal(receipt.authority_effect, false);
  assert.equal(identity.calls.length, 1);
  assert.deepEqual(identity.calls[0], {
    method: 'POST',
    requestPath: `${PREFIX}/commands/wait-batch`,
    bodyText: body,
    options: undefined,
  });
});

test('delegation route policy is exact and rejects enrollment arbitrary path encoding query and method expansion', () => {
  const ok = [
    ['POST', `${PREFIX}/state`, '{}'],
    ['POST', `${PREFIX}/cognitive/deltas`, '{}'],
    ['GET', `${PREFIX}/devos/workspace-snapshot`, ''],
    ['POST', `${PREFIX}/commands/next`, '{}'],
    ['POST', `${PREFIX}/commands/wait-batch`, '{}'],
    ['POST', `${PREFIX}/commands/result-batch`, '{}'],
    ['POST', `${PREFIX}/commands/33333333-3333-4333-8333-333333333333/result`, '{}'],
  ];
  for (const [method, request_path, body_text] of ok) {
    assert.doesNotThrow(() => normalizeSupervisorIdentityDelegationRequest({ method, request_path, body_text }));
  }
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'POST', request_path: `${PREFIX}/device/enrollment/request`, body_text: '{}' }), /route_denied/);
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'POST', request_path: `${PREFIX}/unknown`, body_text: '{}' }), /route_denied/);
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'DELETE', request_path: `${PREFIX}/state`, body_text: '{}' }), /method_denied/);
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'POST', request_path: `${PREFIX}/state?x=1`, body_text: '{}' }), /path_invalid/);
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'POST', request_path: `${PREFIX}/%73tate`, body_text: '{}' }), /path_invalid/);
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'GET', request_path: `${PREFIX}/devos/workspace-snapshot`, body_text: '{}' }), /get_body_denied/);
  assert.throws(() => normalizeSupervisorIdentityDelegationRequest({ method: 'POST', request_path: `${PREFIX}/state`, body_text: 'not-json' }), /json_required/);
});

test('delegated identity is drop-in for enrolled device headers but cannot acquire enrollment authority', async () => {
  const source = fakeIdentity();
  const signer = new SupervisorIdentityDelegationSigner({ identity: source });
  const delegated = new DelegatedSupervisorIdentity({
    readSnapshot: () => signer.snapshot(),
    signDeviceRequest: (request) => signer.signDeviceRequest(request),
  });
  const snapshot = await delegated.ensure();
  assert.equal(snapshot.device_id, DEVICE_ID);
  assert.equal(snapshot.private_key_exported, false);
  assert.equal(snapshot.enrollment_authority, false);
  const body = JSON.stringify({ state: { authority_effect: false } });
  const headers = await delegated.deviceHeaders('POST', `${PREFIX}/state`, body);
  assert.equal(headers['x-a2-device-id'], DEVICE_ID);
  assert.equal(headers['x-a2-device-body-sha256'], crypto.createHash('sha256').update(body).digest('hex'));
  await assert.rejects(delegated.enrollmentHeaders('{}'), /enrollment_forbidden/);
  await assert.rejects(delegated.bindEnrollmentRequest('x'), /enrollment_forbidden/);
  await assert.rejects(delegated.clearEnrollmentRequest(), /enrollment_forbidden/);
  await assert.rejects(delegated.bindDevice(DEVICE_ID), /enrollment_forbidden/);
});

test('delegated identity rejects a signature receipt bound to different body or path', async () => {
  const source = fakeIdentity();
  const signer = new SupervisorIdentityDelegationSigner({ identity: source });
  const delegated = new DelegatedSupervisorIdentity({
    readSnapshot: () => signer.snapshot(),
    signDeviceRequest: async (request) => {
      const receipt = await signer.signDeviceRequest(request);
      return { ...receipt, request_path: `${PREFIX}/state` };
    },
  });
  await delegated.ensure();
  await assert.rejects(
    delegated.deviceHeaders('POST', `${PREFIX}/commands/next`, '{}'),
    /receipt_drift/,
  );
});

test('delegation manifest exposes no generic signing private-key or arbitrary-origin surface', () => {
  const manifest = supervisorIdentityDelegationManifest();
  assert.equal(manifest.enrollment_authority, false);
  assert.equal(manifest.arbitrary_origin, false);
  assert.equal(manifest.arbitrary_headers, false);
  assert.equal(manifest.caller_timestamp, false);
  assert.equal(manifest.caller_nonce, false);
  assert.equal(manifest.private_key_exported, false);
  assert.equal(manifest.browser_safe_storage_owner, true);
  assert.equal(manifest.host_agent_compatible_identity_interface, true);
  assert.equal(manifest.authority_effect, false);
});
