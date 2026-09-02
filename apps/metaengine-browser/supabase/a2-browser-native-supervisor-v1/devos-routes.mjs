import { createMetaDevosSuperstep } from './meta-devos-superstep.mjs';

const AGENT_RE=/^agent_[a-z0-9-]{8,64}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE=/^[a-f0-9]{64}$/;
const TARGET_RE=/^webcontents:[1-9][0-9]*$/;
const ROLE_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
const FINALISH=new Set(['RESULT_READY','BLOCKED','AMBIGUOUS','COMPLETED','FAILED']);
const RECOVERY_CLASSES=new Set(['PRE_EFFECT_ABORTED','EFFECT_PROVEN']);
const EFFECT_STATES=new Set(['PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_CONVERSATION']);
const TRANSPORT_ADMISSION_FENCES=new Set([
  'devos_transport_claim_state_invalid',
  'devos_transport_supervisor_snapshot_missing',
  'devos_transport_client_binding_missing',
  'devos_transport_client_binding_changed',
  'devos_transport_supervisor_snapshot_missing_after_lock',
  'devos_transport_client_actuation_lease_active',
  'devos_transport_supervisor_snapshot_stale',
  'devos_transport_agent_missing',
  'devos_transport_agent_not_active',
  'devos_transport_agent_binding_mismatch',
  'devos_transport_proof_mismatch',
  'devos_transport_proof_time_invalid',
  'devos_transport_proof_time_in_future',
]);
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

