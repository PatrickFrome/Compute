import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserIdentitySignerRuntime } from '../src/browser-identity-signer-runtime.mjs';

function identity() {
  return {
    async ensure() { return { client_id: '11111111-1111-4111-8111-111111111111', device_id: '22222222-2222-4222-8222-222222222222' }; },
    async deviceHeaders() { throw new Error('unused'); },
  };
}

test('Browser signer runtime starts and stops one isolated server without exposing the session key', async () => {
  const events = [];
  const server = {
    async start() { events.push('start'); },
    async close() { events.push('close'); },
    snapshot() {
      return {
        schema: 'metaengine.supervisor-identity-signer.ipc-server.v1',
        endpoint_kind: 'WINDOWS_NAMED_PIPE',
        listening: events.includes('start') && !events.includes('close'),
        private_key_exported: false,
        enrollment_authority: false,
        browser_control_authority: false,
        authority_effect: false,
      };
    },
  };
  const runtime = new BrowserIdentitySignerRuntime({
    identity: identity(),
    userDataPath: 'C:\\Users\\Owner\\AppData\\Roaming\\METAENGINE',
    sessionKey: 'x'.repeat(43),
    endpointFactory: () => '\\\\.\\pipe\\metaengine-identity-signer-test',
    serverFactory: ({ endpoint, sessionKey, signer }) => {
      assert.equal(endpoint, '\\\\.\\pipe\\metaengine-identity-signer-test');
      assert.equal(sessionKey, 'x'.repeat(43));
      assert.equal(typeof signer.signDeviceRequest, 'function');
      return server;
    },
  });

  const ready = await runtime.start();
  assert.equal(ready.state, 'READY');
  assert.equal(ready.session_key_exposed, false);
  assert.equal(ready.private_key_exported, false);
  assert.equal(ready.enrollment_authority, false);
  assert.equal(ready.browser_control_authority, false);
  assert.equal(JSON.stringify(ready).includes('x'.repeat(20)), false);
  assert.deepEqual(events, ['start']);

  const stopped = await runtime.stop();
  assert.equal(stopped.state, 'STOPPED');
  assert.deepEqual(events, ['start', 'close']);
});

test('Browser signer startup failure is fail-closed and closes partial server', async () => {
  let closed = 0;
  const runtime = new BrowserIdentitySignerRuntime({
    identity: identity(),
    userDataPath: '/tmp/metaengine',
    sessionKey: 'y'.repeat(43),
    endpointFactory: () => '/tmp/metaengine-identity-signer.sock',
    serverFactory: () => ({
      async start() { throw new Error('bind_failed'); },
      async close() { closed += 1; },
      snapshot() { return null; },
    }),
  });

  await assert.rejects(runtime.start(), /bind_failed/);
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.state, 'FAILED');
  assert.equal(snapshot.last_error, 'bind_failed');
  assert.equal(snapshot.session_key_exposed, false);
  assert.equal(snapshot.authority_effect, false);
  assert.equal(closed, 1);
});

test('Browser signer runtime is idempotent at READY and STOPPED lifecycle edges', async () => {
  let starts = 0;
  let closes = 0;
  const runtime = new BrowserIdentitySignerRuntime({
    identity: identity(),
    userDataPath: '/tmp/metaengine',
    sessionKey: 'z'.repeat(43),
    endpointFactory: () => '/tmp/metaengine-identity-signer.sock',
    serverFactory: () => ({
      async start() { starts += 1; },
      async close() { closes += 1; },
      snapshot() { return { endpoint_kind: 'LOCAL_SOCKET' }; },
    }),
  });
  await runtime.start();
  await runtime.start();
  assert.equal(starts, 1);
  await runtime.stop();
  await runtime.stop();
  assert.equal(closes, 1);
});
