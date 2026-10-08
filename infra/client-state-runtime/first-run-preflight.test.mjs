import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectClientFirstRun } from './first-run-preflight.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-client-first-run-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundleDirectory = path.join(root, 'verified-bundle');
  await fs.mkdir(bundleDirectory);
  return { root, bundleDirectory, stateDirectory: path.join(root, 'private-state'),
    pgDataDirectory: path.join(root, 'private-state', 'pg17'),
    runtimeConfigFile: path.join(root, 'private-state', 'host-config.json'),
    ownerFile: path.join(root, 'roaming', 'metaengine-state-provider-v1.json') };
}

test('fresh layout yields read-only preparation review, never authority or PGDATA', async t => {
  const f = await fixture(t);
  const before = await fs.readdir(f.root);
  const result = await inspectClientFirstRun(f);
  assert.equal(result.state, 'PREPARATION_REVIEW_REQUIRED');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.initialization_authorized, false);
  assert.equal(result.hosted_fallback_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.pgdata_created, false);
  assert.equal(result.vault_key_created, false);
  assert.equal(result.profile_written, false);
  assert.equal(JSON.stringify(result).includes(f.root), false, 'private paths must not reach public status');
  assert.deepEqual(await fs.readdir(f.root), before);
  await assert.rejects(fs.stat(f.stateDirectory), { code: 'ENOENT' });
});

test('existing PostgreSQL data and unrelated private bytes force reconciliation, without writes', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.pgDataDirectory, { recursive: true });
  const marker = path.join(f.pgDataDirectory, 'PG_VERSION');
  await fs.writeFile(marker, '17\n');
  const out = await inspectClientFirstRun(f);
  assert.equal(out.state, 'HOLD_EXISTING_PRIVATE_STATE');
  assert(out.reasons.includes('EXISTING_PGDATA_RECONCILIATION_REQUIRED'));
  assert.equal(await fs.readFile(marker, 'utf8'), '17\n');
  assert.equal(out.initialization_authorized, false);
});

test('an existing owner or private runtime config never receives first-run permission', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.dirname(f.ownerFile), { recursive: true });
  await fs.writeFile(f.ownerFile, '{private-owner-data}');
  assert((await inspectClientFirstRun(f)).reasons.includes('EXISTING_OWNER_RECONCILIATION_REQUIRED'));
  await fs.mkdir(f.stateDirectory);
  await fs.writeFile(f.runtimeConfigFile, '{private-runtime-data}');
  const result = await inspectClientFirstRun(f);
  assert(result.reasons.includes('EXISTING_PRIVATE_CONFIG_RECONCILIATION_REQUIRED'));
  assert.equal(await fs.readFile(f.ownerFile, 'utf8'), '{private-owner-data}');
});

test('missing bundle, repository overlap and PGDATA outside owner state fail closed', async t => {
  const f = await fixture(t);
  const other = path.join(f.root, 'missing-bundle');
  await assert.rejects(inspectClientFirstRun({ ...f, bundleDirectory: other }), /bundle_missing/);
  await assert.rejects(inspectClientFirstRun({ ...f, pgDataDirectory: path.join(f.root, 'other-data') }), /private_layout_invalid/);
  await assert.rejects(inspectClientFirstRun({ ...f, stateDirectory: f.bundleDirectory,
    pgDataDirectory: path.join(f.bundleDirectory, 'pgdata'),
    runtimeConfigFile: path.join(f.bundleDirectory, 'config.json') }), /private_layout_invalid/);
});

test('symlink or junction ancestors are rejected for both owner and database', async t => {
  const f = await fixture(t);
  const actual = path.join(f.root, 'actual');
  await fs.mkdir(actual);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectClientFirstRun({
    ...f, ownerFile: path.join(alias, 'owner.json'),
  }), /reparse_point_denied/);
  await assert.rejects(inspectClientFirstRun({
    ...f, stateDirectory: path.join(alias, 'state'),
    pgDataDirectory: path.join(alias, 'state', 'pgdata'),
    runtimeConfigFile: path.join(alias, 'state', 'host.json'),
  }), /reparse_point_denied/);
});

test('existing nonempty state directory, even without PGDATA, requires explicit reconciliation', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.stateDirectory);
  await fs.writeFile(path.join(f.stateDirectory, 'unrecognized-owner-data'), 'DO NOT DELETE');
  const result = await inspectClientFirstRun(f);
  assert.equal(result.state, 'HOLD_EXISTING_PRIVATE_STATE');
  assert.deepEqual(result.reasons, ['EXISTING_PRIVATE_STATE_RECONCILIATION_REQUIRED']);
  assert.equal(await fs.readFile(path.join(f.stateDirectory, 'unrecognized-owner-data'), 'utf8'), 'DO NOT DELETE');
});
