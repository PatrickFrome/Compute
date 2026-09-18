import test from 'node:test';
import assert from 'node:assert/strict';
import { planElasticFleetCapacity, ELASTIC_FLEET_CONTRACT } from '../src/fleet-elastic-governor.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

function agent(id, state, { created_at = '2026-09-03T10:00:00.000Z', tab_id = null } = {}) {
  return { agent_id: id, role: 'IMPLEMENTER', lifecycle_state: state, tab_id, target_id: tab_id ? 'webcontents:1' : null, generation_epoch: 1, created_at, updated_at: created_at };
}

function fleetSnapshot(agents, policy = {}) {
  return {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
    policy: { warm_agents: 2, desired_agents: 6, spawn_burst_limit: 8, ...policy },
    agents,
    counts: {},
    capacity_backpressure: { blocked: false },
  };
}

test('governor grounds the shrink inventory in the physical census when available', () => {
  // 3 logical tab-bound agents (pool=3), but the census proves 6 physical
  // FLEET tabs (3 orphans). The warm floor is 2: logical-only surplus would be
  // 1; physical grounding exposes surplus 4 and still proposes only bounded
  // retirees (the execution boundary re-validates each against the TRUE
  // provisioner snapshot, so orphans cannot be over-retired from here).
  const snap = fleetSnapshot([
    agent('agent_p1', 'ACTIVE', { tab_id: 'tab_p1', created_at: '2026-09-03T09:00:00.000Z' }),
    agent('agent_p2', 'BOUND_UNVERIFIED', { tab_id: 'tab_p2', created_at: '2026-09-03T10:00:00.000Z' }),
    agent('agent_p3', 'BOUND_UNVERIFIED', { tab_id: 'tab_p3', created_at: '2026-09-03T11:00:00.000Z' }),
  ]);
  const census = { by_role: { USER: 5, FLEET: 6 }, fleet_tab_ceiling: 16 };
  const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 5, tabCensus: census });
  assert.equal(plan.worker_tab_pool, 3, 'logical pool semantics unchanged');
  assert.equal(plan.physical_worker_tabs, 6);
  assert.equal(plan.fleet_tab_ceiling, 16);
  assert.equal(plan.tab_census_grounded, true);
  assert.equal(plan.retire_count, 2, 'surplus 4 -> bounded retire fan-out 2 (only eligible logical agents exist)');
  assert.deepEqual([...plan.retire_agent_ids], ['agent_p3', 'agent_p2'], 'newest first');
});

test('governor keeps purely logical semantics when the census is absent or malformed', () => {
  const snap = fleetSnapshot([
    agent('agent_q1', 'ACTIVE', { tab_id: 'tab_q1' }),
    agent('agent_q2', 'BOUND_UNVERIFIED', { tab_id: 'tab_q2', created_at: '2026-09-03T11:00:00.000Z' }),
    agent('agent_q3', 'BOUND_UNVERIFIED', { tab_id: 'tab_q3', created_at: '2026-09-03T12:00:00.000Z' }),
  ]);
  for (const census of [null, undefined, {}, { by_role: {}, fleet_tab_ceiling: 16 }, 'census']) {
    const plan = planElasticFleetCapacity({ backlog: { ready: 0, running: 0 }, fleetSnapshot: snap, idleCycles: 9, tabCensus: census });
    assert.equal(plan.tab_census_grounded, false);
    assert.equal(plan.physical_worker_tabs, null);
    assert.equal(plan.retire_count, 1, 'logical-only surplus 1 (pool 3 - warm 2)');
  }
  assert.equal(ELASTIC_FLEET_CONTRACT.tab_census_capacity_authority, true);
});

test('scale-up target is unaffected by the census (growth stays demand-driven)', () => {
  const snap = fleetSnapshot([]);
  const census = { by_role: { USER: 0, FLEET: 14 }, fleet_tab_ceiling: 16 };
  const plan = planElasticFleetCapacity({ backlog: { ready: 10, running: 0 }, fleetSnapshot: snap, tabCensus: census });
  assert.equal(plan.active, true);
  assert.equal(plan.target_agents, 10);
  assert.equal(plan.authority_effect, false);
});

