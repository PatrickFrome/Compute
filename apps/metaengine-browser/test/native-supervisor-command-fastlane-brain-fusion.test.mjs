import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSupervisorCommandFastlane } from '../src/native-supervisor-command-fastlane.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFastlane({ commands = [], intervalMs = 1000, maxDrain = 32 } = {}) {
  const state = {
    running: true,
    busy: false,
    commands: [...commands],
    pickupCalls: 0,
  };
  const fastlane = new NativeSupervisorCommandFastlane({
    intervalMs,
    maxDrain,
    isRunning: () => state.running,
    isSlotBusy: () => state.busy,
    identitySnapshot: () => ({ device_id: '00000000-0000-4000-8000-000000000001' }),
    pickupAndRun: async () => {
      state.pickupCalls += 1;
      return state.commands.length ? state.commands.shift() : null;
    },
  });
  return { fastlane, state };
}

test('trusted wake preempts the fallback timer and runs the same pickup path immediately', async () => {
  const { fastlane } = makeFastlane({
    intervalMs: 1000,
    commands: [{ command_id: 'one', action: 'POLL' }],
  });
  fastlane.start();
  const started = Date.now();
  assert.equal(fastlane.wake('REALTIME_COMMAND_INSERT'), true);
  while (fastlane.snapshot().commands_executed < 1 && Date.now() - started < 250) await sleep(5);
  const elapsed = Date.now() - started;
  const snap = fastlane.snapshot();
  fastlane.stop();
  assert.equal(snap.commands_executed, 1);
  assert.ok(elapsed < 250, `wake path must not wait for the 1000ms fallback interval; elapsed=${elapsed}`);
  assert.equal(snap.last_wake_reason, 'REALTIME_COMMAND_INSERT');
  assert.equal(snap.trusted_wake_transport_hint_only, true);
  assert.equal(snap.scheduler_authority, false);
});

test('one wake drains a bounded burst without inter-command cadence sleeps', async () => {
  const commands = Array.from({ length: 12 }, (_, i) => ({ command_id: `cmd-${i}`, action: 'POLL' }));
  const { fastlane, state } = makeFastlane({ intervalMs: 1000, maxDrain: 16, commands });
  fastlane.start();
  const started = Date.now();
  fastlane.wake('REALTIME_BURST');
  while (fastlane.snapshot().commands_executed < 12 && Date.now() - started < 300) await sleep(5);
  const snap = fastlane.snapshot();
  fastlane.stop();
  assert.equal(snap.commands_executed, 12);
  assert.equal(snap.drain_bursts, 1);
  assert.equal(snap.max_observed_drain, 12);
  assert.equal(state.pickupCalls, 13, 'bounded drain terminates on the first empty lease read');
  assert.equal(snap.mutating_parallelism, 1, 'transport burst must not widen effect parallelism');
});

test('bounded drain never leases beyond maxDrain in a single wake', async () => {
  const commands = Array.from({ length: 20 }, (_, i) => ({ command_id: `cmd-${i}`, action: 'POLL' }));
  const { fastlane } = makeFastlane({ intervalMs: 1000, maxDrain: 4, commands });
  fastlane.start();
  fastlane.wake('REALTIME_BURST');
  const started = Date.now();
  while (fastlane.snapshot().commands_executed < 4 && Date.now() - started < 250) await sleep(5);
  const snap = fastlane.snapshot();
  fastlane.stop();
  assert.equal(snap.commands_executed, 4);
  assert.equal(snap.max_observed_drain, 4);
  assert.equal(snap.max_drain, 4);
});

test('wake coalesces while the command slot is occupied', async () => {
  const { fastlane, state } = makeFastlane({ intervalMs: 1000, commands: [{ command_id: 'one', action: 'POLL' }] });
  state.busy = true;
  fastlane.start();
  fastlane.wake('ONE');
  fastlane.wake('TWO');
  await sleep(40);
  assert.equal(fastlane.snapshot().commands_executed, 0);
  assert.equal(fastlane.snapshot().wake_count, 2);
  state.busy = false;
  fastlane.wake('THREE');
  const started = Date.now();
  while (fastlane.snapshot().commands_executed < 1 && Date.now() - started < 250) await sleep(5);
  assert.equal(fastlane.snapshot().commands_executed, 1);
  fastlane.stop();
});
