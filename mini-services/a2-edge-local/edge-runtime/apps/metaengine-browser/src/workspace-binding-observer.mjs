const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE=/^[a-f0-9]{40}$/;
const AGENT_RE=/^agent_[a-z0-9-]{8,64}$/;
const TARGET_RE=/^webcontents:[1-9][0-9]*$/;
const STATES=new Set(['RESERVED','READY','FROZEN']);
const UNAVAILABLE_STATES=new Set(['UNINITIALIZED','DEVICE_NOT_ENROLLED','ROUTE_UNAVAILABLE','RUNTIME_NOT_DEPLOYED','READ_UNAVAILABLE','READ_ERROR','INVALID_READBACK']);

const positive=(v)=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null};
const clip=(v,n=240)=>String(v??'').slice(0,n);

export function unavailableWorkspaceBindingSnapshot(state='UNINITIALIZED',reason=null){
  const normalized=UNAVAILABLE_STATES.has(String(state||'').toUpperCase())?String(state).toUpperCase():'READ_ERROR';
  return Object.freeze({schema:'metaengine.browser.workspace-binding-observer.v1',state:normalized,observed_at:new Date().toISOString(),bindings:[],reason:reason?clip(reason):null,source:'NATIVE_SUPERVISOR_HEARTBEAT',source_implemented:true,runtime_deployed:normalized==='RUNTIME_NOT_DEPLOYED'?false:null,filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,automatic_retry_allowed:false,second_polling_loop:false,authority_effect:false});
}

function normalizeBinding(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return null;
  if(['repo_root','managed_root','worktree_path','worktree_realpath'].some((key)=>Object.hasOwn(row,key)))return null;
  const workspace_id=String(row.workspace_id||'').toLowerCase();
  const coordination_workspace_id=String(row.coordination_workspace_id||'').toLowerCase();
  const task_id=String(row.task_id||'').toLowerCase();
  const agent_id=String(row.agent_id||'').toLowerCase();
  const tab_id=clip(row.tab_id,160);
  const target_id=String(row.target_id||'').toLowerCase();
  const base_sha=String(row.base_sha||'').toLowerCase();
  const state=String(row.state||'').toUpperCase();
  const workspace_generation=positive(row.workspace_generation),claim_id=positive(row.claim_id),agent_generation_epoch=positive(row.agent_generation_epoch),lease_generation=positive(row.lease_generation);
  const lease_expires_at=String(row.lease_expires_at||''),updated_at=String(row.updated_at||'');
  if(!UUID_RE.test(workspace_id)||!UUID_RE.test(coordination_workspace_id)||!UUID_RE.test(task_id)||!AGENT_RE.test(agent_id)||!tab_id||!TARGET_RE.test(target_id)||!SHA40_RE.test(base_sha)||!STATES.has(state)||workspace_generation==null||claim_id==null||agent_generation_epoch==null||lease_generation==null||!Number.isFinite(Date.parse(lease_expires_at))||!Number.isFinite(Date.parse(updated_at)))return null;
  if(row.authority_effect!==false||row.automatic_retry_allowed!==false||row.scheduler_authority!==false||row.browser_actuation_authority!==false||row.page_data_authority!==false)return null;
  const verified=row.last_verified_head_sha==null?null:String(row.last_verified_head_sha).toLowerCase();
  if(verified!==null&&!SHA40_RE.test(verified))return null;
  return Object.freeze({workspace_id,workspace_generation,coordination_workspace_id,task_id,claim_id,point_id:clip(row.point_id,160),repo_id:clip(row.repo_id,240),base_sha,branch_name:clip(row.branch_name,240),agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,lease_expires_at,lease_current:row.lease_current===true,state,last_verified_head_sha:verified,ambiguity_code:row.ambiguity_code==null?null:clip(row.ambiguity_code,120),dirty_hold:row.dirty_hold===true,updated_at,automatic_retry_allowed:false,scheduler_authority:false,browser_actuation_authority:false,page_data_authority:false,authority_effect:false});
}

export function normalizeWorkspaceBindingSnapshot(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schema!=='metaengine.devos.workspace-binding-snapshot.v1'||value.state!=='AVAILABLE')return null;
  if(value.filesystem_paths_exposed!==false||value.scheduler_authority!==false||value.browser_actuation_authority!==false||value.automatic_retry_allowed!==false||value.authority_effect!==false)return null;
  const rows=Array.isArray(value.bindings)?value.bindings:[];
  if(rows.length>64)return null;
  const bindings=[];
  for(const row of rows){const checked=normalizeBinding(row);if(!checked)return null;bindings.push(checked)}
  const coordination_workspace_id=String(value.coordination_workspace_id||'').toLowerCase();
  if(!UUID_RE.test(coordination_workspace_id)||bindings.some((row)=>row.coordination_workspace_id!==coordination_workspace_id))return null;
  return Object.freeze({schema:'metaengine.browser.workspace-binding-observer.v1',state:'AVAILABLE',coordination_workspace_id,observed_at:value.observed_at||new Date().toISOString(),bindings,source:'NATIVE_SUPERVISOR_HEARTBEAT',source_implemented:true,runtime_deployed:true,filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,automatic_retry_allowed:false,second_polling_loop:false,authority_effect:false});
}
