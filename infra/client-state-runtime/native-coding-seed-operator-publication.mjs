import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {publishNativeSeedSelectorWindows} from './native-coding-selector-move.mjs';
import {nativeCodingCanonicalJson as canonical} from './native-coding-task-context.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import {readPreparedNativeCodingSeedProfile} from './native-coding-seed-profile-preparation.mjs';
import {observeNativeCodingSeedProfile} from './native-coding-host-seed-service.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
const fail=reason=>{throw Error('native_coding_seed_publication_'+reason);};
// Private installer/operator composition. No IPC, new credentials or ACL changes.
export async function publishNativeCodingSeedOperator({sql,stateDirectory,profile_id,profile_sha256,
 readNativeScope,requestContext,verifyStorage=verifyOwnerOnlyWindowsStorage,publishCompleted=publishNativeSeedSelectorWindows}={}){
 assertNativeCodingHostRequestOpen(requestContext);
 if(!path.isAbsolute(stateDirectory||'')||typeof readNativeScope!=='function'||typeof verifyStorage!=='function'||typeof publishCompleted!=='function')fail('configuration_invalid');
 const selector={sql,profile_id,profile_sha256,requestContext};
 await readPreparedNativeCodingSeedProfile(selector);
 const [{value}]=await sql.unsafe('select destruktion_meta.native_coding_seed_profile_v1($1::uuid,true) as value',[profile_id]);
 if(value?.profile_sha256!==profile_sha256||value?.profile?.profile_id!==profile_id)fail('profile_changed');
 const root=await fs.realpath(stateDirectory),stat=await fs.lstat(stateDirectory);
 if(root!==stateDirectory||!stat.isDirectory()||stat.isSymbolicLink())fail('directory_invalid');
 const verifyDirectory=async()=>{
  const result=await verifyStorage(root,{operation:'VERIFY_DIRECTORY',signal:requestContext?.signal});
  if(result?.owner_dacl_verified!==true)fail('directory_unverified');
  const after=await fs.lstat(root);
  if(!after.isDirectory()||after.isSymbolicLink()||after.dev!==stat.dev||after.ino!==stat.ino||await fs.realpath(root)!==root)fail('directory_changed');
  assertNativeCodingHostRequestOpen(requestContext);
 };
 const pin={schema:'metaengine.native-coding.seed-operator.v1',profile_id,profile_sha256};
 const file=path.join(root,'native-coding-seed-operator-v1.json');
 await verifyDirectory();
 let existing=null;
 try{existing=await readNativeCodingProtectedJson(file,{maximumBytes:4096,verifyStorage,signal:requestContext?.signal});}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing){
  if(canonical(existing.value)!==canonical(pin))fail('operator_conflict');
  await readPreparedNativeCodingSeedProfile(selector);await verifyDirectory();
  assertNativeCodingHostRequestOpen(requestContext);
  // A lost publication reply is recovered by reads only. This proves stored
  // configuration, not a new physical observation or admission to execute.
  return Object.freeze({schema:'metaengine.native-coding.operator-publication.v1',profile_id,profile_sha256,
   operator_pin_published:true,existing_pin:true,physical_scope_observed:false,readback_only:true,
   physical_execution_proven:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
 }
 await readNativeScope.prepare?.();
 await observeNativeCodingSeedProfile({profile:value.profile,profileSha256:profile_sha256,readNativeScope,requestContext,
  revalidate:async()=>{await readPreparedNativeCodingSeedProfile(selector);await verifyDirectory();}});
 assertNativeCodingHostRequestOpen(requestContext);
 const temporary=path.join(root,`.native-seed-selector-${randomUUID()}.tmp`);
 let created=false,published=false;
 try{
  const handle=await fs.open(temporary,'wx',0o600);created=true;
  try{await handle.writeFile(canonical(pin)+'\n');await handle.sync();}finally{await handle.close();}
  const staged=await readNativeCodingProtectedJson(temporary,{maximumBytes:4096,verifyStorage,signal:requestContext?.signal});
  if(canonical(staged.value)!==canonical(pin))fail('staged_operator_changed');
  await verifyDirectory();
  published=await publishCompleted(temporary,file,{requestContext});
  if(typeof published!=='boolean')fail('native_publication_unconfirmed');
 }finally{if(created)await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 await verifyDirectory();
 const actual=await readNativeCodingProtectedJson(file,{maximumBytes:4096,verifyStorage,signal:requestContext?.signal});
 if(canonical(actual.value)!==canonical(pin))fail('operator_conflict');
 await readPreparedNativeCodingSeedProfile(selector);assertNativeCodingHostRequestOpen(requestContext);
 return Object.freeze({schema:'metaengine.native-coding.operator-publication.v1',profile_id,profile_sha256,
  operator_pin_published:true,existing_pin:!published,physical_scope_observed:true,readback_only:false,
  physical_execution_proven:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
}
