import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compareRestoreTables, verifyBackup, RESTORE_REPORT_SCHEMA } from '../backup-verifier.mjs';

const project = 'jhriwwsryeqsvvvufkok';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const row = (schema, name, rows = '0', content_md5 = crypto.createHash('md5').update('').digest('hex')) => ({ schema, name, rows, content_md5 });

async function fixture(t, { withObject = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-backup-verifier-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const objectBytes = Buffer.from('private object bytes');
  const objectDigest = hash(objectBytes);
  const inventory = {
    database: 'postgres', snapshot_id: '00000003-00000008-1',
    schemas: [], extensions: [], roles: [{ rolname: 'postgres' }], functions: [], policies: [], publications: [],
    tables: [row('public', 'state', '12', 'a'.repeat(32)), row('storage', 'objects', withObject ? '1' : '0'), row('storage', 'buckets', withObject ? '1' : '0')],
    vault_plaintext_rows: 0,
  };
  const manifest = { schema: 'metaengine.full-database-backup.v1', project, database_complete: true, status: 'DATABASE_COMPLETE_PLATFORM_PARTIAL',
    stages: { database: 'CONSISTENT_ALL_SCHEMA_DUMP', roles: 'METADATA_WITHOUT_LOGIN_PASSWORDS', archive: 'OFFLINE_FULL_SQL_EXTRACTION_VERIFIED', storage_objects: 'ALL_BYTES_MATCH_OBJECT_COUNT' }, files: [] };
  const objects = withObject ? [{ bucket: 'private', name: 'rows/private.json', sha256: objectDigest, bytes: objectBytes.length }] : [];
  const writeBound = async (name, data) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), bytes);
    manifest.files = manifest.files.filter((entry) => entry.path !== name);
    manifest.files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  };
  await writeBound('database.dump', 'PGDMP controlled format fixture');
  await writeBound('database.sql', '--\n-- PostgreSQL database dump\n--\n');
  await writeBound('roles.sql', '-- PostgreSQL database cluster dump\n');
  await writeBound('archive-toc.txt', '; Format: CUSTOM\n');
  await writeBound('database-inventory.json', inventory);
  await writeBound('storage-buckets.json', withObject ? [{ id: 'private' }] : []);
  await writeBound('storage-object-manifest.json', objects);
  if (withObject) {
    await fs.mkdir(path.join(root, 'storage-blobs'));
    await fs.writeFile(path.join(root, 'storage-blobs', objectDigest), objectBytes);
  }
  const saveManifest = () => fs.writeFile(path.join(root, 'backup-manifest.json'), JSON.stringify(manifest));
  await saveManifest();
  const report = {
    schema: RESTORE_REPORT_SCHEMA, source_project: project, source_snapshot_id: inventory.snapshot_id,
    source_dump_sha256: manifest.files.find((file) => file.path === 'database.dump').sha256,
    source_inventory_sha256: manifest.files.find((file) => file.path === 'database-inventory.json').sha256,
    tables: structuredClone(inventory.tables), errors: [], ddl_adaptations: [], schema_verified: true,
  };
  const reportPath = path.join(root, 'restore-report.json');
  const saveReport = () => fs.writeFile(reportPath, JSON.stringify(report));
  await saveReport();
  const verify = (args = {}) => verifyBackup({ root, expectedProject: project, ...args });
  return { root, inventory, manifest, report, reportPath, writeBound, saveManifest, saveReport, verify, objectDigest };
}

test('hash-verified archive is distinct from restored database and recoverable platform', async (t) => {
  const f = await fixture(t);
  const backup = await f.verify();
  assert.equal(backup.archive_integrity_verified, true);
  assert.equal(backup.database_archive_complete, true);
  assert.equal(backup.storage_bytes_complete, true);
  assert.equal(backup.database_complete, false);
  assert.equal(backup.restore_verified, false);
  assert.equal(backup.status, 'ARCHIVE_VERIFIED_RESTORE_UNPROVEN');
  const restored = await f.verify({ restoreReportPath: f.reportPath });
  assert.equal(restored.database_complete, true);
  assert.equal(restored.restore_comparison.source_tables, 3);
  assert.equal(restored.restore_comparison.source_rows, '12');
  assert.equal(restored.platform_recovery_complete, false);
  assert.equal(restored.source_authenticity_attested, false);
  assert.deepEqual(restored.data_policy, { classification: 'LOCAL_PRIVATE', remote_export_allowed: false });
});

