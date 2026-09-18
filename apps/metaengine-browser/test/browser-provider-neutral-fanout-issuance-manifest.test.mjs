import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderNeutralFanoutDurableCheckpoint } from '../src/browser-provider-neutral-fanout-durable-checkpoint.mjs';
import {
  projectProviderNeutralFanoutIssuanceManifest,
  providerNeutralFanoutIssuanceManifestContract,
} from '../src/browser-provider-neutral-fanout-issuance-manifest.mjs';

const actionId = 'fanout-issuance-manifest-1';
const actionDigest = 'a'.repeat(64);

function checkpoint() {
  return new ProviderNeutralFanoutDurableCheckpoint({ actionId, actionDigest, expectedCount: 4 }).checkpoint();
}

function manifest(targets, issuedCount = 0, requestedCount = 2, maxParallel = 2) {
  return projectProviderNeutralFanoutIssuanceManifest(checkpoint(), {
    issued_count: issuedCount,
    requested_count: requestedCount,
    max_parallel: maxParallel,
    target_binding_digests: targets,
  });
}

test('binds exact contiguous issuance indices to provider-neutral target digests', () => {
  const projected = manifest(['1'.repeat(64), '2'.repeat(64)]);
  assert.deepEqual(projected.entries.map(({ fanout_index, target_binding_digest }) => ({ fanout_index, target_binding_digest })), [
    { fanout_index: 0, target_binding_digest: '1'.repeat(64) },
    { fanout_index: 1, target_binding_digest: '2'.repeat(64) },
  ]);
  assert.equal(projected.entries.every((entry) => entry.entry_digest.length === 64), true);
});

test('manifest digest is deterministic and target membership sensitive', () => {
  const left = manifest(['1'.repeat(64), '2'.repeat(64)]);
  const same = manifest(['1'.repeat(64), '2'.repeat(64)]);
  const changed = manifest(['1'.repeat(64), '3'.repeat(64)]);
  assert.equal(left.issuance_manifest_digest, same.issuance_manifest_digest);
  assert.notEqual(left.issuance_manifest_digest, changed.issuance_manifest_digest);
  assert.notEqual(left.entries[1].entry_digest, changed.entries[1].entry_digest);
});

test('fails closed on malformed or incomplete target binding sets', () => {
  assert.throws(() => manifest(['1'.repeat(64)]), /target_count_mismatch/);
  assert.throws(() => manifest(['1'.repeat(64), 'not-a-digest']), /target_digest_invalid/);
});

test('zero-capacity window requires no target digests and produces empty manifest', () => {
  const projected = manifest([], 2, 2, 2);
  assert.equal(projected.projected_count, 0);
  assert.deepEqual(projected.entries, []);
});

test('contract remains provider-neutral and grants no scheduling or effect authority', () => {
  const contract = providerNeutralFanoutIssuanceManifestContract();
  assert.equal(contract.target_binding_digest_fenced, true);
  assert.equal(contract.exact_window_membership_fenced, true);
  assert.equal(contract.provider_neutral, true);
  for (const field of [
    'command_payload_persisted', 'payload_persisted', 'semantic_payload_persisted', 'reservation_authority',
    'scheduler_authority', 'dispatch_authority', 'lease_authority', 'effect_execution_authority',
    'automatic_retry_allowed', 'ambiguous_retry_allowed', 'authority_effect',
  ]) {
    assert.equal(contract[field], false, field);
  }
});
