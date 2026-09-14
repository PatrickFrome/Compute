import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_HEARTBEAT_PATH,
  createNativeSupervisorHeartbeatRoute,
} from '../supabase/a2-browser-native-supervisor-v1/heartbeat-route.mjs';

const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

function json(status, body) {
  return { status, body };
}

function validDbAck() {
  return {
    accepted: true,
    last_seen_at: '2026-09-14T10:00:00.000Z',
    state_document_mutated: false,
    liveness_mutated: true,
    last_seen_at_mutated: true,
    authority_effect: false,
  };
}

test('heartbeat accepts only the exact minimal phase plus zero-authority envelope', async () => {
  let rpcCalls = 0;
  const route = createNativeSupervisorHeartbeatRoute({
    workspaceId: WORKSPACE_ID,
    json,
    rpc: async () => {
      rpcCalls += 1;
      return validDbAck();
    },
  });

  const extraField = await route({
    req: { method: 'POST' },
    path: NATIVE_SUPERVISOR_HEARTBEAT_PATH,
    body: {
      phase: 'WATCHDOG',
      authority_effect: false,
      telemetry: { tabs: ['must-not-cross-liveness-lane'] },
    },
    identity: { id: 'client_a', device_id: 'device_a' },
  });

  assert.equal(extraField.status, 400);
  assert.equal(extraField.body.error, 'native_heartbeat_payload_invalid');
  assert.equal(extraField.body.state_payload_allowed, false);
  assert.deepEqual(extraField.body.allowed_fields, ['phase', 'authority_effect']);
  assert.equal(extraField.body.automatic_retry_allowed, false);
  assert.equal(extraField.body.authority_effect, false);
  assert.equal(rpcCalls, 0);

  const valid = await route({
    req: { method: 'POST' },
    path: NATIVE_SUPERVISOR_HEARTBEAT_PATH,
    body: { phase: 'WATCHDOG', authority_effect: false },
    identity: { id: 'client_a', device_id: 'device_a' },
  });

  assert.equal(valid.status, 202);
  assert.equal(valid.body.accepted, true);
  assert.equal(valid.body.phase, 'WATCHDOG');
  assert.equal(valid.body.state_document_mutated, false);
  assert.equal(valid.body.liveness_mutated, true);
  assert.equal(valid.body.command_leasing, false);
  assert.equal(valid.body.control_authority, false);
  assert.equal(valid.body.authority_effect, false);
  assert.equal(rpcCalls, 1);
});
