#!/usr/bin/env node
// Source-only, explicit preparation of an entire QA installed-image backup.
// Never changes installed bytes, Owner, Guardian, PG, registry or service state.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { captureInstalledTreeFingerprint } from './qa-installed-tree-fingerprint.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from '../src/private-windows-storage-acl.mjs';

export const QA_IMAGE_SNAPSHOT_SCHEMA='metaengine.browser.qa-installed-image-snapshot.v1';
const fail=s=>{throw new Error('qa_snapshot_'+s);};
const inside=(parent,child)=>{
  const r=path.relative(path.resolve(parent),path.resolve(child));
  return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));
};
const physicalDirectory=async p=>{
  const s=await fs.lstat(p);
  if(!s.isDirectory()||s.isSymbolicLink())fail('directory_not_physical');
  return s;
};
const validName=n=>typeof n==='string'&&n.length>0&&n!=='.'&&n!=='..'
  &&!/[\\/:\0]/.test(n)&&!n.endsWith('.')&&!n.endsWith(' ');
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size
  &&a.birthtimeMs===b.birthtimeMs&&a.mtimeMs===b.mtimeMs;
async function copyPinnedFile(source,destination,before){
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)fail('source_file_not_physical');
  const noFollow=constants.O_NOFOLLOW||0;
  const input=await fs.open(source,constants.O_RDONLY|noFollow);
  try{
    const pinned=await input.stat();
    if(!pinned.isFile()||pinned.nlink!==1||!identity(before,pinned))fail('source_file_swapped');
    const output=await fs.open(destination,'wx',0o600);
    try{
      const buffer=Buffer.allocUnsafe(256*1024);
      let offset=0;
      while(offset<pinned.size){
        const take=Math.min(buffer.length,pinned.size-offset);
        const {bytesRead}=await input.read(buffer,0,take,offset);
        if(bytesRead<1)fail('source_file_truncated');
        let written=0;
        while(written<bytesRead){
          const step=await output.write(buffer,written,bytesRead-written,offset+written);
          if(step.bytesWritten<1)fail('snapshot_write_incomplete');
          written+=step.bytesWritten;
        }
        offset+=bytesRead;
      }
      await output.sync();
    }finally{await output.close();}
    const after=await fs.lstat(source);
    if(!identity(before,after)||!after.isFile()||after.nlink!==1)fail('source_file_changed');
  }finally{await input.close();}
}
export async function copyInstalledImageToFreshDirectory(sourceRoot,destinationRoot,{onDirectory=async()=>{}}={}){
  if(!path.isAbsolute(sourceRoot||'')||!path.isAbsolute(destinationRoot||'')
    ||inside(sourceRoot,destinationRoot)||inside(destinationRoot,sourceRoot))fail('separate_absolute_roots_required');
  const source=path.resolve(sourceRoot),target=path.resolve(destinationRoot);
  await physicalDirectory(source);
  const before=await captureInstalledTreeFingerprint(source);
  // The destination must not exist. A previous ambiguous copy never replays.
  try{await fs.lstat(target);fail('destination_exists');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  await physicalDirectory(path.dirname(target));
  await fs.mkdir(target,{recursive:false,mode:0o700});
  await onDirectory(target);
  async function walk(from,to){
    const oldDir=await physicalDirectory(from);
    const names=(await fs.readdir(from)).sort();
    for(const name of names){
      if(!validName(name))fail('invalid_path');
      const sourceFile=path.join(from,name),destFile=path.join(to,name);
      const stat=await fs.lstat(sourceFile);
      if(stat.isSymbolicLink())fail('reparse_point');
      if(stat.isDirectory()){
        await fs.mkdir(destFile,{mode:0o700});
        await onDirectory(destFile);
        await walk(sourceFile,destFile);
      }else await copyPinnedFile(sourceFile,destFile,stat);
    }
    const after=await fs.lstat(from);
    if(!identity(oldDir,after))fail('source_directory_changed');
  }
  await walk(source,target);
  const [after,copied]=await Promise.all([
    captureInstalledTreeFingerprint(source),
    captureInstalledTreeFingerprint(target)
  ]);
  if(after.tree_sha256!==before.tree_sha256||copied.tree_sha256!==before.tree_sha256
    ||copied.file_count!==before.file_count||copied.total_bytes!==before.total_bytes)
    fail('source_or_snapshot_changed');
  return Object.freeze({schema:QA_IMAGE_SNAPSHOT_SCHEMA,tree_sha256:before.tree_sha256,
    file_count:before.file_count,total_bytes:before.total_bytes,
    source_unchanged:true,copied_tree_verified:true,installed_mutated:false,
    restore_authorized:false,production_authorized:false,authority_effect:false});
}
export async function stagePrivateQaImageSnapshot({installedRoot,snapshotContainer}){
  if(process.platform!=='win32')fail('windows_only');
  if(path.basename(path.resolve(installedRoot||''))!=='METAENGINE Browser Test'
    ||!path.isAbsolute(snapshotContainer||'')||!path.isAbsolute(installedRoot||'')
    ||inside(installedRoot,snapshotContainer)||inside(snapshotContainer,installedRoot))
    fail('boundary_invalid');
  await physicalDirectory(snapshotContainer);
  if((await fs.readdir(snapshotContainer)).length!==0)fail('snapshot_container_not_empty');
  const parent=await verifyOwnerOnlyWindowsStorage(snapshotContainer,{operation:'VERIFY_DIRECTORY'});
  if(parent.owner_dacl_verified!==true)fail('private_root_not_verified');
  const imageDirectory=path.join(snapshotContainer,'image');
  const result=await copyInstalledImageToFreshDirectory(installedRoot,imageDirectory,{
    onDirectory:async dir=>{
      const proof=await protectOwnerOnlyWindowsDirectory(dir);
      if(proof.owner_dacl_verified!==true)fail('private_directory_not_protected');
    }
  });
  const verified=await verifyOwnerOnlyWindowsStorage(imageDirectory,{operation:'VERIFY_DIRECTORY'});
  if(verified.owner_dacl_verified!==true)fail('snapshot_dacl_unverified');
  const proofFile=path.join(snapshotContainer,'snapshot-proof.json');
  const file=await fs.open(proofFile,'wx',0o600);
  try{await file.writeFile(JSON.stringify({...result,installed_root:installedRoot,
    image_directory:imageDirectory})+'\n');await file.sync();}finally{await file.close();}
  const acl=await verifyOwnerOnlyWindowsStorage(proofFile,{operation:'VERIFY_PRIVATE_FILE'});
  if(acl.owner_dacl_verified!==true)fail('snapshot_receipt_acl_unverified');
  return Object.freeze({...result,image_directory:imageDirectory,receipt_file:proofFile});
}
