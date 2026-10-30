import fs from 'node:fs/promises';
import {verifyOwnerOnlyWindowsStorage} from './private-windows-storage-acl.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import path from 'node:path';
import {readNativeCodingProtectedJson} from './native-coding-host-observers.mjs';
import {nativeCodingCanonicalJson as canonical,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {signNativeCodingDeviceRequest} from './native-coding-device-request.mjs';
export const NATIVE_WORKSPACE_STAGE='native-coding-workspace-stage-v1.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...k].sort().join('|');
const fail=reason=>{throw Error('native_workspace_preparation_'+reason);};
const absolute=v=>typeof v==='string'&&/^[A-Za-z]:\\/.test(v)&&!v.includes('\0')&&v.length<=4096&&path.win32.normalize(v)===v;
export function validateNativeWorkspaceStage(v){
 if(!exact(v,['schema','preparation_id','workspace_id','repo_id','repo_root','managed_root','repo_root_identity_sha256','managed_root_identity_sha256',
  'user_sid','artifact','postgres','agents','expires_at'])||v.schema!=='metaengine.native-coding.workspace-stage.v1'
  ||![v.preparation_id,v.workspace_id].every(x=>UUID.test(x||''))||!/^[-a-zA-Z0-9:._/]{3,160}$/.test(v.repo_id||'')
  ||![v.repo_root,v.managed_root].every(absolute)||v.repo_root.toLowerCase()===v.managed_root.toLowerCase()
  ||![v.repo_root_identity_sha256,v.managed_root_identity_sha256].every(x=>HASH.test(x||''))
  ||!/^S-1-\d+(?:-\d+)+$/.test(v.user_sid||'')||!Number.isFinite(Date.parse(v.expires_at))
  ||new Date(v.expires_at).toISOString()!==v.expires_at||Date.parse(v.expires_at)<=Date.now())fail('stage_invalid');
 const descendant=(root,file)=>{const relative=path.win32.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..\\')&&!path.win32.isAbsolute(relative);};
 if(descendant(v.repo_root,v.managed_root)||descendant(v.managed_root,v.repo_root))fail('roots_overlap');
 if(!exact(v.artifact,['installed_exe_sha256','installed_asar_sha256','runtime_bundle_sha256','source_sha','cli_executable_sha256'])
  ||Object.entries(v.artifact).some(([k,x])=>!(k==='source_sha'?/^[a-f0-9]{40}$/:HASH).test(x||'')))fail('artifact_invalid');
 if(!exact(v.postgres,['system_identifier','data_directory_identity_sha256','postmaster'])
  ||!/^\d+$/.test(v.postgres.system_identifier||'')||!HASH.test(v.postgres.data_directory_identity_sha256||'')
  ||!exact(v.postgres.postmaster,['pid','created_at','process_incarnation_id']))fail('postgres_invalid');
 const pg=v.postgres.postmaster,birth=/^pid:([1-9][0-9]*):created_100ns:([1-9][0-9]{16,18})$/.exec(pg.process_incarnation_id||'');
 if(!Number.isSafeInteger(pg.pid)||pg.pid<1||!birth||Number(birth[1])!==pg.pid||!Number.isFinite(Date.parse(pg.created_at))
  ||new Date(pg.created_at).toISOString()!==pg.created_at||(BigInt(birth[2])-116444736000000000n)/10000n!==BigInt(Date.parse(pg.created_at)))fail('postgres_invalid');
 if(!Array.isArray(v.agents)||v.agents.length<2)fail('roster_invalid');
 const ids=new Set(),providers=new Set();
 for(const a of v.agents){
  if(!exact(a,['provider_id','agent_id','role','agent_generation_epoch','worktree','sandbox'])||!UUID.test(a.provider_id||'')
   ||!/^agent_[a-z0-9-]{8,64}$/.test(a.agent_id||'')||ids.has(a.agent_id)||providers.has(a.provider_id)
   ||!['IMPLEMENTER','CRITIC'].includes(a.role)||!Number.isSafeInteger(a.agent_generation_epoch)||a.agent_generation_epoch<1
   ||!exact(a.worktree,['path','root_identity_sha256','base_sha'])||!absolute(a.worktree.path)
   ||!(a.worktree.path.toLowerCase()===v.repo_root.toLowerCase()||descendant(v.managed_root,a.worktree.path))
   ||!HASH.test(a.worktree.root_identity_sha256||'')||!/^[a-f0-9]{40}$/.test(a.worktree.base_sha||'')
   ||!exact(a.sandbox,['backend','mode','evidence_sha256','outside_write_denied','worktree_write_denied'])
   ||!['CODEX_WINDOWS_ELEVATED','WINDOWS_RESTRICTED_TOKEN','WINDOWS_APPCONTAINER'].includes(a.sandbox.backend)
   ||a.sandbox.mode!==(a.role==='CRITIC'?'read-only':'workspace-write')||a.sandbox.outside_write_denied!==true
   ||a.sandbox.worktree_write_denied!==(a.role==='CRITIC')||!HASH.test(a.sandbox.evidence_sha256||''))fail('roster_invalid');
  ids.add(a.agent_id);providers.add(a.provider_id);
 }
 for(const a of v.agents)if(!['IMPLEMENTER','CRITIC'].every(role=>v.agents.some(b=>b.role===role&&canonical(b.worktree)===canonical(a.worktree)))
  ||v.agents.some(b=>b.worktree.root_identity_sha256===a.worktree.root_identity_sha256&&canonical(b.worktree)!==canonical(a.worktree)))fail('independent_pair_required');
 if(Buffer.byteLength(canonical(v))>1048576)fail('stage_budget');
 return structuredClone(v);
}
export async function readNativeWorkspaceStage(directory,options={}){
 const read=await readNativeCodingProtectedJson(path.join(directory,NATIVE_WORKSPACE_STAGE),{maximumBytes:1048576,...options});
 const configuration=validateNativeWorkspaceStage(read.value);
 return {configuration,input:{preparation_id:configuration.preparation_id,configuration_sha256:sha(configuration)}};
}
// Native main only. READ is always attempted first; a retained intent makes a
// second startup/readback incapable of automatically repeating the write.
export async function prepareNativeWorkspaceFromStage({stateDirectory,identity,capability,assertOpen=()=>{},readStage=readNativeWorkspaceStage,verifyStorage=verifyOwnerOnlyWindowsStorage}={}){
 let stage;try{stage=await readStage(stateDirectory);}catch(error){
  if(error.code!=='ENOENT')throw error;
  // Removal of an opted-in stage is not retirement of an unknown effect.
  for(const name of ['native-coding-workspace-dispatch-intent-v1.json','native-coding-workspace-preparation-intent-v1.json','native-coding-workspace-preparation-receipt-v1.json']){
   const exists=await fs.lstat(path.join(stateDirectory,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(exists)fail('stage_missing_with_retained_state');
  }
  return null;
 }
 assertOpen();const input=stage.input;
 const invoke=async operation=>{
  assertOpen();const before=identity.snapshot();const signed=await signNativeCodingDeviceRequest({identity,binding:capability.snapshot(),operation,input});assertOpen();
  const value=await (operation==='PREPARE_WORKSPACE_V1'?capability.prepareWorkspace(signed):capability.readWorkspacePreparation(signed));
  assertOpen();const after=identity.snapshot();
  if(['device_id','client_id','key_fingerprint_sha256'].some(key=>before[key]!==after[key]))fail('identity_changed');
  if(!exact(value,['schema','preparation_id','configuration_sha256','state','preparation_grant_epoch','current_grant_valid','owner_incarnation_verified','execution_ready','production_qualified','automatic_retry_allowed','authority_effect'])
   ||!Number.isSafeInteger(value.preparation_grant_epoch)||value.preparation_grant_epoch<1||value.production_qualified!==false
   ||value?.schema!=='metaengine.native-coding.workspace-preparation-readback.v1'||value.preparation_id!==input.preparation_id
   ||value.configuration_sha256!==input.configuration_sha256||value.automatic_retry_allowed!==false||value.authority_effect!==false
   ||value.execution_ready!==false||value.owner_incarnation_verified!==false||value.current_grant_valid!==true
   ||!['NOT_STARTED','UNKNOWN','PREPARED'].includes(value.state))fail('readback_invalid');
  return value;
 };
 let result=await invoke('READ_WORKSPACE_PREPARATION_V1');
 if(result.state==='NOT_STARTED'){
  // Retain caller dispatch identity BEFORE transport. Even if Host readback
  // reports absence after a lost send/restart, absence is not replay consent.
  const file=path.join(stateDirectory,'native-coding-workspace-dispatch-intent-v1.json');
  const intent={schema:'metaengine.native-coding.workspace-dispatch-intent.v1',...input};
  const rootIdentity=await readDirectoryIdentity(stateDirectory);
  if((await verifyStorage(stateDirectory,{operation:'VERIFY_DIRECTORY'}))?.owner_dacl_verified!==true)fail('directory_unverified');
  let prior;try{prior=await readNativeCodingProtectedJson(file,{maximumBytes:4096,verifyStorage});}catch(error){if(error.code!=='ENOENT')throw error;}
  if(prior){if(canonical(prior.value)!==canonical(intent))fail('dispatch_conflict');fail('outcome_unknown');}
  assertOpen();let handle;
  try{handle=await fs.open(file,'wx',0o600);}catch(error){if(error.code==='EEXIST')fail('outcome_unknown');throw error;}
  try{await handle.writeFile(canonical(intent)+'\n');await handle.sync();}finally{await handle.close();}
  assertOpen();
  if(await readDirectoryIdentity(stateDirectory)!==rootIdentity
   ||canonical((await readNativeCodingProtectedJson(file,{maximumBytes:4096,verifyStorage})).value)!==canonical(intent))fail('dispatch_changed');
  result=await invoke('PREPARE_WORKSPACE_V1');
 }
 if(result.state!=='PREPARED')fail('outcome_unknown');
 return result;
}
