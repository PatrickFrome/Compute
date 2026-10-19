#!/usr/bin/env node
// Disposable CI qualification of whole-image restoration after an interrupted
// NSIS replacement. NOT A LIVE WINDOWS RESTORER OR PACKAGE PROMOTION PATH.
// Only an immediate child of os.tmpdir with the fixed fixture prefix is valid.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureInstalledTreeFingerprint } from './qa-installed-tree-fingerprint.mjs';
import { copyInstalledImageToFreshDirectory } from './qa-installed-image-snapshot.mjs';

export const DISPOSABLE_RESTORE_SCHEMA='metaengine.browser.qa-disposable-image-restore.v1';
const fail=code=>{throw new Error('qa_disposable_restore_'+code);};
const SHA=/^[a-f0-9]{64}$/;
async function exist(file){
  try{return await fs.lstat(file);}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
}
async function physicalDirectory(file){
  const s=await fs.lstat(file);
  if(!s.isDirectory()||s.isSymbolicLink())fail('directory_not_physical');
  const real=await fs.realpath(file),other=await fs.lstat(real);
  if(!other.isDirectory()||other.isSymbolicLink()||s.dev!==other.dev||s.ino!==other.ino)
    fail('directory_identity_unknown');
}
async function journal(file,value){
  // Only the current disposable fixture is writable; never keep receipts in
  // the installed app, repository, user profile, Guardian or PGDATA.
  const tmp=file+'.'+randomUUID()+'.tmp';
  const out=await fs.open(tmp,'wx',0o600);
  try{await out.writeFile(JSON.stringify(value)+'\n');await out.sync();}finally{await out.close();}
  await fs.rename(tmp,file);
}
async function proveTree(file,digest){
  const x=await captureInstalledTreeFingerprint(file);
  if(x.tree_sha256!==digest)fail('tree_digest_mismatch');
  return x;
}
export async function qualifyDisposableFullImageRestore(root,{
  expectedSnapshotSha256,onCheckpoint=async()=>{},
}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||!SHA.test(expectedSnapshotSha256||''))
    fail('arguments_invalid');
  const base=path.resolve(root),temp=path.resolve(os.tmpdir());
  const rel=path.relative(temp,base);
  if(rel.startsWith('..')||path.isAbsolute(rel)||rel.includes(path.sep)
    ||!/^metaengine-qa-recovery-fixture-[A-Za-z0-9_-]{4,80}$/.test(rel))
    fail('outside_disposable_fixture');
  await physicalDirectory(base);
  const installed=path.join(base,'installed'),snapshot=path.join(base,'snapshot'),
    prepared=path.join(base,'prepared'),quarantine=path.join(base,'quarantine'),
    proof=path.join(base,'restore-receipt.json');
  await physicalDirectory(installed);await physicalDirectory(snapshot);
  for(const p of [prepared,quarantine,proof])if(await exist(p))fail('existing_attempt_requires_readback');
  const snapshotTree=await proveTree(snapshot,expectedSnapshotSha256);
  const currentTree=await captureInstalledTreeFingerprint(installed);
  if(currentTree.tree_sha256===expectedSnapshotSha256)fail('already_restored');
  const copy=await copyInstalledImageToFreshDirectory(snapshot,prepared);
  if(!copy.copied_tree_verified||copy.tree_sha256!==expectedSnapshotSha256)
    fail('replacement_copy_unverified');
  if((await captureInstalledTreeFingerprint(installed)).tree_sha256!==currentTree.tree_sha256)
    fail('preimage_changed');
  const record={schema:DISPOSABLE_RESTORE_SCHEMA,
    source_tree_sha256:expectedSnapshotSha256,preimage_sha256:currentTree.tree_sha256,
    state:'PREPARED',installed_mutated:false,production_authorized:false,
    owner_mutated:false,guardian_mutated:false,postgres_mutated:false,
    automatic_retry_allowed:false,authority_effect:false};
  await journal(proof,record);
  let phase='PREPARED';
  try{
    await onCheckpoint('PREPARED');
    record.state='MOVING_PREIMAGE';await journal(proof,record);
    await fs.rename(installed,quarantine);phase='PREIMAGE_QUARANTINED';
    record.state=phase;record.installed_mutated=true;await journal(proof,record);
    await onCheckpoint(phase);
    await fs.rename(prepared,installed);phase='RESTORED_UNVERIFIED';
    record.state=phase;await journal(proof,record);
    await onCheckpoint(phase);
    const result=await proveTree(installed,expectedSnapshotSha256);
    const original=await proveTree(quarantine,currentTree.tree_sha256);
    if(result.file_count!==snapshotTree.file_count||result.total_bytes!==snapshotTree.total_bytes
      ||original.file_count!==currentTree.file_count)fail('post_restore_identity_mismatch');
    record.state='RESTORED_IMAGE_VERIFIED';await journal(proof,record);
    return Object.freeze({...record,fixture_root:base,restored_file_count:result.file_count,
      restore_receipt:proof,installed_mutated:true});
  }catch(error){
    // Only the gap between the two renames is compensated automatically:
    // no new image is published and exact quarantined preimage is unchanged.
    // A failure after promotion is UNKNOWN, never blind-replayed.
    if(phase==='PREIMAGE_QUARANTINED'){
      const current=await exist(installed),prior=await exist(quarantine);
      if(!current&&prior&&prior.isDirectory()){
        await proveTree(quarantine,currentTree.tree_sha256);
        await fs.rename(quarantine,installed);
        await proveTree(installed,currentTree.tree_sha256);
        record.state='ABORTED_PREIMAGE_RESTORED';record.installed_mutated=false;
        await journal(proof,record);
        throw Object.assign(error,{rollbackConfirmed:true});
      }
    }
    record.state='EFFECT_UNKNOWN_REQUIRES_READBACK';
    await journal(proof,record);
    throw error;
  }
}
