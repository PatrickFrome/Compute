import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELASTIC_FLEET_CONTRACT,
  liveFleetAgents,
  planElasticFleetCapacity,
  retireEligibleFleetAgents,
} from '../src/fleet-elastic-governor.mjs';
import { planElasticFleetCapacity as viaCycle } from '../src/devos-native-task-cycle.mjs';

function agent(id, state, { created_at = '2026-09-03T10:00:00.000Z', tab_id = null } = {}) {
  return { agent_id: id, role: 'IMPLEMENTER', lifecycle_state: state, tab_id, target_id: tab_id ? 'webcontents:1' : null, generation_epoch: 1, created_at, updated_at: created_at };
}

function fleetSnapshot(agents, policy = {}) {
  return {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    policy: { warm_agents: 2, desired_agents: 6, spawn_burst_limit: 8, ...policy },
    agents,
    counts: {},
    capacity_backpressure: { blocked: false },
  };
}

test('elastic contract is frozen, authority-free and never reads worker telemetry', () => {
  assert.equal(ELASTIC_FLEET_CONTRACT.authority_effect, false);
  assert.equal(ELASTIC_FLEET_CONTRACT.second_scheduler_loop, false);
  assert.equal(ELASTIC_FLEET_CONTRACT.worker_telemetry_capacity_authority, false);
  assert.equal(ELASTIC_FLEET_CONTRACT.idle_cycles_required, 3);
  assert.equal(ELASTIC_FLEET_CONTRACT.max_retire_per_cycle, 4);
  assert.deepEqual([...ELASTIC_FLEET_CONTRACT.retire_eligible_states], ['PROVISIONING', 'BOUND_UNVERIFIED', 'ADMISSION_FENCED']);
  assert.ok(Object.isFrozen(ELASTIC_FLEET_CONTRACT));
  assert.ok(Object.isFrozen(ELASTIC_FLEET_CONTRACT.retire_eligible_states));
});

test('scale-up stays demand-driven and identical to the backlog plan while below the ceiling', () => {
  const plan = planElasticFleetCapacity({ backlog: { ready: 20, running: 1 }, fleetSnapshot: fleetSnapshot([]) });
  assert.equal(plan.active, true);
  assert.equal(plan.target_agents, 10); // max(live=0,warm=2) + min(ready=20,burst=8), bounded by warm+demand and the ceiling
  assert.equal(plan.idle_cycles, 0);
  assert.deepEqual([...plan.retire_agent_ids], []);
  assert.equal(plan.authority_effect, false);
});

test('scale-up ceiling protects the shared tab budget', () => {
  const plan = planElasticFleetCapacity({ backlog: { ready: 500, running: 40 }, fleetSnapshot: fleetSnapshot([]), maxTargetAgents: 10 });
  assert.equal(plan.target_agents, 10);
  const atCeiling = fleetSnapshot(Array.from({ length: 12 }, (_, i) => agent(`agent_h${i + 1}`, 'ACTIVE', { tab_id: `tab_h${i + 1}` })));
  const held = planElasticFleetCapacity({ backlog: { ready: 500, running: 40 }, fleetSnapshot: atCeiling });
  assert.equal(held.target_agents, ELASTIC_FLEET_CONTRACT.max_target_agents_default, 'a fleet already at the ceiling never grows past it');
});

test('demand resets the idle hysteresis counter', () => {
  const snap = fleetSnapshot([agent('agent_a1', 'BOUND_UNVERIFIED', { tab_id: 'tab_1' })]);
  const idle = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 2 });
  assert.equal(idle.idle_cycles, 3);
  const active = planElasticFleetCapacity({ backlog: { ready: 1, running: 0 }, fleetSnapshot: snap, idleCycles: 2 });
  assert.equal(active.idle_cycles, 0);
  assert.equal(active.active, true);
});

test('hysteresis holds the fleet for the first two idle cycles without retiring anything', () => {
  const snap = fleetSnapshot([
    agent('agent_a1', 'BOUND_UNVERIFIED', { tab_id: 'tab_1', created_at: '2026-09-03T10:00:00.000Z' }),
    agent('agent_a2', 'BOUND_UNVERIFIED', { tab_id: 'tab_2', created_at: '2026-09-03T10:01:00.000Z' }),
  ]);
  for (const idleCycles of [0, 1]) {
    const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles });
    assert.equal(plan.scale_down, false);
    assert.deepEqual([...plan.retire_agent_ids], []);
    assert.equal(plan.target_agents, 2);
    assert.equal(plan.active, false);
  }
});

