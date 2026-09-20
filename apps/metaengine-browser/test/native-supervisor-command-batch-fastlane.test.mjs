import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  NativeSupervisorCommandBatchFastlane,
  classifyBatchFastlaneWakeReason,
} from '../src/native-supervisor-command-batch-fastlane.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client.mjs';
import { SupervisorDeviceIdentity } from '../src/supervisor-device-identity.mjs';

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value, 'utf8').replace(/^enc:/, ''),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildBatchFastlane(overrides = {}) {
  const state = {
    running: true,
    slotBusy: false,
    identity: { device_id: '00000000-0000-4000-8000-000000000002' },
    commands: [],
    polls: 0,
  };
  const fastlane = new NativeSupervisorCommandBatchFastlane({
    intervalMs: 250,
    isRunning: () => state.running,
    isSlotBusy: () => state.slotBusy,
    identitySnapshot: () => state.identity,
    pickupAndRun: async () => {
      state.polls += 1;
      const command = state.commands.length ? state.commands.shift() : null;
      if (command?.__throw) throw new Error(command.__throw);
      return command || null;
    },
    ...overrides.deps,
  });
  return { fastlane, state };
}

test('wake reason classification separates poll-fallback edges from notify edges', () => {
  assert.equal(classifyBatchFastlaneWakeReason('DB_POLL_TIMEOUT_FALLBACK'), 'POLL_EDGE');
  assert.equal(classifyBatchFastlaneWakeReason('POSTGRES_LISTEN_UNAVAILABLE_DB_POLL_FALLBACK'), 'POLL_EDGE');
  assert.equal(classifyBatchFastlaneWakeReason('POSTGRES_NOTIFY'), 'NOTIFY_EDGE');
  assert.equal(classifyBatchFastlaneWakeReason('POSTGRES_RELISTEN'), 'NOTIFY_EDGE');
  assert.equal(classifyBatchFastlaneWakeReason('POSTGRES_SUBSCRIBED_RECHECK'), 'NOTIFY_EDGE');
  assert.equal(classifyBatchFastlaneWakeReason('REALTIME_BROADCAST'), 'NOTIFY_EDGE');
  assert.equal(classifyBatchFastlaneWakeReason('IMMEDIATE'), 'NEUTRAL');
  assert.equal(classifyBatchFastlaneWakeReason('TIMEOUT'), 'NEUTRAL');
  assert.equal(classifyBatchFastlaneWakeReason('UNKNOWN'), 'NEUTRAL');
  assert.equal(classifyBatchFastlaneWakeReason(''), 'NEUTRAL');
  assert.equal(classifyBatchFastlaneWakeReason(null), 'NEUTRAL');
});

test('batch fastlane constructor requires all dependency probes', () => {
  for (const drop of ['isRunning', 'isSlotBusy', 'identitySnapshot', 'pickupAndRun']) {
    const deps = {
      isRunning: () => true,
      isSlotBusy: () => false,
      identitySnapshot: () => ({}),
      pickupAndRun: async () => null,
    };
    delete deps[drop];
    assert.throws(() => new NativeSupervisorCommandBatchFastlane(deps), /native_supervisor_batch_fastlane_/);
  }
  assert.throws(() => new NativeSupervisorCommandBatchFastlane({
    isRunning: () => true,
    isSlotBusy: () => false,
    identitySnapshot: () => ({}),
    pickupAndRun: async () => null,
    initialMode: 'ALWAYS',
  }), /native_supervisor_batch_fastlane_initial_mode_invalid/);
});

test('batch fastlane polls while a poll-fallback edge is observed and picks up commands', async () => {
  const { fastlane, state } = buildBatchFastlane();
  state.commands.push({ command_id: crypto.randomUUID(), action: 'POLL' });
  fastlane.observeWake('DB_POLL_TIMEOUT_FALLBACK');
  fastlane.start();
  await sleep(900);
  fastlane.stop();
  const snap = fastlane.snapshot();
  assert.equal(snap.schema, 'metaengine.native-supervisor.command-batch-fastlane.v1');
  assert.equal(snap.mode, 'POLLING');
  assert.equal(snap.last_wake_reason_class, 'POLL_EDGE');
  assert.ok(snap.poll_count >= 1, 'batch fastlane must poll against a bounded DB poll edge');
  assert.equal(snap.commands_executed, 1, 'issued command must be picked up by the batch fastlane');
  assert.equal(snap.command_pickup_transport_only, true);
  assert.equal(snap.command_execution_exclusive, 'local_slot_plus_db_lease_transactional');
  assert.equal(snap.auto_suspend_on_notify_wake, true);
  assert.equal(snap.scheduler_authority, false);
  assert.equal(snap.browser_authority, false);
  assert.equal(snap.authority_effect, false);
});

