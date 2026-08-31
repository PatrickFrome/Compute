import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetBrowserComposition } from '../src/fleet-browser-composition.mjs';

const AGENT_ID = 'agent_compose-12345678';
const LEASE_ID = 'lease_exact_1';
const EFFECT_KEY = `fleet.transport-promotion:${AGENT_ID}`;

function stateFixture() {
  return {
    schema: 'metaengine.browser.fleet-state.v1', version: '1.4.0',
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 },
    agents: [{ agent_id: AGENT_ID, role: 'PLANNER', ownership: 'FLEET_OWNED', lifecycle_state: 'BOUND_UNVERIFIED', tab_id: 'tab_1', target_id: 'webcontents:101', conversation_epoch: 0, generation_epoch: 7, created_at: '2026-08-31T00:00:00.000Z', updated_at: '2026-08-31T00:00:00.000Z', lost_reason: null, ambiguous_reason: null, transport_proof: null, automatic_retry_allowed: false, authority_effect: false }],
    updated_at: '2026-08-31T00:00:00.000Z',
  };
}

function validDecision(request) {
  return { valid: true, lease_id: request.lease_id, agent_id: request.agent_id, status: 'ACTIVE', released_at: null, not_expired: true, effect_scope: request.effect_scope, effect_key: request.effect_key, holder_verified: true, target_verified: true, authority_effect: false };
}

function fixture({ leaseDecision = validDecision, includeVerifier = true } = {}) {
  const saved = []; const leaseRequests = []; const state = stateFixture();
  const options = {
    createTab: async () => { throw new Error('unexpected_create'); }, loadTab: async () => { throw new Error('unexpected_load'); }, tabExists: (tabId) => tabId === 'tab_1', loadState: async () => state, saveState: async (next) => { saved.push(structuredClone(next)); },
    lookupView: (tabId) => tabId === 'tab_1' ? { webContents: { id: 101, isDestroyed: () => false, isLoadingMainFrame: () => false, getURL: () => 'https://chatgpt.com/c/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' } } : null,
    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, max_agents: 1 }, clock: () => Date.parse('2026-08-31T12:00:00.000Z'), uuid: () => '00000000-0000-4000-8000-000000000001',
  };
  if (includeVerifier) options.verifyActuationLease = async (request) => { leaseRequests.push(structuredClone(request)); return leaseDecision(request); };
  return { composition: createFleetBrowserComposition(options), saved, leaseRequests };
}

test('composition exposes only lease-gated supervisor promotion', async () => {
  const { composition } = fixture(); await composition.init();
  for (const key of ['markTransportProven','promoteAgentFromLiveBrowser','fleet','provisioner']) assert.equal(key in composition, false);
  assert.equal(composition.raw_transport_promotion_exposed, false); assert.equal(composition.live_browser_promotion_exposed, false); assert.equal(composition.proof_input_surface_exposed, false); assert.equal(composition.worker_browser_authority, false); assert.equal(composition.automatic_retry_allowed, false);
});

test('valid exact ACTIVE lease gates Browser-local proof derivation', async () => {
  const { composition, leaseRequests } = fixture(); await composition.init();
  const result = await composition.promoteAgentFromSupervisor({ agent_id: AGENT_ID, lease_id: LEASE_ID, tab_id: 'tab_attacker', target_id: 'webcontents:999', generation_epoch: 999, authority_effect: true });
  assert.deepEqual(leaseRequests, [{ agent_id: AGENT_ID, lease_id: LEASE_ID, effect_scope: 'BROWSER_CLIENT_ACTUATION', effect_key: EFFECT_KEY, authority_effect: false }]);
  const agent = result.agents.find((row) => row.agent_id === AGENT_ID);
  assert.equal(agent.lifecycle_state, 'ACTIVE'); assert.equal(agent.transport_proof.tab_id, 'tab_1'); assert.equal(agent.transport_proof.target_id, 'webcontents:101'); assert.equal(agent.transport_proof.generation_epoch, 7); assert.equal(agent.automatic_retry_allowed, false);
});

test('invalid lease dimensions fail closed before transport promotion', async () => {
  const mutations = [
    () => ({ valid: false, reason: 'expired', authority_effect: false }),
    (r) => ({ ...validDecision(r), status: 'RELEASED' }),
    (r) => ({ ...validDecision(r), released_at: '2026-08-31T12:00:00.000Z' }),
    (r) => ({ ...validDecision(r), not_expired: false }),
    (r) => ({ ...validDecision(r), agent_id: 'agent_other' }),
    (r) => ({ ...validDecision(r), effect_scope: 'OTHER_SCOPE' }),
    (r) => ({ ...validDecision(r), effect_key: 'fleet.transport-promotion:agent_other' }),
    (r) => ({ ...validDecision(r), holder_verified: false }),
    (r) => ({ ...validDecision(r), target_verified: false }),
  ];
  for (const leaseDecision of mutations) {
    const { composition, saved } = fixture({ leaseDecision }); await composition.init();
    await assert.rejects(composition.promoteAgentFromSupervisor({ agent_id: AGENT_ID, lease_id: LEASE_ID }), /fleet_supervisor_lease_/);
    assert.equal(composition.snapshot().agents[0].lifecycle_state, 'BOUND_UNVERIFIED'); assert.equal(saved.length, 0);
  }
});

test('composition without trusted lease verifier fails closed', async () => {
  const { composition } = fixture({ includeVerifier: false }); await composition.init();
  await assert.rejects(composition.promoteAgentFromSupervisor({ agent_id: AGENT_ID, lease_id: LEASE_ID }), /fleet_supervisor_lease_verifier_unavailable/);
});