test('cycle observes up to four running tasks per heartbeat, isolating per-task failures', async () => {
  const runningTasks = [];
  const captures = [];
  const agents = Array.from({ length: 5 }, (_, i) => {
    const tabId = `tab_r${i + 1}`;
    return {
      agent_id: `agent_r${i + 1}rrrrrrrr`, role: 'IMPLEMENTER', lifecycle_state: 'ACTIVE',
      tab_id: tabId, target_id: `webcontents:${i + 1}`, generation_epoch: 1,
      transport_proof: {
        schema: 'metaengine.browser.fleet-transport-proof.v1', tab_id: tabId, target_id: `webcontents:${i + 1}`,
        generation_epoch: 1, conversation_url_sha256: 'a'.repeat(64), proven_at: '2026-09-03T18:00:00.000Z', authority_effect: false,
      },
      created_at: '2026-09-03T10:00:00.000Z', updated_at: '2026-09-03T10:00:00.000Z',
    };
  });
  const uuid = (n) => `09f2e414-5c31-4fc7-87a3-f5de1315cb0${n}`;
  const baseSha = '724612235eb7ceb4534c13d126425b274d876394';
  for (let i = 0; i < 5; i += 1) {
    runningTasks.push({
      task_id: uuid(i + 1), agent_id: `agent_r${i + 1}rrrrrrrr`, tab_id: `tab_r${i + 1}`,
      target_id: `webcontents:${i + 1}`, agent_generation_epoch: 1, lease_generation: 1,
      role: 'IMPLEMENTER', base_sha: baseSha, automatic_retry_allowed: false,
      conversation_url_sha256: 'a'.repeat(64),
    });
  }
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: fleetSnapshot(agents) }),
    executeCommand: async (command) => {
      if (command.action === 'CAPTURE') {
        captures.push(command.payload?.tab_id);
        // tab_r2 fails to capture: its observation is recorded as failed
        // while the other three still complete.
        if (command.payload?.tab_id === 'tab_r2') throw new Error('capture_target_unavailable');
        return {
          tab_id: command.payload?.tab_id, target_id: 'webcontents:1', url: 'https://chatgpt.com/',
          viewport: { width: 1200, height: 640 },
          semantic_targets: [{ role: 'button', name: 'Stop generating' }],
          authority_effect: false,
        };
      }
      if (command.action === 'FLEET_RECONCILE') return { ok: true, authority_effect: false };
      return null;
    },
    signedRequest: async () => ({
      status: 200, ok: true,
      json: async () => ({ schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 0, running: 5 }, lease: null, running: runningTasks }),
    }),
    effectJournal: null,
  });
  const snapshot = await cycle.cycle();
  assert.equal(captures.length, 4, 'exactly the observation budget (4 of 5 running) is captured per cycle');
  assert.ok(!captures.includes('tab_r5'), 'the fifth running task is deferred to the next cycle');
  const batch = snapshot.result_ready_batch;
  assert.equal(batch.budget, 4);
  assert.equal(batch.observed, 4);
  assert.equal(batch.failed, 1);
  assert.equal(batch.authority_effect, false);
  assert.equal(batch.results[1].state, 'OBSERVATION_FAILED');
  assert.equal(batch.results[1].task_id, uuid(2));
  assert.equal(batch.results[1].automatic_retry_allowed, false);
  assert.equal(batch.results[0].state, 'GENERATING');
  assert.equal(snapshot.state, 'OK', 'a single flaky tab no longer aborts the whole observation pass');
  assert.equal(snapshot.running_observation_fanout_per_cycle, 4);
});