test('batch fastlane suspends permanently on notify wake evidence and stops polling', async () => {
  const { fastlane, state } = buildBatchFastlane();
  fastlane.start();
  await sleep(350);
  const pollsBeforeNotify = state.polls;
  fastlane.observeWake('POSTGRES_NOTIFY');
  assert.equal(fastlane.snapshot().mode, 'SUSPENDED');
  assert.equal(fastlane.snapshot().suspend_count, 1);
  await sleep(600);
  fastlane.stop();
  assert.equal(state.polls, pollsBeforeNotify, 'no polls may happen after notify-wake suspension');
  const snap = fastlane.snapshot();
  assert.equal(snap.mode, 'SUSPENDED');
  assert.equal(snap.steady_state_single_lease_loop, true, 'suspended mode is the single steady-state lease loop');
  // Reactivation only on explicit poll-fallback evidence returning.
  fastlane.observeWake('IMMEDIATE');
  assert.equal(fastlane.snapshot().mode, 'SUSPENDED', 'NEUTRAL evidence keeps the suspended mode');
  fastlane.observeWake('DB_POLL_TIMEOUT_FALLBACK');
  assert.equal(fastlane.snapshot().mode, 'POLLING');
  assert.equal(fastlane.snapshot().reactivate_count, 1);
});

test('batch fastlane defers to an occupied command slot and never polls while execution is in flight', async () => {
  const { fastlane, state } = buildBatchFastlane();
  state.slotBusy = true;
  fastlane.start();
  await sleep(600);
  fastlane.stop();
  assert.equal(fastlane.snapshot().poll_count, 0, 'no polls may happen while the command slot is busy');
});

test('batch fastlane does not poll when the supervisor is not running or the device is not enrolled', async () => {
  const notRunning = buildBatchFastlane();
  notRunning.state.running = false;
  notRunning.fastlane.start();
  await sleep(450);
  notRunning.fastlane.stop();
  assert.equal(notRunning.fastlane.snapshot().poll_count, 0);

  const notEnrolled = buildBatchFastlane();
  notEnrolled.state.identity = { device_id: null };
  notEnrolled.fastlane.start();
  await sleep(450);
  notEnrolled.fastlane.stop();
  assert.equal(notEnrolled.fastlane.snapshot().poll_count, 0, 'enrollment stays driven by the supervisor cycle');
});

test('batch fastlane backs off exponentially on pickup failure and resets after success', async () => {
  const { fastlane, state } = buildBatchFastlane();
  state.commands.push({ __throw: 'native_supervisor_next_http_502' });
  fastlane.start();
  await sleep(450);
  let snap = fastlane.snapshot();
  assert.equal(snap.current_backoff_ms, 500, 'first failure doubles the interval');
  assert.match(String(snap.last_error), /native_supervisor_next_http_502/);
  state.commands.push(null);
  await sleep(700);
  snap = fastlane.snapshot();
  assert.equal(snap.current_backoff_ms, 0, 'successful poll resets backoff');
  assert.equal(snap.last_error, null);
  fastlane.stop();
});

