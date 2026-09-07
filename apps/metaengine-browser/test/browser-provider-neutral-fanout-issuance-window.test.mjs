import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  projectProviderNeutralFanoutIssuanceWindow,
  providerNeutralFanoutIssuanceWindowContract,
} from '../src/browser-provider-neutral-fanout-issuance-window.mjs';

const actionId = 'fanout-issuance-window-1';
const actionDigest = 'c'.repeat(64);

function savedCheckpoint(receivedCount = 0, expectedCount = 8) {
  const durable = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount });
  Array.from({ length: receivedCount }, (_, fanoutIndex) => fanoutIndex).forEach((fanoutIndex) => {
    durable.accept({
      action_id: actionId,
      action_digest: actionDigest,
      fanout_index: fanoutIndex,
      target_binding_digest: `${fanoutIndex + 1}`.padStart(64, '0'),
      outcome: 'APPLIED',
      effect_proof_digest: 'd'.repeat(64),
    });
  });
  return durable.checkpoint();
}

const issuance = (saved, issuedCount, requestedCount, maxParallel) => projectProviderNeutralFanoutIssuanceWindow(saved, {
  issued_count: issuedCount,
  requested_count: requestedCount,
  max_parallel: maxParallel,
});

test('projects deterministic contiguous issuance indices from available capacity', () => {
  const window = issuance(savedCheckpoint(2), 5, 6, 4);
  assert.deepEqual(
    { projected: window.projected_count, start: window.start_index, end: window.end_exclusive, indices: window.indices },
    { projected: 1, start: 5, end: 6, indices: [5] },
  );
});

test('never projects beyond remaining unissued fanout', () => {
  const window = issuance(savedCheckpoint(7), 7, 8, 8);
  assert.deepEqual({ projected: window.projected_count, end: window.end_exclusive, indices: window.indices }, {
    projected: 1,
    end: 8,
    indices: [7],
  });
});

test('zero available capacity produces an empty zero-authority window', () => {
  const window = issuance(savedCheckpoint(), 4, 3, 4);
  assert.deepEqual({ projected: window.projected_count, start: window.start_index, end: window.end_exclusive, indices: window.indices }, {
    projected: 0,
    start: 4,
    end: 4,
    indices: [],
  });
});

test('window digest binds exact checkpoint and capacity projection', () => {
  const saved = savedCheckpoint(2);
  const left = issuance(saved, 3, 4, 5);
  const right = issuance(saved, 3, 4, 5);
  assert.equal(left.issuance_window_digest, right.issuance_window_digest);
  assert.equal(left.capacity_projection_digest, right.capacity_projection_digest);
  assert.equal(left.checkpoint_digest, saved.checkpoint_digest);
  assert.equal(left.issuance_window_digest.length, 64);
  assert.notEqual(issuance(saved, 4, 4, 5).issuance_window_digest, left.issuance_window_digest);
});

test('inherits fail-closed checkpoint and issuance validation', () => {
  const saved = savedCheckpoint(2, 4);
  for (const issuedCount of [1, 5]) {
    assert.throws(() => issuance(saved, issuedCount, 1, 2), /fanout_capacity_issued_count_inconsistent/);
  }
  assert.throws(
    () => issuance({ ...saved, checkpoint_digest: '0'.repeat(64) }, 2, 1, 2),
    /fanout_checkpoint_digest_mismatch/,
  );
});

test('contract preserves provider neutrality and grants no reservation or effect authority', () => {
  const contract = providerNeutralFanoutIssuanceWindowContract();
  assert.deepEqual(
    [contract.capacity_projection_digest_fenced, contract.deterministic_contiguous_indices, contract.bounded_projection_only, contract.provider_neutral],
    [true, true, true, true],
  );
  const denied = [
    'queue_persisted', 'reservation_authority', 'payload_persisted', 'semantic_payload_persisted',
    'scheduler_authority', 'dispatch_authority', 'lease_authority', 'effect_execution_authority',
    'automatic_retry_allowed', 'ambiguous_retry_allowed', 'authority_effect',
  ];
  assert.deepEqual(denied.filter((field) => contract[field] !== false), []);
});
