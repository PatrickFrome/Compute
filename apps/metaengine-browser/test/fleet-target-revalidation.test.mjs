import test from 'node:test';
import assert from 'node:assert/strict';
import { revalidateFleetTargetBinding } from '../src/fleet-target-revalidation.mjs';

const base = {
  lifecycle_state: 'BOUND_UNVERIFIED',
  bound_tab_id: 'tab_11111111-2222-3333-4444-555555555555',
  bound_target_id: 'webcontents:77',
  generation_epoch: 8,
  observed_tab_id: 'tab_11111111-2222-3333-4444-555555555555',
  observed_target_id: 'webcontents:77',
  tab_exists: true,
};

test('fresh same-target observation preserves generation but grants zero authority', () => {
  const result = revalidateFleetTargetBinding(base);
  assert.equal(result.target_changed, false);
  assert.equal(result.generation_epoch, 8);
  assert.equal(result.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(result.transport_proof, null);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('fresh replacement target advances generation before any transport proof can be accepted', () => {
  const result = revalidateFleetTargetBinding({ ...base, observed_target_id: 'webcontents:88' });
  assert.equal(result.target_changed, true);
  assert.equal(result.prior_target_id, 'webcontents:77');
  assert.equal(result.target_id, 'webcontents:88');
  assert.equal(result.generation_epoch, 9);
  assert.equal(result.lifecycle_state, 'BOUND_UNVERIFIED');
  assert.equal(result.transport_proof, null);
  assert.equal(result.authority_effect, false);
});

test('stale tab identity and dead physical tab fail closed', () => {
  assert.throws(
    () => revalidateFleetTargetBinding({ ...base, observed_tab_id: 'tab_other' }),
    /fleet_revalidation_tab_binding_mismatch/,
  );
  assert.throws(
    () => revalidateFleetTargetBinding({ ...base, tab_exists: false }),
    /fleet_revalidation_tab_not_live/,
  );
});

test('ACTIVE callers cannot use revalidation as an alternate authority path', () => {
  assert.throws(
    () => revalidateFleetTargetBinding({ ...base, lifecycle_state: 'ACTIVE' }),
    /fleet_revalidation_state_invalid:ACTIVE/,
  );
});
