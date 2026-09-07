import { createHash } from 'node:crypto';
import {
  ProviderNeutralFanoutPreparationAccumulator,
  providerNeutralFanoutPreparationAccumulatorContract,
} from './browser-provider-neutral-fanout-preparation-accumulator.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-preparation-durable-checkpoint.v1';
const DIGEST_RE = /^[0-9a-f]{64}$/;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireDigest(value, name) {
  const normalized = String(value ?? '').toLowerCase();
  if (!DIGEST_RE.test(normalized)) throw new Error(`fanout_preparation_checkpoint_${name}_invalid`);
  return normalized;
}

function requireCount(value, name) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 128) {
    throw new Error(`fanout_preparation_checkpoint_${name}_invalid`);
  }
  return normalized;
}

function checkpointCore(snapshot) {
  return Object.freeze({
    schema: SCHEMA,
    action_id: snapshot.action_id,
    action_digest: snapshot.action_digest,
    checkpoint_digest: snapshot.checkpoint_digest,
    issuance_manifest_digest: snapshot.issuance_manifest_digest,
    preparation_shards_digest: snapshot.preparation_shards_digest,
    expected_count: snapshot.expected_count,
    prepared_count: snapshot.prepared_count,
    ready_shard_indexes: snapshot.ready_shard_indexes,
    entries: snapshot.entries,
  });
}

export class ProviderNeutralFanoutPreparationDurableCheckpoint {
  #accumulator;

  constructor(checkpointInput, options = {}) {
    this.#accumulator = new ProviderNeutralFanoutPreparationAccumulator(checkpointInput, options);
  }

  accept(input = {}) {
    return this.#accumulator.accept(input);
  }

  snapshot() {
    return this.#accumulator.snapshot();
  }

  checkpoint() {
    const core = checkpointCore(this.#accumulator.snapshot());
    return Object.freeze({
      ...core,
      preparation_checkpoint_digest: digest(core),
      payload_persisted: false,
      semantic_payload_persisted: false,
      scheduler_authority: false,
      dispatch_authority: false,
      lease_authority: false,
      reservation_authority: false,
      effect_execution_authority: false,
      automatic_retry_allowed: false,
      ambiguous_retry_allowed: false,
      authority_effect: false,
    });
  }
}

export function restoreProviderNeutralFanoutPreparationDurableCheckpoint(checkpointInput, options = {}, saved = {}) {
  if (saved.schema !== SCHEMA) throw new Error('fanout_preparation_checkpoint_schema_invalid');
  if (!Array.isArray(saved.entries) || !Array.isArray(saved.ready_shard_indexes)) {
    throw new Error('fanout_preparation_checkpoint_shape_invalid');
  }

  const expectedCount = requireCount(saved.expected_count, 'expected_count');
  const preparedCount = requireCount(saved.prepared_count, 'prepared_count');
  if (preparedCount !== saved.entries.length || preparedCount > expectedCount) {
    throw new Error('fanout_preparation_checkpoint_count_mismatch');
  }

  const restored = new ProviderNeutralFanoutPreparationDurableCheckpoint(checkpointInput, options);
  const initial = restored.snapshot();
  const identities = [
    ['action_id', String(saved.action_id ?? ''), initial.action_id],
    ['action_digest', requireDigest(saved.action_digest, 'action_digest'), initial.action_digest],
    ['checkpoint_digest', requireDigest(saved.checkpoint_digest, 'upstream_digest'), initial.checkpoint_digest],
    ['issuance_manifest_digest', requireDigest(saved.issuance_manifest_digest, 'issuance_manifest_digest'), initial.issuance_manifest_digest],
    ['preparation_shards_digest', requireDigest(saved.preparation_shards_digest, 'preparation_shards_digest'), initial.preparation_shards_digest],
  ];
  for (const [name, actual, expected] of identities) {
    if (actual !== expected) throw new Error(`fanout_preparation_checkpoint_${name}_mismatch`);
  }
  if (expectedCount !== initial.expected_count) throw new Error('fanout_preparation_checkpoint_expected_count_mismatch');

  const indexes = new Set();
  for (const entry of saved.entries) {
    const fanoutIndex = Number(entry?.fanout_index);
    if (!Number.isSafeInteger(fanoutIndex) || indexes.has(fanoutIndex)) {
      throw new Error('fanout_preparation_checkpoint_entry_index_invalid');
    }
    indexes.add(fanoutIndex);
    restored.accept({
      fanout_index: fanoutIndex,
      shard_index: entry.shard_index,
      target_binding_digest: entry.target_binding_digest,
      issuance_entry_digest: entry.issuance_entry_digest,
      prepared_command_digest: entry.prepared_command_digest,
    });
  }

  const replayed = checkpointCore(restored.snapshot());
  if (digest(replayed) !== requireDigest(saved.preparation_checkpoint_digest, 'digest')) {
    throw new Error('fanout_preparation_checkpoint_digest_mismatch');
  }
  return restored;
}

export function providerNeutralFanoutPreparationDurableCheckpointContract() {
  return Object.freeze({
    ...providerNeutralFanoutPreparationAccumulatorContract(),
    schema: 'metaengine.browser.provider-neutral-fanout-preparation-durable-checkpoint-contract.v1',
    deterministic_checkpoint_digest: true,
    restart_restore_supported: true,
    upstream_projection_fenced: true,
    prepared_entry_collision_fence_preserved: true,
    ready_shard_state_reconstructed: true,
    prepared_command_digest_only: true,
    payload_persisted: false,
    semantic_payload_persisted: false,
  });
}
