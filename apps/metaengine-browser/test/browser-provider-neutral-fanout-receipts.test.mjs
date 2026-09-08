import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProviderNeutralFanoutReceipt,
  partitionProviderNeutralFanout,
  providerNeutralFanoutReceiptSnapshot,
  reduceProviderNeutralFanoutReceipts,
} from '../src/browser-provider-neutral-fanout-receipts.mjs';

const action = () => ({
  action_id: 'fanout-action-1',
  action: 'SEMANTIC_FOCUS',
  payload: { role: 'textbox', accessible_name: 'Message' },
});

const binding = (index) => ({
  agent_id: `agent-${index}`,
  tab_id: `tab-${index}`,
  target_id: `target-${index}`,
  agent_generation: 2,
  lease_generation: 3,
  binding_generation: 4,
});

const receipt = (index, outcome = 'APPLIED') => ({
  action_id: 'fanout-action-1',
  action_digest: 'a'.repeat(64),
  fanout_index: index,
  target_binding_digest: String(index + 1).padStart(64, '0'),
  outcome,
  effect_proof_digest: outcome === 'APPLIED' ? 'b'.repeat(64) : null,
});

test('fanout partitions deterministically into bounded transport batches without dispatch authority', () => {
  const targets = Array.from({ length: 70 }, (_, index) => binding(index));
  const batches = partitionProviderNeutralFanout(action(), targets, { batchSize: 32 });
  assert.deepEqual(batches.map((batch) => batch.items.length), [32, 32, 6]);
  assert.deepEqual(batches.map((batch) => [batch.first_fanout_index, batch.last_fanout_index]), [[0, 31], [32, 63], [64, 69]]);
  assert.equal(new Set(batches.map((batch) => batch.action_digest)).size, 1);
  assert.equal(batches.every((batch) => batch.dispatch_authority === false), true);
  assert.equal(batches.every((batch) => batch.automatic_retry_allowed === false), true);
});

test('receipt normalization persists only digests and explicit outcome, never action payload', () => {
  const normalized = normalizeProviderNeutralFanoutReceipt(receipt(0));
  assert.equal(normalized.outcome, 'APPLIED');
  assert.match(normalized.receipt_digest, /^[a-f0-9]{64}$/);
  assert.equal(normalized.payload_persisted, false);
  assert.equal('payload' in normalized, false);
  assert.equal(normalized.automatic_retry_allowed, false);
  assert.equal(normalized.ambiguous_retry_allowed, false);
});

test('receipt reduction is idempotent and reports incomplete/complete fanout without synthesizing retries', () => {
  const first = receipt(0, 'APPLIED');
  const partial = reduceProviderNeutralFanoutReceipts({
    actionId: 'fanout-action-1',
    actionDigest: 'a'.repeat(64),
    expectedCount: 3,
    receipts: [first, first, receipt(1, 'AMBIGUOUS')],
  });
  assert.equal(partial.received_count, 2);
  assert.equal(partial.pending_count, 1);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.counts, { APPLIED: 1, REJECTED: 0, AMBIGUOUS: 1, BLOCKED: 0 });
  assert.deepEqual(partial.retry_candidates, []);

  const complete = reduceProviderNeutralFanoutReceipts({
    actionId: 'fanout-action-1',
    actionDigest: 'a'.repeat(64),
    expectedCount: 3,
    receipts: [first, receipt(1, 'AMBIGUOUS'), receipt(2, 'BLOCKED')],
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.pending_count, 0);
});

test('receipt collision, action mismatch and out-of-range index fail closed', () => {
  const collision = { ...receipt(0), outcome: 'REJECTED', effect_proof_digest: null };
  assert.throws(() => reduceProviderNeutralFanoutReceipts({
    actionId: 'fanout-action-1', actionDigest: 'a'.repeat(64), expectedCount: 2, receipts: [receipt(0), collision],
  }), /fanout_receipt_collision/);
  assert.throws(() => reduceProviderNeutralFanoutReceipts({
    actionId: 'different', actionDigest: 'a'.repeat(64), expectedCount: 2, receipts: [receipt(0)],
  }), /fanout_receipt_action_mismatch/);
  assert.throws(() => reduceProviderNeutralFanoutReceipts({
    actionId: 'fanout-action-1', actionDigest: 'a'.repeat(64), expectedCount: 1, receipts: [receipt(1)],
  }), /fanout_receipt_index_out_of_range/);
});

test('contract is bounded, provider-neutral coordination only and forbids blind retry', () => {
  const snapshot = providerNeutralFanoutReceiptSnapshot();
  assert.equal(snapshot.max_batch_size, 64);
  assert.equal(snapshot.deterministic_partitioning, true);
  assert.equal(snapshot.durable_payload_persistence, false);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.dispatch_authority, false);
  assert.equal(snapshot.effect_execution_authority, false);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.ambiguous_retry_allowed, false);
  assert.equal(snapshot.authority_effect, false);
});
