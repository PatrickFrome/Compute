import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  applyProviderNeutralFanoutCheckpointDelta,
  createProviderNeutralFanoutCheckpointDelta,
  providerNeutralFanoutCheckpointDeltaContract,
} from '../src/browser-provider-neutral-fanout-checkpoint-delta.mjs';

const actionId = 'fanout-delta-1';
const actionDigest = 'a'.repeat(64);

function receipt(index, outcome = 'APPLIED') {
  return {
    action_id: actionId,
    action_digest: actionDigest,
    fanout_index: index,
    target_binding_digest: String(index + 1).padStart(64, '0'),
    outcome,
    effect_proof_digest: outcome === 'APPLIED' ? 'b'.repeat(64) : null,
  };
}

function checkpoint(entries = [], count = 4) {
  const durable = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: count });
  for (const [index, outcome] of entries) durable.accept(receipt(index, outcome));
  return durable.checkpoint();
}

test('creates append-only compact delta and applies it to exact base', () => {
  const base = checkpoint([[0]]);
  const next = checkpoint([[0], [2, 'AMBIGUOUS'], [3, 'BLOCKED']]);
  const delta = createProviderNeutralFanoutCheckpointDelta(base, next);

  assert.equal(delta.added_count, 2);
  assert.deepEqual(delta.added_receipts.map((entry) => entry.fanout_index), [2, 3]);
  assert.equal('payload' in delta, false);
  assert.equal(JSON.stringify(delta).includes('semantic_payload'), true);
  assert.deepEqual(applyProviderNeutralFanoutCheckpointDelta(base, delta), next);
});

test('rejects stale base, mutation and non-monotonic checkpoints', () => {
  const base = checkpoint([[0]], 2);
  const next = checkpoint([[0], [1, 'REJECTED']], 2);
  const delta = createProviderNeutralFanoutCheckpointDelta(base, next);

  assert.throws(() => applyProviderNeutralFanoutCheckpointDelta({ ...base, checkpoint_digest: '0'.repeat(64) }, delta), /fanout_checkpoint_digest_mismatch/);
  assert.throws(
    () => createProviderNeutralFanoutCheckpointDelta(base, checkpoint([[0, 'BLOCKED'], [1]], 2)),
    /fanout_checkpoint_delta_receipt_collision/,
  );
  assert.throws(() => createProviderNeutralFanoutCheckpointDelta(next, base), /fanout_checkpoint_delta_non_monotonic/);
});

test('rejects tampered next digest after bounded replay', () => {
  const base = checkpoint([], 2);
  const delta = createProviderNeutralFanoutCheckpointDelta(base, checkpoint([[1]], 2));
  assert.throws(() => applyProviderNeutralFanoutCheckpointDelta(base, {
    ...delta,
    next_checkpoint_digest: '0'.repeat(64),
  }), /fanout_checkpoint_delta_next_digest_mismatch/);
});

test('contract preserves zero authority and no blind retry', () => {
  const contract = providerNeutralFanoutCheckpointDeltaContract();
  assert.deepEqual(
    {
      max_fanout: contract.max_fanout,
      append_only: contract.append_only,
      base_digest_fenced: contract.base_digest_fenced,
      next_digest_verified: contract.next_digest_verified,
      receipt_collision_fence_preserved: contract.receipt_collision_fence_preserved,
    },
    {
      max_fanout: 128,
      append_only: true,
      base_digest_fenced: true,
      next_digest_verified: true,
      receipt_collision_fence_preserved: true,
    },
  );
  for (const field of [
    'payload_persisted',
    'semantic_payload_persisted',
    'scheduler_authority',
    'dispatch_authority',
    'lease_authority',
    'effect_execution_authority',
    'automatic_retry_allowed',
    'ambiguous_retry_allowed',
    'authority_effect',
  ]) assert.equal(contract[field], false, field);
});
