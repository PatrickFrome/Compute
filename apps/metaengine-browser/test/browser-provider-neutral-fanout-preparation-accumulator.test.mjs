import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  ProviderNeutralFanoutPreparationAccumulator,
  providerNeutralFanoutPreparationAccumulatorContract,
} from '../src/browser-provider-neutral-fanout-preparation-accumulator.mjs';

const actionId = 'fanout-preparation-accumulator-1';
const actionDigest = 'a'.repeat(64);
const targets = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)];

function accumulator() {
  const checkpoint = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
  return new ProviderNeutralFanoutPreparationAccumulator(checkpoint, {
    issued_count: 0,
    requested_count: 4,
    max_parallel: 4,
    target_binding_digests: targets,
    shard_count: 2,
  });
}

function acceptedInput(fanoutIndex, preparedByte) {
  const acc = accumulator();
  const initial = acc.snapshot();
  void initial;
  const shardIndex = fanoutIndex % 2;
  return {
    fanout_index: fanoutIndex,
    shard_index: shardIndex,
    target_binding_digest: targets[fanoutIndex],
    issuance_entry_digest: null,
    prepared_command_digest: preparedByte.repeat(64),
  };
}

function projectedInputs(acc) {
  const checkpoint = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
  const probe = new ProviderNeutralFanoutPreparationAccumulator(checkpoint, {
    issued_count: 0,
    requested_count: 4,
    max_parallel: 4,
    target_binding_digests: targets,
    shard_count: 2,
  });
  void acc;
  return probe;
}

test('accepts preparation results incrementally and exposes shard readiness as soon as complete', async () => {
  const checkpoint = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
  const { projectProviderNeutralFanoutPreparationShards } = await import('../src/browser-provider-neutral-fanout-preparation-shards.mjs');
  const projection = projectProviderNeutralFanoutPreparationShards(checkpoint, {
    issued_count: 0, requested_count: 4, max_parallel: 4, target_binding_digests: targets, shard_count: 2,
  });
  const acc = accumulator();
  const entry = (index) => projection.shards.flatMap((shard) => shard.entries.map((item) => ({ shard, item })))
    .find(({ item }) => item.fanout_index === index);
  const submit = (index, byte) => {
    const found = entry(index);
    return acc.accept({
      fanout_index: index,
      shard_index: found.shard.shard_index,
      target_binding_digest: found.item.target_binding_digest,
      issuance_entry_digest: found.item.issuance_entry_digest,
      prepared_command_digest: byte.repeat(64),
    });
  };

  assert.equal(submit(0, 'b').shard_ready, false);
  assert.equal(submit(2, 'c').shard_ready, true);
  assert.deepEqual(acc.snapshot().ready_shard_indexes, [0]);
  assert.equal(submit(1, 'd').shard_ready, false);
  assert.equal(submit(3, 'e').shard_ready, true);
  const snapshot = acc.snapshot();
  assert.equal(snapshot.prepared_count, 4);
  assert.deepEqual(snapshot.ready_shard_indexes, [0, 1]);
});

test('duplicate delivery is idempotent while conflicting preparation fails closed', async () => {
  const checkpoint = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
  const { projectProviderNeutralFanoutPreparationShards } = await import('../src/browser-provider-neutral-fanout-preparation-shards.mjs');
  const projection = projectProviderNeutralFanoutPreparationShards(checkpoint, {
    issued_count: 0, requested_count: 4, max_parallel: 4, target_binding_digests: targets, shard_count: 2,
  });
  const found = projection.shards.flatMap((shard) => shard.entries.map((item) => ({ shard, item })))
    .find(({ item }) => item.fanout_index === 0);
  const acc = accumulator();
  const input = {
    fanout_index: 0,
    shard_index: found.shard.shard_index,
    target_binding_digest: found.item.target_binding_digest,
    issuance_entry_digest: found.item.issuance_entry_digest,
    prepared_command_digest: 'b'.repeat(64),
  };
  assert.equal(acc.accept(input).accepted, true);
  assert.equal(acc.accept(input).duplicate, true);
  assert.throws(() => acc.accept({ ...input, prepared_command_digest: 'c'.repeat(64) }), /collision/);
  assert.equal(acc.snapshot().prepared_count, 1);
});

test('wrong shard, target, issuance identity, index, or digest fails before state mutation', async () => {
  const checkpoint = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
  const { projectProviderNeutralFanoutPreparationShards } = await import('../src/browser-provider-neutral-fanout-preparation-shards.mjs');
  const projection = projectProviderNeutralFanoutPreparationShards(checkpoint, {
    issued_count: 0, requested_count: 4, max_parallel: 4, target_binding_digests: targets, shard_count: 2,
  });
  const found = projection.shards.flatMap((shard) => shard.entries.map((item) => ({ shard, item })))
    .find(({ item }) => item.fanout_index === 0);
  const base = {
    fanout_index: 0,
    shard_index: found.shard.shard_index,
    target_binding_digest: found.item.target_binding_digest,
    issuance_entry_digest: found.item.issuance_entry_digest,
    prepared_command_digest: 'b'.repeat(64),
  };
  for (const candidate of [
    { ...base, fanout_index: 99 },
    { ...base, shard_index: 1 },
    { ...base, target_binding_digest: 'f'.repeat(64) },
    { ...base, issuance_entry_digest: 'e'.repeat(64) },
    { ...base, prepared_command_digest: 'bad' },
  ]) {
    const acc = accumulator();
    assert.throws(() => acc.accept(candidate));
    assert.equal(acc.snapshot().prepared_count, 0);
  }
});

test('contract stays bounded provider-neutral preparation evidence with zero authority', () => {
  const contract = providerNeutralFanoutPreparationAccumulatorContract();
  assert.equal(contract.incremental_o1_accept, true);
  assert.equal(contract.duplicate_idempotency, true);
  assert.equal(contract.collision_fenced, true);
  assert.equal(contract.shard_readiness_streamable, true);
  assert.equal(contract.prepared_command_digest_only, true);
  assert.equal(contract.preparation_only, true);
  assert.equal(contract.provider_neutral, true);
  for (const field of ['scheduler_authority', 'dispatch_authority', 'lease_authority', 'reservation_authority', 'effect_execution_authority', 'automatic_retry_allowed', 'ambiguous_retry_allowed', 'authority_effect']) {
    assert.equal(contract[field], false, field);
  }
});