test('third idle cycle retires only surplus claim-ineligible agents, newest first, bounded per cycle', () => {
  const snap = fleetSnapshot([
    agent('agent_a1', 'ACTIVE', { tab_id: 'tab_1', created_at: '2026-09-03T09:00:00.000Z' }),
    agent('agent_a2', 'BOUND_UNVERIFIED', { tab_id: 'tab_2', created_at: '2026-09-03T10:00:00.000Z' }),
    agent('agent_a3', 'BOUND_UNVERIFIED', { tab_id: 'tab_3', created_at: '2026-09-03T11:00:00.000Z' }),
    agent('agent_a4', 'PROVISIONING', { tab_id: 'tab_4', created_at: '2026-09-03T12:00:00.000Z' }),
    agent('agent_a5', 'REGISTERED', { created_at: '2026-09-03T13:00:00.000Z' }),
    agent('agent_a6', 'PROVISIONING_AMBIGUOUS', { created_at: '2026-09-03T14:00:00.000Z' }),
  ]);
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 2 });
  assert.equal(plan.scale_down, true);
  // worker-tab pool = ACTIVE + 2 BOUND_UNVERIFIED + PROVISIONING = 4; target = warm = 2; surplus = 2
  // eligible newest-first: a4 (PROVISIONING), a3 (BOUND_UNVERIFIED) — a5 REGISTERED has no tab,
  // a6 is ambiguous evidence, a1 is ACTIVE and never auto-retired
  assert.deepEqual([...plan.retire_agent_ids], ['agent_a4', 'agent_a3']);
  assert.equal(plan.target_agents, 2);
  assert.equal(plan.authority_effect, false);
  assert.equal(plan.automatic_retry_allowed, false);
});

test('retire list is bounded to the per-cycle fan-out even with deep surplus', () => {
  const agents = Array.from({ length: 12 }, (_, i) => agent(`agent_b${i + 1}`, 'BOUND_UNVERIFIED', { tab_id: `tab_b${i + 1}`, created_at: `2026-09-03T1${i}:00:00.000Z` }));
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: fleetSnapshot(agents), idleCycles: 5 });
  assert.equal(plan.retire_agent_ids.length, 4);
});

test('ACTIVE agents are never auto-retired even when they alone exceed the warm floor', () => {
  const snap = fleetSnapshot([
    agent('agent_c1', 'ACTIVE', { tab_id: 'tab_c1', created_at: '2026-09-03T09:00:00.000Z' }),
    agent('agent_c2', 'ACTIVE', { tab_id: 'tab_c2', created_at: '2026-09-03T10:00:00.000Z' }),
    agent('agent_c3', 'ACTIVE', { tab_id: 'tab_c3', created_at: '2026-09-03T11:00:00.000Z' }),
  ]);
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 9 });
  assert.deepEqual([...plan.retire_agent_ids], []);
  assert.equal(plan.scale_down, false);
  assert.equal(plan.target_agents, 2);
});

test('ambiguous agents stay fenced and never enter the retire list', () => {
  const snap = fleetSnapshot([
    agent('agent_d1', 'PROVISIONING_AMBIGUOUS', { tab_id: 'tab_d1' }),
    agent('agent_d2', 'BOUND_UNVERIFIED', { tab_id: 'tab_d2' }),
  ]);
  const eligible = retireEligibleFleetAgents(snap);
  assert.deepEqual(eligible.map((row) => row.agent_id), ['agent_d2']);
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 9 });
  assert.equal(plan.worker_tab_pool, 1);
  assert.equal(plan.retire_agent_ids.length, 0, 'warm floor: a single worker tab is never shrunk away');
});

test('ADMISSION_FENCED is the transport-admitted projection of claim-ineligible agents and is shrinkable', () => {
  const snap = fleetSnapshot([
    { ...agent('agent_i1', 'ADMISSION_FENCED', { tab_id: 'tab_i1', created_at: '2026-09-03T10:00:00.000Z' }), transport_admission: 'EXACT_ACTIVE_PROOF_REQUIRED' },
    { ...agent('agent_i2', 'ADMISSION_FENCED', { tab_id: 'tab_i2', created_at: '2026-09-03T11:00:00.000Z' }), transport_admission: 'EXACT_ACTIVE_PROOF_REQUIRED' },
    { ...agent('agent_i3', 'ADMISSION_FENCED', { tab_id: 'tab_i3' }), ambiguous_reason: 'CREATE_TAB_AMBIGUOUS:x' },
    { ...agent('agent_i4', 'ADMISSION_FENCED', { tab_id: 'tab_i4', created_at: '2026-09-03T12:00:00.000Z' }), transport_admission: 'EXACT_ACTIVE_PROOF_REQUIRED' },
  ]);
  const eligible = retireEligibleFleetAgents(snap);
  assert.deepEqual(eligible.map((row) => row.agent_id), ['agent_i4', 'agent_i2', 'agent_i1']);
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 5 });
  assert.equal(plan.worker_tab_pool, 3);
  // surplus = pool 3 - warm 2 = 1 → newest ADMISSION_FENCED worker shrinks away
  assert.deepEqual([...plan.retire_agent_ids], ['agent_i4']);
});

