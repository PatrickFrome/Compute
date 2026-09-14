import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  devosRuntimeControlAllowsContinuousService,
  normalizeDevosRuntimeControl,
} from '../src/devos-runtime-control.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle-core.mjs';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';
import {
  createDevosSupervisorRoutes,
  normalizeDevosRuntimeControl as normalizeServerRuntimeControl,
} from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const rawControl = (overrides = {}) => ({
  schema: 'metaengine.devos.environment-state.v1',
  workspace_id: workspaceId,
  generation_floor: 28,
  refill_enabled: false,
  supervisor_admission_enabled: false,
  reset_at: '2026-09-13T17:00:00.000Z',
  reset_reason: 'USER_REQUESTED_CLEAN_SLATE_FINAL_2026_09_13',
  authority_effect: false,
  ...overrides,
});

function memoryKeepalive() {
  let durable = null;
  let now = Date.parse('2026-09-13T20:00:00.000Z');
  const keepalive = new SupervisorKeepalive({
    loadState: async () => durable,
    saveState: async (value) => { durable = structuredClone(value); },
    clock: () => now++,
    uuid: () => '11111111-1111-4111-8111-111111111111',
    processIncarnationId: 'process_runtime-control-test',
    minWakeIntervalMs: 30_000,
  });
  return keepalive;
}

test('client and server normalize the same authoritative runtime-control row', () => {
  const clientClosed = normalizeDevosRuntimeControl(rawControl(), { workspaceId });
  const serverClosed = normalizeServerRuntimeControl(rawControl(), { workspaceId });
  for (const projection of [clientClosed, serverClosed]) {
    assert.equal(projection.state, 'CLOSED');
    assert.equal(projection.generation_floor, 28);
    assert.equal(projection.continuous_service_allowed, false);
    assert.equal(projection.authoritative, true);
    assert.equal(projection.authority_effect, false);
  }
  const open = normalizeDevosRuntimeControl(rawControl({ refill_enabled: true, supervisor_admission_enabled: true }));
  assert.equal(devosRuntimeControlAllowsContinuousService(open), true);
  assert.equal(normalizeDevosRuntimeControl({}).authoritative, false);
  assert.equal(normalizeDevosRuntimeControl(rawControl({ generation_floor: null })).authoritative, false);
  assert.equal(normalizeDevosRuntimeControl(rawControl({ generation_floor: '28' })).authoritative, false);
  assert.equal(normalizeServerRuntimeControl(rawControl({ generation_floor: null }), { workspaceId }).authoritative, false);
  assert.equal(normalizeServerRuntimeControl(rawControl({ generation_floor: '28' }), { workspaceId }).authoritative, false);
});

test('closed admission parks queued wakes without send or replay after reopen', async () => {
  const keepalive = memoryKeepalive();
  await keepalive.init();
  await keepalive.bindConversation({ url: 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111', tab_id: 'tab_supervisor' });
  await keepalive.enqueueWake('RESEARCH_ACCELERATOR_DUE', { key: 'research' });
  await keepalive.enqueueWake('WORKER_LOST', { agent_id: 'agent_lost' });

  const closed = await keepalive.applyAdmissionClosed(normalizeDevosRuntimeControl(rawControl()));
  assert.equal(closed.state, 'PARKED');
  assert.equal(closed.admission_state, 'CLOSED');
  assert.equal(closed.parked_queued_wake_count, 2);
  assert.deepEqual(new Set(closed.parked_wake_reasons), new Set(['RESEARCH_ACCELERATOR_DUE', 'WORKER_LOST']));
  assert.deepEqual(closed.queued_wakes, []);
  assert.equal(closed.pending_wake, null);
  assert.equal(closed.active_wake, null);
  assert.equal(keepalive.canWake(), false);

  const suppressed = await keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'closed' });
  assert.equal(suppressed.suppressed_wake_count, 1);
  assert.equal(suppressed.last_suppressed_wake_reason, 'CONTINUE_DEVELOPMENT');
  assert.deepEqual(suppressed.queued_wakes, []);

  const reopened = await keepalive.applyAdmissionOpen(normalizeDevosRuntimeControl(rawControl({ refill_enabled: true, supervisor_admission_enabled: true })));
  assert.equal(reopened.state, 'WAITING');
  assert.deepEqual(reopened.queued_wakes, []);
  assert.equal(keepalive.canWake(), false, 'retired wakes are not reconstructed after reopen');
});

