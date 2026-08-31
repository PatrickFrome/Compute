import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserComposition } from '../src/fleet-browser-composition.mjs';

function fixture({ leaseDecision } = {}) {
  const saved = [];
  const leaseRequests = [];
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
    verifyActuationLease: async (request) => {
      leaseRequests.push(structuredClone(request));
      if (leaseDecision) return leaseDecision(request);
      return {
        valid: true,
        lease_id: request.lease_id,
        agent_id: request.agent_id,
        effect: request.effect,
        released_at: null,
        authority_effect: false,
      };
    },
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
    clock: () => Date.parse('2026-08-31T12:00:00.000Z'),
    uuid: () => '00000000-0000-4000-8000-000000000001',
  });
  return { composition, saved, leaseRequests };
}

test('composition exposes only lease-gated supervisor promotion, never raw live promotion', async () => {
  const { composition } = fixture();
  await composition.init();
  assert.equal(Object.isFrozen(composition), true);
  assert.equal('markTransportProven' in composition, false);
  assert.equal('promoteAgentFromLiveBrowser' in composition, false);
  assert.equal('fleet' in composition, false);
  assert.equal('provisioner' in composition, false);
  assert.equal(composition.raw_transport_promotion_exposed, false);
  assert.equal(composition.live_browser_promotion_exposed, false);
  assert.equal(composition.proof_input_surface_exposed, false);
  assert.equal(composition.renderer_input_authority, false);
  assert.equal(composition.worker_browser_authority, false);
  assert.equal(composition.automatic_retry_allowed, false);
});

test('valid exact lease gates Browser-local proof derivation and promotion', async () => {
  const { composition, leaseRequests } = fixture();
  await composition.init();
  const result = await composition.promoteAgentFromSupervisor({
    agent_id: 'agent_compose-12345678',
    lease_id: 'lease_exact_1',
    tab_id: 'tab_attacker',
    target_id: 'webcontents:999',
    generation_epoch: 999,
    authority_effect: true,
  });
  assert.deepEqual(leaseRequests, [{
    agent_id: 'agent_compose-12345678',
    lease_id: 'lease_exact_1',
    effect: 'BROWSER_TRANSPORT_PROMOTION',
    authority_effect: false,
  }]);
  const agent = result.agents.find((row) => row.agent_id === 'agent_compose-12345678');
  assert.equal(agent.lifecycle_state, 'ACTIVE');
  assert.equal(agent.transport_proof.tab_id, 'tab_1');
  assert.equal(agent.transport_proof.target_id, 'webcontents:101');
  assert.equal(agent.transport_proof.generation_epoch, 7);
  assert.equal(agent.authority_effect, false);
  assert.equal(agent.automatic_retry_allowed, false);
});

test('invalid, released, mismatched or wrong-effect lease cannot reach transport promotion', async () => {
  const cases = [
    () => ({ valid: false, reason: 'expired', authority_effect: false }),
    (request) => ({ valid: true, lease_id: request.lease_id, agent_id: request.agent_id, effect: request.effect, released_at: '2026-08-31T12:00:00.000Z', authority_effect: false }),
    (request) => ({ valid: true, lease_id: request.lease_id, agent_id: 'agent_other', effect: request.effect, released_at: null, authority_effect: false }),
    (request) => ({ valid: true, lease_id: request.lease_id, agent_id: request.agent_id, effect: 'OTHER_EFFECT', released_at: null, authority_effect: false }),
  ];
  for (const leaseDecision of cases) {
    const { composition, saved } = fixture({ leaseDecision });
    await composition.init();
    await assert.rejects(
      composition.promoteAgentFromSupervisor({ agent_id: 'agent_compose-12345678', lease_id: 'lease_exact_1' }),
      /fleet_supervisor_lease_/,
    );
    assert.equal(composition.snapshot().agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
    assert.equal(saved.length, 0);
  }
});

test('composition without trusted lease verifier fails closed', async () => {
  const base = fixture();
  const composition = createFleetBrowserComposition({
    createTab: async () => {},
    loadTab: async () => {},
    tabExists: () => true,
    loadState: async () => base.composition.snapshot(),
    saveState: async () => {},
    lookupView: () => null,
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
  });
  await composition.init();
  await assert.rejects(
    composition.promoteAgentFromSupervisor({ agent_id: 'agent_compose-12345678', lease_id: 'lease_exact_1' }),
    /fleet_supervisor_lease_verifier_unavailable/,
  );
});
