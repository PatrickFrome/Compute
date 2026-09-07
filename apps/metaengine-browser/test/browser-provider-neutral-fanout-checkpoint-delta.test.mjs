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

function state(count = 4) {
  return new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: count });
}

test('creates append-only compact delta and applies it to exact base', () => {
  const baseState = state();
  baseState.accept(receipt(0));
  const base = baseState.checkpoint();

  const nextState = state();
  nextState.accept(receipt(0));
  nextState.accept(receipt(2, 'AMBIGUOUS'));
  nextState.accept(receipt(3, 'BLOCKED'));
  const next = nextState.checkpoint();

  const delta = createProviderNeutralFanoutCheckpointDelta(base, next);
  assert.equal(delta.added_count, 2);
  assert.deepEqual(delta.added_receipts.map((entry) => entry.fanout_index), [2, 3]);
  assert.equal('payload' in delta, false);
  assert.equal(JSON.stringify(delta).includes('semantic_payload'), true);
  assert.deepEqual(applyProviderNeutralFanoutCheckpointDelta(base, delta), next);
});

test('rejects stale base, mutation and non-monotonic checkpoints', () => {
  const baseState = state(2);
  baseState.accept(receipt(0));
  const base = baseState.checkpoint();

  const nextState = state(2);
  nextState.accept(receipt(0));
  nextState.accept(receipt(1, 'REJECTED'));
  const next = nextState.checkpoint();
  const delta = createProviderNeutralFanoutCheckpointDelta(base, next);

  assert.throws(() => applyProviderNeutralFanoutCheckpointDelta({ ...base, checkpoint_digest: '0'.repeat(64) }, delta), /fanout_checkpoint_digest_mismatch/);

  const mutatedState = state(2);
  mutatedState.accept(receipt(0, 'BLOCKED'));
  mutatedState.accept(receipt(1));
  assert.throws(() => createProviderNeutralFanoutCheckpointDelta(base, mutatedState.checkpoint()), /fanout_checkpoint_delta_receipt_collision/);

  assert.throws(() => createProviderNeutralFanoutCheckpointDelta(next, base), /fanout_checkpoint_delta_non_monotonic/);
});

test('rejects tampered next digest after bounded replay', () => {
  const baseState = state(2);
  const base = baseState.checkpoint();
  const nextState = state(2);
  nextState.accept(receipt(1));
  const delta = createProviderNeutralFanoutCheckpointDelta(base, nextState.checkpoint());
  assert.throws(() => applyProviderNeutralFanoutCheckpointDelta(base, {
    ...delta,
    next_checkpoint_digest: '0'.repeat(64),
  }), /fanout_checkpoint_delta_next_digest_mismatch/);
});

test('contract preserves zero authority and no blind retry', () => {
  const contract = providerNeutralFanoutCheckpointDeltaContract();
  assert.equal(contract.max_fanout, 128);
  assert.equal(contract.append_only, true);
  assert.equal(contract.base_digest_fenced, true);
  assert.equal(contract.next_digest_verified, true);
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
