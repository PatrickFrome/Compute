import { MetaOrchestratorPrivilegedAdapter } from '../../src/meta-orchestrator-privileged-adapter.mjs';
import { reconcileContinuousMetaOrchestrator } from '../../src/meta-orchestrator-continuous-reconcile.mjs';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROADMAP_RE=/^[a-z0-9][a-z0-9._:-]{2,159}$/;
const POINT_RE=/^[a-z0-9][a-z0-9._:-]{2,191}$/;
const MAX_FRONTIER=8;

function zero(extra={}){
  return Object.freeze({
    schema:'metaengine.meta-orchestrator.heartbeat-superstep.v1',
    state:'IDLE',
    reason:null,
    leader:false,
    leader_epoch:null,
    frontier_point_count:0,
    duplicate_count:0,
    atomic_frontier:false,
    second_scheduler_loop:false,
    automatic_retry_allowed:false,
    task_content_authority:false,
    scheduler_authority:false,
    browser_authority:false,
    release_authority:false,
    authority_effect:false,
    ...extra,
  });
}

function workspace(value){const out=String(value||'').toLowerCase();if(!UUID_RE.test(out))throw new Error('meta_superstep_workspace_invalid');return out}
function roadmap(value){const out=String(value||'').trim().toLowerCase();if(!ROADMAP_RE.test(out))throw new Error('meta_superstep_roadmap_invalid');return out}
function client(value){const out=String(value||'').trim();if(out.length<3||out.length>160||/[\u0000-\u001f\u007f]/.test(out))throw new Error('meta_superstep_client_invalid');return out}
function positive(value,name){const out=Number(value);if(!Number.isSafeInteger(out)||out<1)throw new Error(`meta_superstep_${name}_invalid`);return out}
function object(value,name){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`meta_superstep_${name}_invalid`);return value}
function clip(value,max=180){return String(value||'').slice(0,max)}

function classify(error){
  const message=String(error?.message||error||'').toLowerCase();
  if(message.includes('meta_frontier_leader_fenced'))return'LEADER_FENCED';
  if(message.includes('active_plan_missing')||message.includes('plan_state'))return'ACTIVE_PLAN_UNAVAILABLE';
  if(message.includes('roadmap_authority'))return'ROADMAP_AUTHORITY_UNAVAILABLE';
  if(message.includes('meta_frontier_')||message.includes('meta_admit_'))return'FRONTIER_ADMISSION_FENCED';
  if(message.includes('devos_capacity')||message.includes('capacity'))return'CAPACITY_UNAVAILABLE';
  return'PROVIDER_NOT_READY';
}

function exactControllerLease(value,{workspaceId,roadmapId}={}){
  const row=object(value,'controller_lease');
  if(row.schema!=='metaengine.meta-orchestrator.controller-lease.v1')throw new Error('meta_superstep_controller_lease_schema_invalid');
  if(String(row.workspace_id||'').toLowerCase()!==workspaceId||String(row.roadmap_id||'').toLowerCase()!==roadmapId)throw new Error('meta_superstep_controller_lease_identity_drift');
  if(row.authority_effect!==false||row.scheduler_authority!==false||row.browser_authority!==false||row.release_authority!==false)throw new Error('meta_superstep_controller_lease_authority_invalid');
  const epoch=positive(row.leader_epoch,'leader_epoch');
  if(row.leased===true&&(row.holder_verified!==true||row.not_expired!==true))throw new Error('meta_superstep_controller_lease_readback_invalid');
  return Object.freeze({leased:row.leased===true,leader_epoch:epoch,expires_at:row.expires_at||null});
}

function exactFrontier(value,{workspaceId,roadmapId,generation,epoch,expectedPoints}={}){
  const row=object(value,'frontier');
  if(row.schema!=='metaengine.meta-orchestrator.frontier-admission.v2'||String(row.workspace_id||'').toLowerCase()!==workspaceId||String(row.roadmap_id||'').toLowerCase()!==roadmapId||Number(row.plan_generation)!==generation||Number(row.leader_epoch)!==epoch)throw new Error('meta_superstep_frontier_identity_drift');
  if(row.atomic_transaction!==true||row.all_or_none_new_admission!==true||row.leader_fenced!==false||row.task_payload_returned!==false||row.scheduler_identity_returned!==false||row.authority_effect!==false||row.scheduler_authority!==false||row.browser_authority!==false||row.release_authority!==false)throw new Error('meta_superstep_frontier_contract_invalid');
  if(!Array.isArray(row.points)||row.points.length!==expectedPoints.length||Number(row.point_count)!==expectedPoints.length)throw new Error('meta_superstep_frontier_size_drift');
  const seen=new Set();let duplicates=0;
  for(const pointRow of row.points){
    const pointId=String(pointRow?.point_id||'').toLowerCase();
    if(!POINT_RE.test(pointId)||!expectedPoints.includes(pointId)||seen.has(pointId)||!UUID_RE.test(String(pointRow?.task_id||''))||pointRow?.authority_effect!==false)throw new Error('meta_superstep_frontier_point_invalid');
    seen.add(pointId);if(pointRow.duplicate===true)duplicates+=1;
  }
  if(seen.size!==expectedPoints.length)throw new Error('meta_superstep_frontier_point_set_drift');
  return Object.freeze({duplicates});
}

