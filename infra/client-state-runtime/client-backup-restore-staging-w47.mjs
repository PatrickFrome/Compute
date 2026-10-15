// W47: source-only qualification of an ALREADY restored, GENERATED PostgreSQL 17
// fixture. This module has no SQL, dump, restore, installer, or Host effect path.
// The existing Owner/Supervisor remains the sole authority. A staging receipt
// never makes a historical .59 attempt recoverable or an installed upgrade safe.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readBackupEffectFence} from './pg17-backup-effect-barrier.mjs';

const SHA=/^[a-f0-9]{64}$/;
const HEAD=/^[a-f0-9]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT=/^[1-9][0-9]*:[a-f0-9]{32}$/;
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const result=(reason,state='UNKNOWN')=>Object.freeze({
  schema:'metaengine.client-backup-restore-staging-w47.v1',
  state,reason,evidence_class:'SYNTHETIC/STAGING',
  archive_verified:false,restore_data_compared:false,rollback_preserved:false,
  physical_installed_owner_proven:false,installed_backup_verified:false,
  upgrade_authorized:false,automatic_retry_allowed:false,authority_effect:false,
});
const sha=x=>createHash('sha256').update(x).digest('hex');
async function immutableFile(file,root,base,min=1) {
  if(typeof file!=='string'||!path.isAbsolute(file)
    ||!same(path.dirname(path.resolve(file)),root)||path.basename(file)!==base)
    throw Error('PATH_UNTRUSTED');
  const before=await fs.lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1
    ||before.size<min||before.size>1024*1024*1024
    ||!same(await fs.realpath(file),path.resolve(file)))
    throw Error('FILE_UNTRUSTED');
  // A POSIX private mode is actual stat readback. Windows mode bits do NOT
  // attest a DACL; Windows staging is explicit ACL_UNKNOWN unless independently
  // qualified by a trusted native verifier in a later, separate change.
  if(process.platform!=='win32'&&(before.mode&0o077)!==0)
    throw Error('FILE_ACL_NOT_PRIVATE');
  const h=createHash('sha256');let n=0;
  for await(const b of createReadStream(file)){n+=b.length;h.update(b);}
  const after=await fs.lstat(file);
  if(n!==before.size||before.size!==after.size
    ||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs)
    throw Error('FILE_CHANGED');
  return {bytes:n,digest:h.digest('hex')};
}
async function privateFixtureRoot(dir) {
  if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error('ROOT_INVALID');
  const root=await fs.realpath(dir),temp=await fs.realpath(os.tmpdir());
  const relative=path.relative(temp,root);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)
    ||path.isAbsolute(relative)||!same(root,path.resolve(dir)))
    throw Error('ROOT_NOT_DISPOSABLE');
  const st=await fs.lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()
    ||(process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw Error('ROOT_ACL_UNTRUSTED');
  return root;
}
function validateBindings({intent,archiveReceipt,sourceReadback,restoredReadback,roleReadback}) {
  if(intent?.schema!=='metaengine.pg17.backup-effect-intent.v1'
    ||!UUID.test(intent.intent_id)||!HEAD.test(intent.source_head)
    ||!SHA.test(intent.owner_sha256)||!SHA.test(intent.keeper_postmaster_sha256)
    ||!Number.isSafeInteger(intent.owner_pid)||intent.owner_pid<1
    ||!Number.isSafeInteger(intent.keeper_pid)||intent.keeper_pid<1
    ||intent.owner_pid===intent.keeper_pid||intent.automatic_retry_allowed!==false)
    return 'INTENT_UNTRUSTED';
  if(archiveReceipt?.schema!=='metaengine.pg17.disposable-dump-readback.v1'
    ||archiveReceipt.state!=='ARCHIVE_ONLY_VERIFIED'
    ||archiveReceipt.effect_intent_id!==intent.intent_id
    ||archiveReceipt.archive_verified!==true||!SHA.test(archiveReceipt.archive_sha256)
    ||!SHA.test(archiveReceipt.toc_sha256)
    ||archiveReceipt.upgrade_authorized!==false
    ||archiveReceipt.automatic_retry_allowed!==false
    ||archiveReceipt.authority_effect!==false)
    return 'ARCHIVE_RECEIPT_UNTRUSTED';
  if(sourceReadback?.source_head!==intent.source_head
    ||sourceReadback.owner_pid!==intent.owner_pid
    ||sourceReadback.keeper_pid!==intent.keeper_pid
    ||sourceReadback.owner_sha256!==intent.owner_sha256
    ||sourceReadback.postmaster_sha256!==intent.keeper_postmaster_sha256
    ||sourceReadback.pg_system_identifier!==archiveReceipt.source_pg_system_identifier
    ||sourceReadback.pg_started_at!==archiveReceipt.source_pg_started_at
    ||!/^[1-9][0-9]{9,19}$/.test(sourceReadback.pg_system_identifier||'')
    ||!Number.isSafeInteger(sourceReadback.pg_version)
    ||sourceReadback.pg_version<170000||sourceReadback.pg_version>=180000)
    return 'SOURCE_IDENTITY_DRIFT';
  if(!FINGERPRINT.test(sourceReadback.fingerprint||'')
    ||!FINGERPRINT.test(restoredReadback?.fingerprint||'')
    ||sourceReadback.fingerprint!==restoredReadback.fingerprint)
    return 'RESTORE_DATA_MISMATCH';
  if(!/^[1-9][0-9]{9,19}$/.test(restoredReadback.pg_system_identifier||'')
    ||restoredReadback.pg_system_identifier===sourceReadback.pg_system_identifier
    ||restoredReadback.pg_version<170000||restoredReadback.pg_version>=180000
    ||!Number.isSafeInteger(restoredReadback.pg_version)
    ||!Number.isSafeInteger(restoredReadback.pg_pid)
    ||restoredReadback.pg_pid<=0||restoredReadback.pg_pid===intent.keeper_pid
    ||restoredReadback.pg_pid===intent.owner_pid)
    return 'RESTORE_CLUSTER_NOT_DISTINCT';
  // The caller must measure these SQL grants on BOTH fixture clusters; the
  // result is still fixture evidence, not an installed Owner privilege witness.
  if(roleReadback?.source_role!=='postgres'||roleReadback.restore_role!=='postgres'
    ||roleReadback.source_connect!==true||roleReadback.source_select!==true
    ||roleReadback.restore_create!==true||roleReadback.restore_connect!==true)
    return 'ROLE_OR_GRANT_MISMATCH';
  return null;
}
export async function sealClientBackupRestoreStagingW47({
  journalDirectory,intent,archiveReceipt,tocReadback,sourceReadback,
  restoredReadback,roleReadback,rollbackSha256,
}={}){
  const reason=validateBindings({intent,archiveReceipt,sourceReadback,restoredReadback,roleReadback});
  if(reason)return result(reason);
  let root;
  try{root=await privateFixtureRoot(journalDirectory);}
  catch{return result('ROOT_UNTRUSTED');}
  if(typeof intent.archive_path!=='string'
    ||!same(path.resolve(intent.archive_path),path.join(root,'postgresql-17-snapshot.dump')))
    return result('ARCHIVE_DESTINATION_MISMATCH');
  const fence=await readBackupEffectFence({journalDirectory:root,intentId:intent.intent_id});
  if(fence.state!=='EFFECT_UNKNOWN'||fence.barrier_found!==true)
    return result('NO_DURABLE_EFFECT_FENCE');
  if(typeof tocReadback!=='string'||tocReadback.length>1024*1024
    ||sha(tocReadback)!==archiveReceipt.toc_sha256
    ||!tocReadback.split(/\r?\n/).some(x=>/^\d+;.* TABLE DATA /.test(x)))
    return result('INDEPENDENT_TOC_MISMATCH');
  let archive,rollback;
  try{
    archive=await immutableFile(intent.archive_path,root,'postgresql-17-snapshot.dump',1024);
    rollback=await immutableFile(path.join(root,'rollback-preserved.bin'),root,'rollback-preserved.bin',1);
  }catch{return result('ARCHIVE_OR_ROLLBACK_UNTRUSTED');}
  if(archive.digest!==archiveReceipt.archive_sha256
    ||archive.bytes!==archiveReceipt.archive_bytes
    ||!SHA.test(rollbackSha256||'')||rollback.digest!==rollbackSha256)
    return result('ARCHIVE_OR_ROLLBACK_DRIFT');
  const marker=path.join(root,'stage-w47-'+intent.intent_id+'.json');
  const stage={
    schema:'metaengine.client-backup-restore-staging-w47.v1',
    evidence_class:'SYNTHETIC/STAGING',intent_id:intent.intent_id,
    source_head:intent.source_head,archive_sha256:archive.digest,
    archive_bytes:archive.bytes,toc_sha256:archiveReceipt.toc_sha256,
    data_fingerprint_sha256:sha(sourceReadback.fingerprint),
    rollback_sha256:rollback.digest,
    owner_acl:process.platform==='win32'?'UNKNOWN':'PRIVATE_MODE_READBACK',
    state:process.platform==='win32'?'ACL_REVIEW_REQUIRED':'STAGING_PASSED',
    physical_installed_owner_proven:false,upgrade_authorized:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  const bytes=Buffer.from(JSON.stringify(stage)+'\n');
  let fd;
  try{
    fd=await fs.open(marker,'wx',0o600);
    await fd.writeFile(bytes);
    await fd.sync();
  }catch{return result('STAGE_WRITE_AMBIGUOUS');}
  finally{if(fd)await fd.close().catch(()=>{});}
  try{
    if(sha(await fs.readFile(marker))!==sha(bytes))
      return result('STAGE_DURABILITY_UNKNOWN');
    const after=await immutableFile(path.join(root,'rollback-preserved.bin'),root,
      'rollback-preserved.bin');
    if(after.digest!==rollback.digest)return result('ROLLBACK_CHANGED');
  }catch{return result('STAGE_DURABILITY_UNKNOWN');}
  return Object.freeze({
    ...result(stage.state==='STAGING_PASSED'?'STAGING_ONLY_NOT_INSTALLED':'WINDOWS_DACL_UNKNOWN',
      stage.state),
    archive_verified:true,restore_data_compared:true,rollback_preserved:true,
    archive_sha256:archive.digest,intent_id:intent.intent_id,
    owner_acl:stage.owner_acl,
  });
}
export async function readClientBackupRestoreStagingW47({journalDirectory,intentId}={}){
  if(!UUID.test(intentId||''))return result('INTENT_INVALID');
  let root;
  try{root=await privateFixtureRoot(journalDirectory);}
  catch{return result('ROOT_UNTRUSTED');}
  let record;
  try{
    const p=path.join(root,'stage-w47-'+intentId+'.json');
    const st=await fs.lstat(p);
    if(!st.isFile()||st.isSymbolicLink()||st.size>4096
      ||(process.platform!=='win32'&&(st.mode&0o077)!==0))
      return result('STAGE_RECORD_UNTRUSTED');
    record=JSON.parse(await fs.readFile(p,'utf8'));
  }catch{return result('STAGE_NOT_COMMITTED_OR_ACK_LOST');}
  if(record?.schema!=='metaengine.client-backup-restore-staging-w47.v1'
    ||record.intent_id!==intentId||record.evidence_class!=='SYNTHETIC/STAGING'
    ||record.upgrade_authorized!==false||record.automatic_retry_allowed!==false)
    return result('STAGE_RECORD_DRIFT');
  // A durable marker does not imply that a lost backup ACK can be replayed.
  return result('SEALED_STAGING_NO_RETRY','STAGING_SEALED');
}
