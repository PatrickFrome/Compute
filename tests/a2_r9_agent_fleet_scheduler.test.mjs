import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgentFleet } from '../coordination/browser-shared/agent-fleet-scheduler-v1.mjs';

function agent(agent_id, role, capability_set, lifecycle_state = 'READY') {
  return { agent_id, role, capability_set, lifecycle_state };
}

test('SIMPLE emits one bounded worker slot with no side effect', () => {
  const plan = planAgentFleet({ point_id: 'point.simple', complexity: 'SIMPLE' });
  assert.equal(plan.worker_count, 1);
  assert.equal(plan.slots[0].role, 'WORKER');
  assert.equal(plan.manager_pattern, true);
  assert.equal(plan.direct_peer_messaging, false);
  assert.equal(plan.automatic_spawn_side_effect, false);
  assert.equal(plan.authority_effect, false);
});

test('MEDIUM is exactly three workers plus integrator and reuses ready capabilities', () => {
  const plan = planAgentFleet({
    point_id: 'point.medium', complexity: 'MEDIUM',
    available_agents: [
      agent('agent.research', 'RESEARCHER', ['research']),
      agent('agent.integrator', 'INTEGRATOR', ['integrate']),
      agent('agent.busy.coder', 'CODER', ['code'], 'BUSY'),
    ],
  });
  assert.equal(plan.worker_count, 4);
  assert.deepEqual(plan.slots.map((slot) => slot.role), ['RESEARCHER', 'CODER', 'CRITIC', 'INTEGRATOR']);
  assert.deepEqual(plan.reused_agent_ids.sort(), ['agent.integrator', 'agent.research']);
  assert.equal(plan.spawn_requests.length, 2);
});

test('HARD scales from six to twelve specialists under explicit bound', () => {
  const min = planAgentFleet({ point_id: 'point.hard.min', complexity: 'HARD', max_workers: 12 });
  assert.equal(min.worker_count, 6);
  const ten = planAgentFleet({ point_id: 'point.hard.ten', complexity: 'HARD', requested_workers: 10, max_workers: 10 });
  assert.equal(ten.worker_count, 10);
  assert.ok(ten.slots.some((slot) => slot.role === 'FALSIFIER'));
  assert.ok(ten.slots.some((slot) => slot.role === 'SECURITY'));
  assert.throws(() => planAgentFleet({ point_id: 'point.hard.bad', complexity: 'HARD', max_workers: 5 }), /scheduler_max_workers_below_complexity_minimum/);
});

test('CRITICAL includes blind proposal ensemble, falsifier, security and jury', () => {
  const plan = planAgentFleet({ point_id: 'point.critical', complexity: 'CRITICAL', max_workers: 12 });
  assert.equal(plan.worker_count, 8);
  assert.equal(plan.slots.filter((slot) => slot.blind_group === 'proposal').length, 3);
  assert.ok(plan.slots.some((slot) => slot.role === 'FALSIFIER'));
  assert.ok(plan.slots.some((slot) => slot.role === 'SECURITY'));
  assert.ok(plan.slots.some((slot) => slot.role === 'JURY'));
});

test('duplicate available agent identity and excess worker count fail closed', () => {
  assert.throws(() => planAgentFleet({
    point_id: 'point.dup', complexity: 'SIMPLE',
    available_agents: [agent('agent.same', 'WORKER', []), agent('agent.same', 'WORKER', [])],
  }), /scheduler_duplicate_agent_id/);
  assert.throws(() => planAgentFleet({ point_id: 'point.toomany', complexity: 'HARD', requested_workers: 13, max_workers: 12 }), /scheduler_requested_workers_invalid/);
});
