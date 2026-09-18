import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderNeutralFanoutDurableCheckpoint,
  providerNeutralFanoutDurableCheckpointContract,
  restoreProviderNeutralFanoutDurableCheckpoint,
} from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';

const actionId = 'fanout-checkpoint-1';
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

test('exports deterministic bounded checkpoint without semantic payload', () => {
  const state = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 3 });
  state.accept(receipt(2, 'AMBIGUOUS'));
  state.accept(receipt(0));

  const checkpoint = state.checkpoint();
  assert.equal(checkpoint.received_count, 2);
  assert.equal(checkpoint.pending_count, 1);
  assert.deepEqual(checkpoint.counts, { APPLIED: 1, REJECTED: 0, AMBIGUOUS: 1, BLOCKED: 0 });
  assert.deepEqual(checkpoint.receipts.map((entry) => entry.fanout_index), [0, 2]);
  assert.match(checkpoint.checkpoint_digest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(checkpoint).includes('payload'), true);
  assert.equal('payload' in checkpoint.receipts[0], false);
  assert.deepEqual(checkpoint.retry_candidates, []);
});

test('restores crash-safe receipt fences and continues accumulation', () => {
  const state = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 3 });
  state.accept(receipt(0));
  state.accept(receipt(2, 'BLOCKED'));

  const restored = restoreProviderNeutralFanoutDurableCheckpoint(state.checkpoint());
  assert.deepEqual(restored.accept(receipt(0)), { accepted: false, duplicate: true, complete: false });
  const final = restored.accept(receipt(1, 'REJECTED'));
  assert.equal(final.complete, true);
  assert.deepEqual(restored.snapshot().counts, { APPLIED: 1, REJECTED: 1, AMBIGUOUS: 0, BLOCKED: 1 });
});

test('restore rejects tampered receipt and checkpoint digests', () => {
  const state = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 2 });
  state.accept(receipt(0));
  const checkpoint = state.checkpoint();

  assert.throws(() => restoreProviderNeutralFanoutDurableCheckpoint({
    ...checkpoint,
    receipts: [{ ...checkpoint.receipts[0], outcome: 'BLOCKED' }],
  }), /fanout_checkpoint_receipt_digest_mismatch/);

  assert.throws(() => restoreProviderNeutralFanoutDurableCheckpoint({
    ...checkpoint,
    checkpoint_digest: '0'.repeat(64),
  }), /fanout_checkpoint_digest_mismatch/);
});

test('contract preserves zero authority and no blind retry', () => {
  const contract = providerNeutralFanoutDurableCheckpointContract();
  assert.equal(contract.max_fanout, 128);
  assert.equal(contract.restart_restore_supported, true);
  assert.equal(contract.receipt_collision_fence_preserved, true);
  assert.equal(contract.payload_persisted, false);
  assert.equal(contract.semantic_payload_persisted, false);
  assert.equal(contract.scheduler_authority, false);
  assert.equal(contract.dispatch_authority, false);
  assert.equal(contract.lease_authority, false);
  assert.equal(contract.effect_execution_authority, false);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.ambiguous_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});
