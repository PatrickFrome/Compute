import {createHash,createPublicKey} from 'node:crypto';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
import {validateNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {verifyNativeCodingProviderDescriptor} from '../../apps/metaengine-browser/src/native-coding-transport-proof.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const same=(a,b)=>json(a)===json(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('\0')===[...keys].sort().join('\0');
const fail=reason=>{throw Error('native_coding_service_heartbeat_'+reason);};

// The shared private request verifier must authenticate this exact packet before
// entering its invocation-local ALS. This service never trusts model identity,
// paths, a declared READY boolean, or a provider descriptor without own-PG+OS.
export const createNativeCodingHostServiceHeartbeat=options=>createService(options,1);
export const createNativeCodingHostServiceHeartbeatV2=options=>createService(options,2);
function createService({sql,readCurrentDevice,readNativeScope,readCapacityEvidence=null,hostInstanceId,hostPid}={},version){
 const v2=version===2,writeAction=v2?'SERVICE_HEARTBEAT_V2':'SERVICE_HEARTBEAT',readAction=v2?'READ_SERVICE_HEARTBEAT_V2':'READ_SERVICE_HEARTBEAT';
 const ackSchema=`metaengine.native-coding.service-heartbeat-ack.v${version}`;
 if(v2&&typeof readCapacityEvidence!=='function')fail('capacity_evidence_reader_required');
 if(typeof sql?.unsafe!=='function'||typeof sql?.begin!=='function'||typeof readCurrentDevice!=='function'||typeof readNativeScope!=='function'
  ||!UUID.test(hostInstanceId||'')||!Number.isSafeInteger(hostPid)||hostPid<1)fail('private_dependencies_required');
 let closed=false;
 const open=()=>{if(closed)fail('closed');};
 async function owner(db=sql){open();const rows=await db.unsafe('select current_user::text as current_user,session_user::text as session_user');
  if(rows.length!==1||rows[0].current_user!=='state_owner'||rows[0].session_user!=='state_owner')fail('state_owner_required');}
 async function authenticated(operation,request){
  open();const packet=validateNativeCodingDeviceRequest(request,operation),device=await readCurrentDevice();
  if(packet.body.host_instance_id!==hostInstanceId||packet.body.host_pid!==hostPid
   ||device?.device_id!==packet.headers['x-a2-device-id']||device.client_id!==packet.headers['x-a2-chat-bridge-client']
   ||!HASH.test(device.key_fingerprint_sha256||'')||!Number.isSafeInteger(device.admin_grant_epoch)||device.admin_grant_epoch<1)fail('authenticated_scope_changed');
  await owner();return {packet,device};
 }
 function ack(value,digest,readback){
  if(value===null&&readback)return null;
  if(value?.schema!==ackSchema||value.accepted!==true||value.body_sha256!==digest
   ||!HASH.test(value.witness_sha256||'')||!Number.isFinite(Date.parse(value.expires_at||''))
   ||typeof value.readback_only!=='boolean'||(readback&&value.readback_only!==true)||value.authority_effect!==false)fail('ack_unverified');
  return structuredClone(value);
 }
 async function publish(request){
  const checked=validateNativeCodingDeviceRequest(request,writeAction),requestDigest=hash(json(checked.body));
  let effectMayHaveBegun=false;
  try{
  const {packet,device}=await authenticated(writeAction,request),v=packet.body.input,run=v?.runtime,ctl=v?.control;
  if(!exact(v,[...(v2?['capacity']:[]),'schema','workspace_id','host_process','artifact','postgres','control','runtime','providers','production_qualified','automatic_retry_allowed','authority_effect'])
   ||v.schema!==`metaengine.native-coding.service-heartbeat.v${version}`||!UUID.test(v.workspace_id||'')
   ||['production_qualified','automatic_retry_allowed','authority_effect'].some(k=>v[k]!==false)
   ||!exact(ctl,['supervisor_mode','armed','interrupted_setup_recovery_fenced','runtime_control_generation'])
   ||ctl.supervisor_mode!=='CONTROL'||ctl.armed!==true||ctl.interrupted_setup_recovery_fenced!==false
   ||!Number.isSafeInteger(ctl.runtime_control_generation)||ctl.runtime_control_generation<0
   ||!exact(run,['schema','physical_slot_budget','occupied_slots','closed','shutdown_state','host_unavailable_reason','jobs'])
   ||run.schema!=='metaengine.native-coding.runtime.v1'||run.closed!==false||run.shutdown_state!=='OPEN'||run.host_unavailable_reason!==null
   ||!Number.isSafeInteger(run.physical_slot_budget)||run.physical_slot_budget<1
   ||!Number.isSafeInteger(run.occupied_slots)||run.occupied_slots<0||run.occupied_slots>run.physical_slot_budget
   ||!Array.isArray(run.jobs)||run.jobs.length!==run.occupied_slots||!Array.isArray(v.providers)||!v.providers.length)fail('snapshot_invalid');
  const seen=new Set(),started=Date.now();
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,v.providers.length)},async()=>{while(cursor<v.providers.length){const selector=v.providers[cursor++];
   if(!exact(selector,['permit_id','provider_id','agent_id','role','agent_generation_epoch','envelope_sha256'])
    ||!UUID.test(selector.permit_id||'')||seen.has(selector.permit_id))fail('provider_selector_invalid');seen.add(selector.permit_id);
   const rows=await sql.unsafe(`select public.native_coding_admission_context_v1(p.workspace_id,p.client_id,p.permit_id) as context,
     r.envelope,r.canonical_envelope,r.envelope_sha256 from destruktion_meta.native_coding_operator_permit_h205f22 p
     join destruktion_meta.native_coding_provider_registration_h205f22 r using(permit_id)
     where p.permit_id=$1::uuid and p.workspace_id=$2::uuid and p.device_id=$3::uuid and p.client_id=$4::text and p.admin_grant_epoch=$5::bigint`,
    [selector.permit_id,v.workspace_id,device.device_id,device.client_id,device.admin_grant_epoch]);
   const row=rows[0],p=row?.context?.permit,d=row?.context?.device;
   if(rows.length!==1||p?.device_id!==device.device_id||d?.key_fingerprint_sha256!==device.key_fingerprint_sha256
    ||Number(d.admin_grant_epoch)!==device.admin_grant_epoch||p.provider_id!==selector.provider_id||p.agent_id!==selector.agent_id
    ||p.role!==selector.role||p.agent_generation_epoch!==selector.agent_generation_epoch||run.physical_slot_budget>p.physical_slot_budget
    ||row.envelope_sha256!==selector.envelope_sha256||row.canonical_envelope!==json(row.envelope)
    ||hash(row.canonical_envelope)!==selector.envelope_sha256)fail('registered_provider_changed');
   // Paths and canary pins originate solely in the protected permit/operator
   // registry. The request contains no path or executable selection capability.
   const actual=await readNativeScope(p,true);
   if(!actual||!same(actual.artifact,p.artifact)||!same(actual.artifact,v.artifact)||!same(actual.postgres,p.postgres)
    ||!same(actual.postgres,v.postgres)||!same(actual.host_process,v.host_process)||actual.user_sid!==p.user_sid
    ||!same(actual.worktree,p.worktree))fail('physical_scope_changed');
   const expected={schema:'metaengine.codex-cli.transport-proof.v1',issuer:'NATIVE_HOST',audience:'METAENGINE_NATIVE_SUPERVISOR',provider:'CODEX_CLI',
    host_process:actual.host_process,sandbox:actual.sandbox,target_id:'codex-cli:'+p.provider_id,expires_at:p.expires_at,
    automatic_retry_allowed:false,production_qualified:false,authority_effect:false};
   for(const field of ['trust_namespace','permit_id','goal_id','goal_sha256','owner_epoch','user_sid','device_id','device_key_fingerprint_sha256',
    'workspace_id','project_id','provider_id','agent_id','role','agent_generation_epoch','physical_slot_budget','artifact','postgres','worktree'])expected[field]=p[field];
   verifyNativeCodingProviderDescriptor(row.envelope,{publicKey:createPublicKey({key:d.public_jwk,format:'jwk'}),expected,now:Date.now()});
  }}));
  if(Date.now()-started>25000)fail('observation_window_exceeded');
  const current=await readCurrentDevice();if(!same(current,device))fail('authenticated_scope_changed');
  const text=json(packet.body),digest=hash(text);
  // Lookup is Host-private and exact; no request can supply evidence/resolved.
  const capacityEvidence=v2?await readCapacityEvidence({actor:device,census:v.capacity?.census,host_process:v.host_process,postgres:v.postgres}):null;
  open();
  let value;
  effectMayHaveBegun=true;
  try{value=await sql.begin('isolation level serializable',async tx=>{
   await tx.unsafe('set local synchronous_commit=on');await owner(tx);
   const query=v2?'select destruktion_meta.native_coding_service_heartbeat_v2($1::uuid,$2::text,$3::bigint,$4::uuid,$5::integer,$6::text::jsonb,$6::text,$7::text::jsonb,$8::text::jsonb)as value'
    :'select destruktion_meta.native_coding_service_heartbeat_v1($1::uuid,$2::text,$3::bigint,$4::uuid,$5::integer,$6::text::jsonb,$6::text,$7::text::jsonb)as value';
   const rows=await tx.unsafe(query,[device.device_id,device.client_id,device.admin_grant_epoch,hostInstanceId,hostPid,text,json(packet.headers),...(v2?[json(capacityEvidence)]:[])]);
   if(rows.length!==1)fail('ack_missing');return rows[0].value;
  });}catch(error){
   // A PostgreSQL error returned by the transaction proves its abort. A lost
   // socket/COMMIT acknowledgement does not: propagate that as UNKNOWN so the
   // caller performs only exact readonly reconciliation, never a second write.
   if(error?.name==='PostgresError'&&['55000','23514','23505','42501','40001','22023','25000'].includes(error.code))return {
    schema:ackSchema,accepted:false,body_sha256:digest,
    reason:'NATIVE_SERVICE_ADMISSION_FENCED',write_effect:'ABSENT',automatic_retry_allowed:false,authority_effect:false};
   throw error;
  }
  return ack(value,digest,false);
  }catch(error){
   // Every operation above this boundary is a private read or a physical
   // observation. No heartbeat SQL write was dispatched. A normal provider
   // rotation/OS denial must HOLD admission, not create an unreconcilable
   // UNKNOWN write. Errors after begin/COMMIT retain uncertainty.
   if(!effectMayHaveBegun)return {schema:ackSchema,accepted:false,
    body_sha256:requestDigest,reason:'NATIVE_SERVICE_OBSERVATION_FENCED',write_effect:'ABSENT',
    automatic_retry_allowed:false,authority_effect:false};
   throw error;
  }
 }
 async function read(request){
  const {packet,device}=await authenticated(readAction,request),input=packet.body.input;
  if(!exact(input,['workspace_id','body_sha256'])||!UUID.test(input.workspace_id||'')||!HASH.test(input.body_sha256||''))fail('read_selector_invalid');
  const rows=await sql.unsafe(`select destruktion_meta.native_coding_service_heartbeat_read_v${version}($1::uuid,$2::text,$3::bigint,$4::uuid,$5::text)as value`,
   [device.device_id,device.client_id,device.admin_grant_epoch,input.workspace_id,input.body_sha256]);
  if(rows.length!==1)fail('readback_missing');return ack(rows[0].value,input.body_sha256,true);
 }
 return Object.freeze({[writeAction]:publish,[readAction]:read,close(){closed=true;}});
}
