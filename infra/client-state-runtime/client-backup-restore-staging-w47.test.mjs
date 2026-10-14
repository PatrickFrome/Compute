import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {buildBackupEffectIntent,publishBackupEffectIntent,crossBackupEffectBarrier,
  readBackupEffectFence} from './pg17-backup-effect-barrier.mjs';
import {sealClientBackupRestoreStagingW47,readClientBackupRestoreStagingW47}
  from './client-backup-restore-staging-w47.mjs';
import {verifyInstalledUpgradeBackup} from './upgrade-backup-gate.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const toc='1; 1 100 TABLE DATA public generated_only postgres\n';
async function fixture(t,{cross=true}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-w47-generated-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const intent=buildBackupEffectIntent({
    intentId:randomUUID(),ownerPid:12345,keeperPid:23456,
    sourceHead:'1'.repeat(40),ownerSha256:'2'.repeat(64),
    postmasterSha256:'3'.repeat(64),
    archivePath:path.join(root,'postgresql-17-snapshot.dump'),
  });
  const archive=Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(2048,71)]);
  await fs.writeFile(path.join(root,'rollback-preserved.bin'),Buffer.from('generated immutable old-owner rollback fixture'),{mode:0o600});
  const rollbackSha256=sha(await fs.readFile(path.join(root,'rollback-preserved.bin')));
  const archiveReceipt={
    schema:'metaengine.pg17.disposable-dump-readback.v1',
    state:'ARCHIVE_ONLY_VERIFIED',effect_intent_id:intent.intent_id,
    source_pg_system_identifier:'1234567890123456789',
    source_pg_started_at:'2026-10-15T00:00:00Z',
    archive_verified:true,archive_sha256:sha(archive),archive_bytes:archive.length,
    toc_sha256:sha(toc),upgrade_authorized:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  const sourceReadback={
    source_head:intent.source_head,owner_pid:intent.owner_pid,
    keeper_pid:intent.keeper_pid,owner_sha256:intent.owner_sha256,
    postmaster_sha256:intent.keeper_postmaster_sha256,
    pg_system_identifier:archiveReceipt.source_pg_system_identifier,
    pg_started_at:archiveReceipt.source_pg_started_at,pg_version:170006,
    fingerprint:'3:'+sha('fixture rows').slice(0,32),
  };
  const restoredReadback={fingerprint:sourceReadback.fingerprint,
    pg_system_identifier:'2234567890123456789',pg_version:170006,pg_pid:34567};
  const roleReadback={
    source_role:'postgres',restore_role:'postgres',
    source_connect:true,source_select:true,restore_create:true,restore_connect:true,
  };
  await publishBackupEffectIntent({journalDirectory:root,intent});
  if(cross)await crossBackupEffectBarrier({journalDirectory:root,intent});
  if(cross)await fs.writeFile(intent.archive_path,archive,{flag:'wx',mode:0o600});
  return {root,intent,archiveReceipt,sourceReadback,restoredReadback,roleReadback,
    tocReadback:toc,rollbackSha256,journalDirectory:root};
}
const seal=x=>sealClientBackupRestoreStagingW47(x);
const verify=x=>assert.equal(x.upgrade_authorized,false);
test('STAGING evidence seals only a generated fixture; recovery never grants effect',async t=>{
  const x=await fixture(t);
  const result=await seal(x);verify(result);
  assert.equal(result.evidence_class,'SYNTHETIC/STAGING');
  assert.equal(result.archive_verified,true);
  assert.equal(result.restore_data_compared,true);
  assert.equal(result.rollback_preserved,true);
  assert.equal(result.physical_installed_owner_proven,false);
  assert.equal(result.state,process.platform==='win32'?'ACL_REVIEW_REQUIRED':'STAGING_PASSED');
  const recovered=await readClientBackupRestoreStagingW47({
    journalDirectory:x.root,intentId:x.intent.intent_id,
  });
  assert.equal(recovered.state,'STAGING_SEALED');
  assert.equal(recovered.automatic_retry_allowed,false);verify(recovered);
});
test('lost backup ACK before sealing is still EFFECT_UNKNOWN; no replay',async t=>{
  const x=await fixture(t);
  const fence=await readBackupEffectFence({journalDirectory:x.root,intentId:x.intent.intent_id});
  assert.equal(fence.state,'EFFECT_UNKNOWN');
  await assert.rejects(crossBackupEffectBarrier({journalDirectory:x.root,intent:x.intent}));
  const r=await seal(x);
  assert.equal(r.upgrade_authorized,false);
});
test('crash before durable effect crossing cannot produce successful staging',async t=>{
  const x=await fixture(t,{cross:false});
  assert.equal((await seal(x)).reason,'NO_DURABLE_EFFECT_FENCE');
  assert.equal((await readClientBackupRestoreStagingW47({
    journalDirectory:x.root,intentId:x.intent.intent_id,
  })).state,'UNKNOWN');
});
test('crash after durable staging cannot overwrite or reissue old request',async t=>{
  const x=await fixture(t);
  await seal(x);
  const result=await seal(x);
  assert.equal(result.reason,'STAGE_WRITE_AMBIGUOUS');
  assert.equal(result.automatic_retry_allowed,false);verify(result);
  const status=await readClientBackupRestoreStagingW47({
    journalDirectory:x.root,intentId:x.intent.intent_id,
  });
  assert.equal(status.state,'STAGING_SEALED');
});
test('historical old .59 request ID cannot claim a new effect or staging',async t=>{
  const x=await fixture(t);
  const old={...x.intent,intent_id:randomUUID()};
  const attempt=await seal({...x,intent:old});
  assert.notEqual(attempt.state,'STAGING_PASSED');
  verify(attempt);
  await assert.rejects(crossBackupEffectBarrier({
    journalDirectory:x.root,intent:old,
  }));
});
test('0-byte and truncated custom archives are rejected',async t=>{
  for(const bytes of [Buffer.alloc(0),Buffer.from('PGDMP')]){
    const x=await fixture(t);
    await fs.writeFile(x.intent.archive_path,bytes);
    const r=await seal(x);
    assert.equal(r.reason,'ARCHIVE_OR_ROLLBACK_UNTRUSTED');verify(r);
  }
});
test('different digest with same length cannot pass',async t=>{
  const x=await fixture(t);
  const data=await fs.readFile(x.intent.archive_path);data[data.length-1]^=1;
  await fs.writeFile(x.intent.archive_path,data);
  const r=await seal(x);assert.equal(r.reason,'ARCHIVE_OR_ROLLBACK_DRIFT');verify(r);
});
test('source SHA/Owner/PG generation drift refuses stage',async t=>{
  for(const property of ['source_head','keeper_pid','postmaster_sha256','pg_started_at']){
    const x=await fixture(t);
    const v={...x.sourceReadback,[property]:
      typeof x.sourceReadback[property]==='number'?99999:'wrong'};
    const r=await seal({...x,sourceReadback:v});
    assert.equal(r.reason,'SOURCE_IDENTITY_DRIFT');verify(r);
  }
});
test('wrong role or missing SQL grant refuses stage',async t=>{
  for(const property of ['source_role','source_connect','source_select','restore_create','restore_connect']){
    const x=await fixture(t);
    const role={...x.roleReadback,[property]:property.endsWith('role')?'wrong':false};
    const r=await seal({...x,roleReadback:role});
    assert.equal(r.reason,'ROLE_OR_GRANT_MISMATCH');verify(r);
  }
});
test('same row count but changed data fingerprint refuses stage',async t=>{
  const x=await fixture(t);
  const restoredReadback={...x.restoredReadback,fingerprint:'3:'+sha('changed').slice(0,32)};
  assert.equal((await seal({...x,restoredReadback})).reason,'RESTORE_DATA_MISMATCH');
});
test('independent TOC is required and pinned',async t=>{
  const x=await fixture(t);
  assert.equal((await seal({...x,tocReadback:'1; TABLE DATA fake\n'})).reason,
    'INDEPENDENT_TOC_MISMATCH');
});
test('rollback preservation digest and archive root cannot be redirected',async t=>{
  const x=await fixture(t);
  assert.equal((await seal({...x,rollbackSha256:'0'.repeat(64)})).reason,
    'ARCHIVE_OR_ROLLBACK_DRIFT');
  // Linux refuses the non-temp root immediately; Windows may pass root
  // canonicalization then reject its archive-path mismatch. Both fail closed.
  assert.match((await seal({...x,journalDirectory:process.cwd()})).reason,
    /^(ROOT_UNTRUSTED|ARCHIVE_DESTINATION_MISMATCH)$/);
});
test('rollback file mutation invalidates stage even with intact archive',async t=>{
  const x=await fixture(t);
  await fs.writeFile(path.join(x.root,'rollback-preserved.bin'),'changed');
  assert.equal((await seal(x)).reason,'ARCHIVE_OR_ROLLBACK_DRIFT');
});
test('recycled process and same-cluster restore rejected',async t=>{
  const x=await fixture(t);
  assert.equal((await seal({...x,restoredReadback:{
    ...x.restoredReadback,pg_pid:x.intent.keeper_pid,
  }})).reason,'RESTORE_CLUSTER_NOT_DISTINCT');
  assert.equal((await seal({...x,restoredReadback:{
    ...x.restoredReadback,pg_system_identifier:x.sourceReadback.pg_system_identifier,
  }})).reason,'RESTORE_CLUSTER_NOT_DISTINCT');
});

test('existing installed upgrade preflight rejects synthetic staging receipt',async t=>{
  const x=await fixture(t);
  const s=await seal(x);
  const installed=await verifyInstalledUpgradeBackup({receipt:s,archivePath:x.intent.archive_path});
  assert.equal(installed.reason,'STAGING_BACKUP_CANNOT_QUALIFY_INSTALLED');
  assert.equal(installed.backup_verified,false);
  assert.equal(installed.upgrade_authorized,false);
});
