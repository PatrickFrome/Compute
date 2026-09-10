import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { DelegatedSupervisorIdentity, SUPERVISOR_IDENTITY_DELEGATION_SCHEMA } from '../src/supervisor-identity-delegation.mjs';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = '/a2-browser-native-supervisor-v1/v1';

function snapshot() {
  return {
    client_id: CLIENT_ID,
    device_id: DEVICE_ID,
    profile: 'A2_DEVICE_HTTP_SIGNATURE_V1',
    public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    key_fingerprint_sha256: 'f'.repeat(64),
  };
}

function receipt(request) {
  const bodySha = crypto.createHash('sha256').update(request.body_text, 'utf8').digest('hex');
  return {
    schema: SUPERVISOR_IDENTITY_DELEGATION_SCHEMA,
    method: request.method,
    request_path: request.request_path,
    body_sha256: bodySha,
    headers: {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': CLIENT_ID,
      'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
      'x-a2-device-id': DEVICE_ID,
      'x-a2-device-timestamp': '2026-09-10T19:45:00.000Z',
      'x-a2-device-nonce': 'fresh-browser-owned-nonce',
      'x-a2-device-body-sha256': bodySha,
      'x-a2-device-signature': 'browser-owned-signature',
    },
  };
}

test('repeated ensure and deviceHeaders reuse one identity snapshot read while every request still gets a fresh signature call', async () => {
  let reads = 0;
  let signs = 0;
  const delegated = new DelegatedSupervisorIdentity({
    readSnapshot: async () => { reads += 1; return snapshot(); },
    signDeviceRequest: async (request) => { signs += 1; return receipt(request); },
  });

  await delegated.ensure();
  await delegated.ensure();
  await delegated.deviceHeaders('POST', `${PREFIX}/state`, '{}');
  await delegated.deviceHeaders('POST', `${PREFIX}/commands/wait-batch`, '{}');

  assert.equal(reads, 1);
  assert.equal(signs, 2);
  assert.equal(delegated.snapshot().device_id, DEVICE_ID);
});

test('explicit refresh is the only normal path that re-reads delegated identity metadata', async () => {
  let reads = 0;
  const delegated = new DelegatedSupervisorIdentity({
    readSnapshot: async () => { reads += 1; return snapshot(); },
    signDeviceRequest: async (request) => receipt(request),
  });

  await delegated.ensure();
  await delegated.ensure();
  assert.equal(reads, 1);
  await delegated.refresh();
  assert.equal(reads, 2);
  await delegated.ensure();
  assert.equal(reads, 2);
});
