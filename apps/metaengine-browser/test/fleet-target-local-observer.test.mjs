import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFleetTargetLocalObserver,
  revalidateFleetTargetFromLocalBrowser,
} from '../src/fleet-target-local-observer.mjs';

function agent(overrides = {}) {
  return {
    agent_id: 'agent_local-observer',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab_11111111-2222-3333-4444-555555555555',
    target_id: 'webcontents:77',
    generation_epoch: 8,
    ...overrides,
  };
}

function liveView(id = 77) {
  return { webContents: { id, isDestroyed: () => false } };
}

test('branded Browser-local observation revalidates same target with zero authority', () => {
  const observe = createFleetTargetLocalObserver({ lookupView: () => liveView(77) });
  const result = revalidateFleetTargetFromLocalBrowser({ agent: agent(), observeLocalTarget: observe });
  assert.equal(result.target_changed, false);
  assert.equal(result.generation_epoch, 8);
  assert.equal(result.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(result.transport_proof, null);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('Browser-local replacement WebContents advances generation but cannot activate agent', () => {
  const observe = createFleetTargetLocalObserver({ lookupView: () => liveView(88) });
  const result = revalidateFleetTargetFromLocalBrowser({ agent: agent(), observeLocalTarget: observe });
  assert.equal(result.target_changed, true);
  assert.equal(result.target_id, 'webcontents:88');
  assert.equal(result.generation_epoch, 9);
  assert.equal(result.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(result.transport_proof, null);
});

test('arbitrary page/model supplied observer cannot cross the local trust boundary', () => {
  const forged = () => ({
    source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
    tab_id: agent().tab_id,
    target_id: 'webcontents:77',
    tab_exists: true,
    authority_effect: false,
  });
  assert.throws(
    () => revalidateFleetTargetFromLocalBrowser({ agent: agent(), observeLocalTarget: forged }),
    /fleet_local_revalidation_observer_untrusted/,
  );
});

test('missing or destroyed local WebContents fails closed', () => {
  for (const lookupView of [() => null, () => ({ webContents: { id: 77, isDestroyed: () => true } })]) {
    const observe = createFleetTargetLocalObserver({ lookupView });
    assert.throws(
      () => revalidateFleetTargetFromLocalBrowser({ agent: agent(), observeLocalTarget: observe }),
      /fleet_revalidation_tab_not_live/,
    );
  }
});

test('ACTIVE state cannot use local revalidation as an alternate authority path', () => {
  const observe = createFleetTargetLocalObserver({ lookupView: () => liveView(77) });
  assert.throws(
    () => revalidateFleetTargetFromLocalBrowser({ agent: agent({ lifecycle_state: 'ACTIVE' }), observeLocalTarget: observe }),
    /fleet_revalidation_state_invalid:ACTIVE/,
  );
});
