import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { NativeSupervisorClient as BaseNativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';
import { createFleetTargetLocalObserver } from '../src/fleet-target-local-observer.mjs';

const subject = process.env.METAENGINE_IDLE_PROGRESS_SUBJECT || '../src/native-supervisor-client-core-base.mjs';
const { NativeSupervisorClient } = await import(new URL(subject, import.meta.url));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const tabId = 'tab_12345678-1234-4234-8234-123456789abc';
const deviceId = '12345678-1234-4234-8234-123456789abc';
const responseBody = { schema: 'metaengine.devos.browser-cycle.v1', backlog: {}, leases: [], running: [], authority_effect: false };
const response = () => new Response(JSON.stringify(responseBody), { headers: { 'content-type': 'application/json' } });

function fixture({ maintenance = false, admitted = true, holdTask = false } = {}) {
  const originalCycle = BaseNativeSupervisorClient.prototype.cycle;
  const originalSnapshot = BaseNativeSupervisorClient.prototype.snapshot;
  const capture = deferred();
  const task = deferred();
  const taskStarted = deferred();
  const counters = { commands: 0, captures: 0, taskRequests: 0, reconciles: 0 };
  const identityState = { client_id: deviceId, device_id: deviceId, enrolled: true };
  const supervisor = {
    identity: identityState, supervisor_mode: 'CONTROL', armed: true, current_commands: [],
    control_fast_lane: { last_batch_count: 0, maintenance_in_flight: maintenance },
    continuous_service: { actuation_allowed: admitted },
  };
  BaseNativeSupervisorClient.prototype.cycle = async function () { counters.commands += 1; return supervisor; };
  BaseNativeSupervisorClient.prototype.snapshot = function () { return supervisor; };
  const identity = { ensure: async () => identityState, snapshot: () => identityState, deviceHeaders: async () => ({}) };
  const agent = {
    agent_id: 'agent_12345678-1234-4234-8234-123456789abc', role: 'PLANNER',
    lifecycle_state: 'BOUND_UNVERIFIED', ownership: 'USER', tab_id: tabId,
    target_id: 'webcontents:42', generation_epoch: 1, authority_effect: false,
  };
  const client = new NativeSupervisorClient({
    identity, hostResilience: false, version: '0.0.0-test',
    getState: async () => ({ tabs: [], fleet: { schema: 'metaengine.browser.fleet-snapshot.v1', readiness_contract: 'TRANSPORT_PROOF_REQUIRED', policy: { warm_agents: 1, spawn_burst_limit: 1 }, agents: [agent] } }),
    observeLocalTarget: createFleetTargetLocalObserver({ lookupView: () => ({ webContents: { id: 42, isDestroyed: () => false } }) }),
    executeCommand: async (command) => {
      if (command.action === 'CAPTURE') { counters.captures += 1; return capture.promise; }
      if (command.action === 'FLEET_RECONCILE') { counters.reconciles += 1; return { authority_effect: false }; }
      throw new Error('unexpected_executor:' + command.action);
    },
    fetchImpl: async (url) => {
      if (!String(url).endsWith('/v1/devos/cycle')) throw new Error('unexpected_route:' + url);
      counters.taskRequests += 1;
      taskStarted.resolve();
      if (holdTask) await task.promise;
      return response();
    },
  });
  return {
    client, counters, capture, task, taskStarted, supervisor,
    async settle() { await nextTurn(); await nextTurn(); },
    async close() {
      capture.resolve({ tab_id: tabId, target_id: 'webcontents:42', controls: [] });
      task.resolve();
      await nextTurn(); await nextTurn();
      client.stop();
      BaseNativeSupervisorClient.prototype.cycle = originalCycle;
      BaseNativeSupervisorClient.prototype.snapshot = originalSnapshot;
    },
  };
}

test('slow advisory capture cannot starve the scheduler-owned DevOS turn', async () => {
  const f = fixture();
  try {
    await f.client.cycle();
    await Promise.race([
      f.taskStarted.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('devos_task_start_timeout')), 5000)),
    ]);
    await f.settle();
    assert.equal(f.counters.commands, 1);
    assert.equal(f.counters.captures, 1);
    assert.equal(f.counters.taskRequests, 1, 'DevOS must progress before an advisory CAPTURE settles');
    assert.equal(f.client.snapshot().idle_background_work.in_flight, false);
    assert.equal(f.client.snapshot().idle_background_work.advisory_observation_in_flight, true);
    assert.equal(f.client.canStartMaintenance(), true, 'read-only capture cannot retain the mutation owner');
  } finally { await f.close(); }
});

