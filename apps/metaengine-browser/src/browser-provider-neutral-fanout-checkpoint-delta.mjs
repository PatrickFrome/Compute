import { restoreProviderNeutralFanoutDurableCheckpoint } from './browser-provider-neutral-fanout-durable-checkpoint.mjs';

const SCHEMA = 'metaengine.browser.provider-neutral-fanout-checkpoint-delta.v1';
const MAX_FANOUT = 128;

function requiredString(value, name, max = 160) {
  const out = String(value ?? '').slice(0, max).trim();
  if (!out) throw new Error(`fanout_checkpoint_delta_${name}_required`);
  return out;
}

function validatedCheckpoint(input) {
  const restored = restoreProviderNeutralFanoutDurableCheckpoint(input);
  return { checkpoint: restored.checkpoint(), restored };
}

function identity(checkpoint) {
  return `${checkpoint.action_id}:${checkpoint.action_digest}:${checkpoint.expected_count}`;
}

function receiptMap(checkpoint) {
  return new Map(checkpoint.receipts.map((receipt) => [receipt.fanout_index, receipt]));
}

export function createProviderNeutralFanoutCheckpointDelta(baseInput, nextInput) {
  const { checkpoint: base } = validatedCheckpoint(baseInput);
  const { checkpoint: next } = validatedCheckpoint(nextInput);
  if (identity(base) !== identity(next)) throw new Error('fanout_checkpoint_delta_identity_mismatch');

  const before = receiptMap(base);
  const added = [];
  for (const receipt of next.receipts) {
    const existing = before.get(receipt.fanout_index);
    if (existing) {
      if (existing.receipt_digest !== receipt.receipt_digest) {
        throw new Error('fanout_checkpoint_delta_receipt_collision');
      }
      continue;
    }
    added.push(receipt);
  }
  if (next.received_count < base.received_count || added.length !== next.received_count - base.received_count) {
    throw new Error('fanout_checkpoint_delta_non_monotonic');
  }

  return Object.freeze({
    schema: SCHEMA,
    action_id: base.action_id,
    action_digest: base.action_digest,
    expected_count: base.expected_count,
    base_checkpoint_digest: base.checkpoint_digest,
    next_checkpoint_digest: next.checkpoint_digest,
    added_receipts: Object.freeze(added.sort((a, b) => a.fanout_index - b.fanout_index)),
    added_count: added.length,
    payload_persisted: false,
    semantic_payload_persisted: false,
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  });
}

export function applyProviderNeutralFanoutCheckpointDelta(baseInput, delta = {}) {
  if (delta.schema !== SCHEMA) throw new Error('fanout_checkpoint_delta_schema_invalid');
  const { checkpoint: base, restored } = validatedCheckpoint(baseInput);
  if (requiredString(delta.base_checkpoint_digest, 'base_checkpoint_digest', 64) !== base.checkpoint_digest) {
    throw new Error('fanout_checkpoint_delta_base_digest_mismatch');
  }
  if (requiredString(delta.action_id, 'action_id') !== base.action_id
    || requiredString(delta.action_digest, 'action_digest', 64) !== base.action_digest
    || Number(delta.expected_count) !== base.expected_count) {
    throw new Error('fanout_checkpoint_delta_identity_mismatch');
  }
  if (!Array.isArray(delta.added_receipts) || delta.added_receipts.length > MAX_FANOUT) {
    throw new Error('fanout_checkpoint_delta_receipts_invalid');
  }

  for (const saved of delta.added_receipts) {
    restored.accept({
      action_id: base.action_id,
      action_digest: base.action_digest,
      fanout_index: saved.fanout_index,
      target_binding_digest: saved.target_binding_digest,
      outcome: saved.outcome,
      effect_proof_digest: saved.effect_proof_digest,
      receipt_digest: saved.receipt_digest,
    });
  }
  const next = restored.checkpoint();
  if (next.checkpoint_digest !== requiredString(delta.next_checkpoint_digest, 'next_checkpoint_digest', 64)) {
    throw new Error('fanout_checkpoint_delta_next_digest_mismatch');
  }
  return next;
}

export function providerNeutralFanoutCheckpointDeltaContract() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-fanout-checkpoint-delta-contract.v1',
    max_fanout: MAX_FANOUT,
    append_only: true,
    base_digest_fenced: true,
    next_digest_verified: true,
    receipt_collision_fence_preserved: true,
    payload_persisted: false,
    semantic_payload_persisted: false,
    scheduler_authority: false,
    dispatch_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    ambiguous_retry_allowed: false,
    authority_effect: false,
  });
}
