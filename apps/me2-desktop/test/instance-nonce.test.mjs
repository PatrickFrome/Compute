/**
 * R79 tests — single-instance nonce-ACK resurrection protocol (legacy parity
 * of TOP-8 item 3). Pure decisions only; electron wiring is asserted indirectly
 * via packaging-contract (main.mjs must import and use these).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createNonce, verifyResurrectionData, resolveSecondaryHandoff, NONCE } from '../src/me2/instance-nonce.mjs';

describe('createNonce', () => {
  test('returns { nonce, ts } with hex nonce and numeric ts', () => {
    const n = createNonce({ now: 1234 });
    assert.equal(typeof n.nonce, 'string');
    assert.match(n.nonce, /^[0-9a-f]+$/);
    assert.ok(n.nonce.length >= NONCE.MIN_HEX_LEN);
    assert.equal(n.ts, 1234);
  });

  test('randomImpl is injectable (deterministic test)', () => {
    let i = 0;
    const seq = [0.0, 0.25, 0.5, 0.75];
    // floor(0.25*0xffff)=0x3fff, floor(0.5*0xffff)=0x7fff, floor(0.75*0xffff)=0xbfff
    const n = createNonce({ randomImpl: () => seq[i++ % seq.length] });
    assert.equal(n.nonce, '00003fff7fffbfff');
  });
});

describe('verifyResurrectionData (pure)', () => {
  const NOW = 10_000_000;

  test('fresh well-formed payload verifies with ageMs', () => {
    const payload = { nonce: 'abcd1234abcd1234', ts: NOW - 500 };
    const v = verifyResurrectionData(payload, { now: NOW });
    assert.equal(v.ok, true);
    assert.equal(v.reason, 'verified');
    assert.equal(v.ageMs, 500);
  });

  test('payload absent / wrong type → payload_absent', () => {
    assert.equal(verifyResurrectionData(null, { now: NOW }).reason, 'payload_absent');
    assert.equal(verifyResurrectionData('nonce', { now: NOW }).reason, 'payload_absent');
    assert.equal(verifyResurrectionData([1], { now: NOW }).reason, 'payload_absent');
  });

  test('nonce too short → nonce_malformed', () => {
    const v = verifyResurrectionData({ nonce: 'abcd', ts: NOW }, { now: NOW });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'nonce_malformed');
  });

  test('nonce non-hex → nonce_not_hex', () => {
    const v = verifyResurrectionData({ nonce: 'zzzz1234abcd1234', ts: NOW }, { now: NOW });
    assert.equal(v.reason, 'nonce_not_hex');
  });

  test('ts missing / non-number → ts_absent', () => {
    assert.equal(verifyResurrectionData({ nonce: 'abcd1234abcd1234' }, { now: NOW }).reason, 'ts_absent');
    assert.equal(verifyResurrectionData({ nonce: 'abcd1234abcd1234', ts: 'now' }, { now: NOW }).reason, 'ts_absent');
  });

  test('ts in the future → clock-sanity rejection', () => {
    const v = verifyResurrectionData({ nonce: 'abcd1234abcd1234', ts: NOW + 1 }, { now: NOW });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'ts_in_future');
  });

  test('expired beyond TTL → nonce_expired', () => {
    const v = verifyResurrectionData({ nonce: 'abcd1234abcd1234', ts: NOW - NONCE.TTL_MS - 1 }, { now: NOW });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'nonce_expired');
  });

  test('exactly at TTL boundary is still fresh', () => {
    const v = verifyResurrectionData({ nonce: 'abcd1234abcd1234', ts: NOW - NONCE.TTL_MS }, { now: NOW });
    assert.equal(v.ok, true);
  });
});

describe('resolveSecondaryHandoff (pure)', () => {
  test('lock acquired → primary boots', () => {
    const r = resolveSecondaryHandoff({ lockAcquired: true, data: { nonce: 'x' } });
    assert.equal(r.role, 'primary');
    assert.equal(r.action, 'boot');
  });

  test('lock lost → secondary hands off with its payload', () => {
    const data = { nonce: 'abcd1234abcd1234', ts: 1 };
    const r = resolveSecondaryHandoff({ lockAcquired: false, data });
    assert.equal(r.role, 'secondary');
    assert.equal(r.action, 'hand-off');
    assert.deepEqual(r.data, data);
  });
});