test('successive command turns progress without duplicating a still-pending advisory capture', async () => {
  const f = fixture();
  try {
    await f.client.cycle(); await f.settle();
    await f.client.cycle(); await f.settle();
    assert.equal(f.counters.commands, 2);
    assert.equal(f.counters.taskRequests, 2);
    assert.equal(f.counters.captures, 1);
  } finally { await f.close(); }
});

test('an admitted task turn excludes new maintenance until its own settlement', async () => {
  const f = fixture({ holdTask: true });
  try {
    await f.client.cycle(); await f.settle();
    assert.equal(f.counters.taskRequests, 1);
    assert.equal(f.client.canStartMaintenance(), false);
    await f.client.cycle(); await f.settle();
    assert.equal(f.counters.commands, 2, 'the remote lease lane remains live');
    assert.equal(f.counters.taskRequests, 1, 'one bounded task turn owns local mutation admission');
    f.task.resolve(); await f.settle();
    assert.equal(f.client.canStartMaintenance(), true);
    assert.equal(f.counters.captures, 1, 'pending read-only capture has no mutation ownership');
  } finally { await f.close(); }
});

test('previously admitted maintenance remains ahead of DevOS and observation', async () => {
  const f = fixture({ maintenance: true });
  try {
    await f.client.cycle(); await f.settle();
    assert.equal(f.counters.commands, 1);
    assert.equal(f.counters.taskRequests, 0);
    assert.equal(f.counters.captures, 0);
    f.supervisor.control_fast_lane.maintenance_in_flight = false;
    await f.client.cycle(); await f.settle();
    assert.equal(f.counters.taskRequests, 1);
  } finally { await f.close(); }
});

test('closed continuous-service admission never grants a task turn through observation', async () => {
  const f = fixture({ admitted: false });
  try {
    await f.client.cycle(); await f.settle();
    assert.equal(f.counters.taskRequests, 0);
    assert.equal(f.counters.reconciles, 0);
    assert.equal(f.client.snapshot().devos_last_error, 'CONTINUOUS_SERVICE_ADMISSION_NOT_OPEN');
    assert.equal(f.client.canStartMaintenance(), true);
  } finally { await f.close(); }
});

test('the real base command cycle consults local maintenance ownership before starting a pass', async () => {
  let gateCalls = 0;
  let effects = 0;
  const identityState = { client_id: deviceId, device_id: deviceId, enrolled: true };
  class HeldMaintenanceClient extends BaseNativeSupervisorClient {
    canStartMaintenance() { gateCalls += 1; return false; }
  }
  const client = new HeldMaintenanceClient({
    identity: { ensure: async () => identityState, snapshot: () => identityState, deviceHeaders: async () => ({}) },
    hostResilience: false, version: '0.0.0-test',
    getState: async () => ({ tabs: [], fleet: null }),
    executeCommand: async () => { effects += 1; throw new Error('unexpected_effect'); },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/v1/state')) return new Response('{}', { status: 202 });
      if (String(url).endsWith('/v1/commands/wait-batch')) return new Response(JSON.stringify({ commands: [], authority_effect: false }));
      return new Response('{}', { status: 404 });
    },
  });
  try {
    await client.cycle(); await nextTurn();
    assert.ok(gateCalls > 0, 'an empty remote batch must consult the maintenance owner');
    assert.equal(effects, 0);
    assert.equal(client.snapshot().control_fast_lane.maintenance_in_flight, false);
  } finally { client.stop(); }
});
