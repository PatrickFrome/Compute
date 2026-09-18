import assert from 'node:assert/strict';
import test from 'node:test';
import { LeaseBroker, LEASE_KINDS } from '../../browser-shared/lease-broker.mjs';

const broker = new LeaseBroker({ supervisorKey: 'test-key', defaultTtlMs: 60000, clockSkewMs: 5000 });

test('issues a lease with valid kind', () => {
  const lease = broker.issue({ resourceId: 'target-1', kind: 'ACTION_CLICK', targetId: 'target-1', profileId: 'p1', contextId: 'c1' });
  assert.equal(lease.lease_id.length, 36);
  assert.equal(lease.kind, 'ACTION_CLICK');
  assert.equal(lease.resource_id, 'target-1');
  assert.equal(lease.target_id, 'target-1');
  assert.ok(lease.hmac && lease.hmac.length === 64);
  assert.ok(lease.issued_at);
  assert.ok(lease.not_after);
});

test('rejects invalid kind on issue', () => {
  assert.throws(() => broker.issue({ resourceId: 'r', kind: 'INVALID' }), /lease_kind_invalid/);
});

test('rejects missing resourceId on issue', () => {
  assert.throws(() => broker.issue({ kind: 'ACTION_CLICK' }), /lease_resource_id_required/);
});

test('verifies a valid lease', () => {
  const lease = broker.issue({ resourceId: 'r1', kind: 'ACTION_NAVIGATE' });
  const result = broker.verify(lease);
  assert.equal(result.ok, true);
  assert.equal(result.lease.lease_id, lease.lease_id);
});

test('rejects expired lease', () => {
  const past = new Date(Date.now() - 10000).toISOString();
  const lease = { lease_id: 'l1', resource_id: 'r1', actor_id: 'a', not_after: past, hmac: 'abc', kind: 'ACTION_CLICK' };
  const result = broker.verify(lease);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_expired');
});

test('rejects HMAC mismatch', () => {
  const lease = broker.issue({ resourceId: 'r1', kind: 'ACTION_CLICK' });
  lease.hmac = '0000000000000000000000000000000000000000000000000000000000000000';
  const result = broker.verify(lease);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_hmac_mismatch');
});

test('rejects invalid kind on verify', () => {
  const lease = broker.issue({ resourceId: 'r1', kind: 'ACTION_CLICK' });
  lease.kind = 'INVALID';
  const result = broker.verify(lease);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_kind_invalid');
});

test('lease_kinds frozen set', () => {
  assert.deepEqual(Array.from(LEASE_KINDS), ['ACTION_NAVIGATE', 'ACTION_CLICK', 'ACTION_TYPE', 'ACTION_SUBMIT', 'TARGET_CREATE', 'TARGET_CLOSE']);
});