test('same row counts with altered contents and missing/extra tables fail restore proof', async (t) => {
  const f = await fixture(t);
  f.report.tables[0].content_md5 = 'b'.repeat(32);
  await f.saveReport();
  const result = await f.verify({ restoreReportPath: f.reportPath });
  assert.equal(result.restore_verified, false);
  assert.equal(result.database_complete, false);
  assert.equal(result.restore_comparison.differences[0].reason, 'CONTENT_DIGEST_MISMATCH');
  const comparison = compareRestoreTables(f.inventory.tables, [row('public', 'different', '12')]);
  assert.equal(comparison.exact, false);
  assert.ok(comparison.differences.some((item) => item.reason === 'TABLE_MISSING'));
  assert.ok(comparison.differences.some((item) => item.reason === 'UNEXPECTED_TABLE'));
});

test('schema adaptations cannot be labeled an exact PostgreSQL restore', async (t) => {
  const f = await fixture(t);
  f.report.ddl_adaptations = ['supabase extension replaced for portable profile'];
  await f.saveReport();
  const result = await f.verify({ restoreReportPath: f.reportPath });
  assert.equal(result.restore_data_complete, true);
  assert.equal(result.restore_schema_exact, false);
  assert.equal(result.database_complete, false);
  assert.equal(result.status, 'DATA_RESTORE_VERIFIED_SCHEMA_CAVEATS');
});

test('source dump, snapshot, inventory and external manifest bindings must all match', async (t) => {
  const f = await fixture(t);
  for (const key of ['source_dump_sha256', 'source_inventory_sha256', 'source_snapshot_id', 'source_project']) {
    const saved = f.report[key];
    f.report[key] = key.includes('sha256') ? 'c'.repeat(64) : 'another-source';
    await f.saveReport();
    const result = await f.verify({ restoreReportPath: f.reportPath });
    assert.equal(result.restore_verified, false, key);
    assert.equal(result.findings.some((item) => item.code === 'RESTORE_REPORT_INVALID'), true);
    f.report[key] = saved;
  }
  const mismatched = await f.verify({ expectedManifestSha256: 'd'.repeat(64) });
  assert.equal(mismatched.archive_integrity_verified, false);
  assert.equal(mismatched.findings[0].detail, 'backup_manifest_digest_mismatch');
});

test('file existence, claimed COMPLETE, empty dump and missing MD5 never suffice', async (t) => {
  const f = await fixture(t);
  f.manifest.status = 'COMPLETE';
  f.manifest.stages.database = 'STARTED';
  await f.saveManifest();
  assert.equal((await f.verify()).database_archive_complete, false);
  f.manifest.stages.database = 'CONSISTENT_ALL_SCHEMA_DUMP';
  await f.writeBound('database.dump', '');
  await f.saveManifest();
  assert.equal((await f.verify()).database_archive_complete, false);
  await f.writeBound('database.dump', 'PGDMP controlled format fixture');
  delete f.inventory.tables[0].content_md5;
  await f.writeBound('database-inventory.json', f.inventory);
  await f.saveManifest();
  assert.equal((await f.verify()).database_archive_complete, false);
});

test('immutable digests detect private backup tampering', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'roles.sql'), '-- PostgreSQL database cluster dump\nALTER ROLE postgres SUPERUSER;');
  const result = await f.verify({ restoreReportPath: f.reportPath });
  assert.equal(result.database_archive_complete, false);
  assert.equal(result.archive_integrity_verified, false);
  assert.ok(result.findings.some((item) => item.code === 'FILE_DIGEST_MISMATCH' && item.path === 'roles.sql'));
});

