import { ProviderNeutralFanoutDurableCheckpoint } from '../../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import { ProviderNeutralFanoutPreparationDurableCheckpoint } from '../../src/browser-provider-neutral-fanout-preparation-durable-checkpoint.mjs';
import { projectProviderNeutralFanoutPreparationShards } from '../../src/browser-provider-neutral-fanout-preparation-shards.mjs';

const actionId = 'fanout-preparation-fixture-1';
const actionDigest = 'a'.repeat(64);

export const preparationOptions = Object.freeze({
  issued_count: 0,
  requested_count: 4,
  max_parallel: 4,
  target_binding_digests: ['1', '2', '3', '4'].map((value) => value.repeat(64)),
  shard_count: 2,
});

export function upstreamPreparationCheckpoint() {
  return new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
}

export function preparedInputFor(checkpoint, index, byte) {
  const projection = projectProviderNeutralFanoutPreparationShards(checkpoint, preparationOptions);
  const found = projection.shards
    .flatMap((shard) => shard.entries.map((entry) => ({ shard, entry })))
    .find(({ entry }) => entry.fanout_index === index);
  return {
    fanout_index: index,
    shard_index: found.shard.shard_index,
    target_binding_digest: found.entry.target_binding_digest,
    issuance_entry_digest: found.entry.entry_digest,
    prepared_command_digest: byte.repeat(64),
  };
}

export function savedPreparationCheckpoint(checkpoint, entries = []) {
  const state = new ProviderNeutralFanoutPreparationDurableCheckpoint(checkpoint, preparationOptions);
  for (const [index, byte] of entries) state.accept(preparedInputFor(checkpoint, index, byte));
  return state.checkpoint();
}
