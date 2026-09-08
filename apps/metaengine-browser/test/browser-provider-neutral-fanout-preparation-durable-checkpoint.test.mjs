import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderNeutralFanoutPreparationDurableCheckpoint,
  providerNeutralFanoutPreparationDurableCheckpointContract,
  restoreProviderNeutralFanoutPreparationDurableCheckpoint,
} from '../src/browser-provider-neutral-fanout-preparation-durable-checkpoint.mjs';
import {
  preparationOptions as options,
  preparedInputFor as inputFor,
  upstreamPreparationCheckpoint as upstreamCheckpoint,
} from './helpers/browser-provider-neutral-fanout-preparation-fixture.mjs';

test('persists deterministic digest-only preparation state and reconstructs ready shards', () => {
  const upstream = upstreamCheckpoint();
  const state = new ProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options);
  state.accept(inputFor(upstream, 0, 'b'));
  state.accept(inputFor(upstream, 2, 'c'));
  state.accept(inputFor(upstream, 1, 'd'));

  const saved = state.checkpoint();
  assert.equal(saved.prepared_count, 3);
  assert.deepEqual(saved.ready_shard_indexes, [0]);
  assert.match(saved.preparation_checkpoint_digest, /^[0-9a-f]{64}$/);
  assert.equal('payload' in saved.entries[0], false);

  const restored = restoreProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options, saved);
  assert.deepEqual(restored.snapshot(), state.snapshot());
  const duplicate = restored.accept(inputFor(upstream, 2, 'c'));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.shard_ready, true);
  assert.deepEqual(duplicate.ready_shard_evidence.entries.map((entry) => entry.fanout_index), [0, 2]);
});

test('restore preserves collision fencing and can continue after restart', () => {
  const upstream = upstreamCheckpoint();
  const state = new ProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options);
  state.accept(inputFor(upstream, 0, 'b'));
  const restored = restoreProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options, state.checkpoint());

  assert.throws(() => restored.accept(inputFor(upstream, 0, 'c')), /collision/);
  restored.accept(inputFor(upstream, 2, 'd'));
  assert.deepEqual(restored.snapshot().ready_shard_indexes, [0]);
});

test('restore fails closed on tampered state or projection drift', () => {
  const upstream = upstreamCheckpoint();
  const state = new ProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options);
  state.accept(inputFor(upstream, 0, 'b'));
  const saved = state.checkpoint();

  assert.throws(() => restoreProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options, {
    ...saved,
    preparation_checkpoint_digest: '0'.repeat(64),
  }), /digest_mismatch/);

  assert.throws(() => restoreProviderNeutralFanoutPreparationDurableCheckpoint(upstream, {
    ...options,
    target_binding_digests: ['5', '2', '3', '4'].map((value) => value.repeat(64)),
  }, saved), /issuance_manifest_digest_mismatch|preparation_shards_digest_mismatch/);

  assert.throws(() => restoreProviderNeutralFanoutPreparationDurableCheckpoint(upstream, options, {
    ...saved,
    entries: [{ ...saved.entries[0], prepared_command_digest: 'e'.repeat(64) }],
  }), /digest_mismatch/);
});

test('contract keeps durable preparation memory bounded and authority-free', () => {
  const contract = providerNeutralFanoutPreparationDurableCheckpointContract();
  assert.equal(contract.restart_restore_supported, true);
  assert.equal(contract.upstream_projection_fenced, true);
  assert.equal(contract.prepared_entry_collision_fence_preserved, true);
  assert.equal(contract.ready_shard_state_reconstructed, true);
  assert.equal(contract.prepared_command_digest_only, true);
  assert.equal(contract.payload_persisted, false);
  assert.equal(contract.semantic_payload_persisted, false);
  for (const field of ['scheduler_authority', 'dispatch_authority', 'lease_authority', 'reservation_authority', 'effect_execution_authority', 'automatic_retry_allowed', 'ambiguous_retry_allowed', 'authority_effect']) {
    assert.equal(contract[field], false, field);
  }
});