test('closed admission preserves a genuinely ambiguous pending wake fail-closed', async () => {
  const keepalive = memoryKeepalive();
  await keepalive.init();
  await keepalive.bindConversation({ url: 'https://chatgpt.com/c/22222222-2222-4222-8222-222222222222', tab_id: 'tab_supervisor' });
  await keepalive.enqueueWake('WORKER_RESULT_READY', { agent_id: 'agent_ready' });
  const prepared = await keepalive.prepareNextWake();
  await keepalive.markWakeAmbiguous(prepared.pending.wake_id, 'SEND_WITHOUT_POSITIVE_READBACK');
  const pendingBefore = keepalive.snapshot().pending_wake;

  const closed = await keepalive.applyAdmissionClosed(normalizeDevosRuntimeControl(rawControl()));
  assert.equal(closed.state, 'WAKE_AMBIGUOUS');
  assert.equal(closed.pending_wake.wake_id, pendingBefore.wake_id);
  assert.equal(closed.pending_wake.automatic_retry_allowed, false);
  assert.equal(closed.queued_wakes.length, 1);
  assert.equal(keepalive.canWake(), false);
});

test('closed admission retires unstarted rollover intent and positive ambiguous readback remains parked', async () => {
  const queued = memoryKeepalive();
  await queued.init();
  await queued.bindConversation({ url: 'https://chatgpt.com/c/33333333-3333-4333-8333-333333333333', tab_id: 'tab_supervisor' });
  await queued.requestRollover('CONVERSATION_LIMIT');
  await queued.approveRollover('TRUSTED_CONTINUOUS_SERVICE');
  const parked = await queued.applyAdmissionClosed(normalizeDevosRuntimeControl(rawControl()));
  assert.equal(parked.state, 'PARKED');
  assert.equal(parked.rollover_reason, null);
  assert.equal(parked.rollover_release_at, null);
  await queued.applyAdmissionOpen(normalizeDevosRuntimeControl(rawControl({ refill_enabled: true, supervisor_admission_enabled: true })));
  await queued.pause();
  assert.equal((await queued.resume()).state, 'WAITING', 'retired rollover cannot reappear after reopen and pause/resume');

  const ambiguous = memoryKeepalive();
  await ambiguous.init();
  await ambiguous.bindConversation({ url: 'https://chatgpt.com/c/44444444-4444-4444-8444-444444444444', tab_id: 'tab_old' });
  await ambiguous.requestRollover('CONVERSATION_LIMIT');
  await ambiguous.approveRollover('TRUSTED_CONTINUOUS_SERVICE');
  await ambiguous.beginRolloverAttempt();
  await ambiguous.markRolloverAmbiguous('SEND_EFFECT_UNKNOWN');
  await ambiguous.applyAdmissionClosed(normalizeDevosRuntimeControl(rawControl()));
  const rebound = await ambiguous.bindRollover({ url: 'https://chatgpt.com/c/55555555-5555-4555-8555-555555555555', tab_id: 'tab_new' });
  assert.equal(rebound.state, 'PARKED');
  assert.equal(rebound.admission_state, 'CLOSED');
});

