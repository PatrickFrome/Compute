import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

function harness() {
  let state = null;
  let seq = 0;
  const tabs = new Map();
  const provisioner = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 1, max_agents: 1, profile: 'BALANCED' },
    clock: (() => { let n = Date.parse('2026-08-30T09:00:00Z'); return () => ++n; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: (id) => tabs.has(id),
    createTab: async () => {
      const tab = { tab_id: 'tab_11111111-2222-3333-4444-555555555555', webcontents_id: 77 };
      tabs.set(tab.tab_id, tab);
      return tab;
    },
    loadTab: async () => {},
  });
  return { provisioner, getState: () => state };
}

test('BOUND_UNVERIFIED promotes to ACTIVE only with exact physical transport proof', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const before = h.provisioner.snapshot().agents[0];
  assert.equal(before.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(before.transport_proof, null);

  const snap = await h.provisioner.markTransportProven({
    agent_id: before.agent_id,
    tab_id: before.tab_id,
    target_id: before.target_id,
    generation_epoch: before.generation_epoch,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  const after = snap.agents[0];
  assert.equal(after.lifecycle_state, 'ACTIVE');
  assert.equal(snap.counts.ACTIVE, 1);
  assert.equal(snap.counts.BOUND_UNVERIFIED, 0);
  assert.equal(after.transport_proof.tab_id, before.tab_id);
  assert.equal(after.transport_proof.target_id, before.target_id);
  assert.equal(after.transport_proof.generation_epoch, before.generation_epoch);
  assert.match(after.transport_proof.conversation_url_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(after.transport_proof).includes('chatgpt.com/c/'), false);
});

test('stale tab, target or generation cannot promote fleet agent', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const agent = h.provisioner.snapshot().agents[0];
  const common = {
    agent_id: agent.agent_id,
    tab_id: agent.tab_id,
    target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };
  await assert.rejects(() => h.provisioner.markTransportProven({ ...common, tab_id: 'tab_deadbeef-dead-beef-dead-beefdeadbeef' }), /fleet_transport_tab_binding_mismatch/);
  await assert.rejects(() => h.provisioner.markTransportProven({ ...common, target_id: 'webcontents:999' }), /fleet_transport_target_binding_mismatch/);
  await assert.rejects(() => h.provisioner.markTransportProven({ ...common, generation_epoch: agent.generation_epoch + 1 }), /fleet_transport_generation_binding_mismatch/);
  assert.equal(h.provisioner.snapshot().agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
});

test('tab loss clears ACTIVE transport proof and increments incarnation', async () => {
  const h = harness();
  await h.provisioner.init();
  await h.provisioner.reconcile({ active: true });
  const before = h.provisioner.snapshot().agents[0];
  await h.provisioner.markTransportProven({
    agent_id: before.agent_id,
    tab_id: before.tab_id,
    target_id: before.target_id,
    generation_epoch: before.generation_epoch,
    conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  await h.provisioner.onTabClosed(before.tab_id, 'TEST_LOSS');
  const after = h.provisioner.snapshot().agents[0];
  assert.equal(after.lifecycle_state, 'LOST');
  assert.equal(after.transport_proof, null);
  assert.equal(after.generation_epoch, before.generation_epoch + 1);
});
