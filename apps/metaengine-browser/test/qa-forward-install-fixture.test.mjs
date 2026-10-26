import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { copyForwardPostgresRuntime, forwardFixtureEnvironment, forwardSchemaOnlyRestorePlan,
  provisionForwardFixture, validateForwardSchemaFixture, assertForwardFixtureSqlIdentity,
  assertForwardPostgresCleanShutdown } from '../scripts/qa-forward-install-fixture.mjs';
import { captureInstalledTreeFingerprint } from '../scripts/qa-installed-tree-fingerprint.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const head = 'a'.repeat(40), sha = 'b'.repeat(64);
const required = ['bin/postgres.exe', 'bin/psql.exe', 'bin/initdb.exe', 'bin/pg_ctl.exe',
  'bin/pg_isready.exe', 'bin/pg_restore.exe', 'bin/pg_controldata.exe', 'lib/plpgsql.dll', 'share/postgres.bki'];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forward-fixture-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'pinned-runtime'), destination = path.join(root, 'external-runtime');
  const files = [];
  for (const relative of required) {
    const file = path.join(source, relative), bytes = Buffer.from('inert unit fixture: ' + relative);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes);
    files.push({ path: 'runtime/postgresql/' + relative, component: 'postgresql', kind: 'postgres_resource', bytes: bytes.length, sha256: digest(bytes) });
  }
  const expectedTreeSha256 = (await captureInstalledTreeFingerprint(source)).tree_sha256;
  return { root, source, destination, expectedTreeSha256, verified: { manifest: { files }, paths: { postgresBinDirectory: path.join(source, 'bin') } } };
}

test('copied PG runtime preserves the complete pinned bin/lib/share inventory with independent regular files', async t => {
  const f = await fixture(t);
  const result = await copyForwardPostgresRuntime(f);
  assert.equal(result.source_tree_sha256, f.expectedTreeSha256);
  assert.equal(result.runtime_tree_sha256, f.expectedTreeSha256);
  assert.equal(result.file_count, required.length);
  for (const name of required) {
    assert.deepEqual(await fs.readFile(path.join(f.source, name)), await fs.readFile(path.join(f.destination, name)));
    const original = await fs.stat(path.join(f.source, name)), copied = await fs.stat(path.join(f.destination, name));
    assert.equal(copied.nlink, 1); assert.notEqual(copied.ino, original.ino);
  }
});

test('runtime changed after artifact qualification refuses before creating a copied destination', async t => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.source, 'bin/postgres.exe'), 'mutated');
  await assert.rejects(copyForwardPostgresRuntime(f), /pg_source_inventory_changed/);
  await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' });
});

test('hardlinked PG source is rejected before copy', async t => {
  const f = await fixture(t);
  await fs.link(path.join(f.source, 'bin/postgres.exe'), path.join(f.root, 'foreign-hardlink'));
  await assert.rejects(copyForwardPostgresRuntime(f), /path_type_invalid|nonregular_or_hardlinked_file/);
  await assert.rejects(fs.lstat(f.destination), { code: 'ENOENT' });
});

test('junction or symlink destination ancestor cannot redirect the runtime copy', async t => {
  const f = await fixture(t), real = path.join(f.root, 'real-parent'), alias = path.join(f.root, 'alias-parent');
  await fs.mkdir(real); await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(copyForwardPostgresRuntime({ ...f, destination: path.join(alias, 'copy') }), /path_alias_forbidden/);
  await assert.rejects(fs.lstat(path.join(real, 'copy')), { code: 'ENOENT' });
});

test('source containment, missing share resources and traversal records cannot be copied', async t => {
  const f = await fixture(t);
  await assert.rejects(copyForwardPostgresRuntime({ ...f, destination: path.join(f.source, 'nested') }), /pg_copy_scope_overlap/);
  const missing = { ...f.verified, manifest: { files: f.verified.manifest.files.filter(row => !row.path.endsWith('postgres.bki')) } };
  await assert.rejects(copyForwardPostgresRuntime({ ...f, verified: missing }), /pg_inventory_incomplete/);
  const invalid = { ...f.verified, manifest: { files: [...f.verified.manifest.files,
    { path: 'runtime/postgresql/bin/../../escape', component: 'postgresql', kind: 'postgres_resource', bytes: 1, sha256: sha }] } };
  await assert.rejects(copyForwardPostgresRuntime({ ...f, verified: invalid }), /pg_inventory_invalid/);
});

test('an omitted source file cannot disappear silently from a copied full-tree inventory', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'share/extra-required.dat'), 'extra');
  f.expectedTreeSha256 = (await captureInstalledTreeFingerprint(f.source)).tree_sha256;
  await assert.rejects(copyForwardPostgresRuntime(f), /pg_copy_inventory_changed/);
  assert.equal(await fs.readFile(path.join(f.source, 'share/extra-required.dat'), 'utf8'), 'extra');
  assert.equal((await fs.stat(f.destination)).isDirectory(), true, 'partial copy retained for explicit review');
});

test('existing destination cannot be overwritten or retried', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.destination); await fs.writeFile(path.join(f.destination, 'hold'), 'preserve');
  await assert.rejects(copyForwardPostgresRuntime(f), /existing_state_requires_review/);
  assert.equal(await fs.readFile(path.join(f.destination, 'hold'), 'utf8'), 'preserve');
});

