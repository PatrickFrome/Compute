import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  beginSelfUpdateTransaction,
  qualifySelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

async function fixture(version = '0.6.3-dev.149.1') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-update-journal-'));
  let current = version;
  return {
    app: {
      getPath: (name) => { assert.equal(name, 'userData'); return userData; },
      getVersion: () => current,
      setVersion: (value) => { current = String(value); },
    },
  };
}

const receipt = (version) => ({
  version,
  available_version: version,
  metadata_verified: true,
  restart_gate_safe: true,
  resolved_git_sha: 'a'.repeat(40),
  authority_effect: false,
});

test('journal starts fail-closed with swapping marker and no automatic retry', async () => {
  const { app } = await fixture('0.6.3-dev.149.1');
  const row = await beginSelfUpdateTransaction(app, receipt('0.6.3-dev.160.1'));
  assert.equal(row.state, 'PREPARED');
  assert.equal(row.swapping, true);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.attempt_count, 1);
  assert.equal((await readSelfUpdateTransaction(app)).target_version, '0.6.3-dev.160.1');
});

test('ambiguous installer state cannot transition back to PREPARED for blind retry', async () => {
  const { app } = await fixture();
  await beginSelfUpdateTransaction(app, receipt('0.6.3-dev.160.1'));
  await transitionSelfUpdateTransaction(app, 'AMBIGUOUS_INSTALL', { evidence: { reason: 'process_lock' } });
  await assert.rejects(() => transitionSelfUpdateTransaction(app, 'PREPARED'), /transition_invalid/);
  const row = await readSelfUpdateTransaction(app);
  assert.equal(row.state, 'AMBIGUOUS_INSTALL');
  assert.equal(row.evidence.reason, 'process_lock');
  assert.equal(row.automatic_retry_allowed, false);
});

test('successor must match exact target before qualification', async () => {
  const { app } = await fixture('0.6.3-dev.149.1');
  await beginSelfUpdateTransaction(app, receipt('0.6.3-dev.160.1'));
  await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED', { requireTargetVersion: '0.6.3-dev.160.1' });
  await assert.rejects(() => qualifySelfUpdateTransaction(app), /target_binding_mismatch/);
  app.setVersion('0.6.3-dev.160.1');
  const qualified = await qualifySelfUpdateTransaction(app, { profile_continuity: true, singleton: true });
  assert.equal(qualified.state, 'QUALIFIED');
  assert.equal(qualified.qualified, true);
  assert.equal(qualified.swapping, false);
  assert.equal(qualified.evidence.profile_continuity, true);
});

test('qualified transaction cannot regress into ambiguous install', async () => {
  const { app } = await fixture('0.6.3-dev.149.1');
  await beginSelfUpdateTransaction(app, receipt('0.6.3-dev.160.1'));
  await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED', { requireTargetVersion: '0.6.3-dev.160.1' });
  app.setVersion('0.6.3-dev.160.1');
  await qualifySelfUpdateTransaction(app);
  await assert.rejects(() => transitionSelfUpdateTransaction(app, 'AMBIGUOUS_INSTALL'), /transition_invalid/);
});

test('transaction persistence is pinned to the shared committed-file durability primitive', async () => {
  const source = await fs.readFile(new URL('../src/self-update-transaction-journal.mjs', import.meta.url), 'utf8');
  const durable = await fs.readFile(new URL('../src/durable-json-file.cjs', import.meta.url), 'utf8');
  assert.match(source, /durableWriteJson/);
  assert.doesNotMatch(source, /fs\.rename\(|fsp\.rename\(|await fs\.rename\(/);
  assert.match(durable, /await handle\.sync\(\)/);
  assert.match(durable, /await committed\.sync\(\)/);
  assert.match(durable, /syncDirectory\(directory\)/);
  assert.match(durable, /if \(process\.platform === 'win32'\) return false/);
});
