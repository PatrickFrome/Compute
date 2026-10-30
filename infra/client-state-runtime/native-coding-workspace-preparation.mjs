import fs from 'node:fs/promises';
import path from 'node:path';
import {readNativeWorkspaceStage} from '../../apps/metaengine-browser/src/native-coding-workspace-preparation.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {observeNativeCodingSeedProfile} from './native-coding-host-seed-service.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
const fail=reason=>{throw Error('native_workspace_preparation_'+reason);};
const same=(a,b)=>json(a)===json(b);
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...k].sort().join('|');
const HASH=/^[a-f0-9]{64}$/;
const INTENT='native-coding-workspace-preparation-intent-v1.json';
const RECEIPT='native-coding-workspace-preparation-receipt-v1.json';
// These are private constructor dependencies, not request-selected readers.
// Workspace preparation writes immutable local records. Explicit signed goal
// admission additionally creates a BLOCKED/PAUSED own-PG binding, never a seed
// profile, execution permit or Owner activation. Recovery never retries effects.
export function createNativeWorkspacePreparation({transaction,stateDirectory,readCurrentDevice,readNativeScope,
 readStage=readNativeWorkspaceStage,readProtectedJson=readNativeCodingProtectedJson,
 verifyStorage=verifyOwnerOnlyWindowsStorage,readRootIdentity=readDirectoryIdentity,
 observe=observeNativeCodingSeedProfile}={}){
 if(!path.isAbsolute(stateDirectory||'')||typeof transaction!=='function'
  ||[readCurrentDevice,readNativeScope,readStage,readProtectedJson,verifyStorage,readRootIdentity,observe].some(f=>typeof f!=='function'))fail('dependencies_required');
 let closed=false;
 const live=context=>{if(closed)fail('closed');assertNativeCodingHostRequestOpen(context);};
 async function load(name,context){
  try{return(await readProtectedJson(path.join(stateDirectory,name),{maximumBytes:16384,verifyStorage,signal:context?.signal})).value;}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 async function durable(name,value,context,assertTransaction=()=>{}){
  live(context);assertTransaction();const handle=await fs.open(path.join(stateDirectory,name),'wx',0o600);
  try{await handle.writeFile(json(value)+'\n');await handle.sync();}finally{await handle.close();}
  live(context);
 }
 async function run(input,write,context,goal=null){
  live(context);
  if(!exact(input,['preparation_id','configuration_sha256'])||!/^[a-f0-9-]{36}$/.test(input.preparation_id||'')||!HASH.test(input.configuration_sha256||''))fail('selector_invalid');
  const staged=await readStage(stateDirectory,{verifyStorage,signal:context?.signal});live(context);
  if(!same(staged.input,input))fail('stage_changed');
  const c=staged.configuration,device=await readCurrentDevice();live(context);
  let transactionEnded=false,transactionWork;
  const transactionOpen=()=>{live(context);if(transactionEnded)fail('transaction_ended');};
  const root=await fs.realpath(stateDirectory),stat=await fs.lstat(stateDirectory);
  if(root!==stateDirectory||!stat.isDirectory()||stat.isSymbolicLink())fail('directory_invalid');
  const directoryIdentity=await readRootIdentity(root);
  const revalidate=async tx=>{
   live(context);
   if(tx){transactionOpen();await tx.unsafe('select destruktion_meta.project_device_grant_h205f22($1::uuid,$2::text,$3::bigint)',[device.device_id,device.client_id,device.admin_grant_epoch]);}
   if((await verifyStorage(root,{operation:'VERIFY_DIRECTORY',signal:context?.signal}))?.owner_dacl_verified!==true)fail('directory_unverified');
   if(await readRootIdentity(root)!==directoryIdentity||!same((await readStage(root,{verifyStorage,signal:context?.signal})).input,input)
    ||!same(await readCurrentDevice(),device))fail('identity_changed');
   const roots=await Promise.all([readRootIdentity(c.repo_root),readRootIdentity(c.managed_root)]);
   if(roots[0]!==c.repo_root_identity_sha256||roots[1]!==c.managed_root_identity_sha256)fail('repository_identity_changed');
   // Filesystem/native awaits may outlive a server idle timeout. Confirm the
   // same transaction still owns its locks immediately before any new effect.
   if(tx){transactionOpen();await tx.unsafe('select 1 as preparation_transaction_alive');transactionOpen();}
   live(context);
  };
  await revalidate();
  // READ ONLY here means fixed SELECTs only, not SET TRANSACTION READ ONLY:
  // PostgreSQL requires a normal transaction for SELECT FOR SHARE. Locks on
  // current device and existing repository grant remain held through fsync.
  let result;
  try{result=await transaction('isolation level serializable',tx=>{
   transactionWork=(async()=>{
   live(context);
   await tx.unsafe("set local statement_timeout='10s'");
   await tx.unsafe("set local lock_timeout='3s'");
   await tx.unsafe("set local idle_in_transaction_session_timeout='30s'");
   const roles=await tx.unsafe('select current_user::text as current_user,session_user::text as session_user');
   if(roles.length!==1||roles[0].current_user!=='state_owner'||roles[0].session_user!=='state_owner')fail('state_owner_required');
   await tx.unsafe('select destruktion_meta.project_device_grant_h205f22($1::uuid,$2::text,$3::bigint)',[device.device_id,device.client_id,device.admin_grant_epoch]);
   // Lock pairing too: project_device_grant checks it but does not lock its row.
   const current=await tx.unsafe(`select d.key_fingerprint_sha256 from public.compute_fabric_a2_browser_device_h205f22 d
    join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p on p.token_hash=d.enrollment_pairing_token_hash
    where d.device_id=$1::uuid and d.client_id=$2::text and d.admin_grant_epoch=$3::bigint
    and d.active and d.revoked_at is null and d.admin_revoked_at is null and d.access_tier='ADMIN'
    and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb and p.active for share of d,p`,
    [device.device_id,device.client_id,device.admin_grant_epoch]);
   if(current.length!==1||current[0].key_fingerprint_sha256!==device.key_fingerprint_sha256)fail('grant_changed');
   const rows=await tx.unsafe(`select coordination_workspace_id,device_id,client_id,admin_grant_epoch,repo_id,repo_root,managed_root
    from public.compute_fabric_a2_managed_project_repository_h205f22
    where coordination_workspace_id=$1::uuid and device_id=$2::uuid and client_id=$3::text for share`,[c.workspace_id,device.device_id,device.client_id]);
   const row=rows[0];
   if(rows.length!==1||Number(row.admin_grant_epoch)!==device.admin_grant_epoch||row.coordination_workspace_id!==c.workspace_id
    ||row.device_id!==device.device_id||row.client_id!==device.client_id||['repo_id','repo_root','managed_root'].some(k=>row[k]!==c[k]))fail('workspace_authorization_required');
   await revalidate(tx);
   const intent={schema:'metaengine.native-coding.workspace-preparation-intent.v1',...input,
    device_id:device.device_id,client_id:device.client_id,device_key_fingerprint_sha256:device.key_fingerprint_sha256,
    preparation_grant_epoch:device.admin_grant_epoch,workspace_id:c.workspace_id,
    repository_scope_sha256:sha({...row,admin_grant_epoch:Number(row.admin_grant_epoch)}),state_directory_identity_sha256:directoryIdentity};
   const response=state=>({schema:'metaengine.native-coding.workspace-preparation-readback.v1',...input,state,
    preparation_grant_epoch:device.admin_grant_epoch,current_grant_valid:true,owner_incarnation_verified:false,
    execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false});
   async function readback(){
    const prior=await load(INTENT,context),receipt=await load(RECEIPT,context);
    if(prior&&!same(prior,intent))fail('intent_conflict');
    if(receipt){
     if(!prior||!exact(receipt,['schema','intent','observation_sha256','prepared_at'])
      ||receipt.schema!=='metaengine.native-coding.workspace-preparation-receipt.v1'||!same(receipt.intent,intent)
      ||!HASH.test(receipt.observation_sha256||'')||!Number.isFinite(Date.parse(receipt.prepared_at))
      ||new Date(receipt.prepared_at).toISOString()!==receipt.prepared_at)fail('receipt_invalid');
     await revalidate(tx);return response('PREPARED');
    }
    await revalidate(tx);return response(prior?'UNKNOWN':'NOT_STARTED');
   }
   const before=await readback();
   if(goal){
    if(before.state!=='PREPARED')fail('goal_preparation_required');
    const goalFile='native-coding-pending-goal-intent-v1.json';
    const goalIntent={schema:'metaengine.native-coding.pending-goal-intent.v1',input:goal,preparation:intent};
    const prior=await load(goalFile,context);
    if(prior&&!same(prior,goalIntent))fail('goal_intent_conflict');
    const query=async mutate=>{
     await revalidate(tx);
     const rows=await tx.unsafe('select destruktion_meta.native_coding_pending_goal_v1($1::text::jsonb,$2::text::jsonb,$3::text::jsonb,$4::boolean) as receipt',
      [json(goal),json(c),json(intent),mutate]);
     if(rows.length!==1)fail('goal_readback_invalid');
     return rows[0].receipt;
    };
    const response=admission=>({schema:'metaengine.native-coding.pending-goal-result.v1',
     state:admission?'PENDING_ACTIVATION':prior?'READBACK_REQUIRED':'NOT_STARTED',admission,
     automatic_retry_allowed:false,authority_effect:false});
    const stored=await query(false);
    if(stored&&!prior)fail('goal_intent_missing');
    if(prior||!write)return response(stored);
    // Irreversible no-overwrite dispatch fence BEFORE physical qualification or
    // SQL mutation. Restart/unknown outcomes only re-read the same immutable ID.
    await readNativeScope.prepare?.();await revalidate(tx);
    try{await durable(goalFile,goalIntent,context,transactionOpen);}catch(error){
     if(error.code==='EEXIST')return {schema:'metaengine.native-coding.pending-goal-result.v1',state:'READBACK_REQUIRED',admission:null,
      automatic_retry_allowed:false,authority_effect:false};throw error;
    }
    if(!same(await load(goalFile,context),goalIntent))fail('goal_intent_conflict');
    const scopeTransaction=Object.freeze({unsafe:(...args)=>{transactionOpen();return tx.unsafe(...args);}});
    const transactionalScope=(permit,sandbox,_reader,request)=>readNativeScope(permit,sandbox,scopeTransaction,request);
    if(typeof readNativeScope.batch==='function')transactionalScope.batch=(permits,sandbox,_reader,request)=>readNativeScope.batch(permits,sandbox,scopeTransaction,request);
    await observe({profile:{...c,profile_id:c.preparation_id},profileSha256:input.configuration_sha256,
     readNativeScope:transactionalScope,revalidate:()=>revalidate(tx),requestContext:context});
    await revalidate(tx);
    return response(await query(true));
   }
   if(!write||before.state!=='NOT_STARTED')return before;
   // Cold immutable image qualification precedes observation freshness and
   // Host intent; recovery/readback never invokes this preparatory reader.
   await readNativeScope.prepare?.();await revalidate(tx);
   // Immutable intent is retained on ANY failure. No subsequent call resumes
   // an interrupted observation/write, even when no success receipt exists.
   try{await durable(INTENT,intent,context,transactionOpen);}catch(error){if(error.code==='EEXIST')return readback();throw error;}
   if(!same(await load(INTENT,context),intent))fail('intent_changed');
   await revalidate(tx);
   // Adapter reuses physical validation only. This is not a seed profile and
   // contains no Owner epoch, device grant claim, permission or verified flag.
   // Scope reads share this owned transaction, not a second pooled slot.
   // Concurrent preparations must not exhaust both runtime pool slots then
   // wait on another connection for their physical PG read.
   const scopeTransaction=Object.freeze({unsafe:(...args)=>{transactionOpen();return tx.unsafe(...args);}});
   const transactionalScope=(permit,sandbox,_reader,request)=>readNativeScope(permit,sandbox,scopeTransaction,request);
   if(typeof readNativeScope.batch==='function')transactionalScope.batch=(permits,sandbox,_reader,request)=>readNativeScope.batch(permits,sandbox,scopeTransaction,request);
   const observation=await observe({profile:{...c,profile_id:c.preparation_id},profileSha256:input.configuration_sha256,
    readNativeScope:transactionalScope,revalidate:()=>revalidate(tx),requestContext:context});
   await revalidate(tx);
   await durable(RECEIPT,{schema:'metaengine.native-coding.workspace-preparation-receipt.v1',intent,
    observation_sha256:sha(observation),prepared_at:new Date().toISOString()},context,transactionOpen);
   return readback();
   })();return transactionWork;
  });}finally{
   // postgres.js can reject begin on server disconnect while its async body
   // is still inside a physical await. Fence late SQL/effects and JOIN that
   // body before returning, draining, or letting the pool be closed.
   transactionEnded=true;await transactionWork?.catch(()=>{});
  }
  live(context);return result;
 }
 function goal(input,write,context){
  if(!exact(input,['preparation_id','configuration_sha256','request_id','objective'])
   ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.request_id||'')
   ||typeof input.objective!=='string'||!input.objective||input.objective!==input.objective.trim()
   ||[...input.objective].length>480||Buffer.byteLength(input.objective)>1920||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.objective))fail('goal_input_invalid');
  return run({preparation_id:input.preparation_id,configuration_sha256:input.configuration_sha256},write,context,input);
 }
 return Object.freeze({ADMIT_PREPARED_GOAL_V1:(input,context)=>goal(input,true,context),
  READ_PREPARED_GOAL_V1:(input,context)=>goal(input,false,context),PREPARE_WORKSPACE_V1:(input,context)=>run(input,true,context),
  READ_WORKSPACE_PREPARATION_V1:(input,context)=>run(input,false,context),close(){closed=true;}});
}
