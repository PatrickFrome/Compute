import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeSupervisorCommandFastlane } from '../src/native-supervisor-command-fastlane.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client.mjs';
import { SupervisorDeviceIdentity } from '../src/supervisor-device-identity.mjs';

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value, 'utf8').replace(/^enc:/, ''),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildFastlane(overrides = {}) {
  const state = {
    running: true,
    slotBusy: false,
    identity: { device_id: '00000000-0000-4000-8000-000000000001' },
    commands: [],
    polls: 0,
  };
  const fastlane = new NativeSupervisorCommandFastlane({
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

test('fastlane constructor requires all dependency probes', () => {
  for (const drop of ['isRunning', 'isSlotBusy', 'identitySnapshot', 'pickupAndRun']) {
    const deps = {
      isRunning: () => true,
      isSlotBusy: () => false,
      identitySnapshot: () => ({}),
      pickupAndRun: async () => null,
    };
    delete deps[drop];
    assert.throws(() => new NativeSupervisorCommandFastlane(deps), /native_supervisor_fastlane_/);
  }
});

test('fastlane picks up a command on its own cadence without waiting for the supervisor cycle', async () => {
  const { fastlane, state } = buildFastlane();
  state.commands.push({ command_id: crypto.randomUUID(), action: 'POLL' });
  fastlane.start();
  await sleep(900);
  fastlane.stop();
  const snap = fastlane.snapshot();
  assert.equal(snap.enabled, true);
  assert.equal(snap.schema, 'metaengine.native-supervisor.command-fastlane.v1');
  assert.ok(snap.poll_count >= 1, 'fastlane must poll on its own cadence');
  assert.equal(snap.commands_executed, 1, 'issued command must be picked up by the fastlane');
  assert.equal(snap.command_pickup_transport_only, true);
  assert.equal(snap.command_execution_exclusive, 'local_slot_plus_db_lease_transactional');
  assert.equal(snap.scheduler_authority, false);
  assert.equal(snap.browser_authority, false);
  assert.equal(snap.authority_effect, false);
});

test('fastlane defers to an occupied command slot and never polls while execution is in flight', async () => {
  const { fastlane, state } = buildFastlane();
  state.slotBusy = true;
  fastlane.start();
  await sleep(700);
  fastlane.stop();
  assert.equal(fastlane.snapshot().poll_count, 0, 'no polls may happen while the local command slot is busy');
});

test('fastlane does not poll when the supervisor is not running or the device is not enrolled', async () => {
  const notRunning = buildFastlane();
  notRunning.state.running = false;
  notRunning.fastlane.start();
  await sleep(550);
  notRunning.fastlane.stop();
  assert.equal(notRunning.fastlane.snapshot().poll_count, 0);

  const notEnrolled = buildFastlane();
  notEnrolled.state.identity = { device_id: null };
  notEnrolled.fastlane.start();
  await sleep(550);
  notEnrolled.fastlane.stop();
  assert.equal(notEnrolled.fastlane.snapshot().poll_count, 0, 'enrollment stays driven by the supervisor cycle');
});

test('fastlane backs off exponentially on pickup failure and resets after success', async () => {
  const { fastlane, state } = buildFastlane();
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

test('fastlane stop halts polling', async () => {
  const { fastlane, state } = buildFastlane();
  fastlane.start();
  await sleep(300);
  fastlane.stop();
  const pollsAtStop = state.polls;
  await sleep(500);
  assert.equal(state.polls, pollsAtStop, 'poll count must not grow after stop()');
});

test('base client exposes fastlane telemetry and keeps cycle pickup intact without the fastlane option', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-fastlane-'));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  const deviceId = crypto.randomUUID();
  await identity.bindDevice(deviceId);
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    if (pathname.endsWith('/v1/commands/wait-batch')) return new Response('', { status: 404 });
    if (pathname.endsWith('/v1/commands/next')) return new Response(JSON.stringify({ command: { command_id: crypto.randomUUID(), action: 'POLL', payload: {}, issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) return new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected_fetch:${pathname}:${init.method || 'GET'}`);
  };
  let executed = 0;
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    version: '0.6.6-dev.16.1',
    intervalMs: 60000,
    getState: async () => ({ tabs: [], active_tab: null, development_plane: null, fleet: null, perception: null }),
    executeCommand: async () => { executed += 1; return { ok: true, authority_effect: false }; },
  });
  const disabled = client.snapshot().command_fastlane;
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.scheduler_authority, false);
  assert.equal(disabled.authority_effect, false);
  await client.cycle();
  assert.equal(executed, 1, 'legacy cycle pickup must remain the fallback when wait-batch is unavailable');
  assert.equal(client.snapshot().last_command_status, 'COMPLETED');
});

test('base client preserves the 750ms fastlane only as a fallback and suppresses it after batch support', async () => {
  const source = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  assert.match(source, /commandFastlane === true\s*\?\s*new NativeSupervisorCommandFastlane/);
  assert.match(source, /this\.#commandFastlane\?\.start\(\)/);
  assert.match(source, /this\.#commandFastlane\?\.stop\(\)/);
  assert.match(source, /command_fastlane: this\.#commandFastlane\?\.snapshot\(\)/);
  assert.match(source, /pickupAndRun:\s*\(\)\s*=>\s*this\.#pickupAndRunLegacyFastlaneCommand\(\)/);
  assert.match(source, /this\.#batchTransport = 'SUPPORTED';\s*\n\s*this\.#commandFastlane\?\.stop\(\)/);
  assert.match(source, /legacy_fallback_suppressed_by_batch_transport:\s*this\.#batchTransport === 'SUPPORTED'/);
  assert.match(source, /one_steady_state_lease_loop:\s*true/);
  assert.match(source, /command_lane_precedes_maintenance:\s*true/);
  const fastlaneSource = await readFile(new URL('../src/native-supervisor-command-fastlane.mjs', import.meta.url), 'utf8');
  assert.match(fastlaneSource, /command_pickup_transport_only: true/);
  assert.match(fastlaneSource, /scheduler_authority: false/);
  assert.doesNotMatch(fastlaneSource, /setInterval\s*\(/);
});

test('shell opts the native supervisor into the command fastlane with a bounded cadence', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /commandFastlane:\s*true/);
  assert.match(main, /commandFastlaneIntervalMs:\s*750/);
});
