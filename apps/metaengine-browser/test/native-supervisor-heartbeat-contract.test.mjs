import test from 'node:test';
import assert from 'node:assert/strict';

import { createNativeSupervisorHeartbeatRoute } from '../supabase/a2-browser-native-supervisor-v1/heartbeat-routes.mjs';
import {
  createNativeSupervisorHeartbeatTransport,
  nativeSupervisorHeartbeatPayload,
  nativeSupervisorHeartbeatTarget,
} from '../src/native-supervisor-client-core.mjs';

const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const STATE_URL = 'https://example.invalid/functions/v1/a2-browser-native-supervisor-v1/v1/state';
const STATE_PATH = '/functions/v1/a2-browser-native-supervisor-v1/v1/state';

function heartbeatBody(marker) {
  return JSON.stringify({
    state: {
      shell_version: '0.7.0-dev.2.1',
      [marker]: true,
      authority_effect: false,
    },
    last_command_id: null,
    last_command_status: null,
  });
}

test('bootstrap and watchdog projections move atomically to /v1/heartbeat', async () => {
  const identityCalls = [];
  const fetchCalls = [];
  const identity = {
    async deviceHeaders(method, path, bodyText) {
      identityCalls.push({ method, path, bodyText });
      return { 'x-test-signed-path': path };
    },
    async ensure() {
      return { device_id: '00000000-0000-4000-8000-000000000001' };
    },
  };
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl });

  for (const marker of ['bootstrap_heartbeat', 'watchdog_heartbeat']) {
    const bodyText = heartbeatBody(marker);
    assert.equal(nativeSupervisorHeartbeatPayload(bodyText), true);
    assert.equal(nativeSupervisorHeartbeatTarget(STATE_PATH, bodyText).endsWith('/v1/heartbeat'), true);
    assert.equal(nativeSupervisorHeartbeatTarget(STATE_URL, bodyText).endsWith('/v1/heartbeat'), true);
    await transport.identity.deviceHeaders('POST', STATE_PATH, bodyText);
    await transport.fetchImpl(STATE_URL, { method: 'POST', body: bodyText });
  }

  assert.equal(identityCalls.length, 2);
  assert.equal(fetchCalls.length, 2);
  assert.equal(identityCalls.every((row) => row.path.endsWith('/v1/heartbeat')), true);
  assert.equal(fetchCalls.every((row) => String(row.url).endsWith('/v1/heartbeat')), true);
});

test('ordinary full state publication remains on /v1/state', async () => {
  const bodyText = JSON.stringify({ state: { shell_version: '0.7.0-dev.2.1', authority_effect: false } });
  assert.equal(nativeSupervisorHeartbeatPayload(bodyText), false);
  assert.equal(nativeSupervisorHeartbeatTarget(STATE_PATH, bodyText), STATE_PATH);
  assert.equal(nativeSupervisorHeartbeatTarget(STATE_URL, bodyText), STATE_URL);
});

test('heartbeat route is authenticated-readback compatible and does not expose a mutation RPC', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name !== 'devos_environment_state_v1') throw new Error(`unexpected_rpc:${name}`);
    return {
      schema: 'metaengine.devos.environment-state.v1',
      workspace_id: WORKSPACE_ID,
      generation_floor: 7,
      refill_enabled: false,
      supervisor_admission_enabled: false,
      reset_at: null,
      reset_reason: 'REPAIR_FENCE',
      authority_effect: false,
    };
  };
  const route = createNativeSupervisorHeartbeatRoute({ rpc, workspaceId: WORKSPACE_ID });
  const response = await route({ req: { method: 'POST' }, path: '/v1/heartbeat', body: { ignored: true } });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.accepted, true);
  assert.equal(body.authority_effect, false);
  assert.equal(body.automatic_retry_allowed, false);
  assert.equal(body.runtime_control.state, 'CLOSED');
  assert.equal(body.runtime_control.refill_enabled, false);
  assert.equal(body.runtime_control.supervisor_admission_enabled, false);
  assert.deepEqual(calls, [{ name: 'devos_environment_state_v1', args: { p_workspace: WORKSPACE_ID } }]);
});

test('heartbeat route fails closed when runtime-control readback is unavailable', async () => {
  const route = createNativeSupervisorHeartbeatRoute({
    workspaceId: WORKSPACE_ID,
    rpc: async () => { throw new Error('offline'); },
  });
  const response = await route({ req: { method: 'POST' }, path: '/v1/heartbeat' });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.runtime_control.state, 'UNAVAILABLE');
  assert.equal(body.runtime_control.authoritative, false);
  assert.equal(body.runtime_control.automatic_retry_allowed, false);
  assert.equal(body.authority_effect, false);
});
