import test from 'node:test';
import assert from 'node:assert/strict';

import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emergencyCommand() {
  return {
    command_id: COMMAND_ID,
    action: 'DEVELOPER_EMERGENCY_UPDATE',
    payload: {
      schema: 'metaengine.developer-emergency-update.v1',
      request_nonce: 'abcdefghijklmnopqrstuvwxyzABCDEF123456',
      release_mode: 'LATEST_TRUSTED',
    },
    platform: null,
  };
}

async function runOneCommand(command, { developerEmergencyUpdate = null } = {}) {
  const events = [];
  const posted = [];
  let ordinaryDispatchCount = 0;

  const identity = {
    ensure: async () => ({
      client_id: 'client-test-1',
      device_id: 'device-test-1',
      key_fingerprint_sha256: 'a'.repeat(64),
    }),
    snapshot: () => ({
      client_id: 'client-test-1',
      device_id: 'device-test-1',
      key_fingerprint_sha256: 'a'.repeat(64),
    }),
    deviceHeaders: async (method, path) => {
      events.push(`signed:${method}:${path}`);
      return { 'content-type': 'application/json', 'x-test-signature': 'present' };
    },
  };

  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return jsonResponse({}, 202);
    if (pathname.endsWith('/v1/commands/wait-batch')) {
      events.push('leased:wait-batch');
      return jsonResponse({ commands: [command] });
    }
    if (pathname.endsWith('/v1/commands/result-batch')) {
      posted.push(JSON.parse(String(init.body || '{}')));
      return jsonResponse({ accepted: true });
    }
    throw new Error(`unexpected_fetch:${pathname}`);
  };

  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => {
      ordinaryDispatchCount += 1;
      throw new Error('ordinary_executor_must_not_receive_test_command');
    },
    developerEmergencyUpdate: developerEmergencyUpdate
      ? async (leasedCommand) => {
          events.push('emergency-handler');
          return developerEmergencyUpdate(leasedCommand);
        }
      : null,
    version: '0.7.0-dev.test',
    commandBatchWaitMs: 250,
  });

  client.setControlState({ mode: 'OFF', armed: false });
  const snapshot = await client.cycle();
  return { client, snapshot, events, posted, ordinaryDispatchCount };
}

test('developer emergency update executes after signed lease while OFF and disarmed', async () => {
  let emergencyDispatchCount = 0;
  const command = emergencyCommand();
  const result = await runOneCommand(command, {
    developerEmergencyUpdate: async (leasedCommand) => {
      emergencyDispatchCount += 1;
      assert.deepEqual(leasedCommand, command);
      return {
        schema: 'metaengine.developer-emergency-update-runtime.v1',
        state: 'CONFIRMED',
        reason: 'EXACT_SUCCESSOR_READY',
        physical_dispatch_count: 1,
        effect_outcome: 'CONFIRMED',
        automatic_retry_allowed: false,
        bypass_program_policy: true,
        authority_effect: false,
      };
    },
  });

  assert.equal(emergencyDispatchCount, 1);
  assert.equal(result.ordinaryDispatchCount, 0);
  assert.equal(result.snapshot.supervisor_mode, 'OFF');
  assert.equal(result.snapshot.armed, false);
  assert.equal(result.snapshot.last_command_status, 'COMPLETED');

  const signedLeaseIndex = result.events.findIndex((event) => event.includes('/v1/commands/wait-batch'));
  const handlerIndex = result.events.indexOf('emergency-handler');
  assert.ok(signedLeaseIndex >= 0);
  assert.ok(handlerIndex > signedLeaseIndex);

  const row = result.posted.at(-1)?.results?.[0];
  assert.equal(row?.ok, true);
  assert.equal(row?.receipt?.lane, 'EMERGENCY');
  assert.equal(row?.receipt?.effect_outcome, 'CONFIRMED');
  assert.equal(row?.receipt?.result?.physical_dispatch_count, 1);
});

test('missing emergency handler holds with proven zero effect instead of falling through', async () => {
  const result = await runOneCommand(emergencyCommand());

  assert.equal(result.ordinaryDispatchCount, 0);
  assert.equal(result.snapshot.last_command_status, 'COMPLETED');
  const row = result.posted.at(-1)?.results?.[0];
  assert.equal(row?.ok, true);
  assert.equal(row?.receipt?.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.equal(row?.receipt?.result?.state, 'HOLD');
  assert.equal(row?.receipt?.result?.reason, 'DEVELOPER_EMERGENCY_UPDATE_HANDLER_UNAVAILABLE');
  assert.equal(row?.receipt?.result?.physical_dispatch_count, 0);
});

test('ordinary mutation remains blocked by OFF/disarmed policy gates', async () => {
  const result = await runOneCommand({
    command_id: COMMAND_ID,
    action: 'NEW_TAB',
    payload: { url: 'https://example.test/' },
    platform: null,
  }, {
    developerEmergencyUpdate: async () => {
      throw new Error('emergency_handler_must_not_receive_normal_mutation');
    },
  });

  assert.equal(result.ordinaryDispatchCount, 0);
  assert.equal(result.snapshot.last_command_status, 'FAILED');
  const row = result.posted.at(-1)?.results?.[0];
  assert.equal(row?.ok, false);
  assert.match(String(row?.error || ''), /native_supervisor_control_required:OFF/);
});
