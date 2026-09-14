import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  createNativeSupervisorHeartbeatTransport,
  sendBootstrapHeartbeat,
} from '../src/native-supervisor-client-core.mjs';

const STATE_PATH = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`;
const HEARTBEAT_PATH = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/heartbeat`;

function fakeIdentity(signatures) {
  return {
    async ensure() {
      return { client_id: 'heartbeat-route-test', device_id: '00000000-0000-4000-8000-000000000001' };
    },
    async deviceHeaders(method, path, bodyText) {
      signatures.push({ method, path, bodyText });
      return { 'content-type': 'application/json', 'x-test-device-signature': path };
    },
  };
}

test('watchdog transport atomically rewrites signature path and HTTP target to /v1/heartbeat', async () => {
  const signatures = [];
  const requests = [];
  const identity = fakeIdentity(signatures);
  const rawFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ accepted: true, authority_effect: false }), { status: 202 });
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl: rawFetch });
  const bodyText = JSON.stringify({ state: { watchdog_heartbeat: true, authority_effect: false } });

  const headers = await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
  const response = await transport.fetchImpl(`https://example.invalid${STATE_PATH}`, {
    method: 'POST',
    headers,
    body: bodyText,
  });

  assert.equal(response.status, 202);
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].path, HEARTBEAT_PATH);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://example.invalid${HEARTBEAT_PATH}`);
});

test('ordinary state publication remains on /v1/state when full state succeeds', async () => {
  const signatures = [];
  const requests = [];
  const identity = fakeIdentity(signatures);
  const rawFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl: rawFetch });
  const bodyText = JSON.stringify({ state: { supervisor_mode: 'CONTROL', authority_effect: false } });

  const headers = await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
  await transport.fetchImpl(`https://example.invalid${STATE_PATH}`, { method: 'POST', headers, body: bodyText });

  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].path, STATE_PATH);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://example.invalid${STATE_PATH}`);
});

for (const transientStatus of [502, 503, 504]) {
  test(`ordinary state ${transientStatus} falls back once to freshly signed /v1/heartbeat`, async () => {
    const signatures = [];
    const requests = [];
    const identity = fakeIdentity(signatures);
    const runtimeControl = { schema: 'metaengine.devos.environment-state.v1', state: 'OPEN', authority_effect: false };
    const rawFetch = async (url, init = {}) => {
      const target = String(url);
      requests.push({ url: target, init });
      if (target.endsWith('/v1/state')) {
        return new Response(JSON.stringify({ error: 'native_supervisor_failure' }), { status: transientStatus });
      }
      if (target.endsWith('/v1/heartbeat')) {
        return new Response(JSON.stringify({ accepted: true, runtime_control: runtimeControl, authority_effect: false }), { status: 202 });
      }
      throw new Error(`unexpected_target:${target}`);
    };
    const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl: rawFetch });
    const bodyText = JSON.stringify({ state: { supervisor_mode: 'CONTROL', armed: true, authority_effect: false } });

    const headers = await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
    const response = await transport.fetchImpl(`https://example.invalid${STATE_PATH}`, {
      method: 'POST', headers, body: bodyText,
    });
    const responseBody = await response.json();

    assert.equal(response.status, 202);
    assert.equal(responseBody.accepted, true);
    assert.equal(responseBody.transient_state_fallback, true);
    assert.deepEqual(responseBody.runtime_control, runtimeControl);
    assert.equal(responseBody.authority_effect, false);
    assert.deepEqual(signatures.map((row) => row.path), [STATE_PATH, HEARTBEAT_PATH]);
    assert.deepEqual(requests.map((row) => row.url), [
      `https://example.invalid${STATE_PATH}`,
      `https://example.invalid${HEARTBEAT_PATH}`,
    ]);
    assert.equal(requests[1].init.headers['x-test-device-signature'], HEARTBEAT_PATH);
    assert.equal(requests[1].init.body, bodyText);
  });
}

test('ordinary state HTTP 500 stays visible and is not downgraded to heartbeat', async () => {
  const signatures = [];
  const requests = [];
  const identity = fakeIdentity(signatures);
  const rawFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ error: 'state_failed' }), { status: 500 });
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl: rawFetch });
  const bodyText = JSON.stringify({ state: { supervisor_mode: 'CONTROL', authority_effect: false } });

  const headers = await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
  const response = await transport.fetchImpl(`https://example.invalid${STATE_PATH}`, { method: 'POST', headers, body: bodyText });

  assert.equal(response.status, 500);
  assert.deepEqual(signatures.map((row) => row.path), [STATE_PATH]);
  assert.deepEqual(requests.map((row) => row.url), [`https://example.invalid${STATE_PATH}`]);
});

test('state transient fallback can be explicitly disabled', async () => {
  const signatures = [];
  const requests = [];
  const identity = fakeIdentity(signatures);
  const rawFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ error: 'native_supervisor_failure' }), { status: 502 });
  };
  const transport = createNativeSupervisorHeartbeatTransport({
    identity,
    fetchImpl: rawFetch,
    transientStateHeartbeatFallback: false,
  });
  const bodyText = JSON.stringify({ state: { supervisor_mode: 'CONTROL', authority_effect: false } });

  const headers = await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
  const response = await transport.fetchImpl(`https://example.invalid${STATE_PATH}`, { method: 'POST', headers, body: bodyText });

  assert.equal(response.status, 502);
  assert.deepEqual(signatures.map((row) => row.path), [STATE_PATH]);
  assert.equal(requests.length, 1);
});

test('public bootstrap heartbeat API cannot bypass the dedicated heartbeat route', async () => {
  const signatures = [];
  const requests = [];
  const identity = fakeIdentity(signatures);
  const rawFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ accepted: true, authority_effect: false }), { status: 202 });
  };

  const result = await sendBootstrapHeartbeat({
    identity,
    fetchImpl: rawFetch,
    getState: async () => ({ tabs: [], authority_effect: false }),
    version: '0.7.0-dev.2.1',
    startedAt: '2026-09-14T12:00:00.000Z',
  });

  assert.equal(result.sent, true);
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].path, HEARTBEAT_PATH);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.endsWith('/v1/heartbeat'), true);
  const payload = JSON.parse(String(requests[0].init.body));
  assert.equal(payload.state.bootstrap_heartbeat, true);
  assert.equal(payload.state.authority_effect, false);
});
