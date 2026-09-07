import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  projectProviderNeutralFanoutIssuanceWindow,
  providerNeutralFanoutIssuanceWindowContract,
} from '../src/browser-provider-neutral-fanout-issuance-window.mjs';

const actionId = 'fanout-issuance-window-1';
const actionDigest = 'c'.repeat(64);

function receipt(index, outcome = 'APPLIED') {
  return {
    action_id: actionId,
    action_digest: actionDigest,
    fanout_index: index,
    target_binding_digest: String(index + 1).padStart(64, '0'),
    outcome,
    effect_proof_digest: outcome === 'APPLIED' ? 'd'.repeat(64) : null,
  };
}

function checkpoint(received = 0, expected = 8) {
  const durable = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: expected });
  for (let index = 0; index < received; index += 1) durable.accept(receipt(index));
  return durable.checkpoint();
}

function project(saved, issuedCount, requestedCount, maxParallel) {
  return projectProviderNeutralFanoutIssuanceWindow(saved, {
    issued_count: issuedCount,
    requested_count: requestedCount,
    max_parallel: maxParallel,
  });
}

test('projects deterministic contiguous issuance indices from available capacity', () => {
  const window = project(checkpoint(2), 5, 6, 4);
  assert.equal(window.projected_count, 1);
  assert.equal(window.start_index, 5);
  assert.equal(window.end_exclusive, 6);
  assert.deepEqual(window.indices, [5]);
});

test('never projects beyond remaining unissued fanout', () => {
  const window = project(checkpoint(7), 7, 8, 8);
  assert.equal(window.projected_count, 1);
  assert.deepEqual(window.indices, [7]);
  assert.equal(window.end_exclusive, 8);
});

test('zero available capacity produces an empty zero-authority window', () => {
  const window = project(checkpoint(0), 4, 3, 4);
  assert.equal(window.projected_count, 0);
  assert.equal(window.start_index, 4);
  assert.equal(window.end_exclusive, 4);
  assert.deepEqual(window.indices, []);
});

test('window digest binds exact checkpoint and capacity projection', () => {
  const saved = checkpoint(2);
  const left = project(saved, 3, 4, 5);
  const right = project(saved, 3, 4, 5);
  assert.equal(left.issuance_window_digest, right.issuance_window_digest);
  assert.equal(left.capacity_projection_digest, right.capacity_projection_digest);
  assert.equal(left.checkpoint_digest, saved.checkpoint_digest);
  assert.equal(left.issuance_window_digest.length, 64);
  assert.notEqual(project(saved, 4, 4, 5).issuance_window_digest, left.issuance_window_digest);
});

test('inherits fail-closed checkpoint and issuance validation', () => {
  const saved = checkpoint(2, 4);
  assert.throws(() => project(saved, 1, 1, 2), /fanout_capacity_issued_count_inconsistent/);
  assert.throws(() => project(saved, 5, 1, 2), /fanout_capacity_issued_count_inconsistent/);
  assert.throws(
    () => project({ ...saved, checkpoint_digest: '0'.repeat(64) }, 2, 1, 2),
    /fanout_checkpoint_digest_mismatch/,
  );
});

test('contract preserves provider neutrality and grants no reservation or effect authority', () => {
  const contract = providerNeutralFanoutIssuanceWindowContract();
  assert.equal(contract.capacity_projection_digest_fenced, true);
  assert.equal(contract.deterministic_contiguous_indices, true);
  assert.equal(contract.bounded_projection_only, true);
  assert.equal(contract.provider_neutral, true);
  for (const field of [
    'queue_persisted',
    'reservation_authority',
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
