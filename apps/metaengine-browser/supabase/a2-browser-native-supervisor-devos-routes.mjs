const AGENT_RE=/^agent_[a-z0-9-]{8,64}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE=/^[a-f0-9]{64}$/;
const TARGET_RE=/^webcontents:[1-9][0-9]*$/;
const ROLE_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
const FINALISH=new Set(['RESULT_READY','BLOCKED','AMBIGUOUS','COMPLETED','FAILED']);
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

function int(value,name){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(`devos_${name}_invalid`);return n;}
function binding(body={}){
  const out={task_id:String(body.task_id||'').toLowerCase(),agent_id:String(body.agent_id||'').toLowerCase(),lease_generation:int(body.lease_generation,'lease_generation'),tab_id:String(body.tab_id||''),target_id:String(body.target_id||'').toLowerCase(),agent_generation_epoch:int(body.agent_generation_epoch,'agent_generation_epoch')};
  if(!UUID_RE.test(out.task_id)||!AGENT_RE.test(out.agent_id)||!out.tab_id||!TARGET_RE.test(out.target_id))throw new Error('devos_binding_invalid');
  return out;
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
  const event=(Array.isArray(snapshot?.recent_events)?snapshot.recent_events:[]).find(e=>String(e?.task_id||'').toLowerCase()===taskId&&/^TASK_RESULT_(RESULT_READY|BLOCKED|AMBIGUOUS|COMPLETED|FAILED)$/.test(String(e?.event_type||'')));
  if(!event)return null;
  const state=String(event.event_type).slice('TASK_RESULT_'.length);
  return {task_id:taskId,state,lease_generation:Number(event.lease_generation)||0,result_sha256:event?.payload?.result_sha256||null,error_code:event?.payload?.error_code||null};
}

export function createDevosSupervisorRoutes({rpc,workspaceId}={}){
  if(typeof rpc!=='function'||!UUID_RE.test(String(workspaceId||'')))throw new Error('devos_routes_dependencies_invalid');
  return async function handle({req,path,body,clientId}={}){
    if(!String(path||'').startsWith('/v1/devos/'))return null;
    if(!clientId)return json(401,{error:'device_auth_required'});
    if(req?.method==='POST'&&path==='/v1/devos/cycle'){
      const agents=boundedAgents(body?.fleet);
      const snapshot=await rpc('devos_fleet_snapshot_v1',{p_workspace:workspaceId});
      const backlog=backlogOf(snapshot);
      let lease=null;
      const candidates=agents.filter(a=>(backlog.by_role[a.role]||0)>0).sort((a,b)=>a.agent_id.localeCompare(b.agent_id));
      for(const agent of candidates.slice(0,8)){
        const result=await rpc('devos_fleet_lease_v1',{p_workspace:workspaceId,p_agent:agent.agent_id,p_role:agent.role,p_tab:agent.tab_id,p_target:agent.target_id,p_epoch:agent.generation_epoch,p_seconds:900});
        if(result?.leased===true){lease=result;break;}
      }
      return json(200,{schema:'metaengine.devos.browser-cycle.v1',backlog,lease,running:runningForAgents(snapshot,agents),scheduler_source:'NATIVE_SUPERVISOR_HEARTBEAT',second_scheduler_loop:false,authority_effect:false});
    }
    if(req?.method==='POST'&&path==='/v1/devos/mark-running'){
      const b=binding(body); const proof=body?.proof||{};
      if(!HASH_RE.test(String(proof.prompt_sha256||'').toLowerCase())||!HASH_RE.test(String(proof.conversation_url_sha256||'').toLowerCase())||!['PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_CONVERSATION'].includes(String(proof.effect_state||'')))return json(400,{error:'transport_not_proven'});
      const result=await rpc('devos_fleet_mark_running_v1',{p_task:b.task_id,p_agent:b.agent_id,p_generation:b.lease_generation,p_tab:b.tab_id,p_target:b.target_id,p_epoch:b.agent_generation_epoch,p_proof:{prompt_sha256:String(proof.prompt_sha256).toLowerCase(),conversation_url_sha256:String(proof.conversation_url_sha256).toLowerCase(),effect_state:String(proof.effect_state)}});
      return json(200,{...result,automatic_retry_allowed:false,authority_effect:false});
    }
    if(req?.method==='POST'&&path==='/v1/devos/complete'){
      const b=binding(body); const state=String(body?.state||'').toUpperCase();
      if(!FINALISH.has(state)||!body?.summary||typeof body.summary!=='object'||Array.isArray(body.summary))return json(400,{error:'invalid_result'});
      const result=await rpc('devos_fleet_complete_v1',{p_task:b.task_id,p_agent:b.agent_id,p_generation:b.lease_generation,p_tab:b.tab_id,p_target:b.target_id,p_epoch:b.agent_generation_epoch,p_state:state,p_summary:body.summary,p_error:body?.error==null?null:String(body.error).slice(0,160)});
      return json(200,{...result,automatic_retry_allowed:false,authority_effect:false});
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
