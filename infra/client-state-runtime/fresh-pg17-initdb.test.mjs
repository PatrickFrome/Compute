import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeFreshClientPg17 } from './fresh-pg17-initdb.mjs';

const sha = 'a'.repeat(64);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-initdb-fixture-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundleDirectory = path.join(root, 'bundle');
  const pgBin = path.join(bundleDirectory, 'runtime', 'postgresql', 'bin');
  await fs.mkdir(pgBin, { recursive: true });
  const binary = path.join(pgBin, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
  await fs.writeFile(binary, 'synthetic-binary-not-executed');
  const passwordFile = path.join(root, 'private-password');
  await fs.writeFile(passwordFile, 'synthetic-private-password\n', { mode: 0o600 });
  const input = {
    bundleDirectory, expectedBundleSha256: sha,
    stateDirectory: path.join(root, 'state'),
    pgDataDirectory: path.join(root, 'state', 'pg17'),
    runtimeConfigFile: path.join(root, 'state', 'private-config.json'),
    ownerFile: path.join(root, 'roaming', 'owner.json'),
    passwordFile, ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17',
  };
  let calls = 0;
  const hooks = { verifyBundle: async () => ({
    manifest: { bundle_sha256: sha }, paths: { postgresBinDirectory: pgBin },
  }), initdb: async ({ executable, dataDirectory, passwordFile: privateFile, stateDirectory }) => {
    calls += 1;
    assert.equal(await fs.realpath(executable), await fs.realpath(binary), 'physical exe identity must survive Windows 8.3 aliases');
    assert.equal(await fs.realpath(privateFile), await fs.realpath(passwordFile), 'physical private credential identity must survive Windows path aliases');
    assert.equal(stateDirectory, input.stateDirectory);
    await fs.writeFile(path.join(dataDirectory, 'PG_VERSION'), '17\n');
    await fs.writeFile(path.join(dataDirectory, 'postgresql.conf'), 'shared_buffers=128MB\n');
    await fs.mkdir(path.join(dataDirectory, 'base'));
  } };
  return { input, root, hooks, calls: () => calls };
}

test('fresh explicit-owner transaction only initializes PG17; Vault/schema/owner remain absent', async t => {
  const f = await fixture(t);
  const result = await initializeFreshClientPg17(f.input, f.hooks);
  assert.equal(f.calls(), 1);
  assert.equal(result.state, 'PG17_INITIALIZED_UNPROVISIONED');
  assert.equal(result.runtime_ready, false);
  assert.equal(result.owner_profile_written, false);
  assert.equal(result.vault_key_created, false);
  assert.equal(result.authority_effect, false);
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.equal(await fs.readFile(path.join(f.input.pgDataDirectory, 'PG_VERSION'), 'utf8'), '17\n');
  await assert.rejects(fs.stat(path.join(f.input.stateDirectory, 'client-first-run-initdb.lock')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.input.runtimeConfigFile), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.input.ownerFile), { code: 'ENOENT' });
  await assert.rejects(initializeFreshClientPg17(f.input, f.hooks), /existing_state_requires_reconciliation/);
  assert.equal(f.calls(), 1);
});

test('without explicit owner action or with wrong digest nothing is written', async t => {
  const f = await fixture(t);
  await assert.rejects(initializeFreshClientPg17({ ...f.input, ownerAction: undefined }, f.hooks), /owner_approval_required/);
  await assert.rejects(initializeFreshClientPg17({ ...f.input, expectedBundleSha256: 'broken' }, f.hooks), /reviewed_bundle_digest_required/);
  await assert.rejects(fs.stat(f.input.stateDirectory), { code: 'ENOENT' });
  assert.equal(f.calls(), 0);
});

test('existing owner/private state is never adopted or mutated even with owner approval', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.input.stateDirectory);
  const marker = path.join(f.input.stateDirectory, 'do-not-touch');
  await fs.writeFile(marker, 'private');
  await assert.rejects(initializeFreshClientPg17(f.input, f.hooks), /existing_state_requires_reconciliation/);
  assert.equal(await fs.readFile(marker, 'utf8'), 'private');
  assert.equal(f.calls(), 0);
});

test('partial initdb result keeps PGDATA and the exclusive review lock; never auto retries', async t => {
  const f = await fixture(t);
  let attempts = 0;
  const hooks = { ...f.hooks, initdb: async ({ dataDirectory }) => {
    attempts++;
    await fs.writeFile(path.join(dataDirectory, 'PG_VERSION'), 'partial');
    throw new Error('synthetic_io_interruption');
  } };
  await assert.rejects(initializeFreshClientPg17(f.input, hooks), /incomplete_review_required/);
  assert.equal(await fs.readFile(path.join(f.input.pgDataDirectory, 'PG_VERSION'), 'utf8'), 'partial');
  assert.match(await fs.readFile(path.join(f.input.stateDirectory, 'client-first-run-initdb.lock'), 'utf8'), /INITDB_UNCONFIRMED/);
  await assert.rejects(initializeFreshClientPg17(f.input, hooks), /existing_state_requires_reconciliation/);
  assert.equal(attempts, 1);
});

