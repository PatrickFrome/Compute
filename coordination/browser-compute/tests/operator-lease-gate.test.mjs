import assert from 'node:assert/strict';
import test from 'node:test';

test('operator lease gate global is available after load', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  assert.equal(typeof globalThis.A2_OPERATOR_LEASE_GATE, 'object');
  assert.equal(typeof globalThis.A2_OPERATOR_LEASE_GATE.verifyLease, 'function');
  assert.equal(typeof globalThis.A2_OPERATOR_LEASE_GATE.validateActionLease, 'function');
  assert.equal(typeof globalThis.A2_OPERATOR_LEASE_GATE.signLease, 'function');
});

test('verifyLease rejects missing fields', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  const result = await globalThis.A2_OPERATOR_LEASE_GATE.verifyLease(null, 'key');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_required');
});

test('verifyLease rejects expired lease', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  const lease = { lease_id: 'l1', resource_id: 'r1', actor_id: 'a', not_after: new Date(Date.now() - 1000).toISOString(), hmac: 'abc', kind: 'ACTION_CLICK' };
  const result = await globalThis.A2_OPERATOR_LEASE_GATE.verifyLease(lease, 'key');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_expired');
});

test('verifyLease rejects HMAC mismatch', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  const lease = { lease_id: 'l1', resource_id: 'r1', actor_id: 'a', not_after: new Date(Date.now() + 10000).toISOString(), hmac: 'deadbeef', kind: 'ACTION_CLICK' };
  const result = await globalThis.A2_OPERATOR_LEASE_GATE.verifyLease(lease, 'key');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_hmac_mismatch');
});

test('verifyLease accepts valid lease', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  const notAfter = new Date(Date.now() + 10000).toISOString();
  const lease = { lease_id: 'l1', resource_id: 'r1', actor_id: 'a', not_after: notAfter, hmac: '', kind: 'ACTION_CLICK' };
  lease.hmac = await globalThis.A2_OPERATOR_LEASE_GATE.signLease(lease, 'key');
  const result = await globalThis.A2_OPERATOR_LEASE_GATE.verifyLease(lease, 'key');
  assert.equal(result.ok, true);
  assert.equal(result.lease.lease_id, 'l1');
});

test('validateActionLease enforces resource_id match', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  const notAfter = new Date(Date.now() + 10000).toISOString();
  const lease = { lease_id: 'l1', resource_id: 'other', actor_id: 'a', not_after: notAfter, hmac: '', kind: 'ACTION_CLICK' };
  lease.hmac = await globalThis.A2_OPERATOR_LEASE_GATE.signLease(lease, 'key');
  const result = await globalThis.A2_OPERATOR_LEASE_GATE.validateActionLease(lease, 'key', 'target-1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_resource_mismatch');
});

test('validateActionLease accepts matching resource', async () => {
  const extPath = new URL('../../chat-control-plane/extension/operator-lease-gate.js', import.meta.url).pathname;
  await import(extPath);
  const notAfter = new Date(Date.now() + 10000).toISOString();
  const lease = { lease_id: 'l1', resource_id: 'target-1', actor_id: 'a', not_after: notAfter, hmac: '', kind: 'ACTION_CLICK' };
  lease.hmac = await globalThis.A2_OPERATOR_LEASE_GATE.signLease(lease, 'key');
  const result = await globalThis.A2_OPERATOR_LEASE_GATE.validateActionLease(lease, 'key', 'target-1');
  assert.equal(result.ok, true);
});
