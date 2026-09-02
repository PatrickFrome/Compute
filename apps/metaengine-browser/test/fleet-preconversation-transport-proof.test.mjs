import assert from 'node:assert/strict';
import test from 'node:test';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';
import { clearFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

function harness() {
  let persisted = null;
  const tabs = new Map();
  const fleet = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 1, profile: 'IMPLEMENTATION', spawn_burst_limit: 1 },
    uuid: () => '33333333-3333-4333-8333-333333333333',
    loadState: async () => structuredClone(persisted),
    saveState: async (value) => { persisted = structuredClone(value); },
    tabExists: (id) => tabs.has(id),
    createTab: async () => {
      const tab = { tab_id: 'tab_root', webcontents_id: 77 };
      tabs.set(tab.tab_id, tab);
      return tab;
    },
    loadTab: async () => {},
  });
  return { fleet, persisted: () => structuredClone(persisted) };
}

test('root transport proof is an in-process admission overlay until a canonical conversation is proven', async () => {
  const h = harness();
  try {
    await h.fleet.init();
    await h.fleet.reconcile({ active: true, target_agents: 1, spawn_burst_limit: 1 });
    const bound = h.fleet.snapshot().agents[0];
    assert.equal(bound.lifecycle_state, 'BOUND_UNVERIFIED');
    assert.equal(bound.transport_proof, null);

    const promoted = await h.fleet.markTransportPreconversationProven({
      agent_id: bound.agent_id,
      tab_id: bound.tab_id,
      target_id: bound.target_id,
      generation_epoch: bound.generation_epoch,
      transport_url: 'https://chatgpt.com/',
    });
    const overlay = promoted.agents[0];
    assert.equal(overlay.lifecycle_state, 'ACTIVE');
    assert.equal(overlay.transport_proof.transport_stage, 'PRECONVERSATION_ROOT');
    assert.match(overlay.transport_proof.conversation_url_sha256, /^[a-f0-9]{64}$/);
    assert.equal(overlay.authority_effect, false);
    assert.equal(overlay.automatic_retry_allowed, false);

    const durableBeforeConversation = h.persisted().agents[0];
    assert.equal(durableBeforeConversation.lifecycle_state, 'BOUND_UNVERIFIED');
    assert.equal(durableBeforeConversation.transport_proof, null, 'root proof must not masquerade as durable conversation proof');

    await assert.rejects(
      h.fleet.markTransportPreconversationProven({
        agent_id: bound.agent_id,
        tab_id: bound.tab_id,
        target_id: 'webcontents:999',
        generation_epoch: bound.generation_epoch,
        transport_url: 'https://chatgpt.com/',
      }),
      /fleet_transport_preconversation_target_binding_mismatch/,
    );

    const canonical = await h.fleet.markTransportProven({
      agent_id: bound.agent_id,
      tab_id: bound.tab_id,
      target_id: bound.target_id,
      generation_epoch: bound.generation_epoch,
      conversation_url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    assert.equal(canonical.agents[0].lifecycle_state, 'ACTIVE');
    assert.equal(canonical.agents[0].transport_proof.transport_stage, undefined);
    assert.equal(h.persisted().agents[0].lifecycle_state, 'ACTIVE');
    assert.ok(h.persisted().agents[0].transport_proof);
  } finally {
    clearFleetRuntime(h.fleet);
  }
});
