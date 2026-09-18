import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  projectProviderNeutralFanoutCapacity,
  providerNeutralFanoutCapacityProjectionContract,
} from '../src/browser-provider-neutral-fanout-capacity-projection.mjs';

const actionId = 'fanout-capacity-1';
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

function checkpoint(received = 0, expected = 8) {
  const durable = new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: expected });
  for (let index = 0; index < received; index += 1) durable.accept(receipt(index));
  return durable.checkpoint();
}

function project(saved, issuedCount, requestedCount, maxParallel) {
  return projectProviderNeutralFanoutCapacity(saved, {
    issued_count: issuedCount,
    requested_count: requestedCount,
    max_parallel: maxParallel,
  });
}

test('projects only currently available fanout credits', () => {
  const projection = project(checkpoint(2), 5, 6, 4);
  assert.deepEqual(
    {
      in_flight: projection.in_flight,
      available_credits: projection.available_credits,
      remaining_unissued: projection.remaining_unissued,
      projected_count: projection.projected_count,
      deferred_count: projection.deferred_count,
    },
    { in_flight: 3, available_credits: 1, remaining_unissued: 3, projected_count: 1, deferred_count: 5 },
  );
});

test('terminal receipts release capacity without exceeding remaining fanout', () => {
  const first = project(checkpoint(1), 4, 4, 4);
  const later = project(checkpoint(3), 4, 4, 4);
  assert.equal(first.projected_count, 1);
  assert.equal(later.projected_count, 3);
  assert.equal(project(checkpoint(7), 7, 8, 8).projected_count, 1);
});

test('zero capacity stays advisory and defers the full request', () => {
  const projection = project(checkpoint(0), 4, 3, 4);
  assert.equal(projection.projected_count, 0);
  assert.equal(projection.deferred_count, 3);
});

test('rejects inconsistent or malformed issuance before projection', () => {
  const saved = checkpoint(2, 4);
  assert.throws(() => project(saved, 1, 1, 2), /fanout_capacity_issued_count_inconsistent/);
  assert.throws(() => project(saved, 5, 1, 2), /fanout_capacity_issued_count_inconsistent/);
  assert.throws(() => project(saved, 2.5, 1, 2), /fanout_capacity_issued_count_invalid/);
  assert.throws(() => project(saved, 2, 1, 0), /fanout_capacity_max_parallel_invalid/);
});

test('projection digest is deterministic and checkpoint fenced', () => {
  const saved = checkpoint(2);
  const left = project(saved, 3, 4, 5);
  const right = project(saved, 3, 4, 5);
  assert.equal(left.projection_digest, right.projection_digest);
  assert.equal(left.checkpoint_digest, saved.checkpoint_digest);
  assert.equal(left.projection_digest.length, 64);
  assert.throws(
    () => project({ ...saved, checkpoint_digest: '0'.repeat(64) }, 3, 4, 5),
    /fanout_checkpoint_digest_mismatch/,
  );
});

test('contract preserves provider neutrality and zero authority', () => {
  const contract = providerNeutralFanoutCapacityProjectionContract();
  assert.equal(contract.max_fanout, 128);
  assert.equal(contract.checkpoint_digest_fenced, true);
  assert.equal(contract.bounded_projection_only, true);
  assert.equal(contract.provider_neutral, true);
  for (const field of [
    'queue_persisted',
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
