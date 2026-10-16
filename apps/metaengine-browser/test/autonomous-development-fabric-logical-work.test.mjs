import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELASTIC_FLEET_CONTRACT,
  projectLogicalWorkDemand,
  planElasticFleetCapacity,
} from '../src/fleet-elastic-governor.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const physical = (n) => ({
  schema: 'metaengine.browser.fleet-snapshot.v1',
  policy: { warm_agents: 2, spawn_burst_limit: 8 },
  agents: Array.from({ length: n }, (_, i) => ({
    agent_id: `physical_${i}`, lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: `tab_${i}`, target_id: `target_${i}`,
    created_at: '2026-10-17T00:00:00.000Z',
  })),
});

test('durable logical task demand remains distinct from finite physical slots', () => {
  const fleet = physical(0);
  const plan = planElasticFleetCapacity({
    backlog: { ready: 500, running: 40 }, fleetSnapshot: fleet,
    maxTargetAgents: 10,
  });
  assert.equal(plan.logical_work.state, 'KNOWN');
  assert.equal(plan.logical_work.ready, 500);
  assert.equal(plan.logical_work.running, 40);
  assert.equal(plan.logical_work.total, 540);
  assert.equal(plan.target_agents, 10);
  assert.equal(plan.logical_work.physical_target_agents, 10);
  assert.equal(plan.logical_work.physical_slots_are_not_logical_queue_limit, true);
  assert.equal(plan.logical_work.logical_work_is_physical_slots, false);
  assert.equal(plan.logical_work.authority_effect, false);
  assert(Object.isFrozen(plan.logical_work));
  assert.equal(ELASTIC_FLEET_CONTRACT.second_scheduler_loop, false);
});

test('missing, malformed or unsafe logical backlog is UNKNOWN, not zero demand', () => {
  for (const invalid of [
    null, undefined, {}, [], { ready: null }, { ready: '500', running: 0 },
    { ready: -1, running: 0 }, { ready: 1.5, running: 0 },
    { ready: Number.MAX_SAFE_INTEGER, running: 1 },
    { ready: 0, running: Number.POSITIVE_INFINITY },
  ]) {
    const projection = projectLogicalWorkDemand(invalid);
    assert.equal(projection.state, 'UNKNOWN');
    assert.equal(projection.total, null);
    assert.equal(projection.authority_effect, false);
    assert(Object.isFrozen(projection));
  }
  assert.deepEqual(
    { state: projectLogicalWorkDemand({ ready: 0 }).state,
      total: projectLogicalWorkDemand({ ready: 0 }).total },
    { state: 'KNOWN', total: 0 },
  );
});

test('UNKNOWN freezes idle hysteresis and never schedules physical tab retirement', () => {
  const fleet = physical(7);
  const unknown = planElasticFleetCapacity({
    backlog: { ready: 'stale', running: 0 },
    fleetSnapshot: fleet, idleCycles: 11, maxTargetAgents: 3,
  });
  assert.equal(unknown.logical_work.state, 'UNKNOWN');
  assert.equal(unknown.idle_cycles, 11);
  assert.equal(unknown.target_agents, 7);
  assert.equal(unknown.scale_down, false);
  assert.deepEqual([...unknown.retire_agent_ids], []);
  assert.equal(unknown.automatic_retry_allowed, false);
  assert.equal(unknown.authority_effect, false);

  const zero = planElasticFleetCapacity({
    backlog: { ready: 0, running: 0 },
    fleetSnapshot: fleet, idleCycles: 11, maxTargetAgents: 3,
  });
  assert.equal(zero.logical_work.state, 'KNOWN');
  assert.equal(zero.idle_cycles, 12);
  assert.equal(zero.scale_down, true);
  assert(zero.retire_agent_ids.length > 0);
});

test('the existing signed DevOS cycle skips FLEET_RECONCILE on UNKNOWN backlog', async () => {
  const actions = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: physical(5) }),
    executeCommand: async command => {
      actions.push(command.action);
      return { ok: true, authority_effect: false };
    },
    signedRequest: async () => ({
      status: 200, ok: true,
      json: async () => ({
        schema: 'metaengine.devos.browser-cycle.v1',
        backlog: { ready: 'unavailable', running: 0 },
        lease: null, running: [],
      }),
    }),
    effectJournal: null,
  });
  await cycle.cycle();
  assert.equal(actions.includes('FLEET_RECONCILE'), false);
  assert.equal(actions.includes('CREATE_TAB'), false);
});
