import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  projectProviderNeutralFanoutPreparedManifest,
  providerNeutralFanoutPreparedManifestContract,
} from '../src/browser-provider-neutral-fanout-prepared-manifest.mjs';

const actionId = 'fanout-prepared-manifest-1';
const actionDigest = 'a'.repeat(64);
const targets = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)];
const prepared = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)];

function checkpoint(expectedCount = 4) {
  return new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount }).checkpoint();
}

function projection(overrides = {}) {
  return projectProviderNeutralFanoutPreparedManifest(checkpoint(), {
    issued_count: 0,
    requested_count: 4,
    max_parallel: 4,
    target_binding_digests: targets,
    shard_count: 2,
    prepared_command_digests: prepared,
    ...overrides,
  });
}

test('binds every prepared command digest to exact target and preparation shard membership', () => {
  const projected = projection();
  assert.equal(projected.prepared_count, 4);
  assert.deepEqual(projected.entries.map((entry) => entry.fanout_index), [0, 1, 2, 3]);
  assert.deepEqual(projected.entries.map((entry) => entry.shard_index), [0, 1, 0, 1]);
  assert.deepEqual(projected.entries.map((entry) => entry.target_binding_digest), targets);
  assert.deepEqual(projected.entries.map((entry) => entry.prepared_command_digest), prepared);
});

test('aggregate digest is deterministic and changes with prepared command identity', () => {
  const left = projection();
  const same = projection();
  const changed = projection({ prepared_command_digests: [...prepared.slice(0, 3), 'f'.repeat(64)] });
  assert.equal(left.prepared_manifest_digest, same.prepared_manifest_digest);
  assert.notEqual(left.prepared_manifest_digest, changed.prepared_manifest_digest);
  assert.notEqual(left.entries[3].prepared_entry_digest, changed.entries[3].prepared_entry_digest);
});

test('fails closed on incomplete or malformed prepared digest sets before producing a manifest', () => {
  assert.throws(() => projection({ prepared_command_digests: prepared.slice(0, 3) }), /count_mismatch/);
  assert.throws(() => projection({ prepared_command_digests: [...prepared.slice(0, 3), 'not-a-digest'] }), /digest_invalid/);
});

test('zero-capacity preparation requires no prepared digests and remains empty', () => {
  const projected = projectProviderNeutralFanoutPreparedManifest(checkpoint(), {
    issued_count: 4,
    requested_count: 1,
    max_parallel: 4,
    target_binding_digests: [],
    shard_count: 4,
    prepared_command_digests: [],
  });
  assert.equal(projected.prepared_count, 0);
  assert.deepEqual(projected.entries, []);
});

test('contract remains provider-neutral preparation evidence with zero execution authority', () => {
  const contract = providerNeutralFanoutPreparedManifestContract();
  assert.equal(contract.exact_preparation_membership_fenced, true);
  assert.equal(contract.target_binding_preserved, true);
  assert.equal(contract.prepared_command_digest_only, true);
  assert.equal(contract.preparation_only, true);
  assert.equal(contract.provider_neutral, true);
  for (const field of [
    'command_payload_persisted', 'payload_persisted', 'semantic_payload_persisted', 'reservation_authority',
    'scheduler_authority', 'dispatch_authority', 'lease_authority', 'effect_execution_authority',
    'automatic_retry_allowed', 'ambiguous_retry_allowed', 'authority_effect',
  ]) {
    assert.equal(contract[field], false, field);
  }
});
