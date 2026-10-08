import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BACKUP_VERIFICATION_SCHEMA = 'metaengine.client-state.backup-verification.v1';
export const RESTORE_REPORT_SCHEMA = 'metaengine.database-restore-report.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const MD5 = /^[a-f0-9]{32}$/;
const DATABASE_REQUIRED = ['database.dump', 'database.sql', 'roles.sql', 'database-inventory.json', 'archive-toc.txt'];
const PLATFORM = ['config-auth.json', 'config-storage.json', 'config-database-postgres.json', 'functions.json', 'secrets.json'];
const requiredStages = {
  database: 'CONSISTENT_ALL_SCHEMA_DUMP', roles: 'METADATA_WITHOUT_LOGIN_PASSWORDS',
  archive: 'OFFLINE_FULL_SQL_EXTRACTION_VERIFIED',
};

const errorCode = (error) => ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code) ? error.code : error?.message?.startsWith('backup_') ? error.message : 'backup_read_failed';

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:\u0000-\u001f\u007f]/.test(value) || value.startsWith('/')) throw new Error('backup_path_invalid');
  if (value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('backup_path_invalid');
  return value;
}

async function containedFile(root, relative) {
  const parts = relativePath(relative).split('/');
  let file = root;
  for (let index = 0; index < parts.length; index++) {
    file = path.join(file, parts[index]);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('backup_file_type_invalid');
  }
  const actual = await fs.realpath(file);
  if (path.relative(root, actual).startsWith('..' + path.sep) || path.isAbsolute(path.relative(root, actual))) throw new Error('backup_path_escape');
  return file;
}

async function fileDigest(file) {
  const before = await fs.stat(file);
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; digest.update(chunk); }
  const after = await fs.stat(file);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes !== after.size) throw new Error('backup_file_changed_during_verification');
  return { bytes, sha256: digest.digest('hex') };
}

