import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMERGENCY_LEASE_RPC,
  EMERGENCY_WAIT_PATH,
  createEmergencyCommandRoutes,
} from '../supabase/a2-browser-native-supervisor-v1/emergency-routes.mjs';

const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

function json(status, body) { return { status, body }; }

test('emergency route ignores every non-emergency endpoint', async () => {
  const route = createEmergencyCommandRoutes({ rpc: async () => null, workspaceId: WORKSPACE_ID, openWake: () => null, json });
  assert.equal(await route({ req: { method: 'GET' }, path: EMERGENCY_WAIT_PATH, body: {}, clientId: 'client-a' }), null);
  assert.equal(await route({ req: { method: 'POST' }, path: '/v1/commands/wait-batch', body: {}, clientId: 'client-a' }), null);
});

test('emergency route leases only through dedicated DB RPC and authenticated client identity', async () => {
  const calls = [];
  const route = createEmergencyCommandRoutes({
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        schema: 'metaengine.native-supervisor.emergency-command.v1',
        leased_count: 1,
        command: { command_id: COMMAND_ID, action: 'DISARM', payload: {}, command_lane: 'EMERGENCY' },
        authority_effect: false,
      };
    },
    workspaceId: WORKSPACE_ID,
    openWake: () => { throw new Error('wake_should_not_open_for_immediate_lease'); },
    json,
  });
  const response = await route({ req: { method: 'POST' }, path: EMERGENCY_WAIT_PATH, body: { wait_ms: 4000 }, clientId: 'client-a' });
  assert.equal(response.status, 200);
  assert.equal(response.body.command.command_id, COMMAND_ID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, EMERGENCY_LEASE_RPC);
  assert.deepEqual(calls[0].args, {
    p_workspace_id: WORKSPACE_ID,
    p_client_id: 'client-a',
    p_lease_timeout_seconds: 120,
  });
  assert.equal(response.body.authenticated_device_required, true);
  assert.equal(response.body.second_general_scheduler, false);
  assert.equal(response.body.authority_effect, false);
});

test('route binds Realtime wake to the authenticated client and clamps held wait', async () => {
  const wakeCalls = [];
  let reads = 0;
  const route = createEmergencyCommandRoutes({
    rpc: async () => {
      reads += 1;
      if (reads < 3) return { leased_count: 0, command: null };
      return {
        leased_count: 1,
        command: { command_id: COMMAND_ID, action: 'SET_SUPERVISOR_MODE', payload: { mode: 'OFF' }, command_lane: 'EMERGENCY' },
      };
    },
    workspaceId: WORKSPACE_ID,
    openWake: (args) => {
      wakeCalls.push(args);
      return {
        subscribed: Promise.resolve({ ok: true, reason: 'SUBSCRIBED' }),
        wake: Promise.resolve({ reason: 'BROADCAST' }),
        close() {},
      };
    },
    json,
  });
  const response = await route({ req: { method: 'POST' }, path: EMERGENCY_WAIT_PATH, body: { wait_ms: 999999 }, clientId: 'client-a' });
  assert.equal(response.status, 200);
  assert.equal(reads, 3);
  assert.deepEqual(wakeCalls, [{ clientId: 'client-a', waitMs: 15000 }]);
  assert.equal(response.body.transport_delivery_is_authority, false);
  assert.equal(response.body.automatic_retry_allowed, false);
});

test('missing authenticated client fails before RPC or Realtime', async () => {
  let effects = 0;
  const route = createEmergencyCommandRoutes({
    rpc: async () => { effects += 1; },
    workspaceId: WORKSPACE_ID,
    openWake: () => { effects += 1; },
    json,
  });
  const response = await route({ req: { method: 'POST' }, path: EMERGENCY_WAIT_PATH, body: {}, clientId: '' });
  assert.equal(response.status, 400);
  assert.equal(effects, 0);
});
