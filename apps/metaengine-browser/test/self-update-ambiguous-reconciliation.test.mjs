import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareMetaengineDevVersions,
  reconcileAmbiguousSelfUpdateWithProvenNewerInstall,
  SELF_UPDATE_SUPERSEDED_REASON,
} from '../src/self-update-ambiguous-reconciliation.mjs';
import {
  persistPreInstallReceipt,
} from '../src/self-update-handoff.mjs';
import {
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

const TARGET = '0.6.6-dev.8.1';
const CURRENT = '0.7.0-dev.1';
const GIT_SHA = '1234567890abcdef1234567890abcdef12345678';
const NOW = Date.parse('2026-09-08T18:30:00.000Z');

function fakeApp(userData, version) {
  return {
    isPackaged: true,
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected_path:${name}`);
      return userData;
    },
    getVersion() { return version; },
    hasSingleInstanceLock() { return true; },
  };
}

function preInstallReceipt() {
  return {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: TARGET,
    available_version: TARGET,
    metadata_verified: true,
    publisher_verified: true,
    resolved_git_sha: GIT_SHA,
    restart_gate_safe: true,
    restart_gate_since: '2026-09-08T18:20:00.000Z',
    recorded_at: '2026-09-08T18:20:01.000Z',
    authority_effect: false,
  };
}

async function ambiguousFixture(t) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-self-update-reconcile-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const oldApp = fakeApp(userData, '0.6.6-dev.7.1');
  await persistPreInstallReceipt(oldApp, preInstallReceipt());
  await transitionSelfUpdateTransaction(oldApp, 'AMBIGUOUS_INSTALL', {
    requireTargetVersion: TARGET,
    clock: () => NOW - 1_000,
    evidence: { reason: 'legacy_ambiguous_install' },
  });
  return { userData, currentApp: fakeApp(userData, CURRENT) };
}

test('development version ordering accepts the 0.7.0-dev.1 version shape', () => {
  assert.equal(compareMetaengineDevVersions(CURRENT, TARGET), 1);
  assert.equal(compareMetaengineDevVersions('0.7.0-dev.2', '0.7.0-dev.1'), 1);
  assert.equal(compareMetaengineDevVersions('0.7.0-dev.1', '0.7.0-dev.1'), 0);
  assert.equal(compareMetaengineDevVersions('0.6.6-dev.8.1', '0.6.6-dev.9.1'), -1);
  assert.equal(compareMetaengineDevVersions('0.7.0', TARGET), null);
});

test('exact ambiguous old target is durably superseded by a proven newer packaged runtime', async (t) => {
  const { currentApp } = await ambiguousFixture(t);
  const result = await reconcileAmbiguousSelfUpdateWithProvenNewerInstall(currentApp, { clock: () => NOW });

  assert.equal(result.state, SELF_UPDATE_SUPERSEDED_REASON);
  assert.equal(result.current_version, CURRENT);
  assert.equal(result.target_version, TARGET);
  assert.equal(result.transaction_state, 'SUPERSEDED');
  assert.equal(result.new_install_transaction_admissible, true);
  assert.equal(result.installer_effect_allowed, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);

  const journal = await readSelfUpdateTransaction(currentApp);
  assert.equal(journal.state, 'SUPERSEDED');
  assert.equal(journal.evidence.terminal_reason, SELF_UPDATE_SUPERSEDED_REASON);
  assert.equal(journal.evidence.superseding_version, CURRENT);
  assert.equal(journal.evidence.packaged_runtime_proven, true);
  assert.match(journal.evidence.pre_install_receipt_sha256, /^[a-f0-9]{64}$/);
  assert.equal(journal.automatic_retry_allowed, false);
  assert.equal(journal.authority_effect, false);
});

test('reconciliation never clears ambiguity without strict newer-version and receipt binding proof', async (t) => {
  const { userData, currentApp } = await ambiguousFixture(t);

  const notNewer = await reconcileAmbiguousSelfUpdateWithProvenNewerInstall(fakeApp(userData, TARGET), { clock: () => NOW });
  assert.equal(notNewer.state, 'HELD');
  assert.equal((await readSelfUpdateTransaction(currentApp)).state, 'AMBIGUOUS_INSTALL');

  const paths = await import('../src/self-update-handoff.mjs').then(({ selfUpdateHandoffPaths }) => selfUpdateHandoffPaths(currentApp));
  await fs.unlink(paths.pre_install);
  const missingReceipt = await reconcileAmbiguousSelfUpdateWithProvenNewerInstall(currentApp, { clock: () => NOW });
  assert.equal(missingReceipt.state, 'HELD');
  assert.equal(missingReceipt.reason, 'pre_install_receipt_missing');
  assert.equal((await readSelfUpdateTransaction(currentApp)).state, 'AMBIGUOUS_INSTALL');
});

test('unpackaged runtime is never allowed to reconcile an ambiguous installer transaction', async (t) => {
  const { currentApp } = await ambiguousFixture(t);
  const unpackaged = { ...currentApp, isPackaged: false };
  const result = await reconcileAmbiguousSelfUpdateWithProvenNewerInstall(unpackaged, { clock: () => NOW });
  assert.equal(result.state, 'NOT_APPLICABLE');
  assert.equal((await readSelfUpdateTransaction(currentApp)).state, 'AMBIGUOUS_INSTALL');
});