test('durable generation floor rejects a stale lower-generation reopen across process restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-runtime-floor-'));
  const statePath = path.join(dir, 'keepalive.json');
  const options = {
    statePath,
    requireAuthoritativeAdmission: true,
    getState: async () => ({ tabs: [], fleet: { agents: [] } }),
    executeCommand: async () => { throw new Error('unexpected_command'); },
    canActuate: () => false,
  };
  try {
    const first = new SupervisorLifecycleRuntime(options);
    await first.applyRuntimeControl(normalizeDevosRuntimeControl(rawControl()));
    assert.equal((await first.start()).keepalive.admission_generation_floor, 28);

    const restarted = new SupervisorLifecycleRuntime(options);
    await restarted.applyRuntimeControl(normalizeDevosRuntimeControl(rawControl({ generation_floor: 27, refill_enabled: true, supervisor_admission_enabled: true })));
    const snapshot = await restarted.start();
    assert.equal(snapshot.continuous_service.runtime_control.state, 'UNAVAILABLE');
    assert.equal(snapshot.continuous_service.runtime_control.reason, 'GENERATION_FLOOR_REGRESSION');
    assert.equal(snapshot.keepalive.admission_state, 'CLOSED');
    assert.equal(snapshot.keepalive.admission_generation_floor, 28);
    assert.equal(snapshot.actuation_enabled, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('lifecycle applies closed admission before its first cycle and performs no Browser command', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-runtime-control-'));
  const statePath = path.join(dir, 'keepalive.json');
  const commands = [];
  try {
    const lifecycle = new SupervisorLifecycleRuntime({
      statePath,
      requireAuthoritativeAdmission: true,
      getState: async () => ({ tabs: [], fleet: { agents: [] } }),
      executeCommand: async (command) => { commands.push(command); throw new Error('unexpected_command'); },
      canActuate: () => false,
    });
    await lifecycle.applyRuntimeControl(normalizeDevosRuntimeControl(rawControl()));
    const snapshot = await lifecycle.start();
    assert.equal(snapshot.keepalive.state, 'PARKED');
    assert.equal(snapshot.continuous_service.enabled, false);
    assert.equal(snapshot.continuous_service.admission_state, 'CLOSED');
    assert.equal(snapshot.actuation_enabled, false);
    assert.deepEqual(commands, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('server cycle fences before meta, reconcile or lease when runtime control is closed', async () => {
  const calls = [];
  const control = normalizeServerRuntimeControl(rawControl(), { workspaceId });
  const route = createDevosSupervisorRoutes({
    workspaceId,
    rpc: async (name) => { calls.push(name); throw new Error(`unexpected_rpc:${name}`); },
    readRuntimeControl: async () => control,
  });
  const response = await route({ req: { method: 'POST' }, path: '/v1/devos/cycle', body: { fleet: { agents: [] } }, clientId: 'device' });
  const body = JSON.parse(await response.text());
  assert.equal(response.status, 200);
  assert.equal(body.state, 'ADMISSION_FENCED');
  assert.equal(body.lease, null);
  assert.equal(body.reconcile, null);
  assert.deepEqual(body.running, []);
  assert.deepEqual(calls, []);
});

test('bounded DevOS RUN_ONCE skips local FLEET_RECONCILE on a fenced plan', async () => {
  const commands = [];
  const control = normalizeDevosRuntimeControl(rawControl());
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: { schema: 'metaengine.browser.fleet-snapshot.v1', policy: {}, agents: [] } }),
    executeCommand: async (command) => { commands.push(command); return {}; },
    signedRequest: async (requestPath) => {
      assert.equal(requestPath, '/v1/devos/cycle');
      return new Response(JSON.stringify({
        schema: 'metaengine.devos.browser-cycle.v1',
        state: 'ADMISSION_FENCED',
        admission_fenced: true,
        runtime_control: control,
        authority_effect: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const snapshot = await cycle.cycle();
  assert.equal(snapshot.state, 'ADMISSION_FENCED');
  assert.equal(snapshot.fleet_reconcile_attempted, false);
  assert.equal(snapshot.physical_effect_attempted, false);
  assert.deepEqual(commands, []);
});

test('repository separates signed liveness heartbeat from authoritative state and materializes the same Development Plane projection', async () => {
  const root = new URL('..', import.meta.url);
  const [base, core, edge, main] = await Promise.all([
    fs.readFile(new URL('src/native-supervisor-client-base.mjs', root), 'utf8'),
    fs.readFile(new URL('src/native-supervisor-client-core-base.mjs', root), 'utf8'),
    fs.readFile(new URL('supabase/a2-browser-native-supervisor-v1/index.ts', root), 'utf8'),
    fs.readFile(new URL('src/main.mjs', root), 'utf8'),
  ]);
  assert.match(base, /#signedRequest\('\/v1\/state'/);
  assert.match(core, /NATIVE_SUPERVISOR_RUNTIME_PATH}\/v1\/heartbeat/);
  assert.match(core, /NATIVE_SUPERVISOR_BASE}\/v1\/heartbeat/);
  assert.match(edge, /path==='\/v1\/heartbeat'/);
  assert.match(edge, /touchHeartbeat\(identity\)/);
  assert.match(edge, /runtime_control:await runtimeControl\(\)/);
  assert.match(main, /development_plane: normalizeDevelopmentPlaneProjection\(/);
  assert.match(main, /async function nativeSupervisorState\(\)[\s\S]*const compute = await currentComputeHealth\(\)[\s\S]*compute,/);
  assert.match(edge, /compute:boundedObject\(s\.compute,32768\)/);
});
