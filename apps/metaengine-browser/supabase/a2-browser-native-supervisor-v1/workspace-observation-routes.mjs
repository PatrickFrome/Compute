const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE=/^[a-f0-9]{40}$/;
const AGENT_RE=/^agent_[a-z0-9-]{8,64}$/;
const TARGET_RE=/^webcontents:[1-9][0-9]*$/;
const STATES=new Set(['RESERVED','READY','FROZEN']);
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});

function positive(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null}
function bounded(value,max){return String(value??'').slice(0,max)}
function runtimeMissing(error){const message=String(error?.message||error||'').toLowerCase();return message.includes('h205f22_a2_workspace_binding_snapshot_v1')&&(message.includes('not find')||message.includes('does not exist')||message.includes('pgrst202')||message.includes('404'))}

function normalizeBinding(row,coordinationWorkspaceId){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const workspace_id=String(row.workspace_id||'').toLowerCase();
  const coordination_workspace_id=String(row.coordination_workspace_id||'').toLowerCase();
  const task_id=String(row.task_id||'').toLowerCase();
  const agent_id=String(row.agent_id||'').toLowerCase();
  const tab_id=bounded(row.tab_id,160);
  const target_id=String(row.target_id||'').toLowerCase();
  const base_sha=String(row.base_sha||'').toLowerCase();
  const state=String(row.state||'').toUpperCase();
  const workspace_generation=positive(row.workspace_generation);
  const claim_id=positive(row.claim_id);
  const agent_generation_epoch=positive(row.agent_generation_epoch);
  const lease_generation=positive(row.lease_generation);
  const lease_expires_at=String(row.lease_expires_at||'');
  const updated_at=String(row.updated_at||'');
  if(!UUID_RE.test(workspace_id)||coordination_workspace_id!==coordinationWorkspaceId||!UUID_RE.test(task_id)||!AGENT_RE.test(agent_id)||!tab_id||!TARGET_RE.test(target_id)||!SHA40_RE.test(base_sha)||!STATES.has(state)||workspace_generation==null||claim_id==null||agent_generation_epoch==null||lease_generation==null||!Number.isFinite(Date.parse(lease_expires_at))||!Number.isFinite(Date.parse(updated_at)))return null;
  if(row.authority_effect!==false||row.automatic_retry_allowed!==false||row.scheduler_authority!==false||row.browser_actuation_authority!==false||row.page_data_authority!==false)return null;
  if(Object.hasOwn(row,'repo_root')||Object.hasOwn(row,'managed_root')||Object.hasOwn(row,'worktree_path')||Object.hasOwn(row,'worktree_realpath'))return null;
  return Object.freeze({
    workspace_id,workspace_generation,coordination_workspace_id,task_id,claim_id,
    point_id:bounded(row.point_id,160),repo_id:bounded(row.repo_id,240),base_sha,
    branch_name:bounded(row.branch_name,240),agent_id,tab_id,target_id,agent_generation_epoch,
    lease_generation,lease_expires_at,lease_current:row.lease_current===true,state,
    last_verified_head_sha:row.last_verified_head_sha==null?null:String(row.last_verified_head_sha).toLowerCase(),
    ambiguity_code:row.ambiguity_code==null?null:bounded(row.ambiguity_code,120),dirty_hold:row.dirty_hold===true,
    updated_at,automatic_retry_allowed:false,scheduler_authority:false,browser_actuation_authority:false,page_data_authority:false,authority_effect:false,
  });
}

export function normalizeWorkspaceBindingSnapshot(value,{workspaceId}={}){
  const coordinationWorkspaceId=String(workspaceId||'').toLowerCase();
  if(!UUID_RE.test(coordinationWorkspaceId)||!value||typeof value!=='object'||Array.isArray(value))return null;
  if(value.schema!=='metaengine.devos.workspace-binding-snapshot.v1'||value.state!=='AVAILABLE'||String(value.coordination_workspace_id||'').toLowerCase()!==coordinationWorkspaceId)return null;
  if(value.filesystem_paths_exposed!==false||value.scheduler_authority!==false||value.browser_actuation_authority!==false||value.automatic_retry_allowed!==false||value.authority_effect!==false)return null;
  const rows=Array.isArray(value.bindings)?value.bindings:[];
  if(rows.length>64)return null;
  const bindings=[];
  for(const row of rows){const normalized=normalizeBinding(row,coordinationWorkspaceId);if(!normalized)return null;bindings.push(normalized)}
  return Object.freeze({schema:'metaengine.devos.workspace-binding-snapshot.v1',state:'AVAILABLE',coordination_workspace_id:coordinationWorkspaceId,observed_at:value.observed_at||null,bindings,bounded_rows:64,filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,automatic_retry_allowed:false,authority_effect:false});
}

export function createWorkspaceObservationRoutes({rpc,workspaceId}={}){
  const coordinationWorkspaceId=String(workspaceId||'').toLowerCase();
  if(typeof rpc!=='function'||!UUID_RE.test(coordinationWorkspaceId))throw new Error('workspace_observation_routes_dependencies_invalid');
  return async({req,path,clientId}={})=>{
    if(path!=='/v1/devos/workspace-snapshot')return null;
    if(req?.method!=='GET')return json(405,{error:'method_not_allowed',automatic_retry_allowed:false,authority_effect:false});
    if(!clientId)return json(401,{error:'device_auth_required',automatic_retry_allowed:false,authority_effect:false});
    try{
      const value=await rpc('h205f22_a2_workspace_binding_snapshot_v1',{p_coordination_workspace_id:coordinationWorkspaceId});
      const checked=normalizeWorkspaceBindingSnapshot(value,{workspaceId:coordinationWorkspaceId});
      if(!checked)throw new Error('workspace_binding_snapshot_readback_invalid');
      return json(200,checked);
    }catch(error){
      const notDeployed=runtimeMissing(error);
      return json(503,{schema:'metaengine.devos.workspace-binding-snapshot.v1',state:notDeployed?'RUNTIME_NOT_DEPLOYED':'READ_UNAVAILABLE',coordination_workspace_id:coordinationWorkspaceId,bindings:[],reason:notDeployed?'WORKSPACE_BINDING_RPC_NOT_DEPLOYED':'WORKSPACE_BINDING_READ_UNAVAILABLE',filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,automatic_retry_allowed:false,authority_effect:false});
    }
  };
}
