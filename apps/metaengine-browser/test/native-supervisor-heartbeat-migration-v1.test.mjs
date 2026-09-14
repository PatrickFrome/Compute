import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  sendBootstrapHeartbeat,
} from '../src/native-supervisor-client.mjs';
import {
  NATIVE_SUPERVISOR_STATE_PATH,
  inspectSignedNativeSupervisorStateRequest,
} from '../src/self-update-signed-heartbeat.mjs';

function signedShapeHeaders(bodyText) {
  return {
    'content-type': 'application/json',
    'x-a2-chat-bridge-client': '11111111-1111-4111-8111-111111111111',
    'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
    'x-a2-device-id': '22222222-2222-4222-8222-222222222222',
    'x-a2-device-timestamp': '2026-09-14T12:00:00.000Z',
    'x-a2-device-nonce': 'abcdefghijklmnopQRSTUVWX12345678',
    'x-a2-device-body-sha256': createHash('sha256').update(bodyText).digest('hex'),
    'x-a2-device-signature': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
  };
}

test('direct exported bootstrap producer signs and posts the canonical liveness route', async () => {
  const calls = [];
  const identity = {
    async ensure() {
      return { device_id: '22222222-2222-4222-8222-222222222222' };
    },
    async deviceHeaders(method, path, bodyText) {
      calls.push({ kind: 'headers', method, path, bodyText });
      return signedShapeHeaders(bodyText);
    },
  };
  const fetchImpl = async (url, init) => {
    calls.push({ kind: 'fetch', url: String(url), init });
    return { status: 202 };
  };

  const result = await sendBootstrapHeartbeat({
    identity,
    fetchImpl,
    getState: async () => ({ tabs: [{ tab_id: 'sensitive', url: 'https://example.invalid/private' }] }),
    version: '0.7.0-dev.test.1',
    startedAt: '2026-09-14T11:59:00.000Z',
  });

  assert.equal(result.sent, true);
  const signed = calls.find((row) => row.kind === 'headers');
  const request = calls.find((row) => row.kind === 'fetch');
  assert.ok(signed);
  assert.ok(request);
  assert.equal(signed.path, `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/heartbeat`);
  assert.equal(request.url, `${NATIVE_SUPERVISOR_BASE}/v1/heartbeat`);
  assert.deepEqual(JSON.parse(request.init.body), { phase: 'BOOTSTRAP', authority_effect: false });
  assert.equal(Object.hasOwn(JSON.parse(request.init.body), 'state'), false);
});

test('self-update successor qualification remains bound to accepted full-state publication, not liveness', () => {
  const stateBody = JSON.stringify({
    state: {
      shell_version: '0.7.0-dev.test.1',
      self_update_session_continuity: { state: 'RESTORED' },
      self_update: { current_version: '0.7.0-dev.test.1' },
    },
  });
  const headers = signedShapeHeaders(stateBody);
  const stateUrl = `https://xpeibufgzjknrhbhpffp.supabase.co${NATIVE_SUPERVISOR_STATE_PATH}`;
  const state = inspectSignedNativeSupervisorStateRequest(stateUrl, {
    method: 'POST', headers, body: stateBody,
  });
  assert.equal(state.valid, true);
  assert.equal(state.reason, 'signed_request_shape_valid');

  const heartbeatBody = JSON.stringify({ phase: 'BOOTSTRAP', authority_effect: false });
  const heartbeat = inspectSignedNativeSupervisorStateRequest(
    `${NATIVE_SUPERVISOR_BASE}/v1/heartbeat`,
    { method: 'POST', headers: signedShapeHeaders(heartbeatBody), body: heartbeatBody },
  );
  assert.equal(heartbeat.valid, false);
  assert.equal(heartbeat.reason, 'endpoint_mismatch');
});
