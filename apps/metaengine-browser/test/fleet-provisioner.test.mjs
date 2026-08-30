import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

function harness({ createFails = false, persisted = null } = {}) {
  let state = persisted;
  let seq = 0;
  const tabs = new Map();
  const loads = [];
  const provisioner = new FleetProvisioner({
    policy: { warm_agents: 2, desired_agents: 6, max_agents: 8, profile: 'BALANCED' },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: (id) => tabs.has(id),
    createTab: async () => {
      if (createFails) throw new Error('synthetic-create-failure');
      const tab = { tab_id: `tab_${tabs.size + 1}`, webcontents_id: 100 + tabs.size };
      tabs.set(tab.tab_id, tab);
      return tab;
    },
    loadTab: async (id, url) => { loads.push([id, url]); },
  });
  return { provisioner, tabs, loads, getState: () => state };
}

test('inactive warm reconcile creates logical agents without physical tabs', async () => {
  const h = harness();
  await h.provisioner.init();
  const snap = await h.provisioner.reconcile({ active: false });
  assert.equal(snap.agents.length, 2);
  assert.equal(snap.counts.REGISTERED, 2);
  assert.equal(snap.counts.BOUND_UNVERIFIED, 0);
  assert.equal(h.tabs.size, 0);
  assert.equal(h.loads.length, 0);
  assert.equal(snap.policy.idle_physical_tabs, false);
  assert.ok(snap.agents.every((a) => a.ownership === 'FLEET_OWNED'));
});

test('active reconcile activates logical warm agents and scales to desired fleet', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: false });
  assert.equal(h.tabs.size, 0);
  await h.provisioner.reconcile({ active: true });
  await h.provisioner.reconcile({ active: true });
  const snap = h.provisioner.snapshot();
  assert.equal(snap.agents.length, 6);
  assert.equal(snap.counts.BOUND_UNVERIFIED, 6);
  assert.equal(h.tabs.size, 6);
});

test('ambiguous tab creation is never automatically retried', async () => {
  const h = harness({ createFails: true });
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const first = h.provisioner.snapshot();
  assert.equal(first.counts.PROVISIONING_AMBIGUOUS, 6);
  await h.provisioner.reconcile({ active: true });
  const second = h.provisioner.snapshot();
  assert.equal(second.counts.PROVISIONING_AMBIGUOUS, 6);
  assert.ok(second.agents.every((a) => a.automatic_retry_allowed === false));
});

test('tab loss stays logical while idle and recovery increments conversation epoch when active', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const before = h.provisioner.snapshot().agents[0];
  h.tabs.delete(before.tab_id);
  await h.provisioner.onTabClosed(before.tab_id);
  await h.provisioner.reconcile({ active: false });
  let after = h.provisioner.snapshot().agents.find((a) => a.agent_id === before.agent_id);
  assert.equal(after.lifecycle_state, 'LOST');
  assert.equal(after.tab_id, null);
  await h.provisioner.reconcile({ active: true });
  after = h.provisioner.snapshot().agents.find((a) => a.agent_id === before.agent_id);
  assert.equal(after.agent_id, before.agent_id);
  assert.equal(after.conversation_epoch, before.conversation_epoch + 1);
  assert.equal(after.lifecycle_state, 'BOUND_UNVERIFIED');
});

test('restart converts stale physical binding to LOST without replaying work', async () => {
  const h1 = harness();
  await h1.provisioner.init();
  await h1.provisioner.reconcile({ active: true });
  const persisted = h1.getState();
  const h2 = harness({ persisted });
  const snap = await h2.provisioner.init();
  assert.equal(snap.counts.LOST, 6);
  assert.ok(snap.agents.every((a) => a.tab_id === null));
  assert.ok(snap.agents.every((a) => a.automatic_retry_allowed === false));
  await h2.provisioner.reconcile({ active: false });
  assert.equal(h2.tabs.size, 0);
});

test('policy forbids blind adoption, direct peer messaging and unleased browser authority', async () => {
  const h = harness();
  const snap = await h.provisioner.init();
  assert.equal(snap.policy.adopt_existing, false);
  assert.equal(snap.policy.direct_peer_messaging, false);
  assert.equal(snap.policy.browser_authority, false);
  assert.equal(snap.policy.automatic_work_retry, false);
  assert.equal(snap.policy.idle_physical_tabs, false);
});

test('profile roles are assigned deterministically', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  assert.deepEqual(h.provisioner.snapshot().agents.map((a) => a.role), ['PLANNER', 'RESEARCHER', 'IMPLEMENTER', 'CRITIC', 'FALSIFIER', 'SYNTHESIZER']);
});

test('pre-actuation state is persisted before createTab effect', async () => {
  const order = [];
  let state = null;
  const p = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 1, max_agents: 1, profile: 'BALANCED' },
    clock: () => 1788000000000,
    uuid: () => '11111111-1111-4111-8111-111111111111',
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); order.push(`save:${value.agents.at(-1)?.lifecycle_state || 'EMPTY'}`); },
    tabExists: () => false,
    createTab: async () => { order.push('effect:createTab'); return { tab_id: 'tab_1', webcontents_id: 10 }; },
    loadTab: async () => { order.push('effect:loadTab'); },
  });
  await p.init();
  await p.reconcile({ active: true });
  const effectIndex = order.indexOf('effect:createTab');
  const preIndex = order.indexOf('save:PROVISIONING');
  const bindingIndex = order.indexOf('save:BOUND_UNVERIFIED');
  const loadIndex = order.indexOf('effect:loadTab');
  assert.ok(preIndex >= 0 && preIndex < effectIndex);
  assert.ok(bindingIndex > effectIndex && bindingIndex < loadIndex);
});
