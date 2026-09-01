import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  inspectSelfUpdateStartup,
  persistPreInstallReceipt,
  selfUpdateHandoffPaths,
} from '../src/self-update-handoff.mjs';
import {
  beginSelfUpdateTransaction,
  markSelfUpdateInstallEffectAttempted,
  readSelfUpdateTransaction,
  SELF_UPDATE_TRANSACTION_FILE,
} from '../src/self-update-transaction-journal.mjs';

const NOW = Date.parse('2026-09-01T16:30:00.000Z');

async function fixture(version = '0.6.3-dev.168.1') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-self-update-fail-closed-'));
  let currentVersion = version;
  let locked = true;
  const app = {
    isPackaged: true,
    getPath(name) { assert.equal(name, 'userData'); return userData; },
    getVersion() { return currentVersion; },
    setVersion(value) { currentVersion = String(value); },
    hasSingleInstanceLock() { return locked; },
    releaseSingleInstanceLock() { locked = false; },
  };
  return { app, userData };
}

function receipt(version = '0.6.3-dev.169.1') {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version,
    available_version: version,
    metadata_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date(NOW - 2_000).toISOString(),
    recorded_at: new Date(NOW).toISOString(),
    resolved_git_sha: 'c'.repeat(40),
    authority_effect: false,
  };
}

test('corrupt transaction journal cannot be erased by a new begin and startup holds retry', async () => {
  const { app, userData } = await fixture();
  const journalPath = path.join(userData, SELF_UPDATE_TRANSACTION_FILE);
  await fs.writeFile(journalPath, '{broken', 'utf8');

  const startup = await inspectSelfUpdateStartup(app, { clock: () => NOW + 1_000 });
  assert.equal(startup.state, 'AMBIGUOUS_INSTALL');
  assert.equal(startup.transaction_state, 'UNREADABLE');
  assert.equal(startup.automatic_retry_allowed, false);
  assert.match(startup.reason, /transaction_journal_unreadable/);

  await assert.rejects(
    () => beginSelfUpdateTransaction(app, receipt()),
    /self_update_transaction_json_invalid/,
  );
  assert.equal(await fs.readFile(journalPath, 'utf8'), '{broken');
});

test('unresolved transaction rejects a new receipt without destroying prior evidence', async () => {
  const { app } = await fixture();
  await persistPreInstallReceipt(app, receipt());
  const { pre_install } = selfUpdateHandoffPaths(app);
  const priorReceipt = await fs.readFile(pre_install, 'utf8');

  await assert.rejects(
    () => persistPreInstallReceipt(app, receipt('0.6.3-dev.170.1')),
    /self_update_transaction_unresolved_prior:PREPARED/,
  );
  assert.equal(await fs.readFile(pre_install, 'utf8'), priorReceipt);
  assert.equal((await readSelfUpdateTransaction(app)).state, 'PREPARED');

  await markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.169.1' });
  await assert.rejects(
    () => persistPreInstallReceipt(app, receipt('0.6.3-dev.170.1')),
    /self_update_transaction_unresolved_prior:INSTALLING/,
  );
  assert.equal(await fs.readFile(pre_install, 'utf8'), priorReceipt);
  assert.equal((await readSelfUpdateTransaction(app)).state, 'INSTALLING');
});

test('INSTALLING with missing pre-install receipt converges to durable ambiguity, never NONE', async () => {
  const { app } = await fixture();
  await persistPreInstallReceipt(app, receipt());
  await markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.169.1' });
  const { pre_install } = selfUpdateHandoffPaths(app);
  await fs.unlink(pre_install);

  const startup = await inspectSelfUpdateStartup(app, { clock: () => NOW + 1_000 });
  assert.equal(startup.state, 'AMBIGUOUS_INSTALL');
  assert.equal(startup.transaction_state, 'INSTALLING');
  assert.equal(startup.automatic_retry_allowed, false);
  assert.equal(startup.reason, 'durable_transaction_present_but_pre_install_receipt_missing');
  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'AMBIGUOUS_INSTALL');
  assert.equal(journal.automatic_retry_allowed, false);

  await assert.rejects(
    () => beginSelfUpdateTransaction(app, receipt('0.6.3-dev.170.1')),
    /self_update_transaction_unresolved_prior:AMBIGUOUS_INSTALL/,
  );
});

test('INSTALLING with old process version becomes AMBIGUOUS and remains held on repeated startup', async () => {
  const { app } = await fixture();
  await persistPreInstallReceipt(app, receipt());
  await markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.169.1' });

  const first = await inspectSelfUpdateStartup(app, { clock: () => NOW + 1_000 });
  assert.equal(first.state, 'AMBIGUOUS_INSTALL');
  assert.equal(first.automatic_retry_allowed, false);
  assert.equal((await readSelfUpdateTransaction(app)).state, 'AMBIGUOUS_INSTALL');

  const second = await inspectSelfUpdateStartup(app, { clock: () => NOW + 2_000 });
  assert.equal(second.state, 'AMBIGUOUS_INSTALL');
  assert.equal(second.automatic_retry_allowed, false);
  assert.equal((await readSelfUpdateTransaction(app)).state, 'AMBIGUOUS_INSTALL');
});

test('INSTALLING converges to SUCCESSOR_BOOTED only on exact installed target version', async () => {
  const { app } = await fixture();
  await persistPreInstallReceipt(app, receipt());
  await markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.169.1' });
  app.setVersion('0.6.3-dev.169.1');

  const startup = await inspectSelfUpdateStartup(app, { clock: () => NOW + 1_000 });
  assert.equal(startup.state, 'TARGET_INSTALLED');
  assert.equal(startup.current_version, '0.6.3-dev.169.1');
  assert.equal(startup.target_version, '0.6.3-dev.169.1');
  assert.equal(startup.automatic_retry_allowed, false);
  const journal = await readSelfUpdateTransaction(app);
  assert.equal(journal.state, 'SUCCESSOR_BOOTED');
  assert.equal(journal.evidence.boot_version_match, true);
  assert.equal(journal.automatic_retry_allowed, false);
});
