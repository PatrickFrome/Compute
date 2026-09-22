const STATES=new Set(['FRESH','NO_SNAPSHOT','STALE_FAIL_CLOSED','INVALID_FLEET_FAIL_CLOSED']);
const PRESSURE_STATES=new Set(['NORMAL','READY_SATURATED','RECOVERY_DEBT_HIGH','CAPACITY_UNAVAILABLE']);

function object(value,name){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`meta_pressure_${name}_invalid`);return value}
function integer(value,name,max=1_000_000){const out=Number(value);if(!Number.isSafeInteger(out)||out<0||out>max)throw new Error(`meta_pressure_${name}_invalid`);return out}

export function projectMetaSchedulerPressure(raw,{expectedAvailableSlots=null}={}){
  const row=object(raw,'snapshot');
  if(row.schema!=='metaengine.devos.scheduler-capacity.v1')throw new Error('meta_pressure_schema_invalid');
  if(String(row.source||'').toUpperCase()!=='DEVOS_SCHEDULER_SNAPSHOT')throw new Error('meta_pressure_source_invalid');
  if(row.authority_effect!==false||row.automatic_retry_allowed!==false)throw new Error('meta_pressure_authority_invalid');

  const state=String(row.state||'').toUpperCase();
  const pressureState=String(row.pressure_state||'').toUpperCase();
  if(!STATES.has(state))throw new Error('meta_pressure_state_invalid');
  if(!PRESSURE_STATES.has(pressureState))throw new Error('meta_pressure_pressure_state_invalid');

  const availableSlots=integer(row.available_slots,'available_slots',4096);
  const newFrontierSlots=integer(row.new_frontier_slots,'new_frontier_slots',4096);
  const liveTransportSlots=integer(row.live_transport_slots,'live_transport_slots',64);
  const readyBacklog=integer(row.ready_backlog,'ready_backlog');
  const leasedBacklog=integer(row.leased_backlog,'leased_backlog');
  const runningBacklog=integer(row.running_backlog,'running_backlog');
  const resultReadyBacklog=integer(row.result_ready_backlog,'result_ready_backlog');
  const ambiguousBacklog=integer(row.ambiguous_backlog,'ambiguous_backlog');
  const blockedBacklog=integer(row.blocked_backlog,'blocked_backlog');
  const activeClaims=integer(row.active_claims,'active_claims');
  const readyLimit=integer(row.ready_backlog_limit,'ready_backlog_limit',4096);
  const ambiguityLimit=integer(row.ambiguity_pressure_limit,'ambiguity_pressure_limit',4096);

  if(newFrontierSlots>availableSlots)throw new Error('meta_pressure_frontier_exceeds_physical_capacity');
  if(expectedAvailableSlots!=null&&integer(expectedAvailableSlots,'expected_available_slots',4096)!==availableSlots)throw new Error('meta_pressure_capacity_projection_drift');

  if(state!=='FRESH'){
    if(availableSlots!==0||newFrontierSlots!==0||pressureState!=='CAPACITY_UNAVAILABLE')throw new Error('meta_pressure_fail_closed_state_inconsistent');
  }else if(pressureState==='READY_SATURATED'){
    if(newFrontierSlots!==0||readyBacklog<readyLimit)throw new Error('meta_pressure_ready_saturation_inconsistent');
  }else if(pressureState==='RECOVERY_DEBT_HIGH'){
    if(ambiguousBacklog<ambiguityLimit||newFrontierSlots>1)throw new Error('meta_pressure_recovery_debt_inconsistent');
  }else if(pressureState==='NORMAL'){
    if(readyBacklog>=readyLimit||ambiguousBacklog>=ambiguityLimit||newFrontierSlots!==availableSlots)throw new Error('meta_pressure_normal_state_inconsistent');
  }else{
    throw new Error('meta_pressure_fresh_capacity_unavailable_invalid');
  }

  return Object.freeze({
    source:'DEVOS_SCHEDULER_SNAPSHOT',
    state,
    available_slots:availableSlots,
    new_frontier_slots:newFrontierSlots,
    live_transport_slots:liveTransportSlots,
    pressure_state:pressureState,
    ready_backlog:readyBacklog,
    leased_backlog:leasedBacklog,
    running_backlog:runningBacklog,
    result_ready_backlog:resultReadyBacklog,
    ambiguous_backlog:ambiguousBacklog,
    blocked_backlog:blockedBacklog,
    active_claims:activeClaims,
    ready_backlog_limit:readyLimit,
    ambiguity_pressure_limit:ambiguityLimit,
    pressure_policy:String(row.pressure_policy||'').slice(0,80),
    automatic_retry_allowed:false,
    task_content_authority:false,
    scheduler_authority:false,
    browser_authority:false,
    release_authority:false,
    authority_effect:false,
  });
}
