const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE=/^[a-f0-9]{40}$/;
const ROLE_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
const POINT_RE=/^[a-z0-9][a-z0-9._:-]{2,191}$/;
const FORBIDDEN_TASK_KEYS=new Set(['agent_id','tab_id','target_id','lease_generation','lease_agent_id','lease_tab_id','lease_target_id','agent_generation_epoch','lease_agent_generation_epoch','lease_expires_at','claim_id']);

function scan(value,path='$'){
  if(Array.isArray(value)){value.forEach((item,index)=>scan(item,`${path}[${index}]`));return;}
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_TASK_KEYS.has(key))throw new Error(`meta_adapter_scheduler_field_forbidden:${path}.${key}`);
    scan(child,`${path}.${key}`);
  }
}
function bounded(value,max,name){const out=String(value??'').trim();if(!out||out.length>max)throw new Error(`meta_adapter_${name}_invalid`);return out;}
function int(value,name,min,max){const out=Number(value);if(!Number.isSafeInteger(out)||out<min||out>max)throw new Error(`meta_adapter_${name}_invalid`);return out;}
function keyPart(value){return String(value??'').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g,'-').slice(0,120);}

export function metaTaskProposalToDevosEnqueue(action,{workspace_id}={}){
  if(!action||typeof action!=='object'||Array.isArray(action)||action.schema!=='metaengine.meta-orchestrator.action.v1'||action.type!=='PROPOSE_TASK')throw new Error('meta_adapter_action_invalid');
  if(action.authority_effect!==false||action.scheduler_authority!==false||action.browser_authority!==false)throw new Error('meta_adapter_authority_invalid');
  scan(action);
  const workspace=String(workspace_id||'').toLowerCase();if(!UUID_RE.test(workspace))throw new Error('meta_adapter_workspace_id_invalid');
  const point=bounded(action.point_id,192,'point_id').toLowerCase();if(!POINT_RE.test(point))throw new Error('meta_adapter_point_id_invalid');
  const role=bounded(action.role,64,'role').toUpperCase();if(!ROLE_RE.test(role))throw new Error('meta_adapter_role_invalid');
  const base=bounded(action.base_sha,40,'base_sha').toLowerCase();if(!SHA40_RE.test(base))throw new Error('meta_adapter_base_sha_invalid');
  const priority=int(action.priority??50,'priority',-100000,100000);
  const taskSpec={
    schema:'metaengine.devos.meta-task-spec.v1',
    objective:bounded(action.objective,12000,'objective'),
    constraints:Array.isArray(action.constraints)?action.constraints.map(v=>String(v).slice(0,1000)).slice(0,32):[],
    deliverable:String(action.deliverable||'').slice(0,4000),
    source_branch:String(action.source_branch||'').slice(0,240),
    target_branch:String(action.target_branch||'').slice(0,240),
    required_capabilities:Array.isArray(action.required_capabilities)?[...new Set(action.required_capabilities.map(v=>String(v).toLowerCase()))].sort().slice(0,64):[],
    evidence_contract:action.evidence_contract||{required:[],min_verified:0},
    meta_orchestrator:{
      roadmap_id:bounded(action.roadmap_id,160,'roadmap_id'),
      alignment_epoch:int(action.alignment_epoch,'alignment_epoch',1,Number.MAX_SAFE_INTEGER),
      plan_generation:int(action.plan_generation,'plan_generation',1,Number.MAX_SAFE_INTEGER),
      parent_plan_point:bounded(action.parent_plan_point,128,'parent_plan_point'),
      parent_point_id:action.parent_point_id==null?null:String(action.parent_point_id).slice(0,192),
    },
    automatic_retry_allowed:false,
    page_data_authority:false,
    model_output_authority:false,
    authority_effect:false,
  };
  scan(taskSpec);
  const idempotency=`meta:${keyPart(action.roadmap_id)}:${action.alignment_epoch}:${action.plan_generation}:${keyPart(point)}`;
  return Object.freeze({
    schema:'metaengine.meta-orchestrator.devos-enqueue-proposal.v1',
    rpc:'devos_fleet_enqueue_v1',
    args:Object.freeze({
      p_workspace:workspace,
      p_point:point,
      p_role:role,
      p_base:base,
      p_spec:Object.freeze(taskSpec),
      p_key:idempotency,
      p_branch:action.target_branch?String(action.target_branch).slice(0,240):null,
      p_priority:priority,
    }),
    scheduler_admission_required:true,
    automatic_retry_allowed:false,
    task_content_authority:false,
    scheduler_authority:false,
    browser_authority:false,
    release_authority:false,
    authority_effect:false,
  });
}

export function buildMetaCapacityProposal({reconcile_result,autonomy_target}={}){
  if(!reconcile_result||typeof reconcile_result!=='object'||reconcile_result.authority_effect!==false)throw new Error('meta_adapter_reconcile_invalid');
  if(!autonomy_target||typeof autonomy_target!=='object'||autonomy_target.authority_effect!==false)throw new Error('meta_adapter_autonomy_target_invalid');
  const requested=(reconcile_result.actions||[]).find(row=>row?.type==='REQUEST_CAPACITY');
  const target=Number(autonomy_target.target_agents);
  if(!Number.isSafeInteger(target)||target<0)throw new Error('meta_adapter_target_invalid');
  return Object.freeze({
    schema:'metaengine.meta-orchestrator.capacity-proposal.v1',
    requested_slots:requested?Number(requested.required_slots)||0:0,
    target_agents:target,
    execute_via_existing_fleet_reconcile:true,
    second_scheduler_loop:false,
    scheduler_authority:false,
    browser_authority:false,
    authority_effect:false,
  });
}