test('live agents count matches the backlog planner states', () => {
  const snap = fleetSnapshot([
    agent('agent_e1', 'ACTIVE', { tab_id: 'tab_e1' }),
    agent('agent_e2', 'BOUND_UNVERIFIED', { tab_id: 'tab_e2' }),
    agent('agent_e3', 'REGISTERED'),
    agent('agent_e4', 'RETIRED', { created_at: '2026-09-02T09:00:00.000Z' }),
    agent('agent_e5', 'LOST'),
  ]);
  assert.equal(liveFleetAgents(snap).length, 3);
});

test('malformed backlog fails safe to zero demand, never to growth', () => {
  const plan = planElasticFleetCapacity({ backlog: { ready: 'many', running: null }, fleetSnapshot: fleetSnapshot([]), idleCycles: 'x' });
  assert.equal(plan.active, false);
  assert.equal(plan.ready, 0);
  assert.equal(plan.running, 0);
  assert.equal(plan.idle_cycles, 1);
});

test('governor plan is exported through the DevOS task cycle surface', () => {
  assert.equal(typeof viaCycle, 'function');
  const plan = viaCycle({ backlog: { ready: 3 }, fleetSnapshot: fleetSnapshot([]) });
  assert.equal(plan.schema, 'metaengine.browser.fleet-elastic-plan.v1');
  assert.equal(plan.target_agents, 5);
});

test('cycle-level integration: idle cycles accumulate across cycles and surface in the FLEET_RECONCILE payload', async () => {
  const { DevOsNativeTaskCycle } = await import('../src/devos-native-task-cycle.mjs');
  const reconcilePayloads = [];
  let cycleCount = 0;
  const fleetSnap = fleetSnapshot([
    agent('agent_f1', 'BOUND_UNVERIFIED', { tab_id: 'tab_f1', created_at: '2026-09-03T10:00:00.000Z' }),
    agent('agent_f2', 'BOUND_UNVERIFIED', { tab_id: 'tab_f2', created_at: '2026-09-03T11:00:00.000Z' }),
    agent('agent_f3', 'BOUND_UNVERIFIED', { tab_id: 'tab_f3', created_at: '2026-09-03T12:00:00.000Z' }),
  ]);
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: fleetSnap }),
    executeCommand: async (command) => {
      if (command.action === 'FLEET_RECONCILE') {
        reconcilePayloads.push(structuredClone(command.payload));
        return { ok: true, authority_effect: false };
      }
      return null;
    },
    signedRequest: async () => ({
      status: 200,
      ok: true,
      json: async () => {
        cycleCount += 1;
        return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 0, running: 0 }, lease: null, running: [] };
      },
    }),
    effectJournal: null,
  });
  await cycle.cycle();
  await cycle.cycle();
  await cycle.cycle();
  assert.equal(cycleCount, 3);
  assert.equal(reconcilePayloads.length, 3);
  assert.deepEqual(reconcilePayloads.map((payload) => payload.idle_cycles), [1, 2, 3]);
  assert.equal(reconcilePayloads[0].scale_down, false);
  assert.equal(reconcilePayloads[1].scale_down, false);
  const third = reconcilePayloads[2];
  assert.equal(third.scale_down, true);
  assert.deepEqual([...third.retire_agent_ids], ['agent_f3']); // surplus = live 3 - warm 2 = 1, newest first, never below the warm floor
  const snapshot = cycle.snapshot();
  assert.equal(snapshot.elastic_fleet_governor, 'ELASTIC_BACKLOG_DRIVEN_WITH_IDLE_SHRINK');
  assert.equal(snapshot.elastic_idle_cycles_required, 3);
  assert.equal(snapshot.elastic_max_retire_per_cycle, 4);
});

test('demand arriving mid-idle resets hysteresis and stops shrink at the boundary', async () => {
  const { DevOsNativeTaskCycle } = await import('../src/devos-native-task-cycle.mjs');
  const reconcilePayloads = [];
  let ready = 0;
  const fleetSnap = fleetSnapshot([
    agent('agent_g1', 'BOUND_UNVERIFIED', { tab_id: 'tab_g1' }),
    agent('agent_g2', 'BOUND_UNVERIFIED', { tab_id: 'tab_g2' }),
  ]);
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: fleetSnap }),
    executeCommand: async (command) => {
      if (command.action === 'FLEET_RECONCILE') { reconcilePayloads.push(structuredClone(command.payload)); return { ok: true, authority_effect: false }; }
      return null;
    },
    signedRequest: async () => ({
      status: 200, ok: true,
      json: async () => ({ schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready, running: 0 }, lease: null, running: [] }),
    }),
    effectJournal: null,
  });
  await cycle.cycle(); // idle 1
  await cycle.cycle(); // idle 2
  ready = 5;           // demand arrives before the shrink cycle
  await cycle.cycle();
  const payloads = reconcilePayloads.map((payload) => ({ idle: payload.idle_cycles, down: payload.scale_down, active: payload.active }));
  assert.deepEqual(payloads, [
    { idle: 1, down: false, active: false },
    { idle: 2, down: false, active: false },
    { idle: 0, down: false, active: true },
  ]);
});
