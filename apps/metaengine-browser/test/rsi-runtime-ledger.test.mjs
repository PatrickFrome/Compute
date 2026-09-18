import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeLedger } from '../src/rsi-runtime-ledger.mjs';

test('RSI runtime ledger is fsync-backed, append-only and hash chained', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  const source = 'a'.repeat(40);
  try {
    const ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: source, clock: () => 1_800_000_000_000 });
    await ledger.init();
    const first = await ledger.append('RUNTIME_BOUND', { source_sha: source, authority_effect: false });
    const second = await ledger.append('OBSERVATION', { observation_digest: 'b'.repeat(64), authority_effect: false });
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal(second.previous_digest, first.event_digest);
    assert.equal(ledger.snapshot().event_count, 2);
    assert.equal(ledger.snapshot().hash_chained, true);
    assert.equal(ledger.snapshot().fsync_each_event, true);

    const replay = new RsiRuntimeLedger({ ledgerPath, source_sha: source });
    await replay.init();
    assert.equal(replay.snapshot().event_count, 2);
    assert.equal(replay.snapshot().last_event_digest, second.event_digest);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('RSI runtime ledger rejects authority escalation and sensitive payloads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-deny-'));
  try {
    const ledger = new RsiRuntimeLedger({ ledgerPath: path.join(root, 'rsi.jsonl'), source_sha: 'a'.repeat(40) });
    await ledger.init();
    await assert.rejects(() => ledger.append('BAD', { execution_authority: true }), /authority_escalation_forbidden/);
    await assert.rejects(() => ledger.append('BAD', { prompt_plaintext: 'secret prompt' }), /sensitive_payload_forbidden/);
    assert.equal(ledger.snapshot().event_count, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('RSI runtime ledger fails closed on forensic tampering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-tamper-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    await ledger.init();
    await ledger.append('OBSERVATION', { observation_digest: 'b'.repeat(64) });
    const rows = (await fs.readFile(ledgerPath, 'utf8')).trim().split('\n');
    const event = JSON.parse(rows[0]);
    event.payload.observation_digest = 'c'.repeat(64);
    await fs.writeFile(ledgerPath, JSON.stringify(event) + '\n', 'utf8');
    const replay = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    await assert.rejects(() => replay.init(), /digest_mismatch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
