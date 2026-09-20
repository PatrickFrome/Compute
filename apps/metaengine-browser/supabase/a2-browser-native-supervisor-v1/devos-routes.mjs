import { createMetaDevosSuperstep } from './meta-devos-superstep.mjs';
import { createWorkspaceObservationRoutes } from './workspace-observation-routes.mjs';

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
  'devos_transport_supervisor_schema_invalid',
  'devos_transport_supervisor_client_kind_invalid',
  'devos_transport_identity_invalid',
  'devos_transport_device_binding_invalid',
  'devos_dispatch_runtime_not_ready',
  'devos_dispatch_continuity_degraded',
  'devos_transport_fleet_contract_invalid',
  'devos_transport_agent_missing',
  'devos_transport_agent_not_active',
  'devos_transport_agent_binding_mismatch',
  'devos_transport_proof_mismatch',
  'devos_transport_proof_time_invalid',
  'devos_transport_proof_time_in_future',
]);
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const ENVIRONMENT_STATE_SCHEMA='metaengine.devos.environment-state.v1';

export function unavailableDevosRuntimeControl(reason='READ_UNAVAILABLE'){
  return Object.freeze({schema:ENVIRONMENT_STATE_SCHEMA,state:'UNAVAILABLE',reason:String(reason||'READ_UNAVAILABLE').slice(0,160),workspace_id:null,generation_floor:null,refill_enabled:null,supervisor_admission_enabled:null,continuous_service_allowed:false,authoritative:false,automatic_retry_allowed:false,authority_effect:false});
}

export function normalizeDevosRuntimeControl(value,{workspaceId}={}){
  const expected=String(workspaceId||'').toLowerCase();
  const observed=String(value?.workspace_id||'').toLowerCase();
  const floor=value?.generation_floor;
  if(!UUID_RE.test(expected)||!value||typeof value!=='object'||Array.isArray(value)||value.schema!==ENVIRONMENT_STATE_SCHEMA||value.authority_effect!==false||observed!==expected||typeof floor!=='number'||!Number.isSafeInteger(floor)||floor<0||typeof value.refill_enabled!=='boolean'||typeof value.supervisor_admission_enabled!=='boolean')return unavailableDevosRuntimeControl('READBACK_INVALID');
  const allowed=value.refill_enabled===true&&value.supervisor_admission_enabled===true;
  return Object.freeze({schema:ENVIRONMENT_STATE_SCHEMA,state:allowed?'OPEN':'CLOSED',reason:allowed?null:'CONTINUOUS_SERVICE_ADMISSION_FENCED',workspace_id:observed,generation_floor:floor,refill_enabled:value.refill_enabled,supervisor_admission_enabled:value.supervisor_admission_enabled,reset_at:value.reset_at||null,reset_reason:value.reset_reason?String(value.reset_reason).slice(0,240):null,continuous_service_allowed:allowed,authoritative:true,automatic_retry_allowed:false,authority_effect:false});
}

export async function readDevosRuntimeControl({rpc,workspaceId}={}){
  if(typeof rpc!=='function'||!UUID_RE.test(String(workspaceId||'')))return unavailableDevosRuntimeControl('READ_DEPENDENCY_INVALID');
  try{return normalizeDevosRuntimeControl(await rpc('devos_environment_state_v1',{p_workspace:workspaceId}),{workspaceId});}
  catch{return unavailableDevosRuntimeControl('READ_FAILED');}
}

