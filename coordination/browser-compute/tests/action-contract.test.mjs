import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateActionIntent, validateLeaseEnvelope, ACTION_KINDS, compileActionEnvelope } from '../../browser-shared/action-contract.mjs';

test('rejects null/non-object/missing fields', () => {
  assert.equal(validateActionIntent(null).ok, false);
  assert.equal(validateActionIntent({}).ok, false);
  assert.equal(validateActionIntent({ action_id: 'a', target_id: 't', profile_id: 'p', context_id: 'c', kind: 'NAVIGATE' }).ok, false);
  assert.equal(validateActionIntent({ action_id: 'a', target_id: 't', profile_id: 'p', context_id: 'c', kind: 'NAVIGATE', lease: {} }).ok, false);
});

test('rejects expired lease', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const intent = { action_id: 'a1', target_id: 't1', profile_id: 'p1', context_id: 'c1', kind: 'NAVIGATE', lease: { lease_id: 'l1', resource_id: 't1', actor_id: 'x', not_after: past, hmac: 'deadbeef' } };
  const result = validateActionIntent(intent);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_expired');
});

test('rejects mismatched resource_id', () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const intent = { action_id: 'a1', target_id: 't1', profile_id: 'p1', context_id: 'c1', kind: 'CLICK', lease: { lease_id: 'l1', resource_id: 't_other', actor_id: 'x', not_after: future, hmac: 'deadbeef' }, locator: { semantic_id: 's1', frame_path: ['f1'] } };
  const result = validateActionIntent(intent);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_resource_mismatch');
});

test('accepts valid navigate intent', () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const intent = { action_id: 'a1', target_id: 't1', profile_id: 'p1', context_id: 'c1', kind: 'NAVIGATE', lease: { lease_id: 'l1', resource_id: 't1', actor_id: 'x', not_after: future, hmac: 'deadbeef' }, payload: { url: 'https://example.com/' }, requested_at: new Date().toISOString() };
  const result = validateActionIntent(intent);
  assert.equal(result.ok, true);
  assert.equal(result.action.action_id, 'a1');
  assert.equal(result.action.kind, 'NAVIGATE');
});

test('accepts valid click intent with locator', () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const intent = { action_id: 'a1', target_id: 't1', profile_id: 'p1', context_id: 'c1', kind: 'CLICK', lease: { lease_id: 'l1', resource_id: 't1', actor_id: 'x', not_after: future, hmac: 'deadbeef' }, locator: { semantic_id: 'node_1', frame_path: ['f1', 'f2'] } };
  const result = validateActionIntent(intent);
  assert.equal(result.ok, true);
  assert.equal(result.action.locator.semantic_id, 'node_1');
});

test('rejects invalid action kind', () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const intent = { action_id: 'a1', target_id: 't1', profile_id: 'p1', context_id: 'c1', kind: 'DESTROY', lease: { lease_id: 'l1', resource_id: 't1', actor_id: 'x', not_after: future, hmac: 'deadbeef' } };
  const result = validateActionIntent(intent);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'action_kind_invalid');
});

test('ACTION_KINDS frozen set contains exactly four kinds', () => {
  assert.deepEqual(Array.from(ACTION_KINDS), ['NAVIGATE', 'CLICK', 'TYPE', 'SUBMIT']);
});

test('compileActionEnvelope produces normalized intent', () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const lease = { lease_id: 'l1', resource_id: 't1', actor_id: 'x', not_after: future, hmac: 'abc' };
  const envelope = compileActionEnvelope({ target_id: 'T1', lease, kind: 'click', locator: { semantic_id: 'n1', frame_path: ['a'] }, payload: { text: 'hello' } });
  assert.equal(envelope.action_id.length, 36);
  assert.equal(envelope.target_id, 'T1');
  assert.equal(envelope.kind, 'CLICK');
  assert.equal(envelope.locator.semantic_id, 'n1');
  assert.equal(envelope.payload.text, 'hello');
});

test('lease envelope requires hmac before checking expiry', () => {
  const result = validateLeaseEnvelope({ lease_id: 'l1', resource_id: 'r1', actor_id: 'a1', not_after: new Date(Date.now() - 1000).toISOString(), hmac: '' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'lease_hmac_required');
});