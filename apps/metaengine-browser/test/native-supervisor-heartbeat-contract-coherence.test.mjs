import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sendBootstrapHeartbeat } from '../src/native-supervisor-client.mjs';
import {
  nativeSupervisorRuntimeUrl,
  nativeSupervisorSigningPath,
} from '../src/native-supervisor-endpoints.mjs';
import { inspectSignedNativeSupervisorStateRequest } from '../src/self-update-signed-heartbeat.mjs';

const STATE_ROUTE = '/v1/state';

function deviceHeaders(method, path, bodyText) {
  assert.equal(method, 'POST');
  return {
    'content-type': 'application/json',
    'x-a2-chat-bridge-client': '11111111-1111-4111-8111-111111111111',
    'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
    'x-a2-device-id': '22222222-2222-4222-8222-222222222222',
    'x-a2-device-timestamp': '2026-09-14T12:00:00.000Z',
    'x-a2-device-nonce': 'abcdefghijklmnopQRSTUVWX12345678',
    'x-a2-device-body-sha256': createHash('sha256').update(bodyText).digest('hex'),
    'x-a2-device-signature': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
    'x-test-signing-path': path,
  };
}

test('bounded bootstrap heartbeat is coherent across producer, state signature path, transport, and successor qualification', async () => {
  const calls = [];
  const identity = {
    async ensure() {
      return { device_id: '22222222-2222-4222-8222-222222222222' };
    },
    async deviceHeaders(method, path, bodyText) {
      const headers = deviceHeaders(method, path, bodyText);
      calls.push({ kind: 'headers', method, path, bodyText, headers });
      return headers;
    },
  };
  const fetchImpl = async (url, init) => {
    calls.push({ kind: 'fetch', url, init });
    return { status: 202 };
  };

  const result = await sendBootstrapHeartbeat({
    identity,
    fetchImpl,
    getState: async () => ({ tabs: [] }),
    version: '0.6.3-dev.contract-test',
    startedAt: '2026-09-14T11:59:00.000Z',
  });

  assert.equal(result.sent, true);
  const signed = calls.find((row) => row.kind === 'headers');
  const request = calls.find((row) => row.kind === 'fetch');
  assert.ok(signed);
  assert.ok(request);

  assert.equal(signed.path, nativeSupervisorSigningPath(STATE_ROUTE));
  assert.equal(request.url, nativeSupervisorRuntimeUrl(STATE_ROUTE));
  assert.equal(request.init.headers['x-test-signing-path'], nativeSupervisorSigningPath(STATE_ROUTE));

  const qualifying = inspectSignedNativeSupervisorStateRequest(request.url, request.init);
  assert.equal(qualifying.valid, true);
  assert.equal(qualifying.reason, 'signed_request_shape_valid');
});

test('full state remains the same signed successor-qualification path', () => {
  const bodyText = JSON.stringify({
    state: {
      shell_version: '0.6.3-dev.contract-test',
      authority_effect: false,
    },
  });
  const headers = deviceHeaders('POST', nativeSupervisorSigningPath(STATE_ROUTE), bodyText);
  const qualifying = inspectSignedNativeSupervisorStateRequest(
    nativeSupervisorRuntimeUrl(STATE_ROUTE),
    { method: 'POST', body: bodyText, headers },
  );
  assert.equal(qualifying.valid, true);
  assert.equal(qualifying.reason, 'signed_request_shape_valid');
});
