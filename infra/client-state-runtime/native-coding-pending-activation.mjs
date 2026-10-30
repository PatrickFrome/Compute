import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {readPendingActivationProfile,validatePendingActivationInput} from './native-coding-pending-activation-profile.mjs';
import {PENDING_OWNER_SCOPE_SQL} from './native-coding-pending-owner-custody.mjs';
import {pendingOwnerScope,pendingOwnerTransition} from '../../apps/metaengine-browser/src/native-coding-pending-owner-phase.mjs';
import {W74_SCOPE_LOCK_SQL} from '../../apps/metaengine-browser/src/host-owner-genesis-custody-w74.mjs';
import {observeNativeCodingSeedProfile} from './native-coding-host-seed-service.mjs';
const INTENT='native-coding-pending-activation-intent-v1.json';
const OWNER_INTENT='native-coding-pending-owner-intent-v1.json';
const same=(a,b)=>json(a)===json(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=reason=>{throw Error('native_pending_activation_'+reason);};
// Called only inside the signed Host workspace scope's already reserved tx.
// No pool.begin, public RPC, caller-selected reader, reseal or retry capability.
export async function runPendingGoalActivation({tx,input,configuration,preparation,admission,device,context,
 write,revalidate,load,durable,assertTransaction,stateDirectory,verifyStorage,readNativeScope}={}){
 const checked=validatePendingActivationInput(input),goal={...checked};delete goal.activation_id;delete goal.profile_id;delete goal.profile_sha256;
 const open=()=>{assertTransaction();};open();
 const response=(state,activation=null)=>({schema:'metaengine.native-coding.pending-activation-result.v1',state,activation,
  automatic_retry_allowed:false,authority_effect:false});
 const fixed={schema:'metaengine.native-coding.pending-activation-intent.v1',input:checked,
  preparation_sha256:sha(preparation),admission_sha256:sha(admission),device_id:device.device_id,client_id:device.client_id,
  key_fingerprint_sha256:device.key_fingerprint_sha256,admin_grant_epoch:device.admin_grant_epoch,
  host_instance_id:context?.instanceId,host_pid:context?.hostPid};
 const prior=await load(INTENT,context);open();
 if(prior&&!same(prior.binding,fixed))fail('intent_conflict');
 const records=await tx.unsafe('select input,receipt,sealed_owner_sha256 from destruktion_meta.native_coding_pending_activation_h205f22 where request_id=$1::uuid or activation_id=$2::uuid for share',[checked.request_id,checked.activation_id]);open();
 if(records.length>1||records.length===1&&!same(records[0].input,checked))fail('receipt_conflict');
 if(prior&&(!exact(prior,['binding','sealed_owner_sha256'])||!HASH.test(prior.sealed_owner_sha256||'')))fail('intent_invalid');
 if(records.length){
  if(!prior||prior.sealed_owner_sha256!==records[0].sealed_owner_sha256)fail('intent_missing');
  await readPendingActivationProfile({tx,stateDirectory,input:checked,configuration,device,requestContext:context,revalidate,verifyStorage});
  await revalidate(tx);open();
  return response(write?'READBACK_REQUIRED':'ACTIVATED',write?null:records[0].receipt);
 }
 if(!write||prior)return response(prior?'READBACK_REQUIRED':'NOT_STARTED');
 const phase=context?.pendingActivationPhases;
 if(!phase||typeof phase.authorize!=='function'||typeof phase.assertOpen!=='function'||typeof tx.addCommitGuard!=='function')fail('native_owner_phase_required');
 tx.addCommitGuard(()=>{open();phase.assertOpen();});
 await tx.unsafe(W74_SCOPE_LOCK_SQL,[device.device_id+':'+device.client_id]);open();
 const owner=await load(OWNER_INTENT,context);open();
 const expectedOwnerBinding={schema:'metaengine.native-coding.pending-owner-intent.v1',input:goal,
  preparation_sha256:sha(preparation),admission_sha256:sha(admission),device_id:device.device_id,client_id:device.client_id,
  key_fingerprint_sha256:device.key_fingerprint_sha256,admin_grant_epoch:device.admin_grant_epoch,
  host_instance_id:context.instanceId,host_pid:context.hostPid};
 if(!exact(owner,['binding','origin','transition'])||!same(owner.binding,expectedOwnerBinding)
  ||!exact(owner.origin,['action','body_sha256','request_id','request_sha256'])||owner.origin.action!=='ESTABLISH_PENDING_OWNER_V1'
  ||!UUID.test(owner.origin.request_id||'')||![owner.origin.body_sha256,owner.origin.request_sha256].every(v=>HASH.test(v||'')))fail('owner_intent_required');
 pendingOwnerTransition(owner.transition);
 const profile=await readPendingActivationProfile({tx,stateDirectory,input:checked,configuration,device,requestContext:context,revalidate,verifyStorage});open();
 const readScope=async()=>{
  open();phase.assertOpen();await revalidate(tx);open();
  const rows=await tx.unsafe(PENDING_OWNER_SCOPE_SQL,[checked.request_id,checked.preparation_id,checked.configuration_sha256]);open();const row=rows[0];
  if(rows.length!==1||!same(row.input,goal)||!same(row.configuration,configuration)||!same(row.preparation,preparation)
   ||!same(row.receipt,admission)||row.workspace_id!==admission.workspace_id||row.project_id!==admission.project_id
   ||row.root_task_id!==admission.root_task_id||row.device_id!==device.device_id||row.client_id!==device.client_id
   ||Number(row.admin_grant_epoch)!==device.admin_grant_epoch||row.project_state!=='PAUSED'||row.root_state!=='BLOCKED'
   ||Number(row.lease_generation)!==0||row.goal!==checked.objective||row.task_spec_sha256!==admission.task_spec_sha256
   ||!same(await load(OWNER_INTENT,context),owner))fail('pending_scope_changed');
  const current=await readPendingActivationProfile({tx,stateDirectory,input:checked,configuration,device,requestContext:context,revalidate,verifyStorage});
  if(!same(current,profile))fail('profile_changed');open();phase.assertOpen();
  return pendingOwnerScope({device_id:device.device_id,client_id:device.client_id,key_fingerprint_sha256:device.key_fingerprint_sha256,
   admin_grant_epoch:device.admin_grant_epoch,project_id:row.project_id,observed_at:new Date(row.observed_at).toISOString()});
 };
 const envelope=scope=>({schema:'metaengine.native-coding.pending-activation-scope.v1',input:checked,scope,artifact:profile.profile.artifact});
 const initial=envelope(await readScope());
 const intent={binding:fixed,sealed_owner_sha256:owner.transition.next_sha256};
 try{await durable(INTENT,intent,context,open);}catch(error){if(error.code==='EEXIST')return response('READBACK_REQUIRED');throw error;}
 if(!same(await load(INTENT,context),intent))fail('intent_changed');open();
 let verified=null;
 const connectionClosed=()=>phase.close?.();
 if(tx.signal?.aborted)fail('transaction_closed');tx.signal?.addEventListener('abort',connectionClosed,{once:true});
 try{
  const scopeTransaction=Object.freeze({unsafe:(...args)=>{open();phase.assertOpen();return tx.unsafe(...args);}});
  const scope=(permit,sandbox,_reader,request)=>readNativeScope(permit,sandbox,scopeTransaction,request);
  if(typeof readNativeScope.batch==='function')scope.batch=(permits,sandbox,_reader,request)=>readNativeScope.batch(permits,sandbox,scopeTransaction,request);
  let observation=null;
  const proof=await phase.authorize(initial,{
   readScope:async()=>{
    // First RECHECK_SCOPE: physical evidence is observed between W74's two
    // fresh native Owner checks. RELEASE only rechecks the inexpensive scope.
    if(!observation)observation=await observeNativeCodingSeedProfile({profile:profile.profile,profileSha256:profile.profile_sha256,
     readNativeScope:scope,revalidate:readScope,requestContext:context});
    return envelope(await readScope());
   },
   verifyTransition:async value=>{
    if(verified||!exact(value,['sealed_sha256'])||value.sealed_sha256!==owner.transition.next_sha256)fail('owner_transition_changed');
    await readScope();verified=Object.freeze({...value});
   },
  });open();phase.assertOpen();
  if(!observation||!verified||!same(proof,verified))fail('native_owner_unverified');
  await readScope();if(!same(await load(INTENT,context),intent))fail('intent_changed');open();phase.assertOpen();
  const rows=await tx.unsafe('select destruktion_meta.native_coding_activate_pending_goal_v1($1::text::jsonb,$2::text,$3::text::jsonb,$3::text,$4::text) as value',
   [json(checked),verified.sealed_sha256,json(observation),sha(observation)]);open();phase.assertOpen();
  if(rows.length!==1||rows[0].value?.state!=='ACTIVATED'||!same(rows[0].value.input,checked))fail('activation_unconfirmed');
  return response('ACTIVATED',rows[0].value);
 }finally{tx.signal?.removeEventListener('abort',connectionClosed);}
}
