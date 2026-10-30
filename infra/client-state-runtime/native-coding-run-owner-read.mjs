import path from 'node:path';
import {createNativeCodingDeviceRequestVerifier} from './native-coding-device-request.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {RUN_OWNER_READ,validateRunOwnerReadInput,runOwnerControl,runOwnerScope,runOwnerEvidence} from '../../apps/metaengine-browser/src/native-coding-run-owner-phase.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
const same=(a,b)=>json(a)===json(b),fail=()=>{throw Error('native_run_owner_read_hold');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const iso=v=>v===null?null:new Date(v).toISOString();
const fresh=v=>Number.isFinite(Date.parse(v))&&Date.parse(v)>=Date.now()-30000&&Date.parse(v)<=Date.now()+5000;

// SELECT FOR SHARE is deliberate: on SERIALIZABLE/REPEATABLE READ a row
// changed since the snapshot raises 40001, rather than returning stale control.
// On READ COMMITTED it reads the committed version. Retain this lock until the
// caller's original transaction ends. No INSERT/default control creation.
export const RUN_OWNER_CONTROL_SQL=`select workspace_id,generation_floor,refill_enabled,
 supervisor_admission_enabled,reset_at,updated_at from destruktion_meta.devos_fleet_runtime_control_h205f22
 where workspace_id=$1::uuid for share`;
export const RUN_OWNER_ANCHOR_SQL=`select to_jsonb(e) as execution,g.input as pending_input,g.configuration,g.preparation,g.receipt as admission,
 a.input as activation_input,a.activation_id,a.sealed_owner_sha256,a.receipt as activation_receipt,a.seed_receipt,
 s.receipt as current_seed_receipt,s.observation,s.permit_ids,p.root_task_id,pg_catalog.clock_timestamp() as observed_at
 from destruktion_meta.native_coding_execution_h205f22 e
 join destruktion_meta.project_task_h205f22 pt on pt.task_id=e.task_id
 join destruktion_meta.project_run_h205f22 p on p.project_id=pt.project_id and p.workspace_id=e.workspace_id
 join destruktion_meta.devos_fleet_task_h205f22 root on root.task_id=p.root_task_id
 join destruktion_meta.native_coding_pending_goal_h205f22 g on g.project_id=p.project_id and g.root_task_id=p.root_task_id and g.workspace_id=p.workspace_id
 join destruktion_meta.native_coding_pending_activation_h205f22 a on a.request_id=g.request_id and a.project_id=g.project_id and a.root_task_id=g.root_task_id and a.workspace_id=g.workspace_id
 join destruktion_meta.native_coding_seed_h205f22 s on s.request_id=a.request_id and s.project_id=a.project_id and s.root_task_id=a.root_task_id and s.workspace_id=a.workspace_id
 where e.task_id=$1::uuid and e.workspace_id=$2::uuid and e.lease_generation=$3::bigint and e.reservation_id=$4::uuid
 and p.project_id=$5::uuid and p.state='ACTIVE' and pt.root_task_id=p.root_task_id
 for share of e,pt,p,root,g,a,s`;

export function createNativeRunOwnerReader({sql,scoped,owner,open:authorityOpen,identity,stateDirectory,
 readProtectedJson=readNativeCodingProtectedJson}={}){
 if(!path.isAbsolute(stateDirectory||'')||![scoped,owner,authorityOpen,readProtectedJson].every(f=>typeof f==='function'))fail();
 const verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:identity?.hostInstanceId,hostPid:identity?.hostPid});
 let closed=false;
 const open=request=>{authorityOpen();assertNativeCodingHostRequestOpen(request);
  if(closed||request?.instanceId!==identity.hostInstanceId||request?.hostPid!==identity.hostPid||!request.runOwnerPhases)fail();};
 const load=async(name,request)=>{open(request);const value=(await readProtectedJson(path.join(stateDirectory,name),{maximumBytes:16384,signal:request.signal})).value;open(request);return value;};

 // Reusable private seam. Never begins another transaction or Host request.
 async function readOwnerControl({permit,scope,tx,request}){
  validateRunOwnerReadInput({scope});open(request);
  const assertOpen=()=>{open(request);tx.assertOpen?.();};
  let retained=null,verified=null;
  async function snapshot(){
   assertOpen();await owner(tx);
   const controls=await tx.unsafe(RUN_OWNER_CONTROL_SQL,[scope.workspace_id]);assertOpen();
   if(controls.length!==1)fail();
   const control=runOwnerControl({...controls[0],generation_floor:Number(controls[0].generation_floor),reset_at:iso(controls[0].reset_at),updated_at:iso(controls[0].updated_at)});
   const {c,native}=await scoped(tx,scope,true,request);assertOpen();const p=c.permit,d=c.device;
   if(permit&&!same(permit,p))fail();
   // Lock pairing as well as the device row; scoped's admission checks alone
   // do not retain a pairing lock across the native callback.
   const grants=await tx.unsafe(`select d.key_fingerprint_sha256 from public.compute_fabric_a2_browser_device_h205f22 d
    join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 b on b.token_hash=d.enrollment_pairing_token_hash
    where d.device_id=$1::uuid and d.client_id=$2::text and d.admin_grant_epoch=$3::bigint
    and d.active and d.revoked_at is null and d.access_tier='ADMIN' and d.admin_revoked_at is null
    and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb and b.active for share of d,b`,[d.device_id,d.client_id,d.admin_grant_epoch]);
   if(grants.length!==1||grants[0].key_fingerprint_sha256!==d.key_fingerprint_sha256)fail();
   const [environment]=await tx.unsafe('select public.devos_environment_state_v1($1::uuid) as value',[scope.workspace_id]);
   if(environment?.value?.refill_enabled!==true||environment.value.supervisor_admission_enabled!==true||environment.value.owner_stop===true
    ||environment.value.state==='STOPPED'||Number(environment.value.generation_floor)!==control.generation_floor)fail();
   const rows=await tx.unsafe(RUN_OWNER_ANCHOR_SQL,[scope.task_id,scope.workspace_id,scope.lease_generation,scope.reservation_id,p.project_id]);assertOpen();
   if(rows.length!==1)fail();const r=rows[0],e=r.execution;
   if(!Object.keys(scope).every(k=>['lease_generation','agent_generation_epoch'].includes(k)?Number(e[k])===scope[k]:e[k]===scope[k])
    ||!['RESERVED','ATTEMPTED'].includes(e.state)||!same(r.seed_receipt,r.current_seed_receipt)||!r.permit_ids?.includes(p.permit_id)
    ||r.seed_receipt?.project_id!==p.project_id||r.seed_receipt?.goal_id!==p.goal_id||r.seed_receipt?.goal_sha256!==p.goal_sha256
    ||r.activation_receipt?.state!=='ACTIVATED'||r.activation_receipt.project_id!==p.project_id||r.activation_receipt.root_task_id!==r.root_task_id
    ||!same(r.activation_receipt.input,r.activation_input)||r.activation_input.activation_id!==r.activation_id
    ||!same(r.observation?.host_process,native.host_process)||!same(r.observation?.postgres,native.postgres)
    ||!same(r.configuration?.artifact,p.artifact)||!same(r.configuration?.postgres,p.postgres)||!fresh(r.observed_at))fail();
   const device={device_id:d.device_id,client_id:d.client_id,key_fingerprint_sha256:d.key_fingerprint_sha256,admin_grant_epoch:d.admin_grant_epoch};
   const fixed={preparation_sha256:sha(r.preparation),admission_sha256:sha(r.admission),...device,host_instance_id:request.instanceId,host_pid:request.hostPid};
   const oi=await load('native-coding-pending-owner-intent-v1.json',request),ai=await load('native-coding-pending-activation-intent-v1.json',request);
   if(!exact(oi,['binding','origin','transition'])||!same(oi.binding,{schema:'metaengine.native-coding.pending-owner-intent.v1',input:r.pending_input,...fixed})
    ||!exact(oi.origin,['action','request_id','request_sha256','body_sha256'])||oi.origin.action!=='ESTABLISH_PENDING_OWNER_V1'||!UUID.test(oi.origin.request_id||'')
    ||![oi.origin.request_sha256,oi.origin.body_sha256].every(v=>HASH.test(v||''))||!same(oi.transition,{previous_sha256:null,next_sha256:r.sealed_owner_sha256})
    ||!exact(ai,['binding','sealed_owner_sha256'])||ai.sealed_owner_sha256!==r.sealed_owner_sha256
    ||!same(ai.binding,{schema:'metaengine.native-coding.pending-activation-intent.v1',input:r.activation_input,...fixed}))fail();
   const current={permit:p,device,native,anchor:r,ownerIntent:oi,activationIntent:ai,control};
   // Observation time varies; all original anchor bytes and physical identity do not.
   const stable={...current,anchor:{...r,observed_at:null}};
   if(retained&&!same(retained,stable))fail();retained=stable;assertOpen();
   return runOwnerScope({schema:'metaengine.native-coding.run-owner-scope.v1',execution:scope,device,project_id:p.project_id,
    root_task_id:r.root_task_id,activation_id:r.activation_id,sealed_owner_sha256:r.sealed_owner_sha256,artifact:p.artifact,control,observed_at:iso(r.observed_at)});
  }
  const initial=await snapshot(),phase=request.runOwnerPhases;
  const abort=()=>phase.close();if(tx.signal?.aborted)fail();tx.signal?.addEventListener('abort',abort,{once:true});
  try{
   const result=await phase.run(initial,{readScope:snapshot,verifyOwner:async evidence=>{
    assertOpen();runOwnerEvidence(evidence,initial);if(!fresh(evidence.observed_at))fail();verified=evidence;
   }});assertOpen();if(!verified||!fresh(verified.observed_at))fail();
   return Object.freeze({owner:verified.sealed_record,observed_at:verified.observed_at,sealed_owner_sha256:verified.sealed_sha256,
    control:initial.control,qualification:result.qualification,result,authority_effect:false});
  }finally{tx.signal?.removeEventListener('abort',abort);}
 }
 async function operation(request,context){
  open(context);const device=await verifier.verify({operation:RUN_OWNER_READ,...request});open(context);
  return sql.begin('isolation level serializable',async tx=>{
   await tx.unsafe("set local statement_timeout='10s'");await tx.unsafe("set local lock_timeout='3s'");
   await tx.unsafe("set local idle_in_transaction_session_timeout='30s'");
   const original=context.runOwnerPhases;
   const bound={...context,runOwnerPhases:{close:()=>original.close(),run:(scope,handlers)=>{
    if(!same(scope.device,device))fail();return original.run(scope,handlers);
   }}};
   const value=await readOwnerControl({scope:request.body.input.scope,tx,request:bound});open(context);return value.result;
  });
 }
 return Object.freeze({operation,readOwnerControl,close(){closed=true;verifier.close();}});
}
