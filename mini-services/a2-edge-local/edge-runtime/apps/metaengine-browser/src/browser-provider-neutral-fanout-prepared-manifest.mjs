import { createHash } from 'node:crypto';
import {
  projectProviderNeutralFanoutPreparationShards,
  providerNeutralFanoutPreparationShardsContract,
} from './browser-provider-neutral-fanout-preparation-shards.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-prepared-manifest.v1';
const DIGEST_RE = /^[0-9a-f]{64}$/;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizePreparedDigests(values, expectedCount) {
  if (!Array.isArray(values) || values.length !== expectedCount) {
    throw new Error('fanout_prepared_manifest_count_mismatch');
  }
  return Object.freeze(values.map((value) => {
    const normalized = String(value ?? '').toLowerCase();
    if (!DIGEST_RE.test(normalized)) {
      throw new Error('fanout_prepared_manifest_digest_invalid');
    }
    return normalized;
  }));
}

export function projectProviderNeutralFanoutPreparedManifest(checkpointInput, options = {}) {
  const preparation = projectProviderNeutralFanoutPreparationShards(checkpointInput, options);
  const orderedEntries = preparation.shards
    .flatMap((shard) => shard.entries.map((entry) => ({ shard_index: shard.shard_index, entry })))
    .sort((left, right) => left.entry.fanout_index - right.entry.fanout_index);
  const preparedDigests = normalizePreparedDigests(options.prepared_command_digests ?? [], orderedEntries.length);

  const entries = Object.freeze(orderedEntries.map(({ shard_index: shardIndex, entry }, index) => {
    const core = Object.freeze({
      fanout_index: entry.fanout_index,
      shard_index: shardIndex,
      target_binding_digest: entry.target_binding_digest,
      prepared_command_digest: preparedDigests[index],
      issuance_entry_digest: entry.issuance_entry_digest,
    });
    return Object.freeze({ ...core, prepared_entry_digest: digest(core) });
  }));

  const core = Object.freeze({
    schema: SCHEMA,
    action_id: preparation.action_id,
    action_digest: preparation.action_digest,
    checkpoint_digest: preparation.checkpoint_digest,
    issuance_manifest_digest: preparation.issuance_manifest_digest,
    preparation_shards_digest: preparation.preparation_shards_digest,
    prepared_count: entries.length,
    entries,
  });
  return Object.freeze({ ...core, prepared_manifest_digest: digest(core) });
}

export function providerNeutralFanoutPreparedManifestContract() {
  return Object.freeze({
    ...providerNeutralFanoutPreparationShardsContract(),
    schema: 'metaengine.browser.provider-neutral-fanout-prepared-manifest-contract.v1',
    exact_preparation_membership_fenced: true,
    target_binding_preserved: true,
    prepared_command_digest_only: true,
    preparation_only: true,
  });
}