test('concurrent owner attempts cannot both acquire fresh cluster', async t => {
  const f = await fixture(t);
  const outcomes = await Promise.allSettled([
    initializeFreshClientPg17(f.input, f.hooks),
    initializeFreshClientPg17(f.input, f.hooks),
  ]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(f.calls(), 1);
});

test('bundle verification and credential paths fail before PGDATA creation', async t => {
  const f = await fixture(t);
  await assert.rejects(initializeFreshClientPg17(f.input, {
    ...f.hooks, verifyBundle: async () => { throw new Error('synthetic_resource_tamper'); },
  }), /synthetic_resource_tamper/);
  await assert.rejects(fs.stat(f.input.stateDirectory), { code: 'ENOENT' });
  await assert.rejects(initializeFreshClientPg17({
    ...f.input, passwordFile: path.join(f.input.bundleDirectory, 'forbidden'),
  }, f.hooks));
  assert.equal(f.calls(), 0);
});

test('explicit fresh PG17 and Vault initializes one key before releasing the owner lock', async t => {
  const f = await fixture(t);
  let vaultCalls = 0;
  const hooks = { ...f.hooks, initializeVaultKey: async ({ dataDirectory }) => {
    vaultCalls++;
    assert.equal(dataDirectory, await fs.realpath(f.input.pgDataDirectory));
    const ownerLock = await fs.readFile(path.join(f.input.stateDirectory, 'client-first-run-initdb.lock'), 'utf8');
    assert.match(ownerLock, /INITDB_UNCONFIRMED/);
    await fs.writeFile(path.join(dataDirectory, 'client-vault.key'), 'a'.repeat(64) + '\n', { flag: 'wx', mode: 0o600 });
    return { created: true, key_file: path.join(dataDirectory, 'client-vault.key'), plaintext_key_logged: false };
  } };
  const receipt = await initializeFreshClientPg17({
    ...f.input, ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT',
  }, hooks);
  assert.equal(receipt.vault_key_created, true);
  assert.equal(receipt.runtime_ready, false);
  assert.equal(receipt.schema_provisioned, false);
  assert.equal(receipt.owner_profile_written, false);
  assert.equal(vaultCalls, 1);
  assert.equal((await fs.readFile(path.join(f.input.pgDataDirectory, 'client-vault.key'), 'utf8')).length, 65);
  await assert.rejects(fs.lstat(path.join(f.input.stateDirectory, 'client-first-run-initdb.lock')), { code: 'ENOENT' });
  await assert.rejects(initializeFreshClientPg17({ ...f.input,
    ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT',
  }, hooks), /existing_state_requires_reconciliation/);
  assert.equal(vaultCalls, 1);
});

test('uncertain Vault initialization retains PGDATA and owner review lock, never retries', async t => {
  const f = await fixture(t);
  let calls = 0;
  const hooks = { ...f.hooks, initializeVaultKey: async ({ dataDirectory }) => {
    calls++;
    await fs.writeFile(path.join(dataDirectory, 'client-vault.key'), 'partial');
    throw new Error('synthetic_vault_acl_interruption');
  } };
  const input = { ...f.input, ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT' };
  await assert.rejects(initializeFreshClientPg17(input, hooks), /incomplete_review_required/);
  assert.equal(await fs.readFile(path.join(f.input.pgDataDirectory, 'client-vault.key'), 'utf8'), 'partial');
  assert.match(await fs.readFile(path.join(f.input.stateDirectory, 'client-first-run-initdb.lock'), 'utf8'), /INITDB_UNCONFIRMED/);
  await assert.rejects(initializeFreshClientPg17(input, hooks), /existing_state_requires_reconciliation/);
  assert.equal(calls, 1);
});

test('Vault stage requires exact owner action, not a boolean or existing PGDATA', async t => {
  const f = await fixture(t);
  await assert.rejects(initializeFreshClientPg17({
    ...f.input, ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT_EXTRA',
  }, f.hooks), /owner_approval_required/);
  await assert.rejects(fs.lstat(f.input.stateDirectory), { code: 'ENOENT' });
  await fs.mkdir(f.input.pgDataDirectory, { recursive: true });
  await fs.writeFile(path.join(f.input.pgDataDirectory, 'PG_VERSION'), '17\n');
  await assert.rejects(initializeFreshClientPg17({
    ...f.input, ownerAction: 'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT',
  }, f.hooks), /existing_state_requires_reconciliation/);
});
