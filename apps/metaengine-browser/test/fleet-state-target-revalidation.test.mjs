import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetTargetLocalObserver } from '../src/fleet-target-local-observer.mjs';
import { persistFleetStateTargetRevalidation } from '../src/fleet-state-target-revalidation.mjs';

function state(overrides = {}) {
  return {
    schema: 'metaengine.browser.fleet-state.v1',
    version: '1.4.0',
    policy: {},
    agents: [{
      agent_id: 'agent_transaction-target',
      lifecycle_state: 'BOUND_UNVERIFIED',
      tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      target_id: 'webcontents:77',
      generation_epoch: 8,
      transport_proof: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
    updated_at: null,
    ...overrides,
  };
}

function observer(id = 77, destroyed = false) {
  return createFleetTargetLocalObserver({
    lookupView: () => ({ webContents: { id, isDestroyed: () => destroyed } }),
  });
}

test('persists replacement target as one whole-state transaction without authority', async () => {
  const original = state();
  const writes = [];
  const next = await persistFleetStateTargetRevalidation({
    state: original,
    agent_id: 'agent_transaction-target',
    observeLocalTarget: observer(88),
    saveState: async (value) => writes.push(value),
  });
  assert.equal(original.agents[0].target_id, 'webcontents:77');
  assert.equal(original.agents[0].generation_epoch, 8);
  assert.equal(next.agents[0].target_id, 'webcontents:88');
  assert.equal(next.agents[0].generation_epoch, 9);
  assert.equal(next.agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(next.agents[0].transport_proof, null);
  assert.equal(next.agents[0].automatic_retry_allowed, false);
  assert.equal(next.agents[0].authority_effect, false);
  assert.deepEqual(writes, [next]);
});

test('same target does not consume generation', async () => {
  const next = await persistFleetStateTargetRevalidation({ state: state(), agent_id: 'agent_transaction-target', observeLocalTarget: observer(77), saveState: async () => {} });
  assert.equal(next.agents[0].generation_epoch, 8);
});

test('destroyed WebContents fails closed before durable write', async () => {
  let writes = 0;
  await assert.rejects(persistFleetStateTargetRevalidation({ state: state(), agent_id: 'agent_transaction-target', observeLocalTarget: observer(77, true), saveState: async () => { writes += 1; } }), /fleet_revalidation_tab_not_live/);
  assert.equal(writes, 0);
});

test('forged local observation path cannot reach durable write', async () => {
  let writes = 0;
  await assert.rejects(persistFleetStateTargetRevalidation({ state: state(), agent_id: 'agent_transaction-target', observeLocalTarget: () => ({ tab_exists: true, target_id: 'webcontents:88' }), saveState: async () => { writes += 1; } }), /fleet_local_revalidation_observer_untrusted/);
  assert.equal(writes, 0);
});

test('ACTIVE agent cannot use the zero-authority transaction path', async () => {
  const active = state();
  active.agents[0].lifecycle_state = 'ACTIVE';
  active.agents[0].transport_proof = { schema: 'metaengine.browser.fleet-transport-proof.v1' };
  let writes = 0;
  await assert.rejects(persistFleetStateTargetRevalidation({ state: active, agent_id: 'agent_transaction-target', observeLocalTarget: observer(77), saveState: async () => { writes += 1; } }), /fleet_revalidation_state_invalid:ACTIVE/);
  assert.equal(writes, 0);
});

test('durable save failure never mutates caller state or returns candidate', async () => {
  const original = state();
  await assert.rejects(persistFleetStateTargetRevalidation({ state: original, agent_id: 'agent_transaction-target', observeLocalTarget: observer(88), saveState: async () => { throw new Error('durable_write_failed'); } }), /durable_write_failed/);
  assert.equal(original.agents[0].target_id, 'webcontents:77');
  assert.equal(original.agents[0].generation_epoch, 8);
});