async function prefix(file, limit = 8192) {
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(limit);
    const result = await handle.read(bytes, 0, limit, 0);
    return bytes.subarray(0, result.bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

async function jsonDocument(file, maxBytes = 64 * 1024 * 1024) {
  const before = await fs.stat(file);
  if (before.size > maxBytes) throw new Error('backup_json_too_large');
  const bytes = await fs.readFile(file);
  const after = await fs.stat(file);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) throw new Error('backup_file_changed_during_verification');
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function tableMap(tables) {
  if (!Array.isArray(tables) || tables.length > 100000) throw new Error('backup_tables_invalid');
  const mapped = new Map();
  for (const row of tables) {
    if (!row || typeof row !== 'object' || typeof row.schema !== 'string' || typeof row.name !== 'string'
      || !row.schema || !row.name || /[\u0000-\u001f]/.test(row.schema + row.name)
      || typeof row.rows !== 'string' || !/^(?:0|[1-9]\d{0,39})$/.test(row.rows)
      || typeof row.content_md5 !== 'string' || !MD5.test(row.content_md5)) throw new Error('backup_table_row_invalid');
    const key = row.schema + '\0' + row.name;
    if (mapped.has(key)) throw new Error('backup_table_duplicate');
    mapped.set(key, row);
  }
  return mapped;
}

export function compareRestoreTables(source, restored) {
  const left = tableMap(source);
  const right = tableMap(restored);
  const differences = [];
  for (const [key, row] of left) {
    const other = right.get(key);
    if (!other) differences.push({ schema: row.schema, name: row.name, reason: 'TABLE_MISSING' });
    else {
      if (row.rows !== other.rows) differences.push({ schema: row.schema, name: row.name, reason: 'ROW_COUNT_MISMATCH', source_rows: row.rows, restored_rows: other.rows });
      if (row.content_md5 !== other.content_md5) differences.push({ schema: row.schema, name: row.name, reason: 'CONTENT_DIGEST_MISMATCH' });
    }
  }
  for (const [key, row] of right) if (!left.has(key)) differences.push({ schema: row.schema, name: row.name, reason: 'UNEXPECTED_TABLE' });
  return { source_tables: left.size, restored_tables: right.size, exact: differences.length === 0, differences,
    source_rows: [...left.values()].reduce((sum, row) => sum + BigInt(row.rows), 0n).toString() };
}

export async function verifyBackup({ root, expectedProject, restoreReportPath, expectedManifestSha256 } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('backup_absolute_root_required');
  if (typeof expectedProject !== 'string' || !/^[a-z0-9]{20}$/.test(expectedProject)) throw new Error('backup_expected_project_required');
  if (expectedManifestSha256 !== undefined && !SHA256.test(expectedManifestSha256)) throw new Error('backup_expected_manifest_digest_invalid');
  const archiveRoot = await fs.realpath(root);
  const result = {
    schema: BACKUP_VERIFICATION_SCHEMA, project: expectedProject, checked_at: new Date().toISOString(), status: 'INCOMPLETE',
    archive_integrity_verified: false, database_archive_complete: false, database_complete: false,
    restore_verified: false, restore_data_complete: false, restore_schema_exact: false,
    storage_bytes_complete: false, platform_metadata_complete: false, platform_recovery_complete: false,
    source_authenticity_attested: false, manifest_digest_externally_bound: expectedManifestSha256 !== undefined,
    data_policy: { classification: 'LOCAL_PRIVATE', remote_export_allowed: false },
    authority_effect: false, promotion_authorized: false, files: [], findings: [], limitations: [],
  };
  const issue = (code, details = {}) => result.findings.push({ code, ...details });
  let manifest;
  let manifestDigest;
  const files = new Map();
  try {
    const manifestFile = await containedFile(archiveRoot, 'backup-manifest.json');
    const document = await jsonDocument(manifestFile, 16 * 1024 * 1024);
    manifestDigest = { sha256: document.sha256 };
    result.manifest_sha256 = manifestDigest.sha256;
    manifest = document.value;
    if (manifest.schema !== 'metaengine.full-database-backup.v1' || manifest.project !== expectedProject) throw new Error('backup_source_identity_mismatch');
    if (expectedManifestSha256 && manifestDigest.sha256 !== expectedManifestSha256) throw new Error('backup_manifest_digest_mismatch');
    if (!['COMPLETE', 'DATABASE_COMPLETE_PLATFORM_PARTIAL'].includes(manifest.status) || manifest.database_complete !== true) issue('BACKUP_EXPORT_NOT_COMPLETED');
    for (const [stage, required] of Object.entries(requiredStages)) if (manifest.stages?.[stage] !== required) issue('DATABASE_STAGE_UNVERIFIED', { stage });
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('backup_file_manifest_missing');
    for (const entry of manifest.files) {
      relativePath(entry.path);
      if (entry.path === 'backup-manifest.json' || files.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !SHA256.test(entry.sha256)) throw new Error('backup_file_manifest_invalid');
      files.set(entry.path, entry);
    }
    for (const required of DATABASE_REQUIRED) if (!files.has(required)) issue('REQUIRED_DATABASE_FILE_NOT_BOUND', { path: required });
    for (const entry of files.values()) {
      try {
        const measured = await fileDigest(await containedFile(archiveRoot, entry.path));
        const verified = measured.bytes === entry.bytes && measured.sha256 === entry.sha256;
        result.files.push({ path: entry.path, ...measured, verified });
        if (!verified) issue('FILE_DIGEST_MISMATCH', { path: entry.path });
      } catch (error) { issue('FILE_READ_FAILED', { path: entry.path, detail: errorCode(error) }); }
    }
  } catch (error) {
    issue('MANIFEST_INVALID', { detail: errorCode(error) });
    return result;
  }
  const verified = (name) => result.files.some((entry) => entry.path === name && entry.verified);
  const boundJson = async (name) => {
    if (!verified(name)) throw new Error('backup_json_file_unverified');
    const document = await jsonDocument(await containedFile(archiveRoot, name));
    if (document.sha256 !== files.get(name).sha256) throw new Error('backup_file_changed_during_verification');
    return document.value;
  };
  result.archive_integrity_verified = result.files.length === files.size && result.files.every((entry) => entry.verified)
    && !result.findings.some((entry) => ['FILE_READ_FAILED', 'FILE_DIGEST_MISMATCH', 'REQUIRED_DATABASE_FILE_NOT_BOUND'].includes(entry.code));
  let inventory;
  try {
    if (!verified('database-inventory.json')) throw new Error('backup_inventory_unverified');
    inventory = await boundJson('database-inventory.json');
    if (typeof inventory.snapshot_id !== 'string' || !/^[a-f0-9-]{10,128}$/i.test(inventory.snapshot_id)
      || typeof inventory.database !== 'string' || !inventory.database
      || !['schemas', 'extensions', 'roles', 'functions', 'policies', 'publications'].every((key) => Array.isArray(inventory[key]))) throw new Error('backup_inventory_invalid');
    const tables = tableMap(inventory.tables);
    if (!tables.size || !inventory.roles.length) throw new Error('backup_inventory_empty');
    result.source_snapshot_id = inventory.snapshot_id;
    result.source_tables = tables.size;
    result.source_rows = [...tables.values()].reduce((sum, row) => sum + BigInt(row.rows), 0n).toString();
    if (!Number.isSafeInteger(inventory.vault_plaintext_rows) || inventory.vault_plaintext_rows < 0) throw new Error('backup_vault_count_invalid');
    if (inventory.vault_plaintext_rows > 0) {
      if (!verified('vault-private.json')) issue('VAULT_PLAINTEXT_NOT_BOUND');
      else {
        const secrets = await boundJson('vault-private.json');
        if (!Array.isArray(secrets) || secrets.length !== inventory.vault_plaintext_rows) issue('VAULT_PLAINTEXT_COUNT_MISMATCH');
      }
    }
    for (const [name, pattern] of [
      ['database.dump', /^PGDMP/], ['database.sql', /-- PostgreSQL database dump\b/],
      ['roles.sql', /-- (?:PostgreSQL database cluster dump\b|Role attributes from the consistent source snapshot; password hashes excluded\.)/], ['archive-toc.txt', /;\s*Format:\s*CUSTOM\b/],
    ]) if (!verified(name) || !(files.get(name).bytes > 0) || !pattern.test(await prefix(await containedFile(archiveRoot, name)))) issue('DATABASE_FILE_FORMAT_INVALID', { path: name });
    if (verified('roles.sql') && (await prefix(await containedFile(archiveRoot, 'roles.sql'))).startsWith('-- Role attributes from the consistent source snapshot')) {
      const memberships = await boundJson('roles-membership.json');
      if (!Array.isArray(memberships) || memberships.some((entry) => typeof entry.role !== 'string' || typeof entry.member !== 'string'
        || !['admin_option', 'inherit_option', 'set_option'].every((key) => typeof entry[key] === 'boolean'))) throw new Error('backup_roles_membership_invalid');
    }
  } catch (error) { issue('DATABASE_INVENTORY_INVALID', { detail: errorCode(error) }); }
  result.database_archive_complete = DATABASE_REQUIRED.every(verified) && inventory != null && !result.findings.some((entry) =>
    ['BACKUP_EXPORT_NOT_COMPLETED', 'DATABASE_STAGE_UNVERIFIED', 'VAULT_PLAINTEXT_NOT_BOUND', 'VAULT_PLAINTEXT_COUNT_MISMATCH', 'DATABASE_FILE_FORMAT_INVALID', 'DATABASE_INVENTORY_INVALID'].includes(entry.code));

  try {
    if (!verified('storage-buckets.json') || !verified('storage-object-manifest.json') || !inventory) throw new Error('backup_storage_inventory_unverified');
    const objects = await boundJson('storage-object-manifest.json');
    const buckets = await boundJson('storage-buckets.json');
    if (!Array.isArray(objects) || !Array.isArray(buckets)) throw new Error('backup_storage_shape_invalid');
    const bucketIds = new Set(buckets.map((bucket) => bucket.id));
    if (bucketIds.size !== buckets.length || [...bucketIds].some((value) => typeof value !== 'string' || !value)) throw new Error('backup_storage_buckets_invalid');
    const identities = new Set();
    for (const object of objects) {
      if (typeof object.bucket !== 'string' || !bucketIds.has(object.bucket) || typeof object.name !== 'string' || !object.name
        || !SHA256.test(object.sha256) || !Number.isSafeInteger(object.bytes) || object.bytes < 0) throw new Error('backup_storage_object_invalid');
      const identity = JSON.stringify([object.bucket, object.name]);
      if (identities.has(identity)) throw new Error('backup_storage_object_duplicate');
      identities.add(identity);
      const measured = await fileDigest(await containedFile(archiveRoot, `storage-blobs/${object.sha256}`));
      if (measured.bytes !== object.bytes || measured.sha256 !== object.sha256) throw new Error('backup_storage_blob_digest_mismatch');
    }
    const sourceObjects = inventory.tables.find((table) => table.schema === 'storage' && table.name === 'objects');
    const sourceBuckets = inventory.tables.find((table) => table.schema === 'storage' && table.name === 'buckets');
    if (!sourceObjects || !sourceBuckets || BigInt(sourceObjects.rows) !== BigInt(objects.length) || BigInt(sourceBuckets.rows) !== BigInt(buckets.length)) throw new Error('backup_storage_source_count_mismatch');
    if (!['ALL_BYTES_MATCH_OBJECT_COUNT', 'EMPTY_CONFIRMED_BY_DATABASE_SNAPSHOT'].includes(manifest.stages?.storage_objects)) throw new Error('backup_storage_stage_unverified');
    if (manifest.stages.storage_objects === 'EMPTY_CONFIRMED_BY_DATABASE_SNAPSHOT' && (objects.length || buckets.length)) throw new Error('backup_storage_empty_claim_conflict');
    result.storage_objects = objects.length;
    result.storage_buckets = buckets.length;
    result.storage_bytes_complete = true;
  } catch (error) { issue('STORAGE_BYTES_INCOMPLETE', { detail: errorCode(error) }); }

  const postgrestBound = (verified('config-postgrest.json') && manifest.stages?.['/config/postgrest'] === 'EXPORTED')
    || (verified('postgrest.json') && manifest.stages?.['/postgrest'] === 'EXPORTED');
  const platformFiles = PLATFORM.every(verified) && postgrestBound;
  const edgeMetadata = verified('functions.json') ? await boundJson('functions.json').catch(() => null) : null;
  const edges = Array.isArray(edgeMetadata) ? edgeMetadata : null;
  const edgeSources = [...files.keys()].filter((name) => name.startsWith('platform/') && /\.(?:ts|js|mjs|json)$/.test(name));
  const metadataStages = ['/config/auth', '/config/storage', '/config/database/postgres', '/functions', '/secrets'].every((stage) => manifest.stages?.[stage] === 'EXPORTED');
  result.platform_metadata_complete = platformFiles && metadataStages && edges !== null && manifest.stages?.edge_sources === 'EXPORTED'
    && edges.every((edge) => typeof edge.slug === 'string' && edgeSources.some((name) => name.includes(`/functions/${edge.slug}/`)))
    && edgeSources.every(verified);
  if (!result.platform_metadata_complete) issue('PLATFORM_METADATA_OR_EDGE_SOURCE_NOT_BOUND');

  if (restoreReportPath) {
    try {
      if (!path.isAbsolute(restoreReportPath) || !(await fs.lstat(restoreReportPath)).isFile() || (await fs.lstat(restoreReportPath)).isSymbolicLink()) throw new Error('backup_restore_report_path_invalid');
      const reportDocument = await jsonDocument(restoreReportPath);
      const report = reportDocument.value;
      result.restore_report_sha256 = reportDocument.sha256;
      if (report.schema !== RESTORE_REPORT_SCHEMA || report.source_project !== expectedProject
        || report.source_snapshot_id !== inventory?.snapshot_id || report.source_dump_sha256 !== files.get('database.dump')?.sha256
        || report.source_inventory_sha256 !== files.get('database-inventory.json')?.sha256) throw new Error('backup_restore_source_binding_mismatch');
      if (!Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.ddl_adaptations)) throw new Error('backup_restore_errors_or_adaptations_invalid');
      const comparison = compareRestoreTables(inventory.tables, report.tables);
      result.restore_comparison = comparison;
      result.restore_data_complete = result.database_archive_complete && comparison.exact;
      result.restore_ddl_adaptations = report.ddl_adaptations;
      result.restore_schema_exact = report.schema_verified === true && report.ddl_adaptations.length === 0;
      result.restore_verified = result.restore_data_complete;
      if (!comparison.exact) issue('RESTORE_TABLES_DIFFER');
      if (!result.restore_schema_exact) issue('RESTORE_SCHEMA_EXACTNESS_NOT_PROVEN');
    } catch (error) { issue('RESTORE_REPORT_INVALID', { detail: errorCode(error) }); }
  } else issue('RESTORE_REPORT_MISSING');
  result.database_complete = result.database_archive_complete && result.restore_data_complete && result.restore_schema_exact;
  result.limitations = [
    'File digests bind bytes to the supplied manifest; this is not independent source authentication.',
    'A table content_md5 comparison detects row drift; it does not attest all PostgreSQL DDL, grants or executable code.',
    'Role login password hashes are intentionally excluded; Edge secrets metadata does not contain plaintext secrets.',
    'Platform configuration and Storage bytes are captured after the database snapshot and are not transactionally consistent with it.',
    'No upload is supported; dumps, private rows, configuration and restore evidence remain LOCAL_PRIVATE.',
  ];
  if (result.database_complete && result.storage_bytes_complete) result.status = 'DATABASE_VERIFIED_PLATFORM_CAVEATS';
  else if (result.database_archive_complete && result.restore_data_complete) result.status = 'DATA_RESTORE_VERIFIED_SCHEMA_CAVEATS';
  else if (result.database_archive_complete) result.status = 'ARCHIVE_VERIFIED_RESTORE_UNPROVEN';
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [root, expectedProject, restoreReportPath, expectedManifestSha256] = process.argv.slice(2);
  verifyBackup({ root, expectedProject, restoreReportPath, expectedManifestSha256 }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.database_archive_complete || !result.storage_bytes_complete) process.exitCode = 1;
  }).catch((error) => { console.error(errorCode(error)); process.exitCode = 1; });
}