test('Storage bytes require inventory counts and each actual blob digest', async (t) => {
  const f = await fixture(t, { withObject: true });
  assert.equal((await f.verify()).storage_bytes_complete, true);
  await fs.writeFile(path.join(f.root, 'storage-blobs', f.objectDigest), 'changed');
  const corrupt = await f.verify();
  assert.equal(corrupt.database_archive_complete, true);
  assert.equal(corrupt.storage_bytes_complete, false);
  assert.equal(corrupt.findings.find((item) => item.code === 'STORAGE_BYTES_INCOMPLETE').detail, 'backup_storage_blob_digest_mismatch');
});

test('unbound platform files do not become verified metadata by mere presence', async (t) => {
  const f = await fixture(t);
  for (const name of ['config-auth.json', 'config-storage.json', 'config-postgrest.json', 'config-database-postgres.json', 'functions.json', 'secrets.json']) await fs.writeFile(path.join(f.root, name), '[]');
  f.manifest.platform_complete = true;
  await f.saveManifest();
  const result = await f.verify();
  assert.equal(result.database_archive_complete, true);
  assert.equal(result.platform_metadata_complete, false);
  assert.equal(result.platform_recovery_complete, false);
});

test('bound deployed Edge source verifies metadata but not missing plaintext secrets', async (t) => {
  const f = await fixture(t);
  for (const name of ['config-auth.json', 'config-storage.json', 'config-postgrest.json', 'config-database-postgres.json', 'secrets.json']) await f.writeBound(name, {});
  await f.writeBound('functions.json', [{ slug: 'supervisor' }]);
  await f.writeBound('platform/supabase/functions/supervisor/index.ts', 'export const actualDeployedBytes = true;');
  for (const stage of ['/config/auth', '/config/storage', '/config/postgrest', '/config/database/postgres', '/functions', '/secrets']) f.manifest.stages[stage] = 'EXPORTED';
  f.manifest.stages.edge_sources = 'EXPORTED';
  await f.saveManifest();
  const result = await f.verify({ restoreReportPath: f.reportPath });
  assert.equal(result.platform_metadata_complete, true);
  assert.equal(result.platform_recovery_complete, false);
  assert.equal(result.database_complete, true);
  assert.ok(result.limitations.some((value) => value.includes('plaintext')));
});

test('positive vault rows require a bound plaintext export with exact record count', async (t) => {
  const f = await fixture(t);
  f.inventory.vault_plaintext_rows = 2;
  await f.writeBound('database-inventory.json', f.inventory);
  await f.saveManifest();
  assert.equal((await f.verify()).database_archive_complete, false);
  await f.writeBound('vault-private.json', [{ id: 'secret-1' }]);
  await f.saveManifest();
  assert.equal((await f.verify()).database_archive_complete, false);
  await f.writeBound('vault-private.json', [{ id: 'secret-1' }, { id: 'secret-2' }]);
  await f.saveManifest();
  assert.equal((await f.verify()).database_archive_complete, true);
});

test('manifest traversal and junctions are rejected before reading outside backup', async (t) => {
  const f = await fixture(t);
  f.manifest.files.push({ path: '../outside.sql', bytes: 0, sha256: hash('') });
  await f.saveManifest();
  assert.equal((await f.verify()).findings[0].detail, 'backup_path_invalid');
  f.manifest.files.pop();
  await f.saveManifest();
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-backup-external-'));
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.unlink(path.join(f.root, 'database.sql'));
  try { await fs.symlink(path.join(external, 'private.sql'), path.join(f.root, 'database.sql'), 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    await fs.mkdir(path.join(f.root, 'database.sql'));
  }
  const result = await f.verify();
  assert.equal(result.database_archive_complete, false);
  assert.equal(result.findings.find((item) => item.path === 'database.sql').detail, 'backup_file_type_invalid');
});