function int(value,name){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(`devos_${name}_invalid`);return n;}
function binding(body={}){
  const out={task_id:String(body.task_id||'').toLowerCase(),agent_id:String(body.agent_id||'').toLowerCase(),lease_generation:int(body.lease_generation,'lease_generation'),tab_id:String(body.tab_id||''),target_id:String(body.target_id||'').toLowerCase(),agent_generation_epoch:int(body.agent_generation_epoch,'agent_generation_epoch')};
  if(!UUID_RE.test(out.task_id)||!AGENT_RE.test(out.agent_id)||!out.tab_id||out.tab_id.length>160||!TARGET_RE.test(out.target_id))throw new Error('devos_binding_invalid');
  return out;
}
function recovery(body={}){
  const row=body?.recovery;
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('devos_recovery_invalid');
  const recovery_class=String(row.recovery_class||'').toUpperCase();
  const prompt_sha256=String(row.prompt_sha256||'').toLowerCase();
  if(!RECOVERY_CLASSES.has(recovery_class)||!HASH_RE.test(prompt_sha256)||row.automatic_retry_allowed!==false||row.authority_effect!==false)throw new Error('devos_recovery_invalid');
  if(recovery_class==='PRE_EFFECT_ABORTED'){
    if(row.physical_effect_attempted!==false||row.effect_barrier_crossed!==false||row.proof!=null)throw new Error('devos_recovery_pre_effect_invalid');
    return {recovery_class,prompt_sha256,physical_effect_attempted:false,effect_barrier_crossed:false,automatic_retry_allowed:false,authority_effect:false};
  }
  const proof=row.proof;
  if(row.physical_effect_attempted!==true||row.effect_barrier_crossed!==true||!proof||typeof proof!=='object'||Array.isArray(proof))throw new Error('devos_recovery_effect_proven_invalid');
  const proofPrompt=String(proof.prompt_sha256||'').toLowerCase();
  const conversation=String(proof.conversation_url_sha256||'').toLowerCase();
  const effectState=String(proof.effect_state||'').toUpperCase();
  if(proofPrompt!==prompt_sha256||!HASH_RE.test(conversation)||!EFFECT_STATES.has(effectState))throw new Error('devos_recovery_effect_proven_invalid');
  return {recovery_class,prompt_sha256,physical_effect_attempted:true,effect_barrier_crossed:true,proof:{prompt_sha256:proofPrompt,conversation_url_sha256:conversation,effect_state:effectState},automatic_retry_allowed:false,authority_effect:false};
}
function boundedAgents(value){
  const rows=Array.isArray(value?.agents)?value.agents:[];
  if(rows.length>64)throw new Error('devos_fleet_agent_count_invalid');
  const out=[];
  for(const row of rows){
    const agent_id=String(row?.agent_id||'').toLowerCase(); const role=String(row?.role||'').toUpperCase(); const lifecycle_state=String(row?.lifecycle_state||'').toUpperCase(); const tab_id=String(row?.tab_id||''); const target_id=String(row?.target_id||'').toLowerCase(); const generation_epoch=Number(row?.generation_epoch);
    if(!AGENT_RE.test(agent_id)||!ROLE_RE.test(role)||!['BOUND_UNVERIFIED','ACTIVE'].includes(lifecycle_state)||!tab_id||!TARGET_RE.test(target_id)||!Number.isSafeInteger(generation_epoch)||generation_epoch<1)continue;
    out.push({agent_id,role,lifecycle_state,tab_id,target_id,generation_epoch});
  }
  return out;
}
function backlogOf(snapshot){
  const tasks=Array.isArray(snapshot?.active_tasks)?snapshot.active_tasks:[];
  const by_role={}; let ready=0,running=0;
  for(const t of tasks){const state=String(t?.state||'').toUpperCase();const role=String(t?.role||'').toUpperCase();if(state==='READY'){ready++;if(ROLE_RE.test(role))by_role[role]=(by_role[role]||0)+1;}if(['LEASED','RUNNING'].includes(state))running++;}
  return {ready,running,by_role,authority_effect:false};
}
function deferredBacklog(backlog,backpressure){
  if(!backpressure?.active)return backlog;
  return {...backlog,deferred_ready:Number(backlog?.ready||0),deferred_by_role:{...(backlog?.by_role||{})},ready:0,by_role:{},scheduler_backpressure:true,authority_effect:false};
}
function roleSchedulingStats(snapshot){
  const out=new Map();
  for(const task of Array.isArray(snapshot?.active_tasks)?snapshot.active_tasks:[]){
    const role=String(task?.role||'').toUpperCase(); if(!ROLE_RE.test(role))continue;
    const state=String(task?.state||'').toUpperCase();
    const row=out.get(role)||{role,ready:0,inflight:0,oldest_ready_ms:Number.POSITIVE_INFINITY,highest_ready_priority:Number.NEGATIVE_INFINITY};
    if(state==='READY'){
      row.ready+=1;
      const created=Date.parse(String(task?.created_at||'')); if(Number.isFinite(created))row.oldest_ready_ms=Math.min(row.oldest_ready_ms,created);
      const priority=Number(task?.priority); if(Number.isFinite(priority))row.highest_ready_priority=Math.max(row.highest_ready_priority,priority);
    }
    if(['LEASED','RUNNING'].includes(state))row.inflight+=1;
    out.set(role,row);
  }
  return out;
}
function fairIdleLeaseCandidates(snapshot,agents,backlog){
  const busy=new Set((Array.isArray(snapshot?.active_claims)?snapshot.active_claims:[])
    .filter(row=>String(row?.state||'ACTIVE').toUpperCase()==='ACTIVE')
    .map(row=>String(row?.agent_id||'').toLowerCase())
    .filter(id=>AGENT_RE.test(id)));
  const stats=roleSchedulingStats(snapshot);
  const groups=new Map();
  for(const agent of agents){
    if(busy.has(agent.agent_id)||(backlog.by_role[agent.role]||0)<1)continue;
    if(!groups.has(agent.role))groups.set(agent.role,[]);
    groups.get(agent.role).push(agent);
  }
  for(const group of groups.values())group.sort((a,b)=>a.agent_id.localeCompare(b.agent_id));
  const roles=[...groups.keys()].sort((a,b)=>{
    const sa=stats.get(a)||{inflight:0,oldest_ready_ms:Number.POSITIVE_INFINITY,highest_ready_priority:Number.NEGATIVE_INFINITY};
    const sb=stats.get(b)||{inflight:0,oldest_ready_ms:Number.POSITIVE_INFINITY,highest_ready_priority:Number.NEGATIVE_INFINITY};
    return sa.inflight-sb.inflight||sa.oldest_ready_ms-sb.oldest_ready_ms||sb.highest_ready_priority-sa.highest_ready_priority||a.localeCompare(b);
  });
  const out=[];
  for(let round=0;;round+=1){let added=false;for(const role of roles){const agent=groups.get(role)?.[round];if(agent){out.push(agent);added=true;}}if(!added)break;}
  return out;
}
function runningForAgents(snapshot,agents){
  const allowed=new Map(agents.map(a=>[a.agent_id,a]));
  const proofByKey=new Map();
  for(const e of Array.isArray(snapshot?.recent_events)?snapshot.recent_events:[]){
    if(String(e?.event_type||'')!=='TASK_TRANSPORT_PROVEN')continue;
    const hash=String(e?.payload?.conversation_url_sha256||'').toLowerCase();
    if(HASH_RE.test(hash))proofByKey.set(`${String(e.task_id||'').toLowerCase()}:${Number(e.lease_generation)}`,hash);
  }
  const out=[];
  for(const t of Array.isArray(snapshot?.active_tasks)?snapshot.active_tasks:[]){
    if(String(t?.state||'').toUpperCase()!=='RUNNING')continue;
    const agentId=String(t?.lease_agent_id||'').toLowerCase(); const agent=allowed.get(agentId); if(!agent)continue;
    const generation=Number(t?.lease_generation); const proof=proofByKey.get(`${String(t?.task_id||'').toLowerCase()}:${generation}`)||null;
    out.push({task_id:t.task_id,agent_id:agentId,role:String(t.role||'').toUpperCase(),base_sha:String(t.base_sha||'').toLowerCase(),lease_generation:generation,tab_id:String(t.lease_tab_id||''),target_id:String(t.lease_target_id||'').toLowerCase(),agent_generation_epoch:Number(t.lease_agent_generation_epoch),conversation_url_sha256:proof,automatic_retry_allowed:false,authority_effect:false});
  }
  return out;
}
function taskStatusFromSnapshot(snapshot,taskId){
  const active=(Array.isArray(snapshot?.active_tasks)?snapshot.active_tasks:[]).find(t=>String(t?.task_id||'').toLowerCase()===taskId);
  if(active)return {task_id:active.task_id,state:String(active.state||'').toUpperCase(),lease_generation:Number(active.lease_generation)||0,result_sha256:active.result_sha256||null,error_code:active.error_code||null};
  const event=(Array.isArray(snapshot?.recent_events)?snapshot.recent_events:[]).find(e=>String(e?.task_id||'').toLowerCase()===taskId&&(/TASK_RESULT_(RESULT_READY|BLOCKED|AMBIGUOUS|COMPLETED|FAILED)/.test(String(e?.event_type||''))||String(e?.event_type||'')==='TASK_LEASE_EXPIRED_AMBIGUOUS'));
  if(!event)return null;
  const state=String(event.event_type)==='TASK_LEASE_EXPIRED_AMBIGUOUS'?'AMBIGUOUS':String(event.event_type).slice('TASK_RESULT_'.length);
  return {task_id:taskId,state,lease_generation:Number(event.lease_generation)||0,result_sha256:event?.payload?.result_sha256||null,error_code:event?.payload?.error_code||event?.payload?.reason_code||null};
}
function fencedRpcResponse(error){
  const message=String(error?.message||error||'');
  if(!message.includes('task_lease_fenced'))return null;
  return json(409,{error:'task_lease_fenced',fenced:true,automatic_retry_allowed:false,authority_effect:false});
}
function ambiguityRpcResponse(error){
  const message=String(error?.message||error||'').toLowerCase();
  const match=message.match(/devos_ambiguity_[a-z0-9_]+/);
  if(!match)return null;
  const reason=match[0];
  const invalid=reason.endsWith('_invalid')||reason.endsWith('_required');
  return json(invalid?400:409,{error:reason,fenced:!invalid,automatic_retry_allowed:false,physical_effect_replayed:false,authority_effect:false});
}
function transportAdmissionFence(error){
  const message=String(error?.message||error||'').toLowerCase();
  for(const reason of TRANSPORT_ADMISSION_FENCES){
    if(message.includes(reason))return Object.freeze({reason,fenced:true,automatic_retry_allowed:false,authority_effect:false});
  }
  return null;
}
function schedulerBackpressure(result){
  if(result?.backpressure!==true)return null;
  return Object.freeze({active:true,reason:String(result?.reason||'SCHEDULER_BACKPRESSURE').slice(0,120),retry_after_ms:Math.max(1000,Math.min(300000,Number(result?.retry_after_ms)||60000)),page_signal_authority:false,automatic_retry_allowed:false,authority_effect:false});
}

