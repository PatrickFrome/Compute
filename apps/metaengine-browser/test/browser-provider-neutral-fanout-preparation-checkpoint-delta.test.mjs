import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendProviderNeutralFanoutPreparationCheckpointDelta,
  appendProviderNeutralFanoutPreparationCheckpointDeltas,
  applyProviderNeutralFanoutPreparationCheckpointDelta,
  applyProviderNeutralFanoutPreparationCheckpointDeltas,
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

test('builds an exact append delta and next checkpoint from one durable restore', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const next = saved(checkpoint, [[0, 'b'], [1, 'c'], [2, 'd']]);
  const expected = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, next);
  const { delta, checkpoint: appended } = appendProviderNeutralFanoutPreparationCheckpointDelta(
    checkpoint,
    options,
    base,
    expected.added_entries,
  );

  assert.deepEqual(appended, next);
  assert.deepEqual(delta, expected);
  assert.equal(delta.added_entries.every((entry) => !('payload' in entry)), true);
});

test('builds a contiguous append-delta chain from one durable restore', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const middle = saved(checkpoint, [[0, 'b'], [1, 'c']]);
  const next = saved(checkpoint, [[0, 'b'], [1, 'c'], [2, 'd']]);
  const first = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, middle);
  const second = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, middle, next);
  const appended = appendProviderNeutralFanoutPreparationCheckpointDeltas(
    checkpoint,
    options,
    base,
    [first.added_entries, second.added_entries],
  );

  assert.deepEqual(appended.deltas, [first, second]);
  assert.deepEqual(appended.checkpoint, next);
  assert.deepEqual(applyProviderNeutralFanoutPreparationCheckpointDeltas(checkpoint, options, base, appended.deltas), next);
});

test('single-restore append remains idempotent for already prepared entries and fail-closed on collisions', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const same = appendProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, base.entries);
  assert.equal(same.delta.added_count, 0);
  assert.deepEqual(same.checkpoint, base);

  const collision = saved(checkpoint, [[0, 'e']]).entries[0];
  assert.throws(
    () => appendProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, [collision]),
    /collision/,
  );
});

test('batched append is bounded and preserves empty-batch identity', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const empty = appendProviderNeutralFanoutPreparationCheckpointDeltas(checkpoint, options, base, []);
  assert.deepEqual(empty.deltas, []);
  assert.deepEqual(empty.checkpoint, base);
  assert.throws(
    () => appendProviderNeutralFanoutPreparationCheckpointDeltas(checkpoint, options, base, Array(129).fill([])),
    /batch_invalid/,
  );
});

test('replays a contiguous delta chain from one durable restore', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const middle = saved(checkpoint, [[0, 'b'], [1, 'c']]);
  const next = saved(checkpoint, [[0, 'b'], [1, 'c'], [2, 'd']]);
  const first = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, middle);
  const second = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, middle, next);

  assert.deepEqual(
    applyProviderNeutralFanoutPreparationCheckpointDeltas(checkpoint, options, base, [first, second]),
    next,
  );
  assert.deepEqual(applyProviderNeutralFanoutPreparationCheckpointDeltas(checkpoint, options, base, []), base);
});

test('batched replay fails closed on a broken intermediate digest fence', () => {
  const checkpoint = upstream();
  const base = saved(checkpoint, [[0, 'b']]);
  const middle = saved(checkpoint, [[0, 'b'], [1, 'c']]);
  const next = saved(checkpoint, [[0, 'b'], [1, 'c'], [2, 'd']]);
  const first = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, base, middle);
  const second = createProviderNeutralFanoutPreparationCheckpointDelta(checkpoint, options, middle, next);

  assert.throws(() => applyProviderNeutralFanoutPreparationCheckpointDeltas(checkpoint, options, base, [
    first,
    { ...second, base_preparation_checkpoint_digest: '0'.repeat(64) },
  ]), /base_digest_mismatch/);
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
  assert.equal(contract.max_deltas_per_replay, 128);
  assert.equal(contract.append_only, true);
  assert.equal(contract.base_digest_fenced, true);
  assert.equal(contract.next_digest_verified, true);
  assert.equal(contract.prepared_entry_collision_fence_preserved, true);
  assert.equal(contract.compact_incremental_persistence, true);
  assert.equal(contract.batched_replay_single_restore, true);
  assert.equal(contract.append_builder_single_restore, true);
  assert.equal(contract.batched_append_single_restore, true);
  assert.equal(contract.restart_restore_supported, true);
  assert.equal(contract.effect_execution_authority, false);
});
