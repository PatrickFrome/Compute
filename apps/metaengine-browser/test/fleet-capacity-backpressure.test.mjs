import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';

function makeProvisioner({ errorMessage = 'tab_capacity_exceeded', persisted = null } = {}) {
  let state = persisted;
  let createAttempts = 0;
  let seq = 0;
  const p = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 2, profile: 'BALANCED' },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: () => false,
    createTab: async () => { createAttempts += 1; throw new Error(errorMessage); },
    loadTab: async () => {},
  });
  return { p, attempts: () => createAttempts, state: () => structuredClone(state) };
}

test('tab capacity rejection becomes deterministic no-effect backpressure and does not spam createTab', async () => {
  const h = makeProvisioner();
  await h.p.init();
  let snap = await h.p.reconcile({ active: true });
  assert.equal(snap.counts.PROVISIONING_AMBIGUOUS, 0);
  assert.equal(snap.counts.RETIRED, 2);
  assert.equal(snap.capacity_backpressure.blocked, true);
  assert.equal(snap.capacity_backpressure.deterministic_no_effect, true);
  assert.equal(snap.capacity_backpressure.automatic_retry_allowed, false);
  const attempts = h.attempts();
  snap = await h.p.reconcile({ active: true });
  assert.equal(h.attempts(), attempts, 'capacity backpressure must suppress repeated createTab attempts');
  assert.equal(snap.counts.PROVISIONING_AMBIGUOUS, 0);
});

test('generic createTab failure remains ambiguous and fenced', async () => {
  const h = makeProvisioner({ errorMessage: 'transport_disconnected_mid_create' });
  await h.p.init();
  const snap = await h.p.reconcile({ active: true });
  assert.equal(snap.counts.PROVISIONING_AMBIGUOUS, 2);
  assert.equal(snap.capacity_backpressure.blocked, false);
  assert.ok(snap.agents.filter((a) => a.lifecycle_state === 'PROVISIONING_AMBIGUOUS').every((a) => a.automatic_retry_allowed === false));
});

test('restart migrates legacy capacity ambiguity to retired no-effect attempts', async () => {
  const now = new Date().toISOString();
  const persisted = {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.4.1',
    policy: { profile: 'BALANCED', warm_agents: 1, desired_agents: 2 },
    agents: [{
      agent_id: 'agent_00000000-0000-4000-8000-000000000001', role: 'PLANNER', ownership: 'FLEET_OWNED',
      lifecycle_state: 'PROVISIONING_AMBIGUOUS', tab_id: null, target_id: null, conversation_epoch: 0, generation_epoch: 1,
      created_at: now, updated_at: now, lost_reason: null,
      ambiguous_reason: 'CREATE_TAB_AMBIGUOUS:tab_capacity_exceeded', transport_proof: null,
      automatic_retry_allowed: false, authority_effect: false,
    }],
    updated_at: now,
  };
  const h = makeProvisioner({ persisted });
  const snap = await h.p.init();
  assert.equal(snap.counts.PROVISIONING_AMBIGUOUS, 0);
  assert.equal(snap.counts.RETIRED, 1);
  assert.equal(snap.capacity_backpressure.blocked, true);
  assert.equal(h.attempts(), 0);
});
