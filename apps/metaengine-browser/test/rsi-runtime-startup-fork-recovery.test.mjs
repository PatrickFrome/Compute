import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RsiRuntimeLedger, planRsiRuntimeStartupForkRecovery } from '../src/rsi-runtime-ledger.mjs';
import { recoverRsiRuntimeStartupFork } from '../scripts/recover-rsi-runtime-startup-fork.mjs';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fork(row, seq, at) {
  const { event_digest, ...core } = row;
  core.seq = seq; core.at = at;
  return { ...core, event_digest: hash(JSON.stringify(stable(core))) };
}
async function fixture(root) {
  const ledgerPath = path.join(root, 'ledger.jsonl');
  const ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: 'a'.repeat(40), clock: () => 1_800_000_000_000 });
  await ledger.init();
  await ledger.append('RUNTIME_BOUND', { authority_effect: false });
  await ledger.append('RUNTIME_BOUND', { authority_effect: false });
  const last = await ledger.append('RUNTIME_BOUND', { authority_effect: false });
  const accepted = await fs.readFile(ledgerPath, 'utf8');
  const original = accepted + [fork(last, 5, new Date(1_800_000_000_002).toISOString()), fork(last, 7, new Date(1_800_000_000_004).toISOString())].map(JSON.stringify).join('\n') + '\n';
  await fs.writeFile(ledgerPath, original);
  return { ledgerPath, accepted, original, digest: hash(original) };
}

test('known startup fork recovery preserves every original byte and verified prefix, with a replayable quarantine receipt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-recovery-'));
  try {
    const data = await fixture(root);
    const options = { ledgerPath: data.ledgerPath, expected_sha256: data.digest, source_sha: 'b'.repeat(40) };
    const plan = await recoverRsiRuntimeStartupFork(options);
    assert.equal(plan.applied, false);
    assert.equal(await fs.readFile(data.ledgerPath, 'utf8'), data.original);
    const result = await recoverRsiRuntimeStartupFork({ ...options, apply: true });
    assert.equal(result.accepted_event_count, 3);
    assert.equal(result.original_event_count, 5);
    assert.equal(result.original_bytes_preserved, true);
    assert.equal(await fs.readFile(result.archive_file, 'utf8'), data.original);
    assert.ok((await fs.readFile(data.ledgerPath, 'utf8')).startsWith(data.accepted));
    const replay = new RsiRuntimeLedger({ ledgerPath: data.ledgerPath, source_sha: 'b'.repeat(40) });
    await replay.init();
    assert.equal(replay.snapshot().last_seq, 4);
    assert.equal(replay.events().at(-1).type, 'STARTUP_FORK_QUARANTINED');
    assert.deepEqual(replay.events().at(-1).payload.quarantined_event_digests, result.quarantined_event_digests);
    const appended = await replay.append('RUNTIME_BOUND');
    assert.equal(appended.seq, 5);
    assert.equal(appended.previous_digest, result.recovery_event_digest);
    const receipt = JSON.parse(await fs.readFile(result.receipt_file));
    assert.equal(receipt.restored_sha256, result.restored_sha256);
    assert.equal(receipt.authority_effect, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('recovery rejects tampering, task events, arbitrary gaps and stale file identity without modifying originals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-recovery-deny-'));
  try {
    const data = await fixture(root);
    const rows = data.original.trim().split('\n').map(JSON.parse);
    for (const mutate of [
      row => { row.authority_effect = true; },
      row => { row.payload.changed = true; },
      row => { const modified = fork({ ...row, type: 'TASK_OBSERVATION' }, 5, row.at); Object.assign(row, modified); },
      row => { Object.assign(row, fork(row, 9, row.at)); },
    ]) {
      const copy = structuredClone(rows); mutate(copy[3]);
      assert.throws(() => planRsiRuntimeStartupForkRecovery(copy.map(JSON.stringify).join('\n') + '\n'));
    }
    await assert.rejects(recoverRsiRuntimeStartupFork({ ledgerPath: data.ledgerPath, expected_sha256: 'c'.repeat(64), source_sha: 'b'.repeat(40), apply: true }), /digest_mismatch/);
    assert.equal(await fs.readFile(data.ledgerPath, 'utf8'), data.original);
    assert.throws(() => planRsiRuntimeStartupForkRecovery(data.original.slice(0, -1)), /complete_bounded/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
