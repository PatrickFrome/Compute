import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderNeutralFanoutProgressStream,
  providerNeutralFanoutProgressStreamContract,
} from '../src/browser-provider-neutral-fanout-progress-stream.mjs';

const actionId = 'fanout-progress-1';
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

test('emits one compact monotonic progress event per new receipt', () => {
  const stream = new ProviderNeutralFanoutProgressStream({ actionId, actionDigest, expectedCount: 3 });
  const first = stream.accept(receipt(2, 'AMBIGUOUS'));
  assert.equal(first.progress_event.sequence, 1);
  assert.equal(first.progress_event.received_count, 1);
  assert.equal(first.progress_event.pending_count, 2);
  assert.equal(first.progress_event.outcome, 'AMBIGUOUS');
  assert.deepEqual(first.progress_event.retry_candidates, []);
  assert.equal('payload' in first.progress_event, false);

  const second = stream.accept(receipt(0));
  assert.equal(second.progress_event.sequence, 2);
  assert.equal(second.progress_event.received_count, 2);
  assert.deepEqual(second.progress_event.counts, { APPLIED: 1, REJECTED: 0, AMBIGUOUS: 1, BLOCKED: 0 });
});

test('duplicate delivery emits no second progress event', () => {
  const stream = new ProviderNeutralFanoutProgressStream({ actionId, actionDigest, expectedCount: 2 });
  const value = receipt(0);
  stream.accept(value);
  assert.deepEqual(stream.accept(value), {
    accepted: false,
    duplicate: true,
    progress_event: null,
    complete: false,
  });
  assert.equal(stream.snapshot().progress_sequence, 1);
});

test('completion event exposes bounded counts without retry synthesis', () => {
  const stream = new ProviderNeutralFanoutProgressStream({ actionId, actionDigest, expectedCount: 2 });
  stream.accept(receipt(0, 'REJECTED'));
  const last = stream.accept(receipt(1, 'BLOCKED'));
  assert.equal(last.complete, true);
  assert.equal(last.progress_event.complete, true);
  assert.equal(last.progress_event.pending_count, 0);
  assert.deepEqual(last.progress_event.counts, { APPLIED: 0, REJECTED: 1, AMBIGUOUS: 0, BLOCKED: 1 });
  assert.equal(last.progress_event.automatic_retry_allowed, false);
});

test('contract is bounded provider-neutral observation with zero authority', () => {
  const contract = providerNeutralFanoutProgressStreamContract();
  assert.equal(contract.max_fanout, 128);
  assert.equal(contract.one_event_per_new_receipt, true);
  assert.equal(contract.duplicate_event_suppression, true);
  assert.equal(contract.monotonic_sequence, true);
  assert.equal(contract.payload_persisted, false);
  assert.equal(contract.scheduler_authority, false);
  assert.equal(contract.dispatch_authority, false);
  assert.equal(contract.lease_authority, false);
  assert.equal(contract.effect_execution_authority, false);
  assert.equal(contract.automatic_retry_allowed, false);
  assert.equal(contract.ambiguous_retry_allowed, false);
  assert.equal(contract.authority_effect, false);
});
