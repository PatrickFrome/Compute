import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProviderNeutralFanoutPreparationCheckpointDelta,
  createProviderNeutralFanoutPreparationCheckpointDelta,
  providerNeutralFanoutPreparationCheckpointDeltaContract,
} from '../src/browser-provider-neutral-fanout-preparation-checkpoint-delta.mjs';
import {
  preparationOptions as options,
  savedPreparationCheckpoint as saved,
  upstreamPreparationCheckpoint as upstream,
} from './helpers/browser-provider-neutral-fanout-preparation-fixture.mjs';

test('persists only append-only preparation progress and replays to exact next digest', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const next = saved(checkpoint, [[0, 'b'], [2, 'c'], [1, 'd']]);
  const delta = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, next);

  assert.equal(delta.added_count, 2);
  assert.deepEqual(delta.added_entries.map((entry) => entry.fanout_index), [1, 2]);
  assert.equal(delta.added_entries.every((entry) => !('payload' in entry)), true);
  assert.equal('effect_execution_authority' in delta, false);
  assert.deepEqual(applyProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, delta), next);
});

test('fails closed on stale base, entry collision, regression and tampered next digest', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const next = saved(checkpoint, [[0, 'b'], [1, 'c']]);
  const delta = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, next);

  assert.throws(() => applyProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, {
    ...base,
    preparation_checkpoint_digest: '0'.repeat(64),
  }, delta), /digest_mismatch/);
  assert.throws(() => createProviderNeutralFanoutPreparationCheckpointDelta(
    checkpoint,
    options,
    base,
    saved(checkpoint, [[0, 'e'], [1, 'c']]),
  ), /entry_collision/);
  assert.throws(() => createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, next, base), /non_monotonic/);
  assert.throws(() => applyProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, {
    ...delta,
    next_preparation_checkpoint_digest: '0'.repeat(64),
  }), /next_digest_mismatch/);
});

test('contract exposes the delta-specific restart-safe persistence boundary', () => {
  const contract = providerNeutralFanoutPreparationCheckpointDeltaContract();
  assert.equal(contract.max_fanout, 128);
  assert.equal(contract.append_only, true);
  assert.equal(contract.base_digest_fenced, true);
  assert.equal(contract.next_digest_verified, true);
  assert.equal(contract.prepared_entry_collision_fence_preserved, true);
  assert.equal(contract.compact_incremental_persistence, true);
  assert.equal(contract.restart_restore_supported, true);
  assert.equal(contract.effect_execution_authority, false);
});
