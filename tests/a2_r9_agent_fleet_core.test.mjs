import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentFleetCoreV1 } from '../coordination/browser-shared/agent-fleet-core-v1.mjs';

function clock() {
  let n = 0;
  return () => new Date(Date.UTC(2026, 7, 29, 6, 0, n++));
}
function baseAgent(overrides = {}) {
  return {
    agent_id: 'agent.research.001',
    role: 'RESEARCHER',
    provider: 'policy_a',
    surface: 'web_chat',
    target_id: 'gpt_worker_001',
    conversation_epoch: 1,
    capability_set: ['research', 'review'],
    ...overrides,
  };
}
function assignment(id = 'assignment.001') {
  return { assignment_id: id, point_id: 'point.r9.001', task_kind: 'RESEARCH', required_capabilities: ['research'] };
}

test('manager exclusively owns readiness and assignment; one active assignment per agent', () => {
  const fleet = new AgentFleetCoreV1({ managerId: 'manager.main', clock: clock() });
  const registered = fleet.registerAgent(baseAgent());
  assert.equal(registered.lifecycle_state, 'REGISTERED');
  assert.throws(() => fleet.markReady({ manager_id: 'manager.other', agent_id: registered.agent_id }), /fleet_manager_not_authorized/);
  const ready = fleet.markReady({ manager_id: 'manager.main', agent_id: registered.agent_id });
  assert.equal(ready.lifecycle_state, 'READY');
  const busy = fleet.assignWork({ manager_id: 'manager.main', agent_id: ready.agent_id, assignment: assignment() });
  assert.equal(busy.lifecycle_state, 'BUSY');
  assert.equal(busy.active_assignment.generation_epoch, 1);
  assert.throws(() => fleet.assignWork({ manager_id: 'manager.main', agent_id: ready.agent_id, assignment: assignment('assignment.002') }), /agent_not_ready|agent_assignment_active/);
  const done = fleet.completeWork({ manager_id: 'manager.main', agent_id: ready.agent_id, assignment_id: 'assignment.001', generation_epoch: 1 });
  assert.equal(done.lifecycle_state, 'READY');
  assert.equal(done.active_assignment, null);
  assert.ok(fleet.events().every((event) => event.authority_effect === false && event.actuation_eligible === false));
});

test('rollover preserves agent identity, advances generation and invalidates old assignment without replay', () => {
  const fleet = new AgentFleetCoreV1({ managerId: 'manager.main', clock: clock() });
  fleet.registerAgent(baseAgent());
  fleet.markReady({ manager_id: 'manager.main', agent_id: 'agent.research.001' });
  fleet.assignWork({ manager_id: 'manager.main', agent_id: 'agent.research.001', assignment: assignment('assignment.rollover') });
  const result = fleet.rolloverAgent({ manager_id: 'manager.main', agent_id: 'agent.research.001', target_id: 'gpt_worker_002', conversation_epoch: 2 });
  assert.equal(result.agent.agent_id, 'agent.research.001');
  assert.equal(result.agent.target_id, 'gpt_worker_002');
  assert.equal(result.agent.conversation_epoch, 2);
  assert.equal(result.agent.generation_epoch, 2);
  assert.equal(result.agent.lifecycle_state, 'READY');
  assert.equal(result.invalidated_assignment_id, 'assignment.rollover');
  assert.equal(result.automatic_retry_allowed, false);
  assert.throws(() => fleet.completeWork({ manager_id: 'manager.main', agent_id: 'agent.research.001', assignment_id: 'assignment.rollover', generation_epoch: 1 }), /agent_assignment_not_active|agent_assignment_generation_stale/);
});

test('LOST invalidates active work and never grants automatic retry', () => {
  const fleet = new AgentFleetCoreV1({ managerId: 'manager.main', clock: clock() });
  fleet.registerAgent(baseAgent());
  fleet.markReady({ manager_id: 'manager.main', agent_id: 'agent.research.001' });
  fleet.assignWork({ manager_id: 'manager.main', agent_id: 'agent.research.001', assignment: assignment('assignment.lost') });
  const lost = fleet.markLost({ manager_id: 'manager.main', agent_id: 'agent.research.001', reason_code: 'WORKER_LOST' });
  assert.equal(lost.agent.lifecycle_state, 'LOST');
  assert.equal(lost.agent.generation_epoch, 2);
  assert.equal(lost.invalidated_assignment_id, 'assignment.lost');
  assert.equal(lost.automatic_retry_allowed, false);
  assert.equal(lost.agent.active_assignment, null);
});

test('draining busy agent lets current assignment finish but does not return it to READY', () => {
  const fleet = new AgentFleetCoreV1({ managerId: 'manager.main', clock: clock() });
  fleet.registerAgent(baseAgent());
  fleet.markReady({ manager_id: 'manager.main', agent_id: 'agent.research.001' });
  fleet.assignWork({ manager_id: 'manager.main', agent_id: 'agent.research.001', assignment: assignment('assignment.drain') });
  const draining = fleet.drainAgent({ manager_id: 'manager.main', agent_id: 'agent.research.001' });
  assert.equal(draining.lifecycle_state, 'DRAINING');
  assert.equal(draining.active_assignment.assignment_id, 'assignment.drain');
  const done = fleet.completeWork({ manager_id: 'manager.main', agent_id: 'agent.research.001', assignment_id: 'assignment.drain', generation_epoch: 1, disposition: 'DRAINING' });
  assert.equal(done.lifecycle_state, 'DRAINING');
  assert.equal(done.active_assignment, null);
  const retired = fleet.retireAgent({ manager_id: 'manager.main', agent_id: 'agent.research.001' });
  assert.equal(retired.lifecycle_state, 'RETIRED');
});

test('provider is opaque policy metadata, not an architecture discriminator', () => {
  const fleet = new AgentFleetCoreV1({ managerId: 'manager.main', clock: clock() });
  const agent = fleet.registerAgent(baseAgent({ agent_id: 'agent.opaque.001', provider: 'future_provider_x', target_id: null, conversation_epoch: 0 }));
  assert.equal(agent.provider, 'FUTURE_PROVIDER_X');
  assert.equal(agent.target_id, null);
});
