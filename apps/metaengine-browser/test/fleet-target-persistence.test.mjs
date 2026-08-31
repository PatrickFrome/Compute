import test from 'node:test';
import assert from 'node:assert/strict';
import { createFleetTargetLocalObserver } from '../src/fleet-target-local-observer.mjs';
import { persistRevalidatedFleetTarget } from '../src/fleet-target-persistence.mjs';

function agent(overrides = {}) {
  return {
    agent_id: 'agent_persist-target',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    target_id: 'webcontents:77',
    generation_epoch: 8,
    transport_proof: null,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function observer(id = 77) {
  return createFleetTargetLocalObserver({
    lookupView: () => ({ webContents: { id, isDestroyed: () => false } }),
  });
}

test('persists same-target fresh observation without consuming generation', async () => {
  const writes = [];
  const next = await persistRevalidatedFleetTarget({
    agent: agent(),
    observeLocalTarget: observer(77),
    saveAgent: async (value) => writes.push(value),
  });
  assert.equal(next.target_id, 'webcontents:77');
  assert.equal(next.generation_epoch, 8);
  assert.equal(next.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(next.transport_proof, null);
  assert.equal(next.automatic_retry_allowed, false);
  assert.equal(next.authority_effect, false);
  assert.deepEqual(writes, [next]);
});

test('persists replacement target with exactly one generation advance', async () => {
  const writes = [];
  const next = await persistRevalidatedFleetTarget({
    agent: agent(),
    observeLocalTarget: observer(88),
    saveAgent: async (value) => writes.push(value),
  });
  assert.equal(next.target_id, 'webcontents:88');
  assert.equal(next.generation_epoch, 9);
  assert.equal(next.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(next.transport_proof, null);
  assert.equal(writes.length, 1);
});

test('forged observer cannot persist a target binding', async () => {
  let writes = 0;
  const forged = () => ({
    source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
    tab_id: agent().tab_id,
    target_id: 'webcontents:77',
    tab_exists: true,
    authority_effect: false,
  });
  await assert.rejects(
    persistRevalidatedFleetTarget({
      agent: agent(),
      observeLocalTarget: forged,
      saveAgent: async () => { writes += 1; },
    }),
    /fleet_local_revalidation_observer_untrusted/,
  );
  assert.equal(writes, 0);
});

test('ACTIVE state cannot be persisted through the revalidation path', async () => {
  let writes = 0;
  await assert.rejects(
    persistRevalidatedFleetTarget({
      agent: agent({ lifecycle_state: 'ACTIVE' }),
      observeLocalTarget: observer(77),
      saveAgent: async () => { writes += 1; },
    }),
    /fleet_revalidation_state_invalid:ACTIVE/,
  );
  assert.equal(writes, 0);
});

test('persistence failure cannot return a falsely advanced binding', async () => {
  await assert.rejects(
    persistRevalidatedFleetTarget({
      agent: agent(),
      observeLocalTarget: observer(88),
      saveAgent: async () => { throw new Error('disk_failed'); },
    }),
    /disk_failed/,
  );
});
