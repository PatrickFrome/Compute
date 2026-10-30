import {validateNativeCapacityCensus,validateNativeCapacityProjection} from './native-coding-capacity-contract.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {signNativeCodingDeviceRequest} from './native-coding-device-request.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const same=(a,b)=>json(a)===json(b);
const fail=reason=>{throw Error('native_coding_service_publisher_'+reason);};

// This observes the existing W30 heartbeat. It owns neither a timer nor a
// scheduler. A signed observation is not admission until the private own-PG
// Host acknowledges it; uncertainty permits only exact readonly readback.
export const createNativeCodingServiceHeartbeatPublisher=options=>createPublisher(options,1);
export const createNativeCodingServiceHeartbeatPublisherV2=options=>createPublisher(options,2);
function createPublisher({identity,ownPostgres,readControl,readRuntime,readProviders,readCapacity=null,now=Date.now}={},version){
 const v2=version===2,writeMethod=v2?'serviceHeartbeatV2':'serviceHeartbeat',readMethod=v2?'readServiceHeartbeatV2':'readServiceHeartbeat';
 const writeAction=v2?'SERVICE_HEARTBEAT_V2':'SERVICE_HEARTBEAT',readAction=v2?'READ_SERVICE_HEARTBEAT_V2':'READ_SERVICE_HEARTBEAT';
 const ackSchema=`metaengine.native-coding.service-heartbeat-ack.v${version}`;
 if(v2&&typeof readCapacity!=='function')fail('capacity_reader_required');
 if(typeof readControl!=='function'||typeof readRuntime!=='function'||typeof readProviders!=='function'||typeof now!=='function'
  ||typeof identity?.snapshot!=='function'||typeof identity.deviceHeaders!=='function'
  ||!['snapshot',writeMethod,readMethod].every(k=>typeof ownPostgres?.[k]==='function'))fail('private_dependencies_required');
 let closed=false,inflight=null,pending=null,accepted=null,reason='WITNESS_NOT_PUBLISHED';
 let providerCursor=0,nextProviderCursor=0,providerWindowTruncated=false;
 function input(){
  const control=readControl(),runtime=readRuntime(),descriptors=readProviders();
  if(!control||control.supervisor_mode!=='CONTROL'||control.armed!==true||control.interrupted_setup_recovery_fenced!==false
   ||!Number.isSafeInteger(control.runtime_control_generation)||control.runtime_control_generation<0)fail('control_fenced');
  if(runtime?.closed!==false||runtime.shutdown_state!=='OPEN'||runtime.host_unavailable_reason!==null
   ||!Number.isSafeInteger(runtime.physical_slot_budget)||runtime.physical_slot_budget<1
   ||!Number.isSafeInteger(runtime.occupied_slots)||runtime.occupied_slots<0||runtime.occupied_slots>runtime.physical_slot_budget
   ||!Array.isArray(runtime.jobs)||runtime.jobs.length!==runtime.occupied_slots)fail('runtime_fenced');
  if(!Array.isArray(descriptors)||!descriptors.length)fail('providers_unavailable');
  const first=descriptors[0]?.payload,seen=new Set(),providers=[];
  if(!UUID.test(first?.workspace_id||'')||!first.host_process||!first.artifact||!first.postgres)fail('provider_scope_invalid');
  for(const envelope of descriptors){
   const p=envelope?.payload;
   if(!UUID.test(p?.permit_id||'')||!UUID.test(p.provider_id||'')||seen.has(p.permit_id)
    ||p.workspace_id!==first.workspace_id||!same(p.host_process,first.host_process)||!same(p.artifact,first.artifact)||!same(p.postgres,first.postgres)
    ||!/^agent_[a-z0-9-]{8,64}$/.test(p.agent_id||'')||!['IMPLEMENTER','CRITIC'].includes(p.role)
    ||!Number.isSafeInteger(p.agent_generation_epoch)||p.agent_generation_epoch<1||!Number.isFinite(Date.parse(p.expires_at||''))
    ||Date.parse(p.expires_at)<=now())fail('provider_scope_changed');
   seen.add(p.permit_id);providers.push({permit_id:p.permit_id,provider_id:p.provider_id,agent_id:p.agent_id,role:p.role,
    agent_generation_epoch:p.agent_generation_epoch,envelope_sha256:sha(envelope)});
  }
  providers.sort((a,b)=>a.permit_id.localeCompare(b.permit_id));
  const jobs=runtime.jobs.map(j=>({task_id:j.task_id,lease_generation:j.lease_generation,state:j.state}))
   .sort((a,b)=>a.task_id.localeCompare(b.task_id)||a.lease_generation-b.lease_generation);
  if(jobs.some(j=>!UUID.test(j.task_id||'')||!Number.isSafeInteger(j.lease_generation)||j.lease_generation<1
   ||!['PREPARING','RUNNING','RESULT_READY','READBACK_REQUIRED','READBACK_ONLY','AMBIGUOUS','PHYSICAL_POOL_BUSY'].includes(j.state)))fail('held_job_invalid');
  const value={schema:`metaengine.native-coding.service-heartbeat.v${version}`,workspace_id:first.workspace_id,
   host_process:structuredClone(first.host_process),artifact:structuredClone(first.artifact),postgres:structuredClone(first.postgres),
   control:{supervisor_mode:control.supervisor_mode,armed:control.armed,interrupted_setup_recovery_fenced:control.interrupted_setup_recovery_fenced,
    runtime_control_generation:control.runtime_control_generation},
   runtime:{schema:'metaengine.native-coding.runtime.v1',physical_slot_budget:runtime.physical_slot_budget,occupied_slots:runtime.occupied_slots,
    closed:runtime.closed,shutdown_state:runtime.shutdown_state,host_unavailable_reason:runtime.host_unavailable_reason,jobs},
   providers:[],production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  if(v2){
   const capacity=readCapacity();
   if(!capacity||Object.keys(capacity).sort().join()!=='census,projection')fail('capacity_unavailable');
   const census=validateNativeCapacityCensus(capacity.census,{binding:ownPostgres.snapshot(),ownedTasks:jobs.map(({task_id,lease_generation})=>({task_id,lease_generation})),now:now()});
   const projection=validateNativeCapacityProjection(capacity.projection);
   if(projection.configured_ceiling!==runtime.physical_slot_budget||projection.generation!==census.generation||projection.census_sha256!==census.census_sha256
    ||projection.state!==census.state)fail('capacity_changed');
   value.capacity={census,projection};
  }
  // The signed request has a byte budget, not a fleet-size quota. Rotate
  // admission windows so a large durable roster cannot fence the whole fleet.
  let bytes=Buffer.byteLength(json(value)),visited=0;
  while(visited<providers.length){
   const index=(providerCursor+visited)%providers.length,row=providers[index],size=Buffer.byteLength(json(row))+1;
   if(bytes+size>48*1024)break;
   value.providers.push(row);bytes+=size;visited++;
  }
  if(!value.providers.length)fail('witness_byte_budget');
  nextProviderCursor=(providerCursor+visited)%providers.length;
  providerWindowTruncated=visited<providers.length;
  return value;
 }
 const deviceTuple=()=>{const d=identity.snapshot();return d?{enrolled:d.enrolled,device_id:d.device_id,client_id:d.client_id,key_fingerprint_sha256:d.key_fingerprint_sha256}:null;};
 const recordCurrent=record=>{const b=ownPostgres.snapshot();return b?.closed===false&&b.instance_id===record.binding.instance_id
  &&b.host_pid===record.binding.host_pid&&same(deviceTuple(),record.device);};
 function exactAck(value,record,readback){
  if(v2&&!recordCurrent(record))fail('ack_scope_changed');
  if(value?.schema!==ackSchema||value.accepted!==true||value.body_sha256!==record.body_sha256
   ||!HASH.test(value.witness_sha256||'')||!Number.isFinite(Date.parse(value.expires_at||''))||value.authority_effect!==false
   ||typeof value.readback_only!=='boolean'||(readback&&value.readback_only!==true))fail('ack_changed');
  if(v2&&Date.parse(value.expires_at)>Date.parse(record.input.capacity.census.expires_at))fail('ack_expiry_changed');
  return {...(v2?{binding:record.binding,device:record.device}:{}),input:record.input,input_sha256:sha(record.input),body_sha256:record.body_sha256,witness_sha256:value.witness_sha256,
   expires_at:value.expires_at};
 }
 async function reconcile(){
  const record=pending;
  if(!record||closed)return;
  try{
   const packet=await signNativeCodingDeviceRequest({identity,binding:ownPostgres.snapshot(),operation:readAction,
    input:{workspace_id:record.input.workspace_id,body_sha256:record.body_sha256}});
   if(closed)return;
   const value=await ownPostgres[readMethod](packet);
   if(closed)return;
   if(value===null){reason='WITNESS_OUTCOME_UNKNOWN';return;}
   accepted=exactAck(value,record,true);pending=null;reason=Date.parse(accepted.expires_at)>now()?'ACKNOWLEDGED':'WITNESS_EXPIRED';
  }catch{reason='WITNESS_OUTCOME_UNKNOWN';}
 }
 async function publish(value){
  let packet;
  try{packet=await signNativeCodingDeviceRequest({identity,binding:ownPostgres.snapshot(),operation:writeAction,input:value});}
  catch{accepted=null;reason='SIGNED_DEVICE_OBSERVATION_UNAVAILABLE';return;}
  if(closed)return;
  const record={input:structuredClone(value),body_sha256:packet.headers['x-a2-device-body-sha256'],...(v2?{binding:{instance_id:packet.body.host_instance_id,host_pid:packet.body.host_pid},device:deviceTuple()}: {})};
  pending=record;reason='PUBLICATION_PENDING';
  try{
   const response=await ownPostgres[writeMethod](packet);
   if(closed)return;
   if(response?.schema===ackSchema&&response.accepted===false
    &&response.body_sha256===record.body_sha256&&response.write_effect==='ABSENT'&&response.automatic_retry_allowed===false
    &&response.authority_effect===false){pending=null;accepted=null;reason='ADMISSION_FENCED';return;}
   accepted=exactAck(response,record,false);pending=null;reason='ACKNOWLEDGED';
  }catch{accepted=null;reason='WITNESS_OUTCOME_UNKNOWN';}
 }
 return Object.freeze({
  observe(){
   if(closed||inflight)return;
   let operation;
   if(pending)operation=reconcile;
   else{
    let value;try{value=input();}catch(error){accepted=null;reason=error.message;return;}
    if(accepted&&accepted.input_sha256===sha(value)&&Date.parse(accepted.expires_at)>now()+8000){
     if(!providerWindowTruncated||!accepted.delivered)return;
     providerCursor=nextProviderCursor;value=input();
    }
    operation=()=>publish(value);
   }
   inflight=Promise.resolve().then(operation).finally(()=>{inflight=null;});
  },
  admittedProviders(){
   if(closed||pending||!accepted||Date.parse(accepted.expires_at)<=now())return [];
   try{
    if(v2&&!recordCurrent(accepted)||accepted.input_sha256!==sha(input()))return [];
    const admitted=new Set(accepted.input.providers.map(p=>p.permit_id));
    accepted.delivered=true;
    return structuredClone(readProviders().filter(p=>admitted.has(p.payload.permit_id)));
   }catch{return [];}
  },
  snapshot(){return {schema:'metaengine.native-coding.service-publisher.v1',state:closed?'CLOSED':reason,
   publication_running:inflight!==null,unknown_write_retained:pending!==null,body_sha256:pending?.body_sha256??accepted?.body_sha256??null,
   witness_sha256:accepted?.witness_sha256??null,expires_at:accepted?.expires_at??null,
   production_qualified:false,automatic_retry_allowed:false,authority_effect:false};},
  close(){closed=true;reason='CLOSED';},async drain(){if(inflight)await inflight;},
 });
}
