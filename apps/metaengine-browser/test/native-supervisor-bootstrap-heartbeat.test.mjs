import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBootstrapHeartbeatPayload,
  sendBootstrapHeartbeat,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
} from '../src/native-supervisor-client.mjs';

test('bootstrap heartbeat is read-only monitor state and carries no command authority', () => {
  const payload = buildBootstrapHeartbeatPayload({
    state: { supervisor_mode: 'CONTROL', armed: true, authority_effect: true, tabs: [] },
    version: '0.6.3-dev.test',
    startedAt: '2026-08-31T06:00:00.000Z',
  });
  assert.equal(payload.state.supervisor_mode, 'MONITOR');
  assert.equal(payload.state.armed, false);
  assert.equal(payload.state.operator_mode, 'OBSERVE');
  assert.equal(payload.state.authority_effect, false);
  assert.equal(payload.state.self_update_session_continuity.state, 'BOOTSTRAP_RESTORE_PENDING');
  assert.equal(payload.last_command_id, null);
  assert.equal(payload.last_command_status, null);
});

test('bootstrap pump posts only state and never leases commands while continuity start is pending', async () => {
  const calls = [];
  const identity = {
    async ensure() { return { device_id: '00000000-0000-4000-8000-000000000001' }; },
    async deviceHeaders(method, path, bodyText) {
      calls.push({ kind: 'headers', method, path, bodyText });
      return { 'x-test': '1' };
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
    version: '0.6.3-dev.test',
    startedAt: '2026-08-31T06:00:00.000Z',
  });
  assert.equal(result.sent, true);
  const fetch = calls.find((row) => row.kind === 'fetch');
  assert.equal(fetch.url, `${NATIVE_SUPERVISOR_BASE}/v1/state`);
  assert.equal(calls.find((row) => row.kind === 'headers').path, `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`);
  assert.doesNotMatch(fetch.url, /commands\/next/);
  const body = JSON.parse(fetch.init.body);
  assert.equal(body.state.supervisor_mode, 'MONITOR');
  assert.equal(body.state.armed, false);
  assert.equal(body.state.authority_effect, false);
});

test('unenrolled bootstrap performs no network request and grants no authority', async () => {
  let fetches = 0;
  const result = await sendBootstrapHeartbeat({
    identity: {
      async ensure() { return { device_id: null }; },
      async deviceHeaders() { throw new Error('not_expected'); },
    },
    fetchImpl: async () => { fetches += 1; throw new Error('not_expected'); },
    getState: async () => ({ tabs: [] }),
    version: '0.6.3-dev.test',
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'DEVICE_NOT_ENROLLED');
  assert.equal(result.authority_effect, false);
  assert.equal(fetches, 0);
});
