import {nativeCodingCanonicalSha256 as bindingSha} from './native-coding-task-context.mjs';
import {defaultNativePhysicalSlotBudget,readAgentResourceAdmission} from './agent-resource-admission.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function keyOf(lease) {
  if(!UUID.test(lease?.task_id || '') || !Number.isSafeInteger(lease.lease_generation) || lease.lease_generation<1)
    throw new Error('native_coding_pool_lease_invalid');
  return `${lease.task_id}:${lease.lease_generation}`;
}

// Driven ONLY by the existing W30 heartbeat. A model turn must not hold that
// heartbeat until completion: freshness and lease observation continue while
// the bounded physical jobs run. No queue, timer, retry or alternate scheduler.
export function createNativeCodingExecutionPool({executor,prepareRequest,readPriorExecution,
  physicalSlotBudget=defaultNativePhysicalSlotBudget(),readResourceAdmission=readAgentResourceAdmission,capacityOwner=null,readExecutionBinding=null}={}) {
  if(typeof executor?.execute!=='function' || typeof prepareRequest!=='function'
      || typeof readPriorExecution!=='function' || !Number.isSafeInteger(physicalSlotBudget)
      || physicalSlotBudget<1 || typeof readResourceAdmission!=='function') throw new Error('native_coding_pool_dependencies_invalid');
  const jobs=capacityOwner?capacityOwner.openPool():new Map(); let closed=false;
  const observation=row=>Object.freeze({state:row.state,task_id:row.lease.task_id,
    lease_generation:row.lease.lease_generation,result:row.result,
    reason:row.reason,automatic_retry_allowed:false,authority_effect:false});
  const leaseBinding=lease=>bindingSha(Object.fromEntries(['task_id','lease_generation','agent_id','agent_generation_epoch','tab_id','target_id','role','base_sha'].map(k=>[k,lease[k]??null])));
  const startAllowed=(row,key)=>{
    try{
      if(!capacityOwner||closed||row.controller.signal.aborted||typeof readExecutionBinding!=='function'
        ||row.binding===null||row.binding!==bindingSha(readExecutionBinding(row.lease)))return false;
      const resources=readResourceAdmission(),n=resources?.physical_start_allowed===true?resources.physical_parallelism:0;
      return Number.isSafeInteger(n)&&n>0&&capacityOwner.canStartRetained(jobs.token,key,{configuredCeiling:physicalSlotBudget,resourceCeiling:n});
    }catch{return false;}
  };
  function start(row,key){
    row.preparing=true;row.state='PREPARING';row.reason=null;
    row.done=Promise.resolve().then(async()=>{
      const request=await prepareRequest(structuredClone(row.lease));
      if(keyOf(request?.lease)!==key || request.lease.agent_id!==row.lease.agent_id
          || request.lease.agent_generation_epoch!==row.lease.agent_generation_epoch)
        throw new Error('native_coding_pool_request_binding_changed');
      if(capacityOwner&&!startAllowed(row,key)){row.state='PHYSICAL_POOL_BUSY';row.reason='WAITING_CAPACITY';return;}
      // This is the one first-dispatch boundary, before any executor/ledger
      // entry. Errors beyond it are never automatically retried, even if the
      // later SQL or physical attempt cannot be proven to have started.
      row.neverAttempted=false;row.state='RUNNING';jobs.changed?.();
      const result=await executor.execute(request,{signal:row.controller.signal});
      row.result=structuredClone(result);row.state=result.state;jobs.changed?.();
    }).catch(error=>{
      row.neverAttempted=false;row.state='READBACK_REQUIRED';
      row.reason=error?.message==='native_coding_pool_request_binding_changed'?'NATIVE_REQUEST_BINDING_CHANGED':'EXECUTION_OUTCOME_REQUIRES_READBACK';
      row.result=null;jobs.changed?.();
    }).finally(()=>{row.preparing=false;});
  }
  return Object.freeze({
    capacityPoolToken:jobs.token??null,
    dispatch(lease) {
      const key=keyOf(lease);
      if(closed) throw new Error('native_coding_pool_closed');
      if(jobs.has(key)) return observation(jobs.get(key));
      if(capacityOwner){
        if(jobs.retained(key))return Object.freeze({state:'PHYSICAL_POOL_BUSY',reason:'RETAINED_CUSTODY_CONFLICT',automatic_retry_allowed:false,authority_effect:false});
        let binding=null;try{binding=bindingSha(readExecutionBinding(lease));}catch{/* Retain issued lease, but do not manufacture current authority. */}
        const row={lease:structuredClone(lease),state:'PHYSICAL_POOL_BUSY',result:null,reason:'WAITING_CAPACITY',
          controller:new AbortController(),done:null,neverAttempted:true,preparing:false,binding,leaseBinding:leaseBinding(lease)};
        jobs.set(key,row);return observation(row);
      }
      // Pending receipts retain their slot until the SAME heartbeat has a
      // confirmed W30 completion. Losing a write ACK cannot drop the result.
      const resources=readResourceAdmission();
      // Re-read capacity at each start, not only at pool construction. A lower
      // budget never cancels retained work or discards an unacknowledged result.
      // Boolean-only adapters retain their explicit configured slot budget.
      const dynamicBudget=resources&&Object.hasOwn(resources,'physical_parallelism')
        ?resources.physical_parallelism:physicalSlotBudget;
      if(resources?.physical_start_allowed!==true||!Number.isSafeInteger(dynamicBudget)||dynamicBudget<1
        ||jobs.size>=Math.min(physicalSlotBudget,dynamicBudget)) return Object.freeze({state:'PHYSICAL_POOL_BUSY',
        automatic_retry_allowed:false,authority_effect:false});
      const row={lease:structuredClone(lease),state:'PREPARING',result:null,reason:null,
        controller:new AbortController(),done:null};
      jobs.set(key,row);
      start(row,key);
      return observation(row);
    },
    advanceUnattemptedLease(lease){
      const key=keyOf(lease),row=jobs.get(key);
      if(!row)return Object.freeze({state:'NOT_OWNED',automatic_retry_allowed:false,authority_effect:false});
      if(!capacityOwner||closed||!row.neverAttempted||row.preparing||row.leaseBinding!==leaseBinding(lease)||!startAllowed(row,key))return observation(row);
      start(row,key);return observation(row);
    },
    async observe(lease) {
      const key=keyOf(lease),row=jobs.get(key);
      if(row) return observation(row);
      // After restart only the existing durable ledger/receipt can be read.
      // This callback has no executor/dispatch fallback, even for RESERVED.
      const result=await readPriorExecution(structuredClone(lease));
      return Object.freeze({state:'READBACK_ONLY',task_id:lease.task_id,
        lease_generation:lease.lease_generation,result:structuredClone(result),
        physical_effect_replayed:false,automatic_retry_allowed:false,authority_effect:false});
    },
    acknowledge(lease,{state,lease_generation,result_sha256}={}) {
      const key=keyOf(lease),row=jobs.get(key);
      if(!row || row.state!=='RESULT_READY' || !['RESULT_READY','COMPLETED'].includes(state)
          || lease_generation!==row.lease.lease_generation
          || result_sha256!==row.result?.result?.result_sha256)
        throw new Error('native_coding_pool_completion_ack_unproven');
      jobs.delete(key);
    },
    snapshot() {
      return Object.freeze({schema:'metaengine.native-coding.execution-pool.v1',
        physical_slot_budget:physicalSlotBudget,occupied_slots:[...jobs.values()].length,
        logical_agent_limit:null,logical_work_owned_by:'W30',closed,
        jobs:Object.freeze([...jobs.values()].map(row=>Object.freeze({task_id:row.lease.task_id,
          lease_generation:row.lease.lease_generation,state:row.state}))),
        scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});
    },
    async stop() {
      closed=true;
      for(const row of jobs.values()) row.controller.abort();
      await Promise.allSettled([...jobs.values()].map(row=>row.done));
      return this.snapshot();
    },
  });
}
