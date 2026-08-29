import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildEffectEvent,
  buildIdentityEnvelope,
  canonicalJson,
  EFFECT_EVENT_TYPES,
  entrySha256,
  ledgerHead,
  validateEffectEvent,
  validateIdentityEnvelope,
  verifyLedgerChain
} from '../../browser-shared/effect-ledger.mjs';
import { EffectLedgerStore } from '../src/effect-ledger-store.mjs';

function envelope(overrides = {}) {
  return buildIdentityEnvelope({
    lease_id: 'lease-1',
    action_id: 'action-1',
    target_id: 'target_1',
    profile_id: 'p1',
    process_incarnation_id: 'inc-1',
    context_id: 'default',
    ...overrides
  });
}

test('identity envelope requires the cross-plane join keys', () => {
  const built = envelope();
  assert.equal(built.schema, 'metaengine.a2-identity-envelope.v1');
  assert.equal(built.lease_id, 'lease-1');
  assert.ok(Object.isFrozen(built));
  const missing = validateIdentityEnvelope({ lease_id: 'lease-1' });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /action_id_required/);
});

test('identity envelope rejects unsafe epoch values', () => {
  assert.throws(() => envelope({ context_epoch: 'not-a-number' }), /context_epoch_invalid/);
  assert.throws(() => envelope({ context_epoch: 1.5 }), /context_epoch_invalid/);
  assert.doesNotThrow(() => envelope({ context_epoch: 3 }));
});

test('canonical json is total-ordered and rejects unstable values', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.throws(() => canonicalJson({ bad: Number.NaN }), /number_invalid/);
  assert.throws(() => canonicalJson({ bad: undefined }), /value_invalid/);
  assert.throws(() => canonicalJson({ bad: () => {} }), /value_invalid/);
});

test('effect events chain via prev_entry_sha256 and self-verify', () => {
  const first = buildEffectEvent({ seq: 1, prevEntrySha256: null, type: 'INTENT_SEALED', identity: envelope() });
  assert.equal(first.prev_entry_sha256, '');
  const second = buildEffectEvent({ seq: 2, prevEntrySha256: first.entry_sha256, type: 'EFFECT_OBSERVED', identity: envelope(), payload: { status: 'EFFECTED' } });
  assert.equal(second.prev_entry_sha256, first.entry_sha256);
  assert.equal(validateEffectEvent(first).ok, true);
  assert.equal(validateEffectEvent(second).ok, true);
  // digest covers identity + payload: mutation must break it
  const tampered = { ...second, payload: { status: 'AMBIGUOUS' } };
  const tamperedCheck = validateEffectEvent(tampered);
  assert.equal(tamperedCheck.ok, false);
  assert.equal(tamperedCheck.reason, 'effect_event_digest_mismatch');
});

test('effect event validation rejects unknown types and bad links', () => {
  assert.throws(() => buildEffectEvent({ seq: 1, prevEntrySha256: null, type: 'NOT_A_TYPE', identity: envelope() }), /type_invalid/);
  assert.throws(() => buildEffectEvent({ seq: 0, prevEntrySha256: null, type: 'INTENT_SEALED', identity: envelope() }), /seq_invalid/);
  assert.throws(() => buildEffectEvent({ seq: 2, prevEntrySha256: 'deadbeef', type: 'INTENT_SEALED', identity: envelope() }), /prev_invalid/);
  const orphan = buildEffectEvent({ seq: 2, prevEntrySha256: null, type: 'INTENT_SEALED', identity: envelope() });
  const check = validateEffectEvent({ ...orphan, entry_sha256: entrySha256({ ...orphan, prev_entry_sha256: '' }) });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'effect_event_prev_required');
});

test('verifyLedgerChain detects mutation, reordering and gaps', () => {
  const events = [];
  let prev = null;
  for (let i = 0; i < 4; i += 1) {
    const entry = buildEffectEvent({ seq: i + 1, prevEntrySha256: prev, type: EFFECT_EVENT_TYPES[i], identity: envelope({ action_id: `action-${i + 1}` }) });
    events.push(entry);
    prev = entry.entry_sha256;
  }
  const good = verifyLedgerChain(events);
  assert.equal(good.ok, true);
  assert.equal(good.head_seq, 4);
  assert.equal(good.head_entry_sha256, events[3].entry_sha256);

  const mutated = structuredClone(events);
  mutated[1].payload = { injected: true };
  assert.equal(verifyLedgerChain(mutated).ok, false);

  const reordered = [events[0], events[2], events[1], events[3]];
  const reorderCheck = verifyLedgerChain(reordered);
  assert.equal(reorderCheck.ok, false);
  // Reordering breaks either the seq walk or the prev-link walk — both are
  // detected; which one fires first depends on entry position.
  assert.ok(['ledger_prev_link_mismatch', 'ledger_seq_gap'].includes(reorderCheck.reason));

  const gapped = [events[0], events[2], events[3]];
  const gapCheck = verifyLedgerChain(gapped);
  assert.equal(gapCheck.ok, false);

  const truncated = events.slice(0, 2);
  assert.equal(verifyLedgerChain(truncated, { expectedHeadSeq: 4 }).ok, false);
  assert.equal(ledgerHead(events).seq, 4);
});

