import { createHash } from 'node:crypto';
import {
  projectProviderNeutralFanoutPreparationShards,
  providerNeutralFanoutPreparationShardsContract,
} from './browser-provider-neutral-fanout-preparation-shards.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-preparation-accumulator.v1';
const DIGEST_RE = /^[0-9a-f]{64}$/;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeDigest(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (!DIGEST_RE.test(normalized)) throw new Error('fanout_preparation_accumulator_digest_invalid');
  return normalized;
}

export class ProviderNeutralFanoutPreparationAccumulator {
  #projection;
  #entriesByIndex;
  #accepted = new Map();
  #shardExpected = new Map();
  #shardAccepted = new Map();

  constructor(checkpointInput, options = {}) {
    this.#projection = projectProviderNeutralFanoutPreparationShards(checkpointInput, options);
    this.#entriesByIndex = new Map();
    for (const shard of this.#projection.shards) {
      this.#shardExpected.set(shard.shard_index, shard.entry_count);
      this.#shardAccepted.set(shard.shard_index, 0);
      for (const entry of shard.entries) {
        this.#entriesByIndex.set(entry.fanout_index, Object.freeze({ shard_index: shard.shard_index, entry }));
      }
    }
  }

  accept(input = {}) {
    const fanoutIndex = Number(input.fanout_index);
    if (!Number.isSafeInteger(fanoutIndex) || !this.#entriesByIndex.has(fanoutIndex)) {
      throw new Error('fanout_preparation_accumulator_index_invalid');
    }
    const expected = this.#entriesByIndex.get(fanoutIndex);
    const shardIndex = Number(input.shard_index);
    if (shardIndex !== expected.shard_index) {
      throw new Error('fanout_preparation_accumulator_shard_mismatch');
    }
    const targetBindingDigest = normalizeDigest(input.target_binding_digest);
    if (targetBindingDigest !== expected.entry.target_binding_digest) {
      throw new Error('fanout_preparation_accumulator_target_mismatch');
    }
    const issuanceEntryDigest = normalizeDigest(input.issuance_entry_digest);
    if (issuanceEntryDigest !== expected.entry.issuance_entry_digest) {
      throw new Error('fanout_preparation_accumulator_issuance_mismatch');
    }
    const preparedCommandDigest = normalizeDigest(input.prepared_command_digest);
    const core = Object.freeze({
      fanout_index: fanoutIndex,
      shard_index: shardIndex,
      target_binding_digest: targetBindingDigest,
      issuance_entry_digest: issuanceEntryDigest,
      prepared_command_digest: preparedCommandDigest,
    });
    const preparedEntry = Object.freeze({ ...core, prepared_entry_digest: digest(core) });
    const prior = this.#accepted.get(fanoutIndex);
    if (prior) {
      if (prior.prepared_entry_digest !== preparedEntry.prepared_entry_digest) {
        throw new Error('fanout_preparation_accumulator_collision');
      }
      return Object.freeze({ accepted: false, duplicate: true, shard_ready: this.#isShardReady(shardIndex) });
    }
    this.#accepted.set(fanoutIndex, preparedEntry);
    this.#shardAccepted.set(shardIndex, this.#shardAccepted.get(shardIndex) + 1);
    return Object.freeze({ accepted: true, duplicate: false, shard_ready: this.#isShardReady(shardIndex) });
  }

  #isShardReady(shardIndex) {
    return this.#shardAccepted.get(shardIndex) === this.#shardExpected.get(shardIndex);
  }

  snapshot() {
    const readyShardIndexes = Object.freeze(
      [...this.#shardExpected.keys()].filter((index) => this.#isShardReady(index)),
    );
    const entries = Object.freeze([...this.#accepted.values()].sort((left, right) => left.fanout_index - right.fanout_index));
    const core = Object.freeze({
      schema: SCHEMA,
      action_id: this.#projection.action_id,
      action_digest: this.#projection.action_digest,
      checkpoint_digest: this.#projection.checkpoint_digest,
      issuance_manifest_digest: this.#projection.issuance_manifest_digest,
      preparation_shards_digest: this.#projection.preparation_shards_digest,
      expected_count: this.#projection.projected_count,
      prepared_count: entries.length,
      ready_shard_indexes: readyShardIndexes,
      entries,
    });
    return Object.freeze({ ...core, preparation_accumulator_digest: digest(core) });
  }
}

export function providerNeutralFanoutPreparationAccumulatorContract() {
  return Object.freeze({
    ...providerNeutralFanoutPreparationShardsContract(),
    schema: 'metaengine.browser.provider-neutral-fanout-preparation-accumulator-contract.v1',
    incremental_o1_accept: true,
    duplicate_idempotency: true,
    collision_fenced: true,
    shard_readiness_streamable: true,
    prepared_command_digest_only: true,
    preparation_only: true,
  });
}