test('cycle rethrows only when every observed running task fails (single-task error surface preserved)', async () => {
  const agents = [{
    agent_id: 'agent_s1rrrrrrrr', role: 'IMPLEMENTER', lifecycle_state: 'ACTIVE', tab_id: 'tab_s1', target_id: 'webcontents:1',
    generation_epoch: 1,
    transport_proof: {
      schema: 'metaengine.browser.fleet-transport-proof.v1', tab_id: 'tab_s1', target_id: 'webcontents:1',
      generation_epoch: 1, conversation_url_sha256: 'a'.repeat(64), proven_at: '2026-09-03T18:00:00.000Z', authority_effect: false,
    },
    created_at: '2026-09-03T10:00:00.000Z', updated_at: '2026-09-03T10:00:00.000Z',
  }];
  const runningTasks = [{
    task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb71', agent_id: 'agent_s1rrrrrrrr', tab_id: 'tab_s1', target_id: 'webcontents:1',
    agent_generation_epoch: 1, lease_generation: 1, role: 'IMPLEMENTER',
    base_sha: '724612235eb7ceb4534c13d126425b274d876394', automatic_retry_allowed: false,
    conversation_url_sha256: 'a'.repeat(64),
  }];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: fleetSnapshot(agents) }),
    executeCommand: async (command) => {
      if (command.action === 'CAPTURE') throw new Error('capture_target_unavailable');
      if (command.action === 'FLEET_RECONCILE') return { ok: true, authority_effect: false };
      return null;
    },
    signedRequest: async () => ({
      status: 200, ok: true,
      json: async () => ({ schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 0, running: 1 }, lease: null, running: runningTasks }),
    }),
    effectJournal: null,
  });
  await assert.rejects(() => cycle.cycle(), /capture_target_unavailable/);
});

test('cycle feeds the shell census into the elastic plan when role-tagged tabs are present', async () => {
  const reconcilePayloads = [];
  const agents = [
    agent('agent_t1rrrrrrrr', 'BOUND_UNVERIFIED', { tab_id: 'tab_t1', created_at: '2026-09-03T10:00:00.000Z' }),
    agent('agent_t2rrrrrrrr', 'BOUND_UNVERIFIED', { tab_id: 'tab_t2', created_at: '2026-09-03T11:00:00.000Z' }),
    agent('agent_t3rrrrrrrr', 'BOUND_UNVERIFIED', { tab_id: 'tab_t3', created_at: '2026-09-03T12:00:00.000Z' }),
  ];
  const stateWithCensus = {
    fleet: fleetSnapshot(agents),
    tab_census: { total_tabs: 7, max_tabs: 32, by_role: { USER: 2, FLEET: 5 }, fleet_tab_ceiling: 16 },
    tabs: Array.from({ length: 7 }, (_, i) => ({ tab_id: `tab_c${i}`, role: i < 5 ? 'FLEET' : 'USER' })),
  };
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => stateWithCensus,
    executeCommand: async (command) => {
      if (command.action === 'FLEET_RECONCILE') { reconcilePayloads.push(structuredClone(command.payload)); return { ok: true, authority_effect: false }; }
      return null;
    },
    signedRequest: async () => ({
      status: 200, ok: true,
      json: async () => ({ schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 0, running: 0 }, lease: null, running: [] }),
    }),
    effectJournal: null,
  });
  await cycle.cycle();
  await cycle.cycle();
  await cycle.cycle();
  const shrinkPayload = reconcilePayloads[2];
  assert.equal(shrinkPayload.scale_down, true);
  assert.equal(shrinkPayload.tab_census_grounded, true);
  assert.equal(shrinkPayload.physical_worker_tabs, 5);
  assert.equal(shrinkPayload.worker_tab_pool, 3);
  assert.deepEqual([...shrinkPayload.retire_agent_ids], ['agent_t3rrrrrrrr', 'agent_t2rrrrrrrr', 'agent_t1rrrrrrrr'], 'surplus from the physical pool (5 - warm 2 = 3) retires all three eligible newest agents, within the per-cycle fan-out');
});
