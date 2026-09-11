import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectSelfUpdateStartup, persistPreInstallReceipt } from '../src/self-update-handoff.mjs';
import {
  qualifySelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

async function fixture(version) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-update-loop-'));
  let locked = true;
  return {
    userData,
    app: {
      isPackaged: true,
      getPath: (name) => { assert.equal(name, 'userData'); return userData; },
      getVersion: () => version,
      hasSingleInstanceLock: () => locked,
      setLocked: (value) => { locked = value === true; },
    },
  };
}

function receipt(target) {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target,
    available_version: target,
    metadata_verified: true,
    publisher_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    authority_effect: false,
  };
}

test('old version after installer handoff is held as ambiguous and cannot blind retry', async () => {
  const { app } = await fixture('0.6.3-dev.124.1');
  await persistPreInstallReceipt(app, receipt('0.6.3-dev.149.1'));
  const row = await inspectSelfUpdateStartup(app);
  assert.equal(row.state, 'AMBIGUOUS_INSTALL');
  assert.equal(row.current_version, '0.6.3-dev.124.1');
  assert.equal(row.target_version, '0.6.3-dev.149.1');
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
});

test('installed target is recognized with exact unresolved successor phase', async () => {
  const { app } = await fixture('0.6.3-dev.149.1');
  await persistPreInstallReceipt(app, receipt('0.6.3-dev.149.1'));
  const row = await inspectSelfUpdateStartup(app);
  assert.equal(row.state, 'TARGET_INSTALLED');
  assert.equal(row.transaction_state, 'SUCCESSOR_BOOTED');
  assert.equal(row.automatic_retry_allowed, false);
});

test('already qualified target stays terminal and does not regress into recovery phase', async () => {
  const target = '0.6.3-dev.149.1';
  const { app } = await fixture(target);
  await persistPreInstallReceipt(app, receipt(target));
  await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED', {
    requireTargetVersion: target,
    evidence: { boot_version_match: true },
  });
  await qualifySelfUpdateTransaction(app, { test_qualified: true });
  const before = await readSelfUpdateTransaction(app);
  assert.equal(before.state, 'QUALIFIED');

  const row = await inspectSelfUpdateStartup(app);
  const after = await readSelfUpdateTransaction(app);
  assert.equal(row.state, 'TARGET_INSTALLED');
  assert.equal(row.transaction_state, 'QUALIFIED');
  assert.equal(after.state, 'QUALIFIED');
  assert.equal(after.updated_at, before.updated_at);
});

test('a manually repaired newer version supersedes an older failed transaction', async () => {
  const { app } = await fixture('0.6.3-dev.160.1');
  await persistPreInstallReceipt(app, receipt('0.6.3-dev.149.1'));
  const row = await inspectSelfUpdateStartup(app);
  assert.equal(row.state, 'SUPERSEDED');
  assert.equal(row.automatic_retry_allowed, false);
});

test('main entry wires ambiguous install to process-local self-update hold', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  assert.match(source, /inspectSelfUpdateStartup/);
  assert.match(source, /METAENGINE_DISABLE_SELF_UPDATE = '1'/);
  assert.match(source, /SELF_UPDATE_AUTOMATIC_RETRY_HELD/);
});
