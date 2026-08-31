import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';
import { createFleetTargetLocalObserver } from '../src/fleet-target-local-observer.mjs';

function harness() {
  let state = null;
  let failSave = false;
  let nextWebContentsId = 101;
  const tabs = new Map();
  const provisioner = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 1, max_agents: 1, profile: 'BALANCED' },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: () => '11111111-1111-4111-8111-111111111111',
    loadState: async () => state,
    saveState: async (value) => {
      if (failSave) throw new Error('synthetic-save-failure');
      state = structuredClone(value);
    },
    tabExists: (id) => tabs.has(id),
    createTab: async () => {
      const tab = { tab_id: 'tab_1', webcontents_id: nextWebContentsId };
      tabs.set(tab.tab_id, tab);
      return tab;
    },
    loadTab: async () => {},
  });
  const observeLocalTarget = createFleetTargetLocalObserver({
    lookupView: (tabId) => {
      if (!tabs.has(tabId)) return null;
      return {
        webContents: {
          id: nextWebContentsId,
          isDestroyed: () => false,
        },
      };
    },
  });
  return {
    provisioner,
    tabs,
    observeLocalTarget,
    replaceWebContents(id) { nextWebContentsId = id; },
    failNextSaves() { failSave = true; },
    persisted() { return structuredClone(state); },
  };
}

test('FleetProvisioner revalidates a Browser-local target without promoting authority', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const before = h.provisioner.snapshot().agents[0];

  const same = await h.provisioner.revalidateTargetBinding({
    agent_id: before.agent_id,
    observeLocalTarget: h.observeLocalTarget,
  });
  const sameAgent = same.agents[0];
  assert.equal(sameAgent.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(sameAgent.generation_epoch, before.generation_epoch);
  assert.equal(sameAgent.target_id, 'webcontents:101');
  assert.equal(sameAgent.transport_proof, null);
  assert.equal(sameAgent.automatic_retry_allowed, false);
  assert.equal(sameAgent.authority_effect, false);
  assert.equal(same.authority_effect, false);

  h.replaceWebContents(202);
  const replaced = await h.provisioner.revalidateTargetBinding({
    agent_id: before.agent_id,
    observeLocalTarget: h.observeLocalTarget,
  });
  const replacedAgent = replaced.agents[0];
  assert.equal(replacedAgent.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(replacedAgent.target_id, 'webcontents:202');
  assert.equal(replacedAgent.generation_epoch, before.generation_epoch + 1);
  assert.equal(replacedAgent.transport_proof, null);
  assert.equal(replacedAgent.automatic_retry_allowed, false);
  assert.equal(replacedAgent.authority_effect, false);
});

test('FleetProvisioner rejects an unbranded observer and keeps the binding unchanged', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const before = h.provisioner.snapshot();

  await assert.rejects(
    h.provisioner.revalidateTargetBinding({
      agent_id: before.agents[0].agent_id,
      observeLocalTarget: () => ({
        source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
        tab_id: before.agents[0].tab_id,
        target_id: 'webcontents:999',
        tab_exists: true,
        authority_effect: false,
      }),
    }),
    /fleet_local_revalidation_observer_untrusted/,
  );

  assert.deepEqual(h.provisioner.snapshot(), before);
});

test('FleetProvisioner durable save failure cannot mutate in-memory binding', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const before = h.provisioner.snapshot();
  const persistedBefore = h.persisted();
  h.replaceWebContents(303);
  h.failNextSaves();

  await assert.rejects(
    h.provisioner.revalidateTargetBinding({
      agent_id: before.agents[0].agent_id,
      observeLocalTarget: h.observeLocalTarget,
    }),
    /synthetic-save-failure/,
  );

  assert.deepEqual(h.provisioner.snapshot(), before);
  assert.deepEqual(h.persisted(), persistedBefore);
});
