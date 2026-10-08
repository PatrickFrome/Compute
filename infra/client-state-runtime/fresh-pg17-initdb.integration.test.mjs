import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeFreshClientPg17 } from './fresh-pg17-initdb.mjs';

const bundle = process.env.LOCAL_STATE_TEST_FRESH_BUNDLE_DIRECTORY;
const sha = process.env.LOCAL_STATE_TEST_FRESH_BUNDLE_SHA256;

test('physical offline PostgreSQL 17 initdb creates one SCRAM/checksummed fresh cluster and refuses adoption', {
  skip: !bundle && !sha, timeout: 240000,
}, async t => {
  if (!bundle || !sha || !/^[a-f0-9]{64}$/.test(sha)) {
    throw new Error('physical_initdb_integration_explicit_bundle_pin_required');
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-physical-initdb-'));
  let completed = false;
  // This test owns only its newly created disposable cluster. Preserve an
  // incomplete initdb attempt for manual CI diagnosis, never clean on error.
  t.after(async () => { if (completed) await fs.rm(root, { recursive: true, force: true }); });
  const passwordFile = path.join(root, 'synthetic-pg-password');
  const syntheticPassword = randomBytes(32).toString('hex');
  await fs.writeFile(passwordFile, syntheticPassword + '\n', { flag: 'wx', mode: 0o600 });
  const stateDirectory = path.join(root, 'private');
  const pgDataDirectory = path.join(stateDirectory, 'pg17');
  const selection = {
    bundleDirectory: bundle, expectedBundleSha256: sha, stateDirectory, pgDataDirectory,
    runtimeConfigFile: path.join(stateDirectory, 'runtime-private-config.json'),
    ownerFile: path.join(root, 'roaming', 'owner.json'), passwordFile,
    ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17',
  };
  const receipt = await initializeFreshClientPg17(selection);
  assert.equal(receipt.state, 'PG17_INITIALIZED_UNPROVISIONED');
  assert.equal(receipt.runtime_ready, false);
  assert.equal(receipt.vault_key_created, false);
  assert.equal(receipt.owner_profile_written, false);
  assert.equal(receipt.authority_effect, false);
  assert.equal(await fs.readFile(path.join(pgDataDirectory, 'PG_VERSION'), 'utf8'), '17\n');
  assert.match(await fs.readFile(path.join(pgDataDirectory, 'pg_hba.conf'), 'utf8'), /scram-sha-256/);
  await assert.rejects(fs.lstat(path.join(stateDirectory, 'client-first-run-initdb.lock')), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(selection.ownerFile), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(selection.runtimeConfigFile), { code: 'ENOENT' });
  await assert.rejects(initializeFreshClientPg17(selection), /client_initdb_existing_state_requires_reconciliation/);
  assert.equal(JSON.stringify(receipt).includes(syntheticPassword), false);
  // A successful test can remove only this owned synthetic fixture, which is
  // not an installed Browser profile, user database or source archive.
  completed = true;
});