test('client exposes batch fastlane telemetry and picks up a command sub-second against a poll-fallback edge', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-batch-fastlane-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  await identity.bindDevice(crypto.randomUUID());
  let waitBatchCalls = 0;
  let nextCalls = 0;
  let executed = 0;
  const pendingCommands = [{ command_id: crypto.randomUUID(), action: 'POLL', payload: {}, issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() }];
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/v1/commands/wait-batch')) {
      waitBatchCalls += 1;
      // Emulate the deployed bounded DB poll edge: sleep the full budget then
      // answer empty. The batch fastlane must pick the command up from
      // /v1/commands/next long before this resolves.
      await sleep(1200);
      return new Response(JSON.stringify({ commands: [], wake_reason: 'DB_POLL_TIMEOUT_FALLBACK' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (pathname.endsWith('/v1/commands/next')) {
      nextCalls += 1;
      const command = pendingCommands.length ? pendingCommands.shift() : null;
      return new Response(JSON.stringify({ command }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) return new Response(JSON.stringify({ accepted: true, state: 'DELIVERED' }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected_fetch:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version: '0.7.0-dev.test.1',
    intervalMs: 60000,
    commandBatchWaitMs: 1200,
    commandBatchFastlane: true,
    commandBatchFastlaneIntervalMs: 250,
    legacySingleLeaseFallback: false,
    commandFastlane: false,
    getState: async () => ({ tabs: [], active_tab: null, development_plane: null, fleet: null, perception: null }),
    executeCommand: async () => { executed += 1; return { ok: true, authority_effect: false }; },
  });
  await client.start();
  const startedAt = Date.now();
  while (executed < 1 && Date.now() - startedAt < 3000) await sleep(50);
  const pickupMs = Date.now() - startedAt;
  client.stop();
  assert.equal(executed, 1, 'the batch fastlane must pick the command up while the cycle is parked in wait-batch');
  assert.ok(pickupMs < 1100, `pickup must beat the 1200ms poll edge budget (took ${pickupMs}ms)`);
  assert.ok(nextCalls >= 1, 'fastlane polls the single-lease endpoint');
  const snap = client.snapshot();
  assert.equal(snap.command_batch_fastlane.enabled, true);
  assert.equal(snap.command_batch_fastlane.mode, 'POLLING');
  assert.equal(snap.command_batch_fastlane.command_pickup_transport_only, true);
  assert.equal(snap.command_batch_fastlane.authority_effect, false);
  assert.equal(snap.control_fast_lane.batch_fastlane_configured, true);
  assert.equal(snap.control_fast_lane.batch_fastlane_mode, 'POLLING');
  assert.equal(snap.control_fast_lane.one_steady_state_lease_loop, true);
  assert.equal(snap.last_command_status, 'COMPLETED');
});

test('client suspends the batch fastlane once the edge proves notify wake', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-batch-fastlane-notify-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  await identity.bindDevice(crypto.randomUUID());
  let nextCalls = 0;
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/v1/commands/wait-batch')) {
      await sleep(150);
      return new Response(JSON.stringify({ commands: [], wake_reason: 'POSTGRES_NOTIFY' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (pathname.endsWith('/v1/commands/next')) {
      nextCalls += 1;
      return new Response(JSON.stringify({ command: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected_fetch:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version: '0.7.0-dev.test.1',
    intervalMs: 60000,
    commandBatchWaitMs: 200,
    commandBatchFastlane: true,
    commandBatchFastlaneIntervalMs: 250,
    legacySingleLeaseFallback: false,
    commandFastlane: false,
    getState: async () => ({ tabs: [], active_tab: null, development_plane: null, fleet: null, perception: null }),
    executeCommand: async () => ({ ok: true, authority_effect: false }),
  });
  await client.start();
  const startedAt = Date.now();
  while (client.snapshot().command_batch_fastlane.mode !== 'SUSPENDED' && Date.now() - startedAt < 3000) await sleep(50);
  client.stop();
  assert.equal(client.snapshot().command_batch_fastlane.mode, 'SUSPENDED', 'notify wake must suspend the accelerator');
  const nextCallsAtSuspension = nextCalls;
  await sleep(500);
  assert.equal(nextCalls, nextCallsAtSuspension, 'no further single-lease polls after suspension');
  assert.equal(client.snapshot().command_batch_fastlane.steady_state_single_lease_loop, true);
});

test('batch fastlane disabled by default keeps the previous contract surface', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-batch-fastlane-off-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  await identity.bindDevice(crypto.randomUUID());
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/v1/commands/wait-batch')) return new Response(JSON.stringify({ commands: [], wake_reason: 'DB_POLL_TIMEOUT_FALLBACK' }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected_fetch:${pathname}`);
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version: '0.7.0-dev.test.1',
    intervalMs: 60000,
    legacySingleLeaseFallback: false,
    commandFastlane: false,
    getState: async () => ({ tabs: [], active_tab: null, development_plane: null, fleet: null, perception: null }),
    executeCommand: async () => ({ ok: true, authority_effect: false }),
  });
  const snap = client.snapshot();
  assert.equal(snap.command_batch_fastlane.enabled, false);
  assert.equal(snap.command_batch_fastlane.mode, 'DISABLED');
  assert.equal(snap.control_fast_lane.batch_fastlane_configured, false);
  client.stop();
});
