import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNativeSupervisorHeartbeatTransport,
  nativeSupervisorHeartbeatPayload,
  nativeSupervisorHeartbeatTarget,
} from '../src/native-supervisor-client-core.mjs';

const STATE_PATH = '/functions/v1/a2-browser-native-supervisor/v1/state';
const STATE_URL = `https://example.invalid${STATE_PATH}`;

function heartbeatBody(flag) {
  return JSON.stringify({ state: { [flag]: true, authority_effect: false } });
}

test('heartbeat payload classifier recognizes bootstrap and watchdog liveness', () => {
  assert.equal(nativeSupervisorHeartbeatPayload(heartbeatBody('bootstrap_heartbeat')), true);
  assert.equal(nativeSupervisorHeartbeatPayload(heartbeatBody('watchdog_heartbeat')), true);
  assert.equal(nativeSupervisorHeartbeatPayload(JSON.stringify({ state: {} })), false);
  assert.equal(nativeSupervisorHeartbeatPayload('{invalid'), false);
});

test('heartbeat target remains on deployed signed /v1/state contract', () => {
  assert.equal(nativeSupervisorHeartbeatTarget(STATE_PATH, heartbeatBody('bootstrap_heartbeat')), STATE_PATH);
  assert.equal(nativeSupervisorHeartbeatTarget(STATE_URL, heartbeatBody('watchdog_heartbeat')), STATE_URL);
});

test('heartbeat transport signs and fetches the exact same /v1/state target', async () => {
  const signed = [];
  const fetched = [];
  const identity = {
    async deviceHeaders(method, path, bodyText) {
      signed.push({ method, path, bodyText });
      return { 'content-type': 'application/json', 'x-test-signature': 'present' };
    },
  };
  const fetchImpl = async (url, init = {}) => {
    fetched.push({ url, init });
    return { status: 202, ok: true };
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl });
  const bodyText = heartbeatBody('bootstrap_heartbeat');
  const headers = await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
  await transport.fetchImpl(STATE_URL, { method: 'POST', headers, body: bodyText });

  assert.deepEqual(signed, [{ method: 'POST', path: STATE_PATH, bodyText }]);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, STATE_URL);
  assert.equal(fetched[0].init.body, bodyText);
  assert.equal(String(signed[0].path).includes('/v1/heartbeat'), false);
  assert.equal(String(fetched[0].url).includes('/v1/heartbeat'), false);
});
