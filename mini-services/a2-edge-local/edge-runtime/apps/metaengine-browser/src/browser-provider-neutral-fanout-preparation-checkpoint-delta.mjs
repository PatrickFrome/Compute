import {
  providerNeutralFanoutPreparationDurableCheckpointContract,
  restoreProviderNeutralFanoutPreparationDurableCheckpoint,
} from './browser-provider-neutral-fanout-preparation-durable-checkpoint.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-preparation-checkpoint-delta.v1';
const MAX_FANOUT = 128;
const MAX_DELTAS = 128;

function validated(checkpointInput, options, saved) {
  const restored = restoreProviderNeutralFanoutPreparationDurableCheckpoint(checkpointInput, options, saved);
  return { restored, checkpoint: restored.checkpoint() };
}

function identity(checkpoint) {
  return [
    checkpoint.action_id,
    checkpoint.action_digest,
    checkpoint.checkpoint_digest,
    checkpoint.issuance_manifest_digest,
    checkpoint.preparation_shards_digest,
    checkpoint.expected_count,
  ].join(':');
}

function entryMap(checkpoint) {
  return new Map(checkpoint.entries.map((entry) => [entry.fanout_index, entry]));
}

function requireDigest(value, name) {
  const normalized = String(value ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`fanout_preparation_delta_${name}_invalid`);
  return normalized;
}

function requireDeltaForCheckpoint(delta, checkpoint) {
  if (delta?.schema !== SCHEMA) throw new Error('fanout_preparation_delta_schema_invalid');
  if (requireDigest(delta.base_preparation_checkpoint_digest, 'base_digest') !== checkpoint.preparation_checkpoint_digest) {
    throw new Error('fanout_preparation_delta_base_digest_mismatch');
  }
  if (String(delta.action_id ?? '') !== checkpoint.action_id
    || requireDigest(delta.action_digest, 'action_digest') !== checkpoint.action_digest
    || Number(delta.expected_count) !== checkpoint.expected_count) {
    throw new Error('fanout_preparation_delta_identity_mismatch');
  }
  if (!Array.isArray(delta.added_entries) || delta.added_entries.length > MAX_FANOUT) {
    throw new Error('fanout_preparation_delta_entries_invalid');
  }
}

function deltaFromCheckpoints(base, next) {
  if (identity(base) !== identity(next)) throw new Error('fanout_preparation_delta_identity_mismatch');

  const before = entryMap(base);
  const added = [];
  for (const entry of next.entries) {
    const prior = before.get(entry.fanout_index);
    if (prior) {
      if (prior.prepared_entry_digest !== entry.prepared_entry_digest) {
        throw new Error('fanout_preparation_delta_entry_collision');
      }
      continue;
    }
    added.push(entry);
  }
  if (next.prepared_count < base.prepared_count || added.length !== next.prepared_count - base.prepared_count) {
    throw new Error('fanout_preparation_delta_non_monotonic');
  }

  return Object.freeze({
    schema: SCHEMA,
    action_id: base.action_id,
    action_digest: base.action_digest,
    expected_count: base.expected_count,
    base_preparation_checkpoint_digest: base.preparation_checkpoint_digest,
    next_preparation_checkpoint_digest: next.preparation_checkpoint_digest,
    added_entries: Object.freeze(added.sort((left, right) => left.fanout_index - right.fanout_index)),
    added_count: added.length,
  });
}

export function createProviderNeutralFanoutPreparationCheckpointDelta(checkpointInput, options, baseSaved, nextSaved) {
  const { checkpoint: base } = validated(checkpointInput, options, baseSaved);
  const { checkpoint: next } = validated(checkpointInput, options, nextSaved);
  return deltaFromCheckpoints(base, next);
}

export function appendProviderNeutralFanoutPreparationCheckpointDeltas(checkpointInput, options, baseSaved, entryBatches = []) {
  if (!Array.isArray(entryBatches) || entryBatches.length > MAX_DELTAS) {
    throw new Error('fanout_preparation_delta_batch_invalid');
  }
  const { restored } = validated(checkpointInput, options, baseSaved);
  let current = restored.checkpoint();
  const deltas = [];
  for (const entries of entryBatches) {
    if (!Array.isArray(entries) || entries.length > MAX_FANOUT) {
      throw new Error('fanout_preparation_delta_entries_invalid');
    }
    const base = current;
    for (const entry of entries) restored.accept(entry);
    current = restored.checkpoint();
    deltas.push(deltaFromCheckpoints(base, current));
  }
  return Object.freeze({ deltas: Object.freeze(deltas), checkpoint: current });
}

export function appendProviderNeutralFanoutPreparationCheckpointDelta(checkpointInput, options, baseSaved, addedEntries = []) {
  const appended = appendProviderNeutralFanoutPreparationCheckpointDeltas(
    checkpointInput,
    options,
    baseSaved,
    [addedEntries],
  );
  return Object.freeze({ delta: appended.deltas[0], checkpoint: appended.checkpoint });
}

export function applyProviderNeutralFanoutPreparationCheckpointDeltas(checkpointInput, options, baseSaved, deltas = []) {
  if (!Array.isArray(deltas) || deltas.length > MAX_DELTAS) {
    throw new Error('fanout_preparation_delta_batch_invalid');
  }
  const { restored } = validated(checkpointInput, options, baseSaved);
  let current = restored.checkpoint();
  for (const delta of deltas) {
    requireDeltaForCheckpoint(delta, current);
    for (const entry of delta.added_entries) restored.accept(entry);
    const next = restored.checkpoint();
    if (next.preparation_checkpoint_digest !== requireDigest(delta.next_preparation_checkpoint_digest, 'next_digest')) {
      throw new Error('fanout_preparation_delta_next_digest_mismatch');
    }
    current = next;
  }
  return current;
}

export function applyProviderNeutralFanoutPreparationCheckpointDelta(checkpointInput, options, baseSaved, delta = {}) {
  return applyProviderNeutralFanoutPreparationCheckpointDeltas(checkpointInput, options, baseSaved, [delta]);
}

export function providerNeutralFanoutPreparationCheckpointDeltaContract() {
  return Object.freeze({
    ...providerNeutralFanoutPreparationDurableCheckpointContract(),
    schema: 'metaengine.browser.provider-neutral-fanout-preparation-checkpoint-delta-contract.v1',
    max_fanout: MAX_FANOUT,
    max_deltas_per_replay: MAX_DELTAS,
    append_only: true,
    base_digest_fenced: true,
    next_digest_verified: true,
    prepared_entry_collision_fence_preserved: true,
    compact_incremental_persistence: true,
    batched_replay_single_restore: true,
    append_builder_single_restore: true,
    batched_append_single_restore: true,
  });
}
