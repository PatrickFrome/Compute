import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { validateReceipt, RECEIPT_STATUS, receiptSha256, canonicalReceiptBytes, isEffectEvidence } from '../../browser-shared/receipt-contract.mjs';

function buildReceipt(overrides = {}) {
  const base = {
    schema: 'metaengine.a2-browser-operator.receipt.v1',
    receipt_id: crypto.randomUUID(),
    action_id: crypto.randomUUID(),
    lease_id: crypto.randomUUID(),
    resource_id: 'target_1',
    profile_id: 'p1',
    context_id: 'c1',
    process_incarnation_id: 'inc_001',
    kind: 'CLICK',
    status: 'EFFECTED',
    effect_evidence: { dispatched: true, bound_backend_dom_node_id: 12345 },
    authority_effect: true,
    created_at: new Date().toISOString(),
    receipt_sha256: ''
  };
  const record = { ...base, ...overrides };
  record.receipt_sha256 = receiptSha256(record);
  return record;
}

test('rejects null/array/object without required fields', () => {
  assert.equal(validateReceipt(null).ok, false);
  assert.equal(validateReceipt([]).ok, false);
  assert.equal(validateReceipt({}).ok, false);
});

test('rejects tampered receipt_sha256', () => {
  const receipt = buildReceipt();
  receipt.receipt_sha256 = '0000000000000000000000000000000000000000000000000000000000000000';
  const result = validateReceipt(receipt);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'receipt_sha256_mismatch');
});

test('rejects missing receipt_id', () => {
  const receipt = buildReceipt({ receipt_id: '' });
  const result = validateReceipt(receipt);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'receipt_id_required');
});

test('rejects invalid status', () => {
  const receipt = buildReceipt({ status: 'GHOST' });
  const result = validateReceipt(receipt);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'receipt_status_invalid');
});

test('rejects authority_effect false', () => {
  const receipt = buildReceipt({ authority_effect: false });
  const result = validateReceipt(receipt);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'receipt_authority_effect_required');
});

test('accepts valid EFFECTED receipt', () => {
  const receipt = buildReceipt();
  const result = validateReceipt(receipt);
  assert.equal(result.ok, true);
  assert.equal(result.record.receipt_id, receipt.receipt_id);
});

test('accepts valid AMBIGUOUS receipt', () => {
  const receipt = buildReceipt({ status: 'AMBIGUOUS', effect_evidence: { dispatched: false } });
  const result = validateReceipt(receipt);
  assert.equal(result.ok, true);
  assert.equal(result.record.status, 'AMBIGUOUS');
});

test('rejects missing created_at', () => {
  const { created_at, ...rest } = buildReceipt();
  const result = validateReceipt({ ...rest, created_at: '' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'receipt_created_at_required');
});

test('RECEIPT_STATUS is frozen with exactly three values', () => {
  assert.deepEqual(Array.from(RECEIPT_STATUS), ['EFFECTED', 'FAILED_NO_EFFECT', 'AMBIGUOUS']);
});

test('receiptSha256 round-trips deterministically', () => {
  const receipt = buildReceipt();
  const sha1 = receipt.receipt_sha256;
  const sha2 = receiptSha256(receipt);
  assert.equal(sha1, sha2);
  assert.match(sha1, /^[a-f0-9]{64}$/);
});

test('isEffectEvidence returns truthy only for EFFECTED', () => {
  assert.ok(isEffectEvidence({ status: 'EFFECTED' }));
  assert.ok(!isEffectEvidence({ status: 'FAILED_NO_EFFECT' }));
  assert.ok(!isEffectEvidence({ status: 'AMBIGUOUS' }));
  assert.ok(!isEffectEvidence(null));
});

test('tampered fields after validation fail sha check', () => {
  const receipt = buildReceipt();
  receipt.effect_evidence = { dispatched: true, bound_backend_dom_node_id: 99999 };
  const result = validateReceipt(receipt);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'receipt_sha256_mismatch');
});