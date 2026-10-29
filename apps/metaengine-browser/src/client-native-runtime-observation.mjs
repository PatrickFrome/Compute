const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
// Private runtime memory -> credential-free UI counts. This is bookkeeping,
// never an OS process census, admission permission or accepted-result proof.
export function projectNativeRuntimeObservation(snapshot,{localProviderAttested=false,now=Date.now()}={}){
 const observed=integer(now)&&now<=8640000000000000?new Date(now).toISOString():null;
 const base={schema:'metaengine.client.native-runtime-observation.v1',observed_at:null,
  state:'UNAVAILABLE',closed:null,physical_slot_budget:null,retained_records:null,counts:null,
  logical_agent_limit:null,readback_only:true,physical_execution_proven:false,useful_work_verified:false,authority_effect:false};
 if(localProviderAttested!==true||observed===null)return Object.freeze(base);
 if(snapshot===null)return Object.freeze({...base,state:'UNBOUND',observed_at:observed});
 try{
  if(snapshot?.schema!=='metaengine.native-coding.runtime.v1'||snapshot.authority_effect!==false
   ||snapshot.scheduler_authority!==false||snapshot.automatic_retry_allowed!==false
   ||snapshot.production_qualified!==false||snapshot.useful_work_verified!==false
   ||snapshot.logical_agent_limit!==null||snapshot.logical_work_owned_by!=='W30'||typeof snapshot.closed!=='boolean'
   ||!integer(snapshot.physical_slot_budget,1)||!integer(snapshot.occupied_slots)
   ||snapshot.occupied_slots>snapshot.physical_slot_budget||!Array.isArray(snapshot.jobs)
   ||snapshot.jobs.length!==snapshot.occupied_slots)return Object.freeze(base);
  const counts={preparing:0,running:0,result_ready:0,readback_required:0,other:0},seen=new Set();
  const states={PREPARING:'preparing',RUNNING:'running',RESULT_READY:'result_ready',READBACK_REQUIRED:'readback_required'};
  for(const row of snapshot.jobs){
   if(!UUID.test(row?.task_id||'')||!integer(row?.lease_generation,1)||typeof row.state!=='string'||!/^[A-Z_]{1,64}$/.test(row.state))return Object.freeze(base);
   const key=row.task_id+':'+row.lease_generation;if(seen.has(key))return Object.freeze(base);seen.add(key);
   counts[Object.hasOwn(states,row.state)?states[row.state]:'other']++;
  }
  return Object.freeze({...base,state:'OBSERVED',observed_at:observed,closed:snapshot.closed,physical_slot_budget:snapshot.physical_slot_budget,
   retained_records:snapshot.occupied_slots,counts:Object.freeze(counts)});
 }catch{return Object.freeze(base);}
}