async function storeFixture(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `a2-effect-ledger-${name}-`));
  return { dir, store: new EffectLedgerStore({ profileDir: dir }) };
}

test('store appends entries and the chain verifies on disk', async () => {
  let fx;
  try {
    fx = await storeFixture('append');
    const first = await fx.store.append({ type: 'INTENT_SEALED', identity: envelope(), payload: { kind: 'NAVIGATE' } });
    assert.equal(first.seq, 1);
    const second = await fx.store.append({ type: 'RECEIPT_EMITTED', identity: envelope({ receipt_id: 'r-1' }) });
    assert.equal(second.seq, 2);
    assert.equal(second.prev_entry_sha256, first.entry_sha256);
    const verify = await fx.store.verify();
    assert.equal(verify.ok, true);
    assert.equal(verify.head_seq, 2);
    const head = await fx.store.head();
    assert.equal(head.seq, 2);
    assert.equal(head.poisoned, false);
    assert.equal(await fx.store.size(), 2);
  } finally {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  }
});

test('store is append-only: prior entries are byte-identical after new appends', async () => {
  let fx;
  try {
    fx = await storeFixture('append-only');
    await fx.store.append({ type: 'INTENT_SEALED', identity: envelope() });
    const before = JSON.parse(await fs.readFile(path.join(fx.dir, 'effect-ledger.json'), 'utf8'));
    await fx.store.append({ type: 'EFFECT_OBSERVED', identity: envelope(), payload: { status: 'EFFECTED' } });
    const after = JSON.parse(await fs.readFile(path.join(fx.dir, 'effect-ledger.json'), 'utf8'));
    assert.deepEqual(after.entries[0], before.entries[0]);
    assert.equal(after.entries.length, before.entries.length + 1);
  } finally {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  }
});

test('store detects on-disk tampering and fails closed for appends', async () => {
  let fx;
  try {
    fx = await storeFixture('tamper');
    await fx.store.append({ type: 'INTENT_SEALED', identity: envelope() });
    await fx.store.append({ type: 'EFFECT_OBSERVED', identity: envelope(), payload: { status: 'EFFECTED' } });
    const file = path.join(fx.dir, 'effect-ledger.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.entries[1].payload = { status: 'AMBIGUOUS', injected: true };
    await fs.writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    const reopened = new EffectLedgerStore({ profileDir: fx.dir });
    const verify = await reopened.verify();
    assert.equal(verify.ok, false);
    const head = await reopened.head();
    assert.equal(head.poisoned, true);
    await assert.rejects(
      () => reopened.append({ type: 'RECOVERY_REQUIRED', identity: envelope() }),
      /effect_ledger_chain_broken/
    );
  } finally {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  }
});

test('store detects tail truncation against the persisted head', async () => {
  let fx;
  try {
    fx = await storeFixture('truncate');
    await fx.store.append({ type: 'INTENT_SEALED', identity: envelope() });
    await fx.store.append({ type: 'EFFECT_OBSERVED', identity: envelope() });
    const file = path.join(fx.dir, 'effect-ledger.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.entries = raw.entries.slice(0, 1);
    await fs.writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
    const reopened = new EffectLedgerStore({ profileDir: fx.dir });
    assert.equal((await reopened.verify()).ok, false);
  } finally {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  }
});

test('store resumes the chain after restart (recovery semantics)', async () => {
  let fx;
  try {
    fx = await storeFixture('restart');
    await fx.store.append({ type: 'INTENT_SEALED', identity: envelope() });
    const before = await fx.store.head();
    const reopened = new EffectLedgerStore({ profileDir: fx.dir });
    const next = await reopened.append({ type: 'RECOVERY_REQUIRED', identity: envelope() });
    assert.equal(next.seq, before.seq + 1);
    assert.equal(next.prev_entry_sha256, before.entry_sha256);
    assert.equal((await reopened.verify()).ok, true);
  } finally {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  }
});

test('timeline filters by action_id and carries the identity chain', async () => {
  let fx;
  try {
    fx = await storeFixture('timeline');
    await fx.store.append({ type: 'INTENT_SEALED', identity: envelope({ action_id: 'a-1' }) });
    await fx.store.append({ type: 'EFFECT_OBSERVED', identity: envelope({ action_id: 'a-1' }) });
    await fx.store.append({ type: 'INTENT_SEALED', identity: envelope({ action_id: 'a-2' }) });
    const timeline = await fx.store.timeline({ actionId: 'a-1' });
    assert.equal(timeline.entries.length, 2);
    assert.ok(timeline.entries.every((entry) => entry.identity.action_id === 'a-1'));
    assert.equal(timeline.head.seq, 3);
  } finally {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  }
});
