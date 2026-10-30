import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {W74_SCOPE_LOCK_SQL} from '../../apps/metaengine-browser/src/host-owner-genesis-custody-w74.mjs';
import {pendingOwnerScope,pendingOwnerTransition} from '../../apps/metaengine-browser/src/native-coding-pending-owner-phase.mjs';
const fail=()=>{throw Error('native_pending_owner_scope_unavailable');};
const same=(a,b)=>json(a)===json(b);
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const INTENT='native-coding-pending-owner-intent-v1.json';
// Fixed exact immutable-ledger selection. The legacy W74 LIMIT 2 project query
// is never used here; unrelated projects cannot select or shadow this root.
export const PENDING_OWNER_SCOPE_SQL=`select g.input,g.configuration,g.preparation,g.receipt,
 g.workspace_id,g.project_id,g.root_task_id,p.device_id,p.client_id,p.admin_grant_epoch,
 p.state as project_state,p.goal,t.state as root_state,t.lease_generation,t.task_spec_sha256,
 pg_catalog.clock_timestamp() as observed_at
 from destruktion_meta.native_coding_pending_goal_h205f22 g
 join destruktion_meta.project_run_h205f22 p on p.project_id=g.project_id and p.root_task_id=g.root_task_id
 join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=g.root_task_id
 join destruktion_meta.project_task_h205f22 pt on pt.project_id=g.project_id and pt.task_id=g.root_task_id
 and pt.root_task_id=g.root_task_id and pt.parent_task_id is null and pt.depth=0
 where g.request_id=$1::uuid and g.preparation_id=$2::uuid and g.configuration_sha256=$3::text
 for share of g,p,t,pt`;

export async function runPendingOwnerCustody({tx,input,configuration,preparation,admission,device,context,
 mode,revalidate,load,durable,assertTransaction}={}){
 if(!context?.pendingOwnerPhases||!['WRITE_CUSTODY','READ_CUSTODY'].includes(mode))fail();
 const write=mode==='WRITE_CUSTODY';let retained=null;
 await tx.unsafe(W74_SCOPE_LOCK_SQL,[device.device_id+':'+device.client_id]);
 const readScope=async()=>{
  await revalidate(tx);assertTransaction();
  const rows=await tx.unsafe(PENDING_OWNER_SCOPE_SQL,[input.request_id,input.preparation_id,input.configuration_sha256]);
  const row=rows[0];
  if(rows.length!==1||!same(row.input,input)||!same(row.configuration,configuration)||!same(row.preparation,preparation)
   ||!same(row.receipt,admission)||row.workspace_id!==admission.workspace_id||row.project_id!==admission.project_id
   ||row.root_task_id!==admission.root_task_id||row.device_id!==device.device_id||row.client_id!==device.client_id
   ||Number(row.admin_grant_epoch)!==device.admin_grant_epoch||row.project_state!=='PAUSED'||row.root_state!=='BLOCKED'
   ||Number(row.lease_generation)!==0||row.goal!==input.objective||row.task_spec_sha256!==admission.task_spec_sha256)fail();
  if(retained){if(!same(await load(INTENT,context),retained))fail();await revalidate(tx);}
  assertTransaction();
  return pendingOwnerScope({device_id:device.device_id,client_id:device.client_id,key_fingerprint_sha256:device.key_fingerprint_sha256,
   admin_grant_epoch:device.admin_grant_epoch,project_id:row.project_id,observed_at:new Date(row.observed_at).toISOString()});
 };
 const scope=await readScope();
 const fixed={schema:'metaengine.native-coding.pending-owner-intent.v1',input,
  preparation_sha256:sha(preparation),admission_sha256:sha(admission),device_id:device.device_id,client_id:device.client_id,
  key_fingerprint_sha256:device.key_fingerprint_sha256,admin_grant_epoch:device.admin_grant_epoch,
  host_instance_id:context.instanceId,host_pid:context.hostPid};
 retained=await load(INTENT,context);
 const checkIntent=value=>{
  if(!value||!same(value.binding,fixed)||Object.keys(value).sort().join('|')!=='binding|origin|transition'
   ||!value.origin||Object.keys(value.origin).sort().join('|')!=='action|body_sha256|request_id|request_sha256'
   ||value.origin.action!=='ESTABLISH_PENDING_OWNER_V1'||!UUID.test(value.origin.request_id||'')
   ||![value.origin.body_sha256,value.origin.request_sha256].every(v=>HASH.test(v||'')))fail();
  pendingOwnerTransition(value.transition);return value;
 };
 // Fresh attempt never adopts/replaces an earlier intent, even same selector.
 // Different Host generation cannot adopt it during readonly recovery either.
 if(write&&retained||!write&&!retained)fail();
 if(retained)checkIntent(retained);
 const connectionClosed=()=>context.pendingOwnerPhases.close();
 if(tx.signal?.aborted)fail();
 tx.signal?.addEventListener('abort',connectionClosed,{once:true});
 try{return await context.pendingOwnerPhases.run(scope,{
  readScope,
  prepareTransition:async transition=>{
   if(!write||retained)fail();await readScope();
   const intent={binding:fixed,origin:{action:context.action,request_id:context.requestId,request_sha256:context.requestDigest,body_sha256:context.bodyDigest},
    transition:pendingOwnerTransition(transition)};
   checkIntent(intent);
   await durable(INTENT,intent,context,assertTransaction);
   retained=checkIntent(await load(INTENT,context));if(!same(retained,intent))fail();
   await readScope();
  },
  verifyTransition:async value=>{
   if(write||!retained)fail();await readScope();
   const current=checkIntent(await load(INTENT,context));
   if(!same(current,retained)||value.sealed_sha256!==current.transition.next_sha256)fail();
  },
 });}finally{tx.signal?.removeEventListener('abort',connectionClosed);}
}
