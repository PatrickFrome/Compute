import {performance} from 'node:perf_hooks';
import {nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {nativeCapacityOwnedTasks,nativeCapacityProjection,validateNativeCapacityCensus,NATIVE_CAPACITY_TTL_MS} from './native-coding-capacity-contract.mjs';

const fail=reason=>{throw Error('native_capacity_owner_'+reason);};
const hash=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// This is the EXISTING execution-pool custody map, lifted to Main lifetime.
// No queue, lease allocation, timer, worker, SQL write or dispatch capability.
export function createNativeCodingCapacityOwner({now=Date.now,monotonic=()=>performance.now()}={}){
 if(typeof now!=='function'||typeof monotonic!=='function')fail('clock_required');
 const jobs=new Map();let revision=0,binding=null,census=null,flight=null,closed=false,reason='RECOVERY_REQUIRED',floor=0;
 const invalidate=(why='RECOVERY_REQUIRED')=>{revision++;census=null;reason=why;};
 const current=()=>{
  if(!binding||closed)return false;
  try{const v=binding.readBinding();return v?.closed===false&&v.instance_id===binding.instance_id&&v.host_pid===binding.host_pid
   &&binding.readPrincipal()===binding.principal_sha256;}catch{return false;}
 };
 const fresh=()=>{
  if(!census)return false;
  const wall=now(),mono=monotonic();
  if(!current()||census.revision!==revision||wall<census.wall||mono<census.mono
   ||wall-census.wall>=NATIVE_CAPACITY_TTL_MS||mono-census.mono>=NATIVE_CAPACITY_TTL_MS
   ||wall>=Date.parse(census.value.expires_at)){invalidate('CAPACITY_OBSERVATION_EXPIRED_OR_CHANGED');return false;}
  return true;
 };
 const selectors=()=>nativeCapacityOwnedTasks([...jobs.values()].filter(x=>x.token===binding?.poolToken)
  .map(x=>({task_id:x.row.lease.task_id,lease_generation:x.row.lease.lease_generation})));
 const projection=({configuredCeiling,resourceCeiling})=>nativeCapacityProjection({configuredCeiling,resourceCeiling,
  localTaskCount:jobs.size,localRevision:revision,census:fresh()?census.value:null,
  state:closed?'HOLD':census?.value.state??(reason==='RECOVERY_REQUIRED'?'RECOVERY_REQUIRED':'HOLD')});
 return Object.freeze({
  // Private pool view. A replacement pool cannot adopt/delete an older pool's
  // retained rows, even if it presents the same task/lease. Global size fences
  // starts; per-pool values preserve the unchanged v1 runtime job projection.
  openPool(){
   if(closed)fail('closed');const token={};
   return Object.freeze({token,get size(){return jobs.size;},
    get:key=>jobs.get(key)?.token===token?jobs.get(key).row:undefined,
    has:key=>jobs.get(key)?.token===token,
    retained:key=>jobs.has(key),
    values:()=>[...jobs.values()].filter(x=>x.token===token).map(x=>x.row).values(),
    set(key,row){if(closed||jobs.has(key)&&jobs.get(key).token!==token)fail('retained_custody_conflict');
     jobs.set(key,{token,row});invalidate('LOCAL_CUSTODY_CHANGED');},
    delete(key){if(jobs.get(key)?.token!==token)fail('foreign_custody');jobs.delete(key);invalidate('LOCAL_CUSTODY_CHANGED');},
    changed(){invalidate('LOCAL_CUSTODY_CHANGED');},
   });
  },
  bind({capability,instance_id,host_pid,principal_sha256,readBinding,readPrincipal,poolToken}={}){
   if(closed||!capability||typeof readBinding!=='function'||typeof readPrincipal!=='function'||!poolToken
    ||!uuid.test(instance_id||'')||!hash.test(principal_sha256||'')||!Number.isSafeInteger(host_pid)||host_pid<1)fail('binding_invalid');
   if(binding?.capability===capability&&binding.poolToken===poolToken&&binding.principal_sha256===principal_sha256)return;
   binding={capability,instance_id,host_pid,principal_sha256,readBinding,readPrincipal,poolToken};floor=0;invalidate();
  },
  collect(readCensus){
   if(flight)return flight;
   if(closed||!current()||typeof readCensus!=='function'){invalidate('CAPACITY_BINDING_UNAVAILABLE');return Promise.resolve(null);}
   const original=binding,localRevision=revision,owned=selectors(),wall=now(),mono=monotonic();
   // Collection never releases any row and a second collection cannot overlap.
   // Failed/late responses cannot validate the retained rows of a new binding.
   let pending;
   pending=Promise.resolve().then(()=>readCensus(owned)).then(value=>{
    if(closed||binding!==original||revision!==localRevision||!current()||sha(selectors())!==sha(owned)
     ||now()<wall||monotonic()<mono||now()-wall>=NATIVE_CAPACITY_TTL_MS||monotonic()-mono>=NATIVE_CAPACITY_TTL_MS)fail('collection_changed');
    const checked=validateNativeCapacityCensus(value,{binding:original,ownedTasks:owned,now:now(),minimumGeneration:floor});
    if(checked.principal_sha256!==original.principal_sha256)fail('principal_changed');
    if(original.postgresScope&&checked.postgres_scope_sha256!==original.postgresScope)fail('postgres_changed');
    original.postgresScope=checked.postgres_scope_sha256;floor=checked.generation;census={value:checked,revision,wall,mono};
    reason=checked.counts.unresolved_slots?'HISTORICAL_SETTLEMENT_OR_CUSTODY_UNVERIFIED':checked.state==='CURRENT'?null:'INCOMPLETE_CENSUS';
    return checked;
   }).catch(()=>{if(binding===original)invalidate('CAPACITY_COLLECTION_UNCONFIRMED');return null;})
    .finally(()=>{if(flight===pending)flight=null;});flight=pending;return pending;
  },
  projection,
  canStartRetained(poolToken,key,limits){
   if(closed||jobs.get(key)?.token!==poolToken||binding?.poolToken!==poolToken||!fresh())return false;
   const value=projection(limits),owned=selectors();
   return value.state==='CURRENT'&&census.value.counts.represented_tasks===owned.length
    &&Math.min(value.configured_ceiling,value.resource_ceiling)>0
    &&value.occupied_task_slots+value.occupied_setup_slots<=Math.min(value.configured_ceiling,value.resource_ceiling);
  },
  readObservation(limits){if(!fresh())return null;return Object.freeze({census:structuredClone(census.value),projection:projection(limits)});},
  snapshot(limits){const value=projection(limits);return Object.freeze({projection:value,reason,collection_running:flight!==null,
   retained_task_slots:jobs.size,closed,authority_effect:false});},
  invalidate,
  close(){if(!closed){closed=true;invalidate('MAIN_CUSTODY_CLOSED');}},
  async drain(){if(flight)await flight;},
 });
}
