import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

const TAB_ID = 'tab_11111111-2222-3333-4444-555555555555';
const OLD_TARGET = 'webcontents:77';

function persistedActiveState() {
  return {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.3.0',
    policy: {
      profile: 'BALANCED',
      warm_agents: 1,
      desired_agents: 1,
      max_agents: 1,
      adopt_existing: false,
      direct_peer_messaging: false,
      browser_authority: false,
      automatic_work_retry: false,
      idle_physical_tabs: false,
    },
    agents: [{
      agent_id: 'agent_00000000-0000-4000-8000-000000000001',
      role: 'PLANNER',
      ownership: 'FLEET_OWNED',
      lifecycle_state: 'ACTIVE',
      tab_id: TAB_ID,
      target_id: OLD_TARGET,
      conversation_epoch: 1,
      generation_epoch: 7,
      created_at: '2026-08-30T09:00:00.000Z',
      updated_at: '2026-08-30T09:01:00.000Z',
      lost_reason: null,
      ambiguous_reason: null,
      transport_proof: {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: TAB_ID,
        target_id: OLD_TARGET,
        generation_epoch: 7,
        conversation_url_sha256: 'a'.repeat(64),
        proven_at: '2026-08-30T09:01:00.000Z',
        authority_effect: false,
      },
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
    updated_at: '2026-08-30T09:01:00.000Z',
  };
}

test('restart does not trust persisted ACTIVE transport proof without fresh exact target incarnation revalidation', async () => {
  let state = persistedActiveState();
  const provisioner = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 1, max_agents: 1, profile: 'BALANCED' },
    clock: () => Date.parse('2026-08-31T00:00:00.000Z'),
    uuid: () => '00000000-0000-4000-8000-000000000002',
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    // A tab id can survive while its renderer/target incarnation changes.
    // Mere tab existence therefore cannot re-authorize an old transport proof.
    tabExists: (id) => id === TAB_ID,
    createTab: async () => { throw new Error('not_expected'); },
    loadTab: async () => {},
  });

  const snap = await provisioner.init();
  const agent = snap.agents[0];

  assert.equal(agent.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(agent.transport_proof, null);
  assert.equal(agent.tab_id, TAB_ID);
  assert.equal(agent.target_id, OLD_TARGET);
  assert.equal(agent.generation_epoch, 8);
  assert.equal(agent.automatic_retry_allowed, false);
});
