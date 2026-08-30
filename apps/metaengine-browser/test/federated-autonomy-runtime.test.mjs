import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFleetSupervisorBinding, bindingMatchesPhysicalAgent, fleetSupervisorInstanceId } from '../src/federated-agent-identity.mjs';
import { AutonomyGovernor } from '../src/autonomy-governor.mjs';

const AGENT = {
  agent_id:'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role:'IMPLEMENTER',
  tab_id:'tab_d4a810cc-5df2-486c-9ea6-07f46a6c666b',
  target_id:'webcontents:9',
  generation_epoch:4,
};
const BASE = 'e8f3a482831c541237e05f1f8ee0be8a84539031';

test('fleet supervisor identity is deterministic and exact-incarnation bound', () => {
  const first = buildFleetSupervisorBinding(AGENT);
  const second = buildFleetSupervisorBinding({ ...AGENT });
  assert.equal(first.supervisor_instance_id, fleetSupervisorInstanceId(AGENT.agent_id));
  assert.equal(first.supervisor_instance_id, second.supervisor_instance_id);
  assert.equal(first.binding_sha256, second.binding_sha256);
  assert.equal(first.supervisor_capable, true);
  assert.equal(first.ambient_browser_authority, false);
  assert.equal(first.browser_effect_path, 'TYPED_INTENT_VIA_SHARED_MESH_EXECUTOR');
  assert.equal(bindingMatchesPhysicalAgent(first, AGENT), true);
});

test('renderer reincarnation invalidates stale fleet supervisor binding', () => {
  const binding = buildFleetSupervisorBinding(AGENT);
  assert.equal(bindingMatchesPhysicalAgent(binding, { ...AGENT, target_id:'webcontents:19', generation_epoch:5 }), false);
  assert.equal(bindingMatchesPhysicalAgent(binding, { ...AGENT, tab_id:'tab_deadbeef-dead-beef-dead-beefdeadbeef' }), false);
});

test('governor permits complementary roles on one semantic point', () => {
  const governor = new AutonomyGovernor({ clock:()=>Date.parse('2026-08-30T09:00:00Z') });
  const claims = [{
    claim_id:'claim_impl', point_id:'browser.autonomy.v1', base_sha:BASE,
    role:'IMPLEMENTER', agent_id:AGENT.agent_id, status:'ACTIVE', expires_at:'2026-08-30T09:05:00Z',
  }];
  for (const role of ['RESEARCHER','CRITIC','FALSIFIER','SYNTHESIZER']) {
    const decision = governor.evaluateClaim({ candidate:{ point_id:'browser.autonomy.v1', base_sha:BASE, role, agent_id:'agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, claims });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, 'COMPLEMENTARY_PARALLEL_CLAIM');
  }
});

test('governor blocks duplicate implementation claim on same point by default', () => {
  const governor = new AutonomyGovernor({ clock:()=>Date.parse('2026-08-30T09:00:00Z') });
  const claims = [{
    claim_id:'claim_existing', point_id:'browser.autonomy.v1', base_sha:BASE,
    role:'IMPLEMENTER', agent_id:AGENT.agent_id, status:'ACTIVE', expires_at:'2026-08-30T09:05:00Z',
  }];
  const decision = governor.evaluateClaim({ candidate:{ point_id:'browser.autonomy.v1', base_sha:BASE, role:'IMPLEMENTER', agent_id:'agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, claims });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'IMPLEMENTATION_POINT_ALREADY_CLAIMED');
});

test('owner override can explicitly permit overlapping implementation claim', () => {
  const governor = new AutonomyGovernor({ clock:()=>Date.parse('2026-08-30T09:00:00Z') });
  const claims = [{ claim_id:'claim_existing', point_id:'browser.autonomy.v1', base_sha:BASE, role:'IMPLEMENTER', agent_id:AGENT.agent_id, status:'ACTIVE' }];
  const decision = governor.evaluateClaim({
    candidate:{ point_id:'browser.autonomy.v1', base_sha:BASE, role:'IMPLEMENTER', agent_id:'agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
    claims,
    disabled_gates:['autonomy.overlapping_implementation_claim'],
  });
  assert.equal(decision.allowed, true);
});

test('ambiguous physical effects consume fanout capacity unless owner disables that gate', () => {
  const governor = new AutonomyGovernor({ policy:{ max_parallel_agents:2 } });
  const agents = [
    { agent_id:'agent_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', lifecycle_state:'BOUND_UNVERIFIED' },
    { agent_id:'agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', lifecycle_state:'PROVISIONING_AMBIGUOUS' },
  ];
  const blocked = governor.evaluateSpawn({ agents });
  assert.equal(blocked.allowed, false);
  const allowed = governor.evaluateSpawn({ agents, disabled_gates:['autonomy.ambiguous_capacity','autonomy.max_fanout'] });
  assert.equal(allowed.allowed, true);
});

test('base SHA drift blocks same-point claim unless owner explicitly overrides it', () => {
  const governor = new AutonomyGovernor();
  const claims = [{ claim_id:'claim_old', point_id:'browser.autonomy.v1', base_sha:'1111111111111111111111111111111111111111', role:'CRITIC', agent_id:AGENT.agent_id, status:'ACTIVE' }];
  const blocked = governor.evaluateClaim({ candidate:{ point_id:'browser.autonomy.v1', base_sha:BASE, role:'RESEARCHER', agent_id:'agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, claims });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'POINT_BASE_SHA_CONFLICT');
  const allowed = governor.evaluateClaim({ candidate:{ point_id:'browser.autonomy.v1', base_sha:BASE, role:'RESEARCHER', agent_id:'agent_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, claims, disabled_gates:['*'] });
  assert.equal(allowed.allowed, true);
});
