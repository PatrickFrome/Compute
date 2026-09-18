import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMAND_LANES,
  NativeSupervisorCommandLaneScheduler,
  classifyNativeSupervisorCommand,
} from '../src/native-supervisor-command-lanes.mjs';

const emergency = Object.freeze({
  command_id: '11111111-1111-4111-8111-111111111111',
  action: 'DEVELOPER_EMERGENCY_UPDATE',
  payload: {
    schema: 'metaengine.developer-emergency-update.v1',
    request_nonce: 'A'.repeat(32),
    release_mode: 'LATEST_TRUSTED',
  },
});

test('developer emergency update is highest-priority exclusive emergency lane', () => {
  const descriptor = classifyNativeSupervisorCommand(emergency);
  assert.equal(descriptor.lane, COMMAND_LANES.EMERGENCY);
  assert.equal(descriptor.exclusive, true);
  assert.equal(descriptor.read_only, false);
  assert.equal(descriptor.priority, 0);
  assert.equal(descriptor.effect_key, 'global:emergency');
  assert.equal(descriptor.authority_effect, false);
});

test('developer emergency update is an immutable mutation barrier for later effects', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 8, mutationConcurrency: 8, maxBatch: 8 });
  const events = [];
  let releaseEmergency;
  const emergencyGate = new Promise((resolve) => { releaseEmergency = resolve; });
  const rows = [
    emergency,
    { command_id: 'later', action: 'FLEET_RECONCILE', payload: {} },
    { command_id: 'read', action: 'PROCESS_CENSUS', payload: {} },
  ];
  const drain = scheduler.drain(rows, async (command) => {
    events.push(`start:${command.command_id}`);
    if (command.command_id === emergency.command_id) await emergencyGate;
    events.push(`end:${command.command_id}`);
    return { ok: true };
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(events.includes(`start:${emergency.command_id}`));
  assert.equal(events.includes('start:later'), false);
  assert.equal(events.includes('start:read'), true);
  releaseEmergency();
  await drain;
  assert.ok(events.indexOf(`end:${emergency.command_id}`) < events.indexOf('start:later'), events.join(','));
});
