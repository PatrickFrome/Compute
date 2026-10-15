// Read-only, fail-closed qualification of a one-shot installed-Owner backup.
// Does not access PostgreSQL, credentials, chat content, or installation state.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readClientBackupAclNativeW58} from '../../apps/metaengine-browser/src/client-backup-acl-native-w58.mjs';
import { qualifyIndependentDisposableRestore } from './upgrade-backup-restore-gate.mjs';

const HEX = /^[a-f0-9]{64}$/;
const fail = reason => ({
  schema:'metaengine.installed-upgrade-backup-gate.v1',
  backup_verified:false, upgrade_authorized:false,
  automatic_retry_allowed:false, authority_effect:false, reason,
});
const canonical = s => process.platform === 'win32' ? s.toLowerCase() : s;

export async function verifyInstalledUpgradeBackup({receipt, archivePath, tocReadback, expected, restoreReceipt = null} = {}) {
  // W47 generated-fixture receipts can never replace an installed Owner backup.
  if (receipt?.evidence_class === 'SYNTHETIC/STAGING'
    || receipt?.schema === 'metaengine.client-backup-restore-staging-w47.v1')
    return fail('STAGING_BACKUP_CANNOT_QUALIFY_INSTALLED');
  if (!receipt || receipt.schema !== 'metaengine.local61.pre-upgrade-database-backup.v1'
    || receipt.state !== 'PASSED') return fail('RECEIPT_MISSING_OR_UNQUALIFIED');
  if (!expected || !Number.isSafeInteger(expected.keeperPid) || expected.keeperPid <= 0
    || !Number.isSafeInteger(expected.ownerPid) || expected.ownerPid <= 0
    || !HEX.test(expected.ownerSha256) || !HEX.test(expected.postmasterSha256)
    || typeof expected.backupDirectory !== 'string' || !path.isAbsolute(expected.backupDirectory))
    return fail('EXPECTED_IDENTITY_INVALID');
  if (receipt.keeper_pid !== expected.keeperPid
    || receipt.installed_primary_pid !== expected.ownerPid
    || receipt.owner_sha256 !== expected.ownerSha256
    || receipt.postmaster_sha256 !== expected.postmasterSha256)
    return fail('OWNER_OR_KEEPER_IDENTITY_CHANGED');
  if (receipt.installer_started !== false || receipt.working_database_modified !== false
    || receipt.authenticated_read_only_snapshot !== true
    || receipt.owner_dacl_verified !== true || receipt.secrets_included_in_receipt !== false
    || receipt.automatic_retry_allowed !== false)
    return fail('BACKUP_SAFETY_PROOF_MISSING');
  if (typeof archivePath !== 'string' || !path.isAbsolute(archivePath)
    || canonical(path.resolve(archivePath)) !== canonical(path.resolve(receipt.file || ''))
    || canonical(path.resolve(archivePath)) !== canonical(path.resolve(expected.backupDirectory,'postgresql-17-snapshot.dump'))
    || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1024
    || !HEX.test(receipt.file_sha256) || !HEX.test(receipt.toc_sha256)
    || !Number.isSafeInteger(receipt.toc_entries) || receipt.toc_entries < 100)
    return fail('ARCHIVE_MANIFEST_INVALID');
  if (typeof tocReadback !== 'string' || tocReadback.length > 16 * 1024 * 1024)
    return fail('INDEPENDENT_TOC_MISSING');
  const entries = tocReadback.split(/\r?\n/).filter(x => /^\d+;/.test(x));
  if (createHash('sha256').update(tocReadback).digest('hex') !== receipt.toc_sha256
    || entries.length !== receipt.toc_entries
    || !entries.some(x => / TABLE DATA /.test(x)))
    return fail('INDEPENDENT_TOC_MISMATCH');
  try {
    const before = await fs.lstat(archivePath);
    if (!before.isFile() || before.isSymbolicLink()
      || canonical(await fs.realpath(archivePath)) !== canonical(path.resolve(archivePath)))
      return fail('ARCHIVE_PATH_UNTRUSTED');
    if (before.size !== receipt.bytes) return fail('ARCHIVE_SIZE_MISMATCH');
    const h = createHash('sha256');
    let length = 0, first = Buffer.alloc(0);
    for await (const chunk of createReadStream(archivePath)) {
      length += chunk.length;
      if (first.length < 5) first = Buffer.concat([first, chunk]).subarray(0, 5);
      h.update(chunk);
    }
    const after = await fs.lstat(archivePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ino !== before.ino || length !== before.size)
      return fail('ARCHIVE_CHANGED_DURING_READ');
    if (first.toString('ascii') !== 'PGDMP' || h.digest('hex') !== receipt.file_sha256)
      return fail('ARCHIVE_BYTES_UNVERIFIED');
  } catch { return fail('ARCHIVE_READ_FAILED'); }
  // W58: POSIX mode and a self-asserted owner_dacl_verified are never NTFS
  // evidence. This default production path queries the actual Host/OS readback;
  // no caller can inject a verified=true ACL receipt here.
  const restore = qualifyIndependentDisposableRestore({
    receipt:restoreReceipt, backupReceipt:receipt, tocReadback, expected,
  });
  const acl = await readClientBackupAclNativeW58({
    backupDirectory: expected.backupDirectory, archivePath,
  });
  if (acl.native_acl_verified !== true)
    return {...fail('NATIVE_BACKUP_ACL_'+acl.reason),archive_integrity_verified:true,
      restore_verified:false,physical_restore_proven:false,
      restore_receipt_consistent:restore.restore_receipt_consistent,
      restore_reason:restore.reason};
  // Source/CI NTFS ACL proof does not attest an installed Owner incarnation.
  // W52/native Owner is separately required; keep installed backup UNKNOWN.
  // Only after independent archive bytes and TOC readback qualify the
  // standalone disposable-restore evidence. An archive header and listing
  // do NOT establish that it can reconstruct the actual user data.
  return {
    schema:'metaengine.installed-upgrade-backup-gate.v1',
    backup_verified:false,archive_integrity_verified:true,
    native_acl_verified:true,installed_owner_proven:false,independent_toc_bound:true,
    restore_receipt_consistent:restore.restore_receipt_consistent,
    restore_verified:false, physical_restore_proven:false,
    restore_reason:restore.reason,
    upgrade_authorized:false, // Later quiescence, identity, rollback & authority gates remain.
    automatic_retry_allowed:false, authority_effect:false,
    reason:'NATIVE_ACL_VERIFIED_INSTALLED_OWNER_UNKNOWN',
  };
}
