import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  projectProviderNeutralFanoutPreparationShards,
  providerNeutralFanoutPreparationShardsContract,
} from '../src/browser-provider-neutral-fanout-preparation-shards.mjs';

const actionId = 'fanout-preparation-shards-1';
const actionDigest = 'a'.repeat(64);

function checkpoint(expectedCount = 4) {
  return new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount }).checkpoint();
}

function projection(shardCount, targets = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)]) {
  return projectProviderNeutralFanoutPreparationShards(checkpoint(), {
    issued_count: 0,
    requested_count: targets.length,
    max_parallel: targets.length || 1,
    target_binding_digests: targets,
    shard_count: shardCount,
  });
}

test('deterministically partitions exact manifest entries across bounded preparation shards', () => {
  const projected = projection(2);
  assert.equal(projected.shard_count, 2);
  assert.deepEqual(projected.shards.map((shard) => shard.entries.map((entry) => entry.fanout_index)), [[0, 2], [1, 3]]);
  assert.equal(projected.shards.every((shard) => shard.issuance_manifest_digest === projected.issuance_manifest_digest), true);
});

test('shard and aggregate digests are deterministic and membership sensitive', () => {
  const left = projection(2);
  const same = projection(2);
  const changed = projection(2, ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '5'.repeat(64)]);
  assert.equal(left.preparation_shards_digest, same.preparation_shards_digest);
  assert.notEqual(left.preparation_shards_digest, changed.preparation_shards_digest);
  assert.notEqual(left.shards[1].shard_digest, changed.shards[1].shard_digest);
});

test('never creates empty extra shards and preserves every manifest entry exactly once', () => {
  const projected = projection(8);
  assert.equal(projected.shard_count, 4);
  assert.deepEqual(projected.shards.flatMap((shard) => shard.entries.map((entry) => entry.fanout_index)), [0, 1, 2, 3]);
});

test('fails closed on invalid shard counts', () => {
  for (const value of [0, 129, 1.5, Number.NaN]) {
    assert.throws(() => projection(value), /shard_count_invalid/);
  }
});

test('zero-capacity projection remains bounded and payload-free', () => {
  const projected = projectProviderNeutralFanoutPreparationShards(checkpoint(), {
    issued_count: 4,
    requested_count: 1,
    max_parallel: 4,
    target_binding_digests: [],
    shard_count: 4,
  });
  assert.equal(projected.projected_count, 0);
  assert.equal(projected.shard_count, 1);
  assert.deepEqual(projected.shards[0].entries, []);
});

test('contract remains preparation-only, provider-neutral, and grants no execution authority', () => {
  const contract = providerNeutralFanoutPreparationShardsContract();
  assert.equal(contract.deterministic_partitioning, true);
  assert.equal(contract.exact_manifest_membership_fenced, true);
  assert.equal(contract.bounded_shard_count, 128);
  assert.equal(contract.preparation_only, true);
  assert.equal(contract.provider_neutral, true);
  for (const field of [
    'command_payload_persisted', 'payload_persisted', 'semantic_payload_persisted', 'reservation_authority',
    'scheduler_authority', 'dispatch_authority', 'lease_authority', 'effect_execution_authority',
    'automatic_retry_allowed', 'ambiguous_retry_allowed', 'authority_effect',
  ]) {
    assert.equal(contract[field], false, field);
  }
});