// T2-5 Unified Work Graph item 4: the Objective→Milestone→Task→Claim→Effect
// view model with the cross-plane epochs (fleet generation epochs, supervisor
// mesh epoch, cognitive causal-stream cursor) the browser stamps on the cycle
// body. Pure projection over already-read inputs; no scheduling, no authority.
// The Mechanisms panel becomes a projection OF this graph, not a parallel
// coordination plane.
export function projectDevosWorkGraph({planSnapshot=null,metaOrchestrator=null,backlog=null,running=null,leases=null,planes=null}={}){
  const spec=planSnapshot&&planSnapshot.found===true&&planSnapshot.plan_spec&&typeof planSnapshot.plan_spec==='object'&&!Array.isArray(planSnapshot.plan_spec)?planSnapshot.plan_spec:null;
  const nodes=Array.isArray(spec?.nodes)?spec.nodes:[];
  const leaseRows=Array.isArray(leases)?leases:(leases?1:0);
  const cognitive=planes?.cognitive_stream&&typeof planes.cognitive_stream==='object'&&!Array.isArray(planes.cognitive_stream)&&typeof planes.cognitive_stream.stream_id==='string'
    ?{stream_id:String(planes.cognitive_stream.stream_id).slice(0,160),acknowledged_through_sequence:Number(planes.cognitive_stream.acknowledged_through_sequence)||0}
    :null;
  return Object.freeze({
    schema:'metaengine.devos.work-graph.v1',
    roadmap:Object.freeze({
      roadmap_id:String(planSnapshot?.roadmap_id||'').slice(0,160),
      milestone:spec?.active_milestone_key?String(spec.active_milestone_key).slice(0,160):null,
      plan_generation:Number(planSnapshot?.plan_generation)||0,
      plan_state:planSnapshot?.found===true?String(planSnapshot?.state||'ACTIVE').slice(0,32):'NONE',
      objective:spec?.objective?String(spec.objective).slice(0,480):null,
      node_count:nodes.length,
    }),
    tasks:Object.freeze({
      ready:Number(backlog?.ready)||0,
      running:Array.isArray(running)?running.length:0,
      by_role:Object.freeze({...((backlog&&typeof backlog==='object'&&backlog.by_role&&typeof backlog.by_role==='object')?backlog.by_role:{})}),
    }),
    claims:Object.freeze({leased_this_cycle:typeof leaseRows==='number'?leaseRows:leaseRows.length}),
    planes:Object.freeze({
      fleet_generation_epochs:Object.freeze([...new Set((Array.isArray(planes?.fleet_generation_epochs)?planes.fleet_generation_epochs:[]).map((v)=>Number(v)).filter((v)=>Number.isSafeInteger(v)&&v>0))].sort((a,b)=>a-b).slice(0,64)),
      mesh_epoch:Number.isSafeInteger(Number(planes?.mesh_epoch))?Number(planes.mesh_epoch):null,
      cognitive_stream:cognitive,
      meta_orchestrator_state:metaOrchestrator?.state?String(metaOrchestrator.state).slice(0,64):null,
    }),
    task_content_authority:false,
    scheduler_authority:false,
    browser_authority:false,
    release_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

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

export function createDevosSupervisorRoutes({rpc,workspaceId,readRuntimeControl=null,metaRoadmapId='metaengine-development-os-v1'}={}){
  if(typeof rpc!=='function'||!UUID_RE.test(String(workspaceId||'')))throw new Error('devos_routes_dependencies_invalid');
  const metaSuperstep=createMetaDevosSuperstep({rpc,workspaceId,roadmapId:metaRoadmapId});
  const workspaceObservation=createWorkspaceObservationRoutes({rpc,workspaceId});
  return async function handle({req,path,body,clientId}={}){
    const effectMatch=String(path||'').match(/^\/v1\/commands\/([0-9a-f-]{36})\/effect-intent$/i);
    if(req?.method==='POST'&&effectMatch){
      if(!clientId)return json(401,{error:'device_auth_required'});
      const commandId=effectMatch[1].toLowerCase();
      if(!UUID_RE.test(commandId)||!body?.binding||typeof body.binding!=='object'||Array.isArray(body.binding))return json(400,{error:'native_effect_binding_invalid'});
      // This route is composed before the generic index.ts effect handler and
      // therefore owns the same fail-closed boundary. Never let a path command
      // authorize a different leased binding (or a different device) and never
      // derive command identity from the Request object.
      if(String(body.binding.command_id||'').toLowerCase()!==commandId)return json(409,{error:'effect_binding_command_mismatch',automatic_retry_allowed:false,authority_effect:false});
      if(String(body.binding.client_id||'')!==String(clientId))return json(409,{error:'effect_binding_client_mismatch',automatic_retry_allowed:false,authority_effect:false});
      const result=await rpc('h205f22_a2_browser_supervisor_bind_effect_v1',{p_workspace_id:workspaceId,p_command_id:commandId,p_client_id:clientId,p_binding:body.binding,p_authority_effect:false});
      return json(result?.accepted===true?200:409,{...result,automatic_retry_allowed:false,authority_effect:false});
    }
    if(!String(path||'').startsWith('/v1/devos/'))return null;
    if(!clientId)return json(401,{error:'device_auth_required'});
    const workspaceReadback=await workspaceObservation({req,path,clientId});
    if(workspaceReadback)return workspaceReadback;
    // T2-5 Unified Work Graph item 1: operator-gated admission resume. The
    // environment fence (continuous_service_allowed=false) holds the whole
    // DevOS task cycle fail-closed; the designed exit is an operator-CONFIRMED
    // resume with a generation-floor CAS (devos_environment_resume_v1). The
    // SQL CAS is the authority: a stale floor resumes nothing (409) and the
    // route never bypasses the fence by other means.
    if(req?.method==='POST'&&path==='/v1/devos/resume-admission'){
      if(body?.confirm!==true)return json(400,{error:'devos_resume_confirmation_required',automatic_retry_allowed:false,authority_effect:false});
      let before;
      try{before=normalizeDevosRuntimeControl(await rpc('devos_environment_state_v1',{p_workspace:workspaceId}),{workspaceId});}
      catch{return json(503,{error:'devos_resume_state_unavailable',automatic_retry_allowed:false,authority_effect:false});}
      const expectedFloor=Number(body?.expected_generation_floor);
      const floor=Number.isSafeInteger(expectedFloor)&&expectedFloor>=0?expectedFloor:Number(before.generation_floor);
      if(!Number.isSafeInteger(floor)||floor<0)return json(409,{error:'devos_resume_generation_floor_unavailable',automatic_retry_allowed:false,authority_effect:false});
      try{
        const readback=await rpc('devos_environment_resume_v1',{p_workspace:workspaceId,p_expected_generation_floor:floor});
        const after=normalizeDevosRuntimeControl(await rpc('devos_environment_state_v1',{p_workspace:workspaceId}),{workspaceId});
        return json(200,{schema:'metaengine.devos.environment-resume.v1',resumed:true,requested_floor:floor,before:{state:before.state,generation_floor:before.generation_floor,supervisor_admission_enabled:before.supervisor_admission_enabled},after:{state:after.state,generation_floor:after.generation_floor,supervisor_admission_enabled:after.supervisor_admission_enabled,continuous_service_allowed:after.continuous_service_allowed},readback:readback&&typeof readback==='object'&&!Array.isArray(readback)?readback:null,operator_initiated:true,automatic_retry_allowed:false,authority_effect:false});
      }catch(error){
        const message=String(error?.message||error||'devos_resume_failed');
        if(message.includes('devos_environment_resume_generation_mismatch'))return json(409,{error:'devos_resume_generation_mismatch',requested_floor:floor,automatic_retry_allowed:false,authority_effect:false});
        throw error;
      }
    }
    if(req?.method==='POST'&&path==='/v1/devos/cycle'){
      const runtimeControl=typeof readRuntimeControl==='function'?await readRuntimeControl():null;
      if(runtimeControl&&runtimeControl.continuous_service_allowed!==true){
        return json(200,{schema:'metaengine.devos.browser-cycle.v1',state:'ADMISSION_FENCED',runtime_control:runtimeControl,admission_fenced:true,reconcile:null,backlog:{ready:0,running:0,by_role:{},authority_effect:false},lease:null,leases:[],scheduler_backpressure:null,lease_fenced:true,lease_fence_reason:runtimeControl.reason||'CONTINUOUS_SERVICE_ADMISSION_FENCED',running:[],scheduler_source:'NATIVE_SUPERVISOR_HEARTBEAT',scheduler_policy:'IDLE_ROLE_FAIR_SHARE_V1',lease_attempts:0,second_scheduler_loop:false,automatic_retry_allowed:false,authority_effect:false});
      }
      const agents=boundedAgents(body?.fleet);
      const metaOrchestrator=await metaSuperstep({clientId});
      const reconcile=await rpc('devos_fleet_reconcile_v1',{p_workspace:workspaceId});
      const snapshot=await rpc('devos_fleet_snapshot_v1',{p_workspace:workspaceId});
      const rawBacklog=backlogOf(snapshot);
      // D-C2 (2026-09-19 operator directive: commands must work multiply and
      // simultaneously): lease ONE task per idle agent candidate instead of
      // stopping at the first success. The browser dispatches the batch
      // concurrently (per-agent tabs); `lease` keeps the first entry as the
      // backward-compatible single-lease shape for older browser builds.
      // Backpressure or a transport fence still stops the whole scan. The
      // scan is ROLE-AWARE and BACKLOG-PAID: every successful lease consumes
      // one READY task of that role, a leased:false result exhausts the role
      // for this heartbeat (the DB atomically refused the role's last task —
      // another same-role agent cannot lease it either), and candidates whose
      // role has nothing left to pay are skipped without spending an RPC.
      let lease=null,leases=[],leaseAttempts=0,leaseFence=null,backpressure=null;
      const remainingByRole={...(rawBacklog?.by_role||{})};
      const exhaustedRoles=new Set();
      const leaseCeiling=Math.max(1,Math.min(8,Number(rawBacklog?.ready||0)||0));
      const candidates=fairIdleLeaseCandidates(snapshot,agents,rawBacklog);
      for(const agent of candidates.slice(0,8)){
        if((Number(remainingByRole[agent.role]||0)||0)<1||exhaustedRoles.has(agent.role))continue;
        leaseAttempts+=1;
        try{
          const result=await rpc('devos_fleet_lease_v1',{p_workspace:workspaceId,p_agent:agent.agent_id,p_role:agent.role,p_tab:agent.tab_id,p_target:agent.target_id,p_epoch:agent.generation_epoch,p_seconds:900});
          if(result?.leased===true){
            leases.push(result);
            remainingByRole[agent.role]=Math.max(0,(Number(remainingByRole[agent.role]||0)||1)-1);
            if(leases.length>=leaseCeiling)break;
          }
          else{
            exhaustedRoles.add(agent.role);
            backpressure=schedulerBackpressure(result);
            if(backpressure)break;
          }
        }catch(error){leaseFence=transportAdmissionFence(error);if(!leaseFence)throw error;break;}
      }
      lease=leases[0]||null;
      const backlog=deferredBacklog(rawBacklog,backpressure);
      const runningRows=runningForAgents(snapshot,agents);
      // T2-5 item 4: unified Work Graph projection rides the cycle response —
      // one bounded plan-snapshot read (leader-independent, deterministic).
      // A read failure degrades to null; it never gates the cycle itself.
      let workGraph=null;
      try{
        const planSnapshot=await rpc('meta_orchestrator_plan_snapshot_v1',{p_workspace_id:workspaceId,p_roadmap_id:metaRoadmapId});
        workGraph=projectDevosWorkGraph({planSnapshot,metaOrchestrator,backlog,running:runningRows,leases,planes:body?.planes});
      }catch{workGraph=null;}
      return json(200,{schema:'metaengine.devos.browser-cycle.v1',state:'OPEN',runtime_control:runtimeControl,admission_fenced:false,meta_orchestrator:metaOrchestrator,reconcile,backlog,work_graph:workGraph,lease,leases,scheduler_backpressure:backpressure,lease_fenced:leaseFence?.fenced===true,lease_fence_reason:leaseFence?.reason||null,running:runningRows,scheduler_source:'NATIVE_SUPERVISOR_HEARTBEAT',scheduler_policy:'IDLE_ROLE_FAIR_SHARE_V1',lease_attempts:leaseAttempts,second_scheduler_loop:false,automatic_retry_allowed:false,authority_effect:false});
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
