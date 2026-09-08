import { createHash } from 'node:crypto';
import {
  projectProviderNeutralFanoutIssuanceManifest,
  providerNeutralFanoutIssuanceManifestContract,
} from './browser-provider-neutral-fanout-issuance-manifest.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-preparation-shards.v1';
const MAX_SHARDS = 128;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeShardCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SHARDS) {
    throw new Error('fanout_preparation_shard_count_invalid');
  }
  return count;
}

export function projectProviderNeutralFanoutPreparationShards(checkpointInput, options = {}) {
  const manifest = projectProviderNeutralFanoutIssuanceManifest(checkpointInput, options);
  const shardCount = normalizeShardCount(options.shard_count ?? 1);
  const buckets = Array.from({ length: Math.min(shardCount, Math.max(1, manifest.entries.length)) }, () => []);

  for (const entry of manifest.entries) {
    buckets[entry.fanout_index % buckets.length].push(entry);
  }

  const shards = Object.freeze(buckets.map((entries, shardIndex) => {
    const frozenEntries = Object.freeze([...entries]);
    const core = Object.freeze({
      shard_index: shardIndex,
      issuance_manifest_digest: manifest.issuance_manifest_digest,
      entry_count: frozenEntries.length,
      entries: frozenEntries,
    });
    return Object.freeze({ ...core, shard_digest: digest(core) });
  }));

  const core = Object.freeze({
    schema: SCHEMA,
    action_id: manifest.action_id,
    action_digest: manifest.action_digest,
    checkpoint_digest: manifest.checkpoint_digest,
    issuance_window_digest: manifest.issuance_window_digest,
    issuance_manifest_digest: manifest.issuance_manifest_digest,
    requested_shard_count: shardCount,
    shard_count: shards.length,
    projected_count: manifest.projected_count,
    shards,
  });
  return Object.freeze({ ...core, preparation_shards_digest: digest(core) });
}

export function providerNeutralFanoutPreparationShardsContract() {
  const manifestContract = providerNeutralFanoutIssuanceManifestContract();
  return Object.freeze({
    ...manifestContract,
    schema: 'metaengine.browser.provider-neutral-fanout-preparation-shards-contract.v1',
    deterministic_partitioning: true,
    exact_manifest_membership_fenced: true,
    bounded_shard_count: MAX_SHARDS,
    preparation_only: true,
  });
}
