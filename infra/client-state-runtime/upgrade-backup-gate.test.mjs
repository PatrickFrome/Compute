import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyInstalledUpgradeBackup} from './upgrade-backup-gate.mjs';

const hash = x => createHash('sha256').update(x).digest('hex');
const toc = Array.from({length:105},(_,i) => String(i+1)+'; 1 0 TABLE DATA public synthetic'+i+' owner').join('\n')+'\n';
const expected = {keeperPid:10776,ownerPid:2888,ownerSha256:'a'.repeat(64),postmasterSha256:'b'.repeat(64)};
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-backup-gate-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const archivePath=path.join(root,'postgresql-17-snapshot.dump');
  const bytes=Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(4096,31)]);
  await fs.writeFile(archivePath,bytes);
  const receipt={schema:'metaengine.local61.pre-upgrade-database-backup.v1',state:'PASSED',
    file:archivePath,file_sha256:hash(bytes),bytes:bytes.length,
    toc_sha256:hash(toc),toc_entries:105,keeper_pid:10776,installed_primary_pid:2888,
    owner_sha256:expected.ownerSha256,postmaster_sha256:expected.postmasterSha256,
    installer_started:false,working_database_modified:false,
    authenticated_read_only_snapshot:true,owner_dacl_verified:true,
    secrets_included_in_receipt:false,automatic_retry_allowed:false};
  return {archivePath,receipt,expected:{...expected,backupDirectory:root},tocReadback:toc};
}
test('pinned archive and TOC cannot substitute for native NTFS DACL and installed Owner',async t=>{
  const o=await fixture(t), r=await verifyInstalledUpgradeBackup(o);
  assert.equal(r.backup_verified,false);assert.equal(r.archive_integrity_verified,true);
  assert.match(r.reason,/^NATIVE_BACKUP_ACL_/);assert.equal(r.upgrade_authorized,false);assert.equal(r.automatic_retry_allowed,false);
});
test('failed one-shot pg_dump has no acceptable receipt',async t=>{
  const o=await fixture(t);o.receipt=null;
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'RECEIPT_MISSING_OR_UNQUALIFIED');
});
test('zero-byte or truncated archive is rejected',async t=>{
  const o=await fixture(t);await fs.writeFile(o.archivePath,Buffer.alloc(0));
  assert.equal((await verifyInstalledUpgradeBackup(o)).backup_verified,false);
});
test('stale or different Owner PID/digest is rejected',async t=>{
  const o=await fixture(t);o.expected={...o.expected,ownerPid:7331};
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'OWNER_OR_KEEPER_IDENTITY_CHANGED');
});
test('TOC substitution is rejected',async t=>{
  const o=await fixture(t);o.tocReadback+='1; 1 1 TABLE public fake owner\n';
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'INDEPENDENT_TOC_MISMATCH');
});
test('matching receipt cannot conceal modified archive bytes',async t=>{
  const o=await fixture(t);await fs.writeFile(o.archivePath,Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(4096,43)]));
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'ARCHIVE_BYTES_UNVERIFIED');
});
test('receipt cannot authorize unsafe effects or automatic retry',async t=>{
  const o=await fixture(t);o.receipt.installer_started=true;
  const r=await verifyInstalledUpgradeBackup(o);
  assert.equal(r.reason,'BACKUP_SAFETY_PROOF_MISSING');assert.equal(r.automatic_retry_allowed,false);
});
test('untrusted symlink is refused',async t=>{
  const o=await fixture(t), target=path.join(path.dirname(o.archivePath),'target.dump');
  await fs.rename(o.archivePath,target);
  try {await fs.symlink(target,o.archivePath,'file');} catch(e) { if (process.platform==='win32') {t.skip('symlink privilege unavailable');return;}throw e; }
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'ARCHIVE_PATH_UNTRUSTED');
});
test('unapproved archive directory is rejected even when digest is valid',async t=>{
  const o=await fixture(t);o.expected={...o.expected,backupDirectory:path.dirname(path.dirname(o.archivePath))};
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'ARCHIVE_MANIFEST_INVALID');
});
test('unsafe TOC omission is rejected',async t=>{
  const o=await fixture(t);delete o.tocReadback;
  assert.equal((await verifyInstalledUpgradeBackup(o)).reason,'INDEPENDENT_TOC_MISSING');
});
