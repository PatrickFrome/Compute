import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderNeutralFanoutReceiptAccumulator,
  providerNeutralFanoutReceiptAccumulatorContract,
} from '../src/browser-provider-neutral-fanout-receipt-accumulator.mjs';

const actionId = 'fanout-action-accumulator-1';
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

test('accepts receipts incrementally and exposes compact bounded completion state', () => {
  const accumulator = new ProviderNeutralFanoutReceiptAccumulator({ actionId, actionDigest, expectedCount: 10 });
  assert.deepEqual(accumulator.accept(receipt(0)), { accepted: true, duplicate: false, complete: false });
  assert.deepEqual(accumulator.accept(receipt(9, 'AMBIGUOUS')), { accepted: true, duplicate: false, complete: false });

  const snapshot = accumulator.snapshot();
  assert.equal(snapshot.received_count, 2);
  assert.equal(snapshot.pending_count, 8);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.received_bitmap_hex, '0102');
  assert.deepEqual(snapshot.counts, { APPLIED: 1, REJECTED: 0, AMBIGUOUS: 1, BLOCKED: 0 });
  assert.deepEqual(snapshot.retry_candidates, []);
  assert.equal('payload' in snapshot, false);
  assert.equal('receipts' in snapshot, false);
});

test('duplicate delivery is idempotent while conflicting delivery fails closed', () => {
  const accumulator = new ProviderNeutralFanoutReceiptAccumulator({ actionId, actionDigest, expectedCount: 2 });
  const first = receipt(0);
  accumulator.accept(first);
  assert.deepEqual(accumulator.accept(first), { accepted: false, duplicate: true, complete: false });
  assert.deepEqual(accumulator.snapshot().counts, { APPLIED: 1, REJECTED: 0, AMBIGUOUS: 0, BLOCKED: 0 });

  assert.throws(() => accumulator.accept({ ...first, outcome: 'REJECTED', effect_proof_digest: null }), /fanout_accumulator_receipt_collision/);
});

test('exact action identity and bounded fanout index are fenced before state mutation', () => {
  const accumulator = new ProviderNeutralFanoutReceiptAccumulator({ actionId, actionDigest, expectedCount: 2 });
  assert.throws(() => accumulator.accept({ ...receipt(0), action_id: 'different' }), /fanout_accumulator_action_mismatch/);
  assert.throws(() => accumulator.accept(receipt(2)), /fanout_accumulator_index_out_of_range/);
  assert.equal(accumulator.snapshot().received_count, 0);
});

test('completion counts every explicit outcome without synthesizing retries', () => {
  const accumulator = new ProviderNeutralFanoutReceiptAccumulator({ actionId, actionDigest, expectedCount: 4 });
  accumulator.accept(receipt(0, 'APPLIED'));
  accumulator.accept(receipt(1, 'REJECTED'));
  accumulator.accept(receipt(2, 'AMBIGUOUS'));
  assert.deepEqual(accumulator.accept(receipt(3, 'BLOCKED')), { accepted: true, duplicate: false, complete: true });

  const snapshot = accumulator.snapshot();
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.pending_count, 0);
  assert.deepEqual(snapshot.counts, { APPLIED: 1, REJECTED: 1, AMBIGUOUS: 1, BLOCKED: 1 });
  assert.deepEqual(snapshot.retry_candidates, []);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.ambiguous_retry_allowed, false);
});

test('contract is O(1), bounded and has zero scheduling/effect authority', () => {
  const contract = providerNeutralFanoutReceiptAccumulatorContract();
  assert.equal(contract.max_fanout, 128);
  assert.equal(contract.incremental_accept_complexity, 'O(1)');
  assert.equal(contract.bounded_memory, true);
  assert.equal(contract.compact_received_bitmap, true);
  assert.equal(contract.payload_persisted, false);
  assert.equal(contract.scheduler_authority, false);
  assert.equal(contract.dispatch_authority, false);
  assert.equal(contract.lease_authority, false);
  assert.equal(contract.effect_execution_authority, false);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.ambiguous_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});
