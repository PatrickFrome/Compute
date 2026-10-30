import {createHash} from 'node:crypto';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';

export const NATIVE_CAPACITY_ACTIONS=Object.freeze(['READ_NATIVE_CAPACITY_V1','SERVICE_HEARTBEAT_V2','READ_SERVICE_HEARTBEAT_V2']);
export const NATIVE_CAPACITY_CENSUS_SCHEMA='metaengine.native-coding.capacity-census.v1';
export const NATIVE_CAPACITY_PROJECTION_SCHEMA='metaengine.native-coding.capacity-projection.v1';
export const NATIVE_CAPACITY_TTL_MS=10000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('native_capacity_contract_invalid');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const count=n=>Number.isSafeInteger(n)&&n>=0;
const positive=n=>count(n)&&n>0;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function nativeCapacityPrincipal({device_id,client_id,admin_grant_epoch,key_fingerprint_sha256}={}){
 if(!UUID.test(device_id||'')||!UUID.test(client_id||'')||!positive(admin_grant_epoch)||!HASH.test(key_fingerprint_sha256||''))fail();
 return createHash('sha256').update(['metaengine.native-coding.capacity-principal.v1',device_id,client_id,String(admin_grant_epoch),key_fingerprint_sha256].join('\n'),'utf8').digest('hex');
}
export function nativeCapacityOwnedTasks(value){
 if(!Array.isArray(value))fail();const seen=new Set();
 const result=value.map(row=>{
  if(!exact(row,['task_id','lease_generation'])||!UUID.test(row.task_id||'')||!positive(row.lease_generation))fail();
  const key=`${row.task_id}:${row.lease_generation}`;if(seen.has(key))fail();seen.add(key);
  return {task_id:row.task_id,lease_generation:row.lease_generation};
 }).sort((a,b)=>a.task_id.localeCompare(b.task_id)||a.lease_generation-b.lease_generation);
 return Object.freeze(result.map(Object.freeze));
}
export function validateNativeCapacityReadInput(value){
 if(!exact(value,['owned_tasks']))fail();return Object.freeze({owned_tasks:nativeCapacityOwnedTasks(value.owned_tasks)});
}
export function validateNativeCapacityCensus(value,{binding,ownedTasks,now=Date.now(),minimumGeneration=0}={}){
 if(!exact(value,['schema','host_instance_id','host_pid','principal_sha256','postgres_scope_sha256','generation','owned_tasks_sha256',
  'observed_at','expires_at','census_sha256','complete','state','counts','automatic_retry_allowed','authority_effect'])
  ||value.schema!==NATIVE_CAPACITY_CENSUS_SCHEMA||!UUID.test(value.host_instance_id||'')||!positive(value.host_pid)
  ||!['principal_sha256','postgres_scope_sha256','owned_tasks_sha256','census_sha256'].every(k=>HASH.test(value[k]||''))
  ||!positive(value.generation)||value.generation<=minimumGeneration||!iso(value.observed_at)||!iso(value.expires_at)
  ||Date.parse(value.expires_at)-Date.parse(value.observed_at)!==NATIVE_CAPACITY_TTL_MS
  ||!Number.isFinite(now)||now<Date.parse(value.observed_at)||now>=Date.parse(value.expires_at)
  ||typeof value.complete!=='boolean'||!['CURRENT','HOLD'].includes(value.state)
  ||value.automatic_retry_allowed!==false||value.authority_effect!==false
  ||!exact(value.counts,['task_slots','setup_slots','unrepresented_claims','represented_tasks','unresolved_slots'])
  ||!Object.values(value.counts).every(count)||value.counts.represented_tasks>value.counts.task_slots
  ||value.counts.unrepresented_claims>value.counts.task_slots
  ||value.state==='CURRENT'&&(!value.complete||value.counts.unresolved_slots>0))fail();
 if(binding&&(value.host_instance_id!==binding.instance_id||value.host_pid!==binding.host_pid))fail();
 if(ownedTasks!==undefined){const rows=nativeCapacityOwnedTasks(ownedTasks);if(value.owned_tasks_sha256!==sha(rows)||value.counts.represented_tasks>rows.length)fail();}
 return Object.freeze(structuredClone(value));
}
export function nativeCapacityProjection({census=null,configuredCeiling,resourceCeiling,localTaskCount,localRevision,state=null}={}){
 if(!positive(configuredCeiling)||!count(resourceCeiling)||!count(localTaskCount)||!count(localRevision))fail();
 if(census&&(!count(census.counts?.task_slots)||!count(census.counts?.represented_tasks)||census.counts.represented_tasks>localTaskCount))fail();
 const resolved=state??(census?.state==='CURRENT'&&census.complete===true?'CURRENT':census?'HOLD':'RECOVERY_REQUIRED');
 if(!['CURRENT','HOLD','RECOVERY_REQUIRED'].includes(resolved)||resolved==='CURRENT'&&!census)fail();
 const tasks=localTaskCount+(census?.counts.task_slots??0)-(census?.counts.represented_tasks??0),setup=census?.counts.setup_slots??0,unknown=census?.counts.unresolved_slots??0;
 if(![tasks,setup,unknown].every(count)||resolved==='CURRENT'&&unknown)fail();
 return Object.freeze({schema:NATIVE_CAPACITY_PROJECTION_SCHEMA,configured_ceiling:configuredCeiling,resource_ceiling:resourceCeiling,
  occupied_task_slots:tasks,occupied_setup_slots:setup,unresolved_slots:unknown,state:resolved,
  generation:census?.generation??0,census_sha256:census?.census_sha256??null,local_revision:localRevision,
  free_slots:resolved==='CURRENT'?Math.max(0,Math.min(configuredCeiling,resourceCeiling)-tasks-setup):0,authority_effect:false});
}
export function validateNativeCapacityProjection(value){
 if(!exact(value,['schema','configured_ceiling','resource_ceiling','occupied_task_slots','occupied_setup_slots','unresolved_slots','state',
  'generation','census_sha256','local_revision','free_slots','authority_effect'])||value.schema!==NATIVE_CAPACITY_PROJECTION_SCHEMA
  ||!positive(value.configured_ceiling)||!['resource_ceiling','occupied_task_slots','occupied_setup_slots','unresolved_slots','generation','local_revision','free_slots'].every(k=>count(value[k]))
  ||!['CURRENT','HOLD','RECOVERY_REQUIRED'].includes(value.state)||value.authority_effect!==false
  ||(value.generation===0?value.census_sha256!==null:!HASH.test(value.census_sha256||''))
  ||value.state==='CURRENT'&&(!value.generation||value.unresolved_slots>0)
  ||value.free_slots!==(value.state==='CURRENT'?Math.max(0,Math.min(value.configured_ceiling,value.resource_ceiling)-value.occupied_task_slots-value.occupied_setup_slots):0))fail();
 return Object.freeze(structuredClone(value));
}
