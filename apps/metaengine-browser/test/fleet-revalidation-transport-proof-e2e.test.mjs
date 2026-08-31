import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';
import { createFleetTargetLocalObserver } from '../src/fleet-target-local-observer.mjs';

function makeHarness() {
  let persisted = null;
  let webContentsId = 101;
  const tabs = new Map();
  const deps = {
    policy: { warm_agents: 1, desired_agents: 1, profile: 'BALANCED', spawn_burst_limit: 8 },
    clock: (() => { let n = 1788001000000; return () => ++n; })(),
    uuid: () => '22222222-2222-4222-8222-222222222222',
    loadState: async () => structuredClone(persisted),
    saveState: async (value) => { persisted = structuredClone(value); },
    tabExists: (id) => tabs.has(id),
    createTab: async () => {
      const tab = { tab_id: 'tab_1', webcontents_id: webContentsId };
      tabs.set(tab.tab_id, tab);
      return tab;
    },
    loadTab: async () => {},
  };
  const observer = () => createFleetTargetLocalObserver({
    lookupView: (tabId) => tabs.has(tabId) ? { webContents: { id: webContentsId, isDestroyed: () => false } } : null,
  });
  return {
    deps,
    observer,
    replaceWebContents(id) { webContentsId = id; },
    persisted: () => structuredClone(persisted),
  };
}

test('elastic restart requires fresh local revalidation and exact fresh transport proof before ACTIVE', async () => {
  const h = makeHarness();
  const first = new FleetProvisioner(h.deps);
  await first.init();
  await first.reconcile({ active: true });

  let agent = first.snapshot().agents[0];
  await first.revalidateTargetBinding({ agent_id: agent.agent_id, observeLocalTarget: h.observer() });
  agent = first.snapshot().agents[0];
  await first.markTransportProven({
    agent_id: agent.agent_id,
    tab_id: agent.tab_id,
    target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  const priorActive = first.snapshot().agents[0];
  assert.equal(priorActive.lifecycle_state, 'ACTIVE');
  assert.ok(priorActive.transport_proof);
  assert.equal(first.snapshot().policy.hard_agent_cap, null);
  assert.equal(first.snapshot().policy.elastic, true);

  h.replaceWebContents(202);
  const restarted = new FleetProvisioner(h.deps);
  await restarted.init();
  let afterRestart = restarted.snapshot().agents[0];
  assert.equal(afterRestart.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(afterRestart.transport_proof, null);
  assert.equal(afterRestart.generation_epoch, priorActive.generation_epoch + 1);

  await assert.rejects(
    restarted.markTransportProven({
      agent_id: afterRestart.agent_id,
      tab_id: afterRestart.tab_id,
      target_id: priorActive.target_id,
      generation_epoch: priorActive.generation_epoch,
      conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    }),
    /fleet_transport_target_binding_mismatch|fleet_transport_generation_binding_mismatch/,
  );

  const revalidated = await restarted.revalidateTargetBinding({ agent_id: afterRestart.agent_id, observeLocalTarget: h.observer() });
  afterRestart = revalidated.agents[0];
  assert.equal(afterRestart.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(afterRestart.target_id, 'webcontents:202');
  assert.equal(afterRestart.transport_proof, null);
  assert.equal(afterRestart.generation_epoch, priorActive.generation_epoch + 2);
  assert.equal(afterRestart.automatic_retry_allowed, false);
  assert.equal(afterRestart.authority_effect, false);

  await assert.rejects(
    restarted.markTransportProven({
      agent_id: afterRestart.agent_id,
      tab_id: afterRestart.tab_id,
      target_id: afterRestart.target_id,
      generation_epoch: afterRestart.generation_epoch - 1,
      conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    }),
    /fleet_transport_generation_binding_mismatch/,
  );

  const activated = await restarted.markTransportProven({
    agent_id: afterRestart.agent_id,
    tab_id: afterRestart.tab_id,
    target_id: afterRestart.target_id,
    generation_epoch: afterRestart.generation_epoch,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  const freshActive = activated.agents[0];
  assert.equal(freshActive.lifecycle_state, 'ACTIVE');
  assert.equal(freshActive.target_id, 'webcontents:202');
  assert.equal(freshActive.transport_proof.target_id, 'webcontents:202');
  assert.equal(freshActive.transport_proof.generation_epoch, freshActive.generation_epoch);
  assert.equal(freshActive.automatic_retry_allowed, false);
  assert.equal(freshActive.authority_effect, false);
});
