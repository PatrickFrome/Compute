import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner as CoreFleetProvisioner } from '../src/fleet-provisioner-core.mjs';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';
import {
  clearFleetRuntime,
  registerFleetRuntime,
} from '../src/fleet-runtime-bridge.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

function fleetHarness({ wrapped = false, persisted = null, warm = 0, desired = 1 } = {}) {
  let state = persisted ? structuredClone(persisted) : null;
  let seq = 0;
  let saveCount = 0;
  const tabs = new Map();
  const Ctor = wrapped ? FleetProvisioner : CoreFleetProvisioner;
  const provisioner = new Ctor({
    policy: { warm_agents: warm, desired_agents: desired, profile: 'BALANCED' },
    clock: (() => { let now = 1790000000000; return () => ++now; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); saveCount += 1; },
    tabExists: (id) => tabs.has(id),
    createTab: async () => {
      const tab = { tab_id: `tab_${tabs.size + 1}`, webcontents_id: 100 + tabs.size };
      tabs.set(tab.tab_id, tab);
      return tab;
    },
    loadTab: async () => {},
  });
  return { provisioner, tabs, state: () => state, saveCount: () => saveCount };
}

test('canonical generation floor rebases live bindings monotonically and reincarnation advances above it', async () => {
  const persisted = {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.5.0',
    policy: { warm_agents: 0, desired_agents: 1, profile: 'BALANCED' },
    updated_at: '2026-09-15T00:00:00.000Z',
    agents: [{
      agent_id: 'agent_11111111-1111-4111-8111-111111111111',
      role: 'PLANNER',
      ownership: 'FLEET_OWNED',
      lifecycle_state: 'BOUND_UNVERIFIED',
      tab_id: 'tab_existing',
      target_id: 'webcontents:9',
      conversation_epoch: 0,
      generation_epoch: 1,
      created_at: '2026-09-15T00:00:00.000Z',
      updated_at: '2026-09-15T00:00:00.000Z',
      lost_reason: null,
      ambiguous_reason: null,
      transport_proof: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
  };
  const h = fleetHarness({ persisted });
  h.tabs.set('tab_existing', { tab_id: 'tab_existing', webcontents_id: 9 });
  await h.provisioner.init();

  let snap = await h.provisioner.adoptGenerationFloor(28);
  assert.equal(snap.agents[0].generation_epoch, 28);
  assert.equal(snap.agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(snap.agents[0].transport_proof, null);

  snap = await h.provisioner.adoptGenerationFloor(27);
  assert.equal(snap.agents[0].generation_epoch, 28);
  snap = await h.provisioner.adoptGenerationFloor(28);
  assert.equal(snap.agents[0].generation_epoch, 28);

  await h.provisioner.onTabClosed('tab_existing');
  snap = h.provisioner.snapshot();
  assert.equal(snap.agents[0].generation_epoch, 29);
  assert.equal(snap.agents[0].lifecycle_state, 'LOST');

  await h.provisioner.reconcile({ active: true, target_agents: 1 });
  snap = h.provisioner.snapshot();
  assert.equal(snap.agents[0].generation_epoch, 29);
  assert.equal(snap.agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
});

test('agents created after floor adoption start at the canonical floor', async () => {
  const h = fleetHarness();
  await h.provisioner.init();
  await h.provisioner.adoptGenerationFloor(28);
  await h.provisioner.reconcile({ active: true, target_agents: 1 });
  const snap = h.provisioner.snapshot();
  assert.equal(snap.agents.length, 1);
  assert.equal(snap.agents[0].generation_epoch, 28);
  assert.equal(snap.agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
});

test('raising the floor invalidates an ACTIVE transport proof and requires fresh promotion', async () => {
  const h = fleetHarness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true, target_agents: 1 });
  let agent = h.provisioner.snapshot().agents[0];
  await h.provisioner.markTransportProven({
    agent_id: agent.agent_id,
    tab_id: agent.tab_id,
    target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    conversation_url: 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc',
  });
  agent = h.provisioner.snapshot().agents[0];
  assert.equal(agent.lifecycle_state, 'ACTIVE');
  assert.ok(agent.transport_proof);

  await h.provisioner.adoptGenerationFloor(28);
  agent = h.provisioner.snapshot().agents[0];
  assert.equal(agent.generation_epoch, 28);
  assert.equal(agent.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(agent.transport_proof, null);
});

test('preconversation overlay proof is also invalidated when the canonical generation changes', async () => {
  const h = fleetHarness({ wrapped: true });
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true, target_agents: 1 });
  let agent = h.provisioner.snapshot().agents[0];
  await h.provisioner.markTransportPreconversationProven({
    agent_id: agent.agent_id,
    tab_id: agent.tab_id,
    target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    transport_url: 'https://chatgpt.com/',
  });
  agent = h.provisioner.snapshot().agents[0];
  assert.equal(agent.lifecycle_state, 'ACTIVE');
  assert.equal(agent.transport_proof.transport_stage, 'PRECONVERSATION_ROOT');

  await h.provisioner.adoptGenerationFloor(28);
  agent = h.provisioner.snapshot().agents[0];
  assert.equal(agent.generation_epoch, 28);
  assert.equal(agent.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(agent.transport_proof, null);
  clearFleetRuntime(h.provisioner);
});

test('generation floor input is strict and fail-closed', async () => {
  const h = fleetHarness();
  await h.provisioner.init();
  await assert.rejects(() => h.provisioner.adoptGenerationFloor(-1), /fleet_generation_floor_invalid/);
  await assert.rejects(() => h.provisioner.adoptGenerationFloor(1.5), /fleet_generation_floor_invalid/);
  await assert.rejects(() => h.provisioner.adoptGenerationFloor('28'), /fleet_generation_floor_invalid/);
});

test('DevOS cycle adopts authoritative runtime-control generation floor before post-plan state readback', async () => {
  let generation = 1;
  const fakeRuntime = {
    snapshot() {
      return {
        schema: 'metaengine.browser.fleet-snapshot.v1',
        readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
        policy: { warm_agents: 0, desired_agents: 1, spawn_burst_limit: 1 },
        agents: [{
          agent_id: 'agent_22222222-2222-4222-8222-222222222222',
          role: 'PLANNER',
          ownership: 'FLEET_OWNED',
          lifecycle_state: 'REGISTERED',
          tab_id: null,
          target_id: null,
          generation_epoch: generation,
          transport_proof: null,
          automatic_retry_allowed: false,
          authority_effect: false,
        }],
        authority_effect: false,
      };
    },
    async adoptGenerationFloor(floor) {
      generation = Math.max(generation, floor, 1);
      return this.snapshot();
    },
    async markTransportProven() { return this.snapshot(); },
  };
  clearFleetRuntime();
  registerFleetRuntime(fakeRuntime);
  const commands = [];
  const getState = async () => ({ fleet: fakeRuntime.snapshot(), tabs: [], active_tab: null });
  const cycle = new DevOsNativeTaskCycle({
    getState,
    executeCommand: async (command) => { commands.push(command.action); return fakeRuntime.snapshot(); },
    signedRequest: async (path) => {
      if (path !== '/v1/devos/cycle') throw new Error(`unexpected:${path}`);
      return {
        status: 200,
        ok: true,
        async json() {
          return {
            schema: 'metaengine.devos.browser-cycle.v1',
            runtime_control: {
              schema: 'metaengine.devos.environment-state.v1',
              workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
              generation_floor: 28,
              refill_enabled: true,
              supervisor_admission_enabled: true,
              authority_effect: false,
            },
            backlog: { ready: 0, running: 0 },
            lease: null,
            running: [],
          };
        },
      };
    },
  });

  const out = await cycle.cycle();
  assert.equal(generation, 28);
  assert.equal(out.fleet_generation_floor_adoption.schema, 'metaengine.browser.fleet-generation-floor-adoption.v1');
  assert.equal(out.fleet_generation_floor_adoption.generation_floor, 28);
  assert.equal(out.fleet_generation_floor_adoption.changed_agent_count, 1);
  assert.deepEqual(commands, ['FLEET_RECONCILE']);
  clearFleetRuntime(fakeRuntime);
});