export function createMetaDevosSuperstep({rpc,workspaceId,roadmapId='metaengine-development-os-v1',maxParallelProposals=8}={}){
  if(typeof rpc!=='function')throw new Error('meta_superstep_rpc_required');
  const fixedWorkspace=workspace(workspaceId);
  const fixedRoadmap=roadmap(roadmapId);
  const maxParallel=Math.max(1,Math.min(MAX_FRONTIER,Number(maxParallelProposals)||8));

  return async function run({clientId}={}){
    let fixedClient;
    try{fixedClient=client(clientId)}catch(error){return zero({state:'FENCED',reason:'CLIENT_ID_INVALID'})}

    let leader;
    try{
      leader=exactControllerLease(await rpc('meta_orchestrator_controller_lease_v1',{
        p_workspace_id:fixedWorkspace,
        p_roadmap_id:fixedRoadmap,
        p_client_id:fixedClient,
        p_seconds:12,
      }),{workspaceId:fixedWorkspace,roadmapId:fixedRoadmap});
    }catch(error){return zero({state:'PROVIDER_NOT_READY',reason:classify(error)})}

    if(!leader.leased){
      return zero({state:'FOLLOWER',reason:'CONTROLLER_LEASE_HELD',leader:false,leader_epoch:leader.leader_epoch});
    }

    try{
      const readAuthoritativeInputs=async()=>{
        const [inputs,capacity]=await Promise.all([
          rpc('meta_orchestrator_authoritative_inputs_v1',{p_workspace_id:fixedWorkspace,p_roadmap_id:fixedRoadmap}),
          rpc('devos_fleet_capacity_snapshot_v1',{p_workspace:fixedWorkspace}),
        ]);
        return {...object(inputs,'authoritative_inputs'),capacity:object(capacity,'capacity')};
      };
      const adapter=new MetaOrchestratorPrivilegedAdapter({
        readAuthoritativeInputs,
        activatePlan:async()=>{throw new Error('meta_superstep_plan_activation_disabled')},
      });
      const bundle=await adapter.readAuthoritativeBundle({workspace_id:fixedWorkspace,roadmap_id:fixedRoadmap});
      const snapshot=bundle.snapshot;
      const reconcile=reconcileContinuousMetaOrchestrator({
        plan:bundle.plan,
        observed_alignment_epoch:snapshot.observed_alignment_epoch,
        observed_plan_generation:snapshot.observed_plan_generation,
        leader:{expected_epoch:leader.leader_epoch,observed_epoch:leader.leader_epoch},
        tasks:snapshot.tasks,
        evidence:snapshot.evidence,
        capacity:snapshot.capacity,
        policy:{max_parallel_proposals:maxParallel},
      });
      const proposals=(Array.isArray(reconcile.actions)?reconcile.actions:[]).filter((row)=>row?.type==='PROPOSE_TASK');
      const pointIds=proposals.map((row)=>String(row.point_id||'').toLowerCase());
      if(pointIds.some((pointId)=>!POINT_RE.test(pointId))||new Set(pointIds).size!==pointIds.length||pointIds.length>MAX_FRONTIER)throw new Error('meta_superstep_proposal_set_invalid');

      if(!pointIds.length){
        return zero({
          state:String(reconcile.state||'OBSERVING'),
          reason:clip(reconcile.reason||'NO_FRONTIER'),
          leader:true,
          leader_epoch:leader.leader_epoch,
        });
      }

      let admitted;
      try{
        admitted=await rpc('meta_orchestrator_frontier_admit_v2',{
          p_workspace_id:fixedWorkspace,
          p_roadmap_id:fixedRoadmap,
          p_plan_generation:Number(bundle.plan.plan_generation),
          p_point_ids:pointIds,
          p_holder_client_id:fixedClient,
          p_leader_epoch:leader.leader_epoch,
        });
      }catch(error){
        return zero({
          state:classify(error)==='LEADER_FENCED'?'FENCED':'PROVIDER_NOT_READY',
          reason:classify(error),
          leader:true,
          leader_epoch:leader.leader_epoch,
        });
      }
      const verified=exactFrontier(admitted,{workspaceId:fixedWorkspace,roadmapId:fixedRoadmap,generation:Number(bundle.plan.plan_generation),epoch:leader.leader_epoch,expectedPoints:pointIds});
      return zero({
        state:'ADMITTED',
        reason:'ATOMIC_FRONTIER_CONFIRMED',
        leader:true,
        leader_epoch:leader.leader_epoch,
        frontier_point_count:pointIds.length,
        duplicate_count:verified.duplicates,
        atomic_frontier:true,
      });
    }catch(error){
      return zero({
        state:'PROVIDER_NOT_READY',
        reason:classify(error),
        leader:true,
        leader_epoch:leader.leader_epoch,
      });
    }
  };
}
