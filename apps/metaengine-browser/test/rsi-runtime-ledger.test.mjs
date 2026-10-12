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

test('concurrent ledger replay publishes the existing prefix exactly once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-init-race-'));
  try {
    const ledgerPath = path.join(root, 'rsi.jsonl');
    const writer = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    await writer.init();
    await writer.append('RUNTIME_BOUND');
    const last = await writer.append('OBSERVATION');
    const replay = new RsiRuntimeLedger({ ledgerPath, source_sha: 'b'.repeat(40) });
    await Promise.all(Array.from({ length: 16 }, () => replay.init()));
    assert.equal(replay.snapshot().event_count, 2);
    const next = await replay.append('RUNTIME_BOUND');
    assert.equal(next.seq, 3);
    assert.equal(next.previous_digest, last.event_digest);
    const restart = new RsiRuntimeLedger({ ledgerPath, source_sha: 'b'.repeat(40) });
    await restart.init();
    assert.equal(restart.snapshot().event_count, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('parallel appends retain one continuous durable hash chain across restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-append-race-'));
  try {
    const ledgerPath = path.join(root, 'rsi.jsonl');
    const ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    await ledger.init();
    const events = await Promise.all(Array.from({ length: 32 }, (_, index) => ledger.append('OBSERVATION', { index })));
    assert.deepEqual(events.map(row => row.seq), Array.from({ length: 32 }, (_, index) => index + 1));
    for (let index = 1; index < events.length; index += 1) assert.equal(events[index].previous_digest, events[index - 1].event_digest);
    const restart = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    await restart.init();
    assert.equal(restart.snapshot().event_count, 32);
    assert.equal(restart.snapshot().last_event_digest, events.at(-1).event_digest);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed replay retains no partial prefix when initialization is retried', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-retry-'));
  try {
    const ledgerPath = path.join(root, 'rsi.jsonl');
    const writer = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    await writer.init();
    await writer.append('RUNTIME_BOUND');
    const valid = await fs.readFile(ledgerPath, 'utf8');
    await fs.appendFile(ledgerPath, 'invalid\n');
    const replay = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40) });
    for (let index = 0; index < 3; index += 1) {
      await assert.rejects(replay.init(), /json_invalid:2/);
      assert.equal(replay.snapshot().event_count, 0);
    }
    await assert.rejects(replay.append('OBSERVATION'), /not_initialized/);
    await fs.writeFile(ledgerPath, valid);
    await replay.init();
    const next = await replay.append('OBSERVATION');
    assert.equal(next.seq, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const failurePhase of ['partial_write', 'fsync', 'close']) {
  test(`ambiguous ${failurePhase} failure fences both queued and later appends`, { concurrency: false }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-ledger-io-failure-'));
    const ledgerPath = path.join(root, 'rsi.jsonl');
    const source = 'a'.repeat(40);
    const ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: source });
    await ledger.init();
    const realOpen = fs.open;
    let opens = 0;
    let closes = 0;
    const injectedError = Object.assign(new Error(`injected_${failurePhase}_failure`), { code: 'EIO' });
    t.after(async () => {
      t.mock.restoreAll();
      await fs.rm(root, { recursive: true, force: true });
    });
    t.mock.method(fs, 'open', async (...args) => {
      const handle = await realOpen(...args);
      if (path.resolve(args[0]) !== ledgerPath) return handle;
      opens += 1;
      return {
        async writeFile(serialized, encoding) {
          if (failurePhase === 'partial_write') {
            // Persist a real, invalid prefix before rejecting. Subsequent
            // callers cannot assume that this failed operation wrote nothing.
            const bytes = Buffer.from(serialized, encoding);
            await handle.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
            throw injectedError;
          }
          await handle.writeFile(serialized, encoding);
        },
        async sync() {
          if (failurePhase === 'fsync') throw injectedError;
          await handle.sync();
        },
        async close() {
          closes += 1;
          await handle.close();
          if (failurePhase === 'close') throw injectedError;
        },
      };
    });
    const results = await Promise.allSettled([
      ledger.append('RUNTIME_BOUND'),
      ledger.append('OBSERVATION', { index: 1 }),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[0].reason, injectedError, 'cleanup must preserve the actual I/O failure');
    assert.equal(results[1].status, 'rejected');
    assert.match(results[1].reason.message, /write_failed_restart_required/);
    assert.equal(ledger.snapshot().event_count, 0, 'unconfirmed writes cannot publish an in-memory event');
    assert.equal(ledger.snapshot().last_seq, 0);
    assert.equal(opens, 1, 'a queued append must be fenced before opening the file');
    assert.ok(closes >= 1, 'the opened handle must be closed on every failure path');
    const persistedBytes = await fs.readFile(ledgerPath);
    assert.ok(persistedBytes.length > 0, 'the failed write really affected disk');
    await assert.rejects(ledger.append('OBSERVATION', { index: 2 }), /write_failed_restart_required/);
    assert.equal(opens, 1);
    assert.deepEqual(await fs.readFile(ledgerPath), persistedBytes, 'fenced retries must preserve ambiguous bytes');

    t.mock.restoreAll();
    const fresh = new RsiRuntimeLedger({ ledgerPath, source_sha: source });
    if (failurePhase === 'partial_write') {
      await assert.rejects(fresh.init(), /json_invalid:1/);
      await assert.rejects(fresh.append('OBSERVATION'), /not_initialized/);
    } else {
      // The file is complete in this synthetic case. Only a fresh validated
      // replay can discover its persisted row and safely assign sequence 2.
      await fresh.init();
      const first = JSON.parse(persistedBytes.toString('utf8').trim());
      const next = await fresh.append('OBSERVATION');
      assert.equal(next.seq, 2);
      assert.equal(next.previous_digest, first.event_digest);
      const restart = new RsiRuntimeLedger({ ledgerPath, source_sha: source });
      await restart.init();
      assert.equal(restart.snapshot().event_count, 2);
    }
  });
}
