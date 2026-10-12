import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { qualifyIndependentDisposableRestore } from './upgrade-backup-restore-gate.mjs';
import { verifyInstalledUpgradeBackup } from './upgrade-backup-gate.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const toc=Array.from({length:105},(_,i)=>`${i+1}; 1 0 TABLE DATA public synthetic${i} owner`).join('\n')+'\n';
const expectedBase={keeperPid:10776,ownerPid:2888,ownerSha256:'a'.repeat(64),
  postmasterSha256:'b'.repeat(64),sourcePgPort:55432,qualifiedExecutorSha256:'c'.repeat(64)};
async function fixture(t){
  const backupDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-restore-gate-'));
  t.after(()=>fs.rm(backupDirectory,{recursive:true,force:true}));
  const archivePath=path.join(backupDirectory,'postgresql-17-snapshot.dump');
  const bytes=Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(4096,31)]);
  await fs.writeFile(archivePath,bytes);
  const receipt={schema:'metaengine.local61.pre-upgrade-database-backup.v1',state:'PASSED',
    file:archivePath,file_sha256:sha(bytes),bytes:bytes.length,
    toc_sha256:sha(toc),toc_entries:105,keeper_pid:10776,installed_primary_pid:2888,
    owner_sha256:expectedBase.ownerSha256,postmaster_sha256:expectedBase.postmasterSha256,
    installer_started:false,working_database_modified:false,
    authenticated_read_only_snapshot:true,owner_dacl_verified:true,
    secrets_included_in_receipt:false,automatic_retry_allowed:false};
  const restoreReceipt={schema:'metaengine.disposable-pg17.restore-qualification.v1',state:'PASSED',
    archive_sha256:receipt.file_sha256,archive_bytes:receipt.bytes,toc_sha256:receipt.toc_sha256,
    source_keeper_pid:10776,source_postmaster_sha256:expectedBase.postmasterSha256,
    installed_primary_pid:2888,executor_sha256:expectedBase.qualifiedExecutorSha256,
    disposable_pg_port:55440,disposable_pg_pid:30012,disposable_postmaster_sha256:'d'.repeat(64),
    disposable_only:true,source_connection_attempted:false,source_data_modified:false,
    working_profile_modified:false,installer_started:false,disposable_runtime_isolated:true,
    disposable_postmaster_identity_proven:true,pg_restore_exit_on_error:true,pg_restore_exit_code:0,
    archive_digest_rechecked_after_restore:true,restore_completed:true,restore_data_verified:true,
    independent_evaluator:true,disposable_cleanup_confirmed:true,
    table_data_items_restored:105,restored_table_count:105,verified_nonempty_table_count:105,
    row_count_digest_sha256:'e'.repeat(64),
    automatic_retry_allowed:false,authority_effect:false};
  return {receipt,restoreReceipt,tocReadback:toc,
    expected:{...expectedBase,backupDirectory},archivePath};
}
test('TOC-qualified archive without full disposable restore is NOT restore-qualified',async t=>{
  const x=await fixture(t); delete x.restoreReceipt;
  const result=await verifyInstalledUpgradeBackup(x);
  assert.equal(result.backup_verified,true);
  assert.equal(result.restore_verified,false);
  assert.equal(result.restore_reason,'RESTORE_RECEIPT_MISSING_OR_UNQUALIFIED');
  assert.equal(result.upgrade_authorized,false);
});
test('self-asserted synthetic receipt is consistent but NEVER physical restore proof',async t=>{
  const x=await fixture(t);
  const r=await verifyInstalledUpgradeBackup(x);
  assert.equal(r.backup_verified,true);
  assert.equal(r.restore_receipt_consistent,true);
  assert.equal(r.restore_verified,false);
  assert.equal(r.physical_restore_proven,false);
  assert.equal(r.reason,'BACKUP_AND_RESTORE_RECEIPT_CONSISTENT_PHYSICAL_PROOF_REQUIRED');
  assert.equal(r.upgrade_authorized,false);
  assert.equal(r.automatic_retry_allowed,false);
  assert.equal(r.authority_effect,false);
});
for(const [name,update,expectedReason] of [
  ['different archive digest',r=>{r.archive_sha256='f'.repeat(64)},'RESTORE_SOURCE_BINDING_MISMATCH'],
  ['different postmaster',r=>{r.source_postmaster_sha256='f'.repeat(64)},'RESTORE_SOURCE_BINDING_MISMATCH'],
  ['different executable pin',r=>{r.executor_sha256='f'.repeat(64)},'RESTORE_SOURCE_BINDING_MISMATCH'],
  ['same source PostgreSQL port',r=>{r.disposable_pg_port=55432},'RESTORE_DISPOSABLE_TARGET_UNPROVEN'],
  ['same source process pid',r=>{r.disposable_pg_pid=10776},'RESTORE_DISPOSABLE_TARGET_UNPROVEN'],
  ['same postmaster hash',r=>{r.disposable_postmaster_sha256='b'.repeat(64)},'RESTORE_DISPOSABLE_TARGET_UNPROVEN'],
  ['source connection',r=>{r.source_connection_attempted=true},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
  ['external target not isolated',r=>{r.disposable_runtime_isolated=false},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
  ['SQL restore failed',r=>{r.pg_restore_exit_code=1},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
  ['no exit-on-error',r=>{r.pg_restore_exit_on_error=false},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
  ['cleanup unconfirmed',r=>{r.disposable_cleanup_confirmed=false},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
  ['insufficient table data',r=>{r.table_data_items_restored=104},'RESTORE_DATA_READBACK_INCOMPLETE'],
  ['no row readback',r=>{r.row_count_digest_sha256=null},'RESTORE_DATA_READBACK_INCOMPLETE'],
  ['source profile changed',r=>{r.working_profile_modified=true},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
  ['auto retry grant',r=>{r.automatic_retry_allowed=true},'RESTORE_PHYSICAL_EVIDENCE_INCOMPLETE'],
]){
  test(`restore proof rejects ${name}`,async t=>{
    const x=await fixture(t);
    update(x.restoreReceipt);
    const r=await verifyInstalledUpgradeBackup(x);
    assert.equal(r.restore_verified,false);
    assert.equal(r.restore_reason,expectedReason);
    assert.equal(r.upgrade_authorized,false);
  });
}
test('bad archive always blocks even a claimed perfect restore receipt',async t=>{
  const x=await fixture(t);
  await fs.writeFile(x.archivePath,Buffer.alloc(0));
  const r=await verifyInstalledUpgradeBackup(x);
  assert.equal(r.backup_verified,false);
  assert.equal(r.upgrade_authorized,false);
});
test('standalone restore receipt is inert without expected trusted executable digest',async t=>{
  const x=await fixture(t);delete x.expected.qualifiedExecutorSha256;
  const r=qualifyIndependentDisposableRestore({
    receipt:x.restoreReceipt,backupReceipt:x.receipt,tocReadback:x.tocReadback,expected:x.expected});
  assert.equal(r.restore_verified,false);
  assert.equal(r.reason,'RESTORE_EXPECTED_IDENTITY_INVALID');
});