test('legacy predecessor-sidecar declarations cannot substitute for independently qualified canonical schema', () => {
  const old = { file: path.join(os.tmpdir(), 'predecessor-empty-schema.dump'), sha256: sha, source_head: head,
    kind: 'REVIEWED_OFFLINE_EMPTY_SCHEMA', source_data_rows: 0, synthetic_rpc_bodies: false };
  for (const value of [undefined, null, {}, old, { ...old, source_data_rows: 3 }, { ...old, synthetic_rpc_bodies: true }])
    assert.throws(() => validateForwardSchemaFixture(value), /reviewed_empty_schema_required/);
});

test('schema-only restore keeps ACLs while excluding rows, event triggers, connectors and environment extensions', () => {
  const lines = ['; Dumped from database version: 17.11',
    '1; 1259 100 TABLE public example state_owner',
    '2; 0 0 TABLE DATA public example state_owner',
    '3; 0 0 SEQUENCE SET public example_id state_owner',
    '4; 0 0 ACL public FUNCTION example() state_owner',
    '5; 0 0 EVENT TRIGGER - unsafe state_owner',
    '6; 0 0 SERVER - external state_owner',
    '7; 0 0 FOREIGN TABLE public external state_owner',
    '8; 0 0 EXTENSION - pgcrypto state_owner',
    '9; 0 0 SCHEMA - vault state_owner'];
  const plan = forwardSchemaOnlyRestorePlan(lines.join('\n'));
  assert.deepEqual(plan.selected, [lines[1], lines[4]]);
  assert.equal(plan.omitted.length, 7);
  assert.throws(() => forwardSchemaOnlyRestorePlan(lines.join('\n').replace('17.11', '16.9')), /pg17_schema_archive_required/);
  assert.throws(() => forwardSchemaOnlyRestorePlan(lines.join('\n') + '\nmalformed entry'), /schema_archive_toc_invalid/);
});

test('private tool environments cannot inherit external database credentials, provider selection or token-bearing hooks', () => {
  const result = forwardFixtureEnvironment({ APPDATA: 'fixture-appdata', SystemRoot: 'C:\\Windows',
    PGPASSWORD: 'foreign', PGHOST: 'foreign-server', SUPABASE_URL: 'external', LOCAL_STATE_DATABASE_URL: 'foreign',
    COMPUTE_RUNTIME_HOST_CONFIG: 'foreign', METAENGINE_STATE_PROVIDER: 'HOSTED', NODE_OPTIONS: '--require foreign',
    GH_TOKEN: 'token', GITHUB_TOKEN: 'token', ACTIONS_RUNTIME_TOKEN: 'token', DENO_AUTH_TOKENS: 'token' }, { PGHOST: '127.0.0.1' });
  assert.deepEqual(result, { APPDATA: 'fixture-appdata', SystemRoot: 'C:\\Windows', PGHOST: '127.0.0.1' });
});

test('SQL identity must read the exact native-bound PID file without equating PID epoch and SQL startup time', () => {
  const dataDirectory = path.join(os.tmpdir(), 'new-disposable-pgdata');
  const pidBytes = Buffer.from('1234\n' + dataDirectory + '\n100\n15432\n\n127.0.0.1\nready\n');
  const expected = { expectedClusterSystemIdentifier: '1234567890', expectedPort: 15432, expectedUser: 'state_owner', dataDirectory, pidBytes };
  const actual = { cluster_system_identifier: expected.expectedClusterSystemIdentifier, database_port: 15432,
    database_name: 'postgres', database_user: 'state_owner', pg_data_directory: dataDirectory,
    postmaster_started_at: new Date(102000).toISOString(), postmaster_pid_file: pidBytes.toString('utf8') };
  assert.equal(assertForwardFixtureSqlIdentity(actual, expected), true, 'SQL start can follow PID-file initialization');
  for (const changed of [{ postmaster_pid_file: actual.postmaster_pid_file.replace('1234', '1235') },
    { cluster_system_identifier: '987654321' }, { database_port: 15433 }, { database_user: 'foreign_owner' },
    { pg_data_directory: path.join(os.tmpdir(), 'other-pgdata') }, { postmaster_started_at: 'unobserved' }]) {
    assert.throws(() => assertForwardFixtureSqlIdentity({ ...actual, ...changed }, expected), /postgres_sql_identity_unverified/);
  }
});

test('clean shutdown requires real control readback bound to this cluster and rejects recovery, running and ambiguous output', () => {
  const output = 'pg_control version number:            1700\r\nDatabase system identifier:            1234567890\r\nDatabase cluster state:               shut down\r\n';
  const proof = assertForwardPostgresCleanShutdown(output, '1234567890');
  assert.equal(proof.clean_shutdown_verified, true); assert.equal(proof.control_readback_sha256, digest(output));
  for (const invalid of [output.replace('shut down', 'in production'), output.replace('shut down', 'shut down in recovery'),
    output.replace('1234567890', '1234567891'), output + 'Database cluster state: shut down\n',
    output + 'Database system identifier: 1234567890\n', '']) {
    assert.throws(() => assertForwardPostgresCleanShutdown(invalid, '1234567890'), /postgres_clean_shutdown_unverified/);
  }
});

test('physical fixture cannot run on a non-Windows host', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(provisionForwardFixture({}), /windows_required/);
});
