import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const fail=()=>{throw new Error('native_coding_directory_identity_unverified');};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
// Both Browser and its private own-PG Host use the same native volume/file
// identity. A pathname hash cannot distinguish a replaced directory.
export async function readDirectoryIdentity(directory) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||directory.includes('\0')) fail();
  const resolved=path.resolve(directory);
  if(!samePath(resolved,directory)||!samePath(await fs.realpath(directory),resolved)) fail();
  const before=await fs.lstat(directory,{bigint:true});
  if(!before.isDirectory()||before.isSymbolicLink()||before.ino<=0n||before.dev<0n||before.birthtimeNs<=0n) fail();
  // Refuse aliases in every existing ancestor as well as the leaf.
  let parent=resolved;
  for(;;) {
    const row=await fs.lstat(parent,{bigint:true});
    if(!row.isDirectory()||row.isSymbolicLink()||!samePath(await fs.realpath(parent),parent)) fail();
    const next=path.dirname(parent);if(next===parent) break;parent=next;
  }
  const after=await fs.lstat(directory,{bigint:true});
  if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino
      ||before.birthtimeNs!==after.birthtimeNs||!samePath(await fs.realpath(directory),resolved)) fail();
  return createHash('sha256').update(JSON.stringify({schema:'metaengine.native-coding.fs-identity.v1',
    volume_id:before.dev.toString(),file_id:before.ino.toString(),birth_time_ns:before.birthtimeNs.toString()})).digest('hex');
}
