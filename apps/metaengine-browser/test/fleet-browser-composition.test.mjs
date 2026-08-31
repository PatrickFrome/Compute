import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserComposition } from '../src/fleet-browser-composition.mjs';

function fixture() {
  const saved = [];
  const state = {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.4.0',
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
    agents: [{
      agent_id: 'agent_compose-12345678',
      role: 'PLANNER',
      ownership: 'FLEET_OWNED',
      lifecycle_state: 'BOUND_UNVERIFIED',
      tab_id: 'tab_1',
      target_id: 'webcontents:101',
      conversation_epoch: 0,
      generation_epoch: 7,
      created_at: '2026-08-31T00:00:00.000Z',
      updated_at: '2026-08-31T00:00:00.000Z',
      lost_reason: null,
      ambiguous_reason: null,
      transport_proof: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
    updated_at: '2026-08-31T00:00:00.000Z',
  };
  const composition = createFleetBrowserComposition({
    createTab: async () => { throw new Error('unexpected_create'); },
    loadTab: async () => { throw new Error('unexpected_load'); },
    tabExists: (tabId) => tabId === 'tab_1',
    loadState: async () => state,
    saveState: async (next) => { saved.push(structuredClone(next)); },
    lookupView: (tabId) => tabId === 'tab_1' ? {
      webContents: {
        id: 101,
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        getURL: () => 'https://chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
      },
    } : null,
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
    clock: () => Date.parse('2026-08-31T12:00:00.000Z'),
    uuid: () => '00000000-0000-4000-8000-000000000001',
  });
  return { composition, saved };
}

test('composition does not expose raw FleetProvisioner promotion or proof input', async () => {
  const { composition } = fixture();
  await composition.init();
  assert.equal(Object.isFrozen(composition), true);
  assert.equal('markTransportProven' in composition, false);
  assert.equal('fleet' in composition, false);
  assert.equal('provisioner' in composition, false);
  assert.equal(composition.raw_transport_promotion_exposed, false);
  assert.equal(composition.proof_input_surface_exposed, false);
  assert.equal(composition.renderer_input_authority, false);
  assert.equal(composition.worker_browser_authority, false);
});

test('promotion derives exact live proof and ignores forged proof-shaped fields', async () => {
  const { composition } = fixture();
  await composition.init();
  const result = await composition.promoteAgentFromLiveBrowser({
    agent_id: 'agent_compose-12345678',
    tab_id: 'tab_attacker',
    target_id: 'webcontents:999',
    generation_epoch: 999,
    authority_effect: true,
  });
  const agent = result.agents.find((row) => row.agent_id === 'agent_compose-12345678');
  assert.equal(agent.lifecycle_state, 'ACTIVE');
  assert.equal(agent.transport_proof.tab_id, 'tab_1');
  assert.equal(agent.transport_proof.target_id, 'webcontents:101');
  assert.equal(agent.transport_proof.generation_epoch, 7);
  assert.equal(agent.authority_effect, false);
  assert.equal(agent.automatic_retry_allowed, false);
});

test('composition keeps lifecycle operations but no arbitrary eval or execution surface', async () => {
  const { composition } = fixture();
  await composition.init();
  for (const key of ['eval', 'execute', 'executeJavaScript', 'dispatchWorker', 'rawFleet']) {
    assert.equal(key in composition, false);
  }
  await assert.rejects(composition.promoteAgentFromLiveBrowser({}), /agent_id_required/);
});
