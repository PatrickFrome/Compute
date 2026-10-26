// Explicit local QA image readback/recovery. No process killing, PG, Owner or
// registry operations. The caller must establish quiescence and Keeper custody.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {captureInstalledTreeFingerprint} from './qa-installed-tree-fingerprint.mjs';
import {copyInstalledImageToFreshDirectory} from './qa-installed-image-snapshot.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../src/private-windows-storage-acl.mjs';

const SHA=/^[a-f0-9]{64}$/;
const fail=x=>{throw new Error('qa_operator_image_'+x);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const sha=b=>createHash('sha256').update(b).digest('hex');
const UNINSTALLER='Uninstall METAENGINE Browser Test.exe';
async function fileHash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function inventory(root){
  // The existing tree producer checks reparse points, aliases, hardlinks,
  // bounded size and stable files before this independent byte comparison.
  const fingerprint=await captureInstalledTreeFingerprint(root),rows=[];
  async function walk(dir,prefix=''){
    for(const name of (await fs.readdir(dir)).sort()){
      const file=path.join(dir,name),rel=prefix?prefix+'/'+name:name,stat=await fs.lstat(file);
      if(stat.isDirectory()){rows.push([rel,'DIRECTORY']);await walk(file,rel);}
      else rows.push([rel,stat.size,await fileHash(file)]);
    }
  }
  await walk(root);rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  if((await captureInstalledTreeFingerprint(root)).tree_sha256!==fingerprint.tree_sha256)fail('inventory_changed');
  return {fingerprint,rows};
}

export async function compareQaInstalledImage(candidateRoot,installedRoot,{expectedUninstallerSha256}={}){
  if(!SHA.test(expectedUninstallerSha256||''))fail('uninstaller_pin_required');
  const expected=await inventory(candidateRoot),actual=await inventory(installedRoot);
  // electron-builder's unpacked image has no NSIS-generated uninstaller. Every
  // other byte/directory must match; this sole extra is independently pinned by
  // the exact installer producer, never inferred from the installed file.
  if(expected.rows.some(r=>r[0]===UNINSTALLER))fail('candidate_contains_uninstaller');
  const uninstaller=actual.rows.filter(r=>r[0]===UNINSTALLER);
  if(uninstaller.length!==1||uninstaller[0][2]!==expectedUninstallerSha256)fail('uninstaller_mismatch');
  const packaged=actual.rows.filter(r=>r[0]!==UNINSTALLER);
  if(JSON.stringify(expected.rows)!==JSON.stringify(packaged))fail('candidate_image_mismatch');
  return Object.freeze({schema:'metaengine.operator.qa-installed-image-readback.v1',
    state:'EXACT_CANDIDATE_IMAGE_VERIFIED',candidate_tree_sha256:expected.fingerprint.tree_sha256,
    installed_tree_sha256:actual.fingerprint.tree_sha256,file_count:actual.fingerprint.file_count,
    total_bytes:actual.fingerprint.total_bytes,uninstaller_sha256:expectedUninstallerSha256,
    full_tree_verified:true,production_authorized:false,authority_effect:false});
}

export function assertOperatorRecoveryPaths({installedRoot,stateDirectory,snapshotRoot},env=process.env){
  if(!path.isAbsolute(env.LOCALAPPDATA||'')||!path.isAbsolute(installedRoot||'')
    ||!path.isAbsolute(stateDirectory||'')||!path.isAbsolute(snapshotRoot||''))fail('paths_invalid');
  const target=path.join(env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
  const stateParent=path.join(env.LOCALAPPDATA,'METAENGINE');
  if(!same(installedRoot,target)||!same(path.dirname(stateDirectory),stateParent)
    ||!/^client-state-qa-upgrade-[a-f0-9-]{36}$/.test(path.basename(stateDirectory))
    ||!same(snapshotRoot,path.join(stateDirectory,'predecessor-image-snapshot','image')))fail('scope_invalid');
  return true;
}
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const kernelIdentity=s=>({device:String(s.dev),file_id:String(s.ino),birthtime_ns:String(s.birthtimeNs)});
async function physicalAncestors(directory){
  let current=path.resolve(directory);
  for(;;){const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('reparse_boundary_forbidden');
    const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
// Presence is an explicit native filesystem observation, never an empty tree
// pretending to be a verified application. Pin the parent/root kernel identities
// so replacement of an empty directory cannot inherit another attempt's pin.
export async function captureQaImagePreimage(installedRoot){
  if(!path.isAbsolute(installedRoot||''))fail('paths_invalid');
  const parent=path.dirname(installedRoot);await physicalAncestors(parent);
  const parentStat=await fs.lstat(parent,{bigint:true}),stat=await exists(installedRoot);
  const marker={schema:'metaengine.operator.qa-image-preimage.v1',state:'ABSENT',parent_identity:kernelIdentity(parentStat)};
  if(stat){
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('target_not_physical_directory');
    const rootBefore=await fs.lstat(installedRoot,{bigint:true});
    if((await fs.readdir(installedRoot)).length){
      const tree=await captureInstalledTreeFingerprint(installedRoot);
      return Object.freeze({...tree,state:'PRESENT',preimage_sha256:tree.tree_sha256});
    }
    const rootAfter=await fs.lstat(installedRoot,{bigint:true});
    if(JSON.stringify(kernelIdentity(rootBefore))!==JSON.stringify(kernelIdentity(rootAfter))
      ||rootBefore.mtimeNs!==rootAfter.mtimeNs)fail('preimage_changed');
    marker.state='EMPTY';marker.directory_identity=kernelIdentity(rootBefore);
  }
  if(JSON.stringify(kernelIdentity(parentStat))!==JSON.stringify(kernelIdentity(await fs.lstat(parent,{bigint:true}))))fail('preimage_changed');
  return Object.freeze({...marker,preimage_sha256:sha(JSON.stringify(marker))});
}
function assertPreimage(actual,presence,digest){
  if(actual.state!==presence||actual.preimage_sha256!==digest)fail('preimage_changed');
}
export async function captureOperatorQaPreimage(options){
  if(process.platform!=='win32')fail('windows_required');
  assertOperatorRecoveryPaths(options);
  return captureQaImagePreimage(options.installedRoot);
}
async function durable(file,record,first=false){
  const tmp=first?file:file+'.'+randomUUID()+'.tmp';const h=await fs.open(tmp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(record)+'\n');await h.sync();}finally{await h.close();}
  if(!first)await fs.rename(tmp,file);
}

// Shared transaction core, exercised on disposable physical trees. The real
// entry below supplies the fixed Windows target and private snapshot boundary.
export async function restorePinnedQaImage({installedRoot,snapshotRoot,journalFile,expectedSnapshotSha256,
  expectedPreimageSha256,expectedPreimagePresence='PRESENT',protect=async()=>{},beforeMutation=async()=>{},onCheckpoint=async()=>{}}){
  if(![expectedSnapshotSha256,expectedPreimageSha256].every(x=>SHA.test(x||'')))fail('digest_required');
  if(!['PRESENT','ABSENT','EMPTY'].includes(expectedPreimagePresence))fail('presence_invalid');
  if(await exists(journalFile))fail('existing_attempt_requires_readback');
  const snapshot=await captureInstalledTreeFingerprint(snapshotRoot),before=await captureQaImagePreimage(installedRoot);
  if(snapshot.tree_sha256!==expectedSnapshotSha256)fail('preimage_changed');
  assertPreimage(before,expectedPreimagePresence,expectedPreimageSha256);
  const nonce=randomUUID(),prepared=installedRoot+'.qa-prepared-'+nonce,quarantine=installedRoot+'.qa-quarantine-'+nonce;
  const copied=await copyInstalledImageToFreshDirectory(snapshotRoot,prepared,{onDirectory:protect});
  if(copied.tree_sha256!==expectedSnapshotSha256||copied.copied_tree_verified!==true)fail('snapshot_copy_unverified');
  const record={schema:'metaengine.operator.qa-image-restore.v2',state:'PREPARED',
    snapshot_sha256:expectedSnapshotSha256,preimage_sha256:expectedPreimageSha256,preimage_presence:expectedPreimagePresence,
    preimage_observation:before,
    prepared_directory:prepared,quarantine_directory:quarantine,installed_mutated:false,
    owner_mutated:false,guardian_mutated:false,postgres_mutated:false,
    production_authorized:false,automatic_retry_allowed:false,authority_effect:false};
  await durable(journalFile,record,true);await beforeMutation();
  assertPreimage(await captureQaImagePreimage(installedRoot),expectedPreimagePresence,expectedPreimageSha256);
  let phase='PREPARED';
  try{
    if(expectedPreimagePresence==='ABSENT'){
      record.state='ABSENT_PREIMAGE_CONFIRMED';await durable(journalFile,record);phase='ABSENT_CONFIRMED';
      await onCheckpoint(phase);
      assertPreimage(await captureQaImagePreimage(installedRoot),'ABSENT',expectedPreimageSha256);
    }else{
      record.state='MOVING_PREIMAGE';await durable(journalFile,record);
      await fs.rename(installedRoot,quarantine);phase='QUARANTINED';record.installed_mutated=true;
      record.state='PREIMAGE_QUARANTINED';await durable(journalFile,record);await onCheckpoint(phase);
    }
    await fs.rename(prepared,installedRoot);phase='PROMOTED';
    record.state='RESTORED_UNVERIFIED';record.installed_mutated=true;await durable(journalFile,record);await onCheckpoint(phase);
    if((await captureInstalledTreeFingerprint(installedRoot)).tree_sha256!==expectedSnapshotSha256)fail('readback_mismatch');
    if(expectedPreimagePresence==='ABSENT'){if(await exists(quarantine))fail('unexpected_quarantine');}
    else assertPreimage(await captureQaImagePreimage(quarantine),expectedPreimagePresence,expectedPreimageSha256);
    record.state='RESTORED_IMAGE_VERIFIED';await durable(journalFile,record);return record;
  }catch(error){
    let confirmed=false;
    try {
      if(phase==='QUARANTINED'&&!await exists(installedRoot)
        &&(await captureQaImagePreimage(quarantine)).preimage_sha256===expectedPreimageSha256){
        await fs.rename(quarantine,installedRoot);
        assertPreimage(await captureQaImagePreimage(installedRoot),expectedPreimagePresence,expectedPreimageSha256);
        record.state='ABORTED_PREIMAGE_RESTORED';record.installed_mutated=false;confirmed=true;
      } else if(phase==='ABSENT_CONFIRMED'){
        assertPreimage(await captureQaImagePreimage(installedRoot),'ABSENT',expectedPreimageSha256);
        record.state='ABORTED_ABSENT_PREIMAGE_PRESERVED';record.installed_mutated=false;confirmed=true;
      }
    } catch(rollbackError) { error=new AggregateError([error,rollbackError],'qa_image_rollback_unconfirmed'); }
    if(confirmed){await durable(journalFile,record);throw Object.assign(error,{rollbackConfirmed:true});}
    record.state='EFFECT_UNKNOWN_REQUIRES_READBACK';await durable(journalFile,record);throw error;
  }
}

export async function restoreOperatorQaImage(options){
  if(process.platform!=='win32')fail('windows_required');
  assertOperatorRecoveryPaths(options);
  for(const target of [path.dirname(options.installedRoot),options.stateDirectory,options.snapshotRoot])await physicalAncestors(target);
  for(const file of [options.stateDirectory,options.snapshotRoot]){
    if((await verifyOwnerOnlyWindowsStorage(file,{operation:'VERIFY_DIRECTORY'})).owner_dacl_verified!==true)fail('private_acl_unverified');
  }
  return restorePinnedQaImage({...options,journalFile:path.join(options.stateDirectory,'operator-image-restore.json'),
    protect:async dir=>{if((await protectOwnerOnlyWindowsDirectory(dir)).owner_dacl_verified!==true)fail('private_acl_unverified');}});
}