export function createDevosSupervisorRoutes({rpc,workspaceId}={}){
  if(typeof rpc!=='function'||!UUID_RE.test(String(workspaceId||'')))throw new Error('devos_routes_dependencies_invalid');
  const metaSuperstep=createMetaDevosSuperstep({rpc,workspaceId});
  return async function handle({req,path,body,clientId}={}){
    const effectMatch=String(path||'').match(/^\/v1\/commands\/([0-9a-f-]{36})\/effect-intent$/i);
    if(req?.method==='POST'&&effectMatch){
      if(!clientId)return json(401,{error:'device_auth_required'});
      const commandId=effectMatch[1].toLowerCase();
      if(!UUID_RE.test(commandId)||!body?.binding||typeof body.binding!=='object'||Array.isArray(body.binding))return json(400,{error:'native_effect_binding_invalid'});
      const result=await rpc('h205f22_a2_browser_supervisor_bind_effect_v1',{p_workspace_id:workspaceId,p_command_id:commandId,p_client_id:clientId,p_binding:body.binding,p_authority_effect:false});
      return json(result?.accepted===true?200:409,{...result,automatic_retry_allowed:false,authority_effect:false});
    }
    if(!String(path||'').startsWith('/v1/devos/'))return null;
    if(!clientId)return json(401,{error:'device_auth_required'});
    if(req?.method==='POST'&&path==='/v1/devos/cycle'){
      const agents=boundedAgents(body?.fleet);
      const metaOrchestrator=await metaSuperstep({clientId});
      const reconcile=await rpc('devos_fleet_reconcile_v1',{p_workspace:workspaceId});
      const snapshot=await rpc('devos_fleet_snapshot_v1',{p_workspace:workspaceId});
      const rawBacklog=backlogOf(snapshot);
      let lease=null,leaseAttempts=0,leaseFence=null,backpressure=null;
      const candidates=fairIdleLeaseCandidates(snapshot,agents,rawBacklog);
      for(const agent of candidates.slice(0,8)){
        leaseAttempts+=1;
        try{
          const result=await rpc('devos_fleet_lease_v1',{p_workspace:workspaceId,p_agent:agent.agent_id,p_role:agent.role,p_tab:agent.tab_id,p_target:agent.target_id,p_epoch:agent.generation_epoch,p_seconds:900});
          if(result?.leased===true){lease=result;break;}
          backpressure=schedulerBackpressure(result);
          if(backpressure)break;
        }catch(error){leaseFence=transportAdmissionFence(error);if(!leaseFence)throw error;break;}
      }
      const backlog=deferredBacklog(rawBacklog,backpressure);
      return json(200,{schema:'metaengine.devos.browser-cycle.v1',meta_orchestrator:metaOrchestrator,reconcile,backlog,lease,scheduler_backpressure:backpressure,lease_fenced:leaseFence?.fenced===true,lease_fence_reason:leaseFence?.reason||null,running:runningForAgents(snapshot,agents),scheduler_source:'NATIVE_SUPERVISOR_HEARTBEAT',scheduler_policy:'IDLE_ROLE_FAIR_SHARE_V1',lease_attempts:leaseAttempts,second_scheduler_loop:false,automatic_retry_allowed:false,authority_effect:false});
    }
    if(req?.method==='POST'&&path==='/v1/devos/mark-running'){
      const b=binding(body); const proof=body?.proof||{};
      if(!HASH_RE.test(String(proof.prompt_sha256||'').toLowerCase())||!HASH_RE.test(String(proof.conversation_url_sha256||'').toLowerCase())||!EFFECT_STATES.has(String(proof.effect_state||'').toUpperCase()))return json(400,{error:'transport_not_proven'});
      try{
        const result=await rpc('devos_fleet_mark_running_v1',{p_task:b.task_id,p_agent:b.agent_id,p_generation:b.lease_generation,p_tab:b.tab_id,p_target:b.target_id,p_epoch:b.agent_generation_epoch,p_proof:{prompt_sha256:String(proof.prompt_sha256).toLowerCase(),conversation_url_sha256:String(proof.conversation_url_sha256).toLowerCase(),effect_state:String(proof.effect_state).toUpperCase()}});
        return json(200,{...result,automatic_retry_allowed:false,authority_effect:false});
      }catch(error){const fenced=fencedRpcResponse(error);if(fenced)return fenced;throw error;}
    }
    if(req?.method==='POST'&&path==='/v1/devos/reconcile-ambiguous'){
      let b,r;
      try{b=binding(body);r=recovery(body);}catch(error){return json(400,{error:String(error?.message||'devos_recovery_invalid').slice(0,120),automatic_retry_allowed:false,physical_effect_replayed:false,authority_effect:false});}
      try{
        const result=await rpc('devos_fleet_reconcile_ambiguous_v2',{p_workspace:workspaceId,p_client:clientId,p_task:b.task_id,p_agent:b.agent_id,p_generation:b.lease_generation,p_tab:b.tab_id,p_target:b.target_id,p_epoch:b.agent_generation_epoch,p_recovery:r});
        return json(200,{...result,automatic_retry_allowed:false,physical_effect_replayed:false,authority_effect:false});
      }catch(error){const mapped=ambiguityRpcResponse(error);if(mapped)return mapped;throw error;}
    }
    if(req?.method==='POST'&&path==='/v1/devos/complete'){
      const b=binding(body); const state=String(body?.state||'').toUpperCase();
      if(!FINALISH.has(state)||!body?.summary||typeof body.summary!=='object'||Array.isArray(body.summary))return json(400,{error:'invalid_result'});
      try{
        const result=await rpc('devos_fleet_complete_v1',{p_task:b.task_id,p_agent:b.agent_id,p_generation:b.lease_generation,p_tab:b.tab_id,p_target:b.target_id,p_epoch:b.agent_generation_epoch,p_state:state,p_summary:body.summary,p_error:body?.error==null?null:String(body.error).slice(0,160)});
        return json(200,{...result,automatic_retry_allowed:false,authority_effect:false});
      }catch(error){const fenced=fencedRpcResponse(error);if(fenced)return fenced;throw error;}
    }
    const match=String(path||'').match(/^\/v1\/devos\/tasks\/([0-9a-f-]{36})\/status$/i);
    if(req?.method==='GET'&&match){
      const taskId=match[1].toLowerCase();
      if(!UUID_RE.test(taskId))return json(400,{error:'task_id_invalid'});
      const snapshot=await rpc('devos_fleet_snapshot_v1',{p_workspace:workspaceId});
      const row=taskStatusFromSnapshot(snapshot,taskId);
      return row?json(200,{...row,automatic_retry_allowed:false,authority_effect:false}):json(404,{error:'task_status_not_proven'});
    }
    return json(404,{error:'devos_route_not_found'});
  };
}
