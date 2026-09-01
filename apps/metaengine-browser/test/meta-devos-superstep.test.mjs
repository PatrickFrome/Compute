import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileMetaPlan } from '../src/meta-orchestrator-core.mjs';
import { createMetaDevosSuperstep } from '../supabase/a2-browser-native-supervisor-v1/meta-devos-superstep.mjs';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const roadmapId='metaengine-development-os-v1';
const clientId='native:test/browser-1';
const baseline='84a71aaedc49186c24a992f507ca1d3f14767181';
const authority={authority_key:'METAENGINE_DEVOS',roadmap_id:roadmapId,active_milestone_key:'META_ORCHESTRATOR_V1',integration_line:'work/browser-continuous-fleet-audit-v1',baseline_sha:baseline,alignment_epoch:4,updated_at:'2026-09-01T07:55:00Z'};
const plan=compileMetaPlan({authority,plan_generation:5,nodes:[{point_id:'meta.critical',role:'IMPLEMENTER',objective:'Implement the continuous fleet hardening slice.',dependencies:[],required_capabilities:['capability.repo_write'],risk:'CRITICAL',priority:90,evidence_contract:{required:['ci_green'],min_verified:1}}]});

function planState(){return{schema:'metaengine.meta-orchestrator.plan-state.v1',found:true,workspace_id:workspaceId,roadmap_id:roadmapId,plan_generation:5,alignment_epoch:4,baseline_sha:baseline,plan_sha256:'a'.repeat(64),plan_spec:plan,state:'ACTIVE',automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false}}
function inputs({tasks=[]}={}){return{schema:'metaengine.meta-orchestrator.authoritative-inputs.v1',workspace_id:workspaceId,roadmap_id:roadmapId,roadmap_authority:authority,plan_state:planState(),tasks,roadmap_receipts:[],task_meta_projection_only:true,task_payload_exposed:false,result_summary_exposed:false,scheduler_identity_exposed:false,receipt_summary_exposed:false,receipt_evidence_exposed:false,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false}}
function capacity(slots,overrides={}){return{schema:'metaengine.devos.scheduler-capacity.v1',workspace_id:workspaceId,state:'FRESH',source:'DEVOS_SCHEDULER_SNAPSHOT',available_slots:slots,new_frontier_slots:slots,live_transport_slots:Math.max(slots,1),by_role:{IMPLEMENTER:slots},observed_at:'2026-09-01T07:55:00Z',ready_backlog:0,leased_backlog:0,running_backlog:0,result_ready_backlog:0,ambiguous_backlog:0,blocked_backlog:0,active_claims:0,ready_backlog_limit:8,ambiguity_pressure_limit:8,pressure_state:'NORMAL',freshness_horizon_seconds:45,transport_admission:'ACTIVE_EXACT_PROOF_V1',scheduler_source:'NATIVE_SUPERVISOR_HEARTBEAT',scheduler_policy:'IDLE_ROLE_FAIR_SHARE_V1',pressure_policy:'RECOVERY_AWARE_FRONTIER_V1',automatic_retry_allowed:false,authority_effect:false,...overrides}}
function leader(overrides={}){return{schema:'metaengine.meta-orchestrator.controller-lease.v1',workspace_id:workspaceId,roadmap_id:roadmapId,leased:true,leader_epoch:9,holder_verified:true,not_expired:true,expires_at:'2026-09-01T08:00:00Z',transitions:1,lease_seconds:12,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false,...overrides}}
function frontier(pointIds){return{schema:'metaengine.meta-orchestrator.frontier-admission.v2',workspace_id:workspaceId,roadmap_id:roadmapId,plan_generation:5,leader_epoch:9,leader_fenced:false,controller_lease_expires_at:'2026-09-01T08:00:00Z',point_count:pointIds.length,points:pointIds.map((point_id,index)=>({point_id,task_id:`00000000-0000-4000-8000-00000000000${index+1}`,duplicate:false,task_spec_sha256:'b'.repeat(64),authority_effect:false})),atomic_transaction:true,all_or_none_new_admission:true,task_payload_returned:false,scheduler_identity_returned:false,second_scheduler_loop:false,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false}}

function runner({slots=3,capacityRow=null,leaderRow=leader(),frontierError=null,inputsError=null,inputRow=null}={}){
  const calls=[];
  const rpc=async(name,args)=>{
    calls.push({name,args});
    if(name==='meta_orchestrator_controller_lease_v1')return leaderRow;
    if(name==='meta_orchestrator_authoritative_inputs_v1'){
      if(inputsError)throw inputsError;
      return inputRow||inputs();
    }
    if(name==='devos_fleet_capacity_snapshot_v1')return capacityRow||capacity(slots);
    if(name==='meta_orchestrator_frontier_admit_v2'){
      if(frontierError)throw frontierError;
      return frontier(args.p_point_ids);
    }
    throw new Error(`unexpected_rpc:${name}`);
  };
  return{calls,run:createMetaDevosSuperstep({rpc,workspaceId,roadmapId})};
}

test('follower performs only controller lease read and no plan/frontier work',async()=>{
  const {calls,run}=runner({leaderRow:leader({leased:false,holder_verified:false})});
  const result=await run({clientId});
  assert.equal(result.state,'FOLLOWER');
  assert.equal(result.leader,false);
  assert.deepEqual(calls.map((row)=>row.name),['meta_orchestrator_controller_lease_v1']);
});

test('leader with insufficient capacity never materializes a partial critical group',async()=>{
  const {calls,run}=runner({slots:1});
  const result=await run({clientId});
  assert.equal(result.state,'CAPACITY_WAIT');
  assert.equal(result.frontier_point_count,0);
  assert.equal(calls.some((row)=>row.name==='meta_orchestrator_frontier_admit_v2'),false);
});

test('leader materializes one complete critical frontier in one RPC',async()=>{
  const {calls,run}=runner({slots:3});
  const result=await run({clientId});
  assert.equal(result.state,'ADMITTED');
  assert.equal(result.atomic_frontier,true);
  assert.equal(result.frontier_point_count,3);
  assert.equal(result.pressure_state,'NORMAL');
  assert.equal(result.new_frontier_slots,3);
  const writes=calls.filter((row)=>row.name==='meta_orchestrator_frontier_admit_v2');
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].args.p_point_ids,['meta.critical','meta.critical.critic','meta.critical.falsifier']);
  assert.equal(writes[0].args.p_holder_client_id,clientId);
  assert.equal(writes[0].args.p_leader_epoch,9);
});

test('recovery debt soft budget prevents partial critical growth even with physical capacity',async()=>{
  const capacityRow=capacity(3,{new_frontier_slots:1,ambiguous_backlog:8,pressure_state:'RECOVERY_DEBT_HIGH'});
  const {calls,run}=runner({capacityRow});
  const result=await run({clientId});
  assert.equal(result.state,'CAPACITY_WAIT');
  assert.equal(result.reason,'NEW_FRONTIER_PRESSURE_BUDGET_REQUIRED');
  assert.equal(result.available_slots,3);
  assert.equal(result.new_frontier_slots,1);
  assert.equal(calls.some((row)=>row.name==='meta_orchestrator_frontier_admit_v2'),false);
});

test('ready saturation blocks new frontier without pretending physical capacity disappeared',async()=>{
  const capacityRow=capacity(3,{new_frontier_slots:0,ready_backlog:8,pressure_state:'READY_SATURATED'});
  const {calls,run}=runner({capacityRow});
  const result=await run({clientId});
  assert.equal(result.state,'CAPACITY_WAIT');
  assert.equal(result.available_slots,3);
  assert.equal(result.new_frontier_slots,0);
  assert.equal(result.pressure_state,'READY_SATURATED');
  assert.equal(calls.some((row)=>row.name==='meta_orchestrator_frontier_admit_v2'),false);
});

test('leader fence during atomic frontier never retries admission',async()=>{
  const {calls,run}=runner({slots:3,frontierError:new Error('meta_frontier_leader_fenced')});
  const result=await run({clientId});
  assert.equal(result.state,'FENCED');
  assert.equal(result.automatic_retry_allowed,false);
  assert.equal(calls.filter((row)=>row.name==='meta_orchestrator_frontier_admit_v2').length,1);
});

test('authoritative provider failure is fail-soft and never attempts frontier',async()=>{
  const {calls,run}=runner({inputsError:new Error('meta_privileged_active_plan_missing')});
  const result=await run({clientId});
  assert.equal(result.state,'PROVIDER_NOT_READY');
  assert.equal(result.leader,true);
  assert.equal(calls.some((row)=>row.name==='meta_orchestrator_frontier_admit_v2'),false);
});

test('devos cycle continues when meta provider is unavailable',async()=>{
  const calls=[];
  const rpc=async(name,args)=>{
    calls.push({name,args});
    if(name==='meta_orchestrator_controller_lease_v1')throw new Error('rpc_missing_branch_local_migration');
    if(name==='devos_fleet_reconcile_v1')return{schema:'metaengine.devos.reconcile.v1',requeued:0,failed:0,authority_effect:false};
    if(name==='devos_fleet_snapshot_v1')return{active_tasks:[],active_claims:[],recent_events:[],authority_effect:false};
    throw new Error(`unexpected_rpc:${name}`);
  };
  const routes=createDevosSupervisorRoutes({rpc,workspaceId});
  const response=await routes({req:{method:'POST'},path:'/v1/devos/cycle',body:{fleet:{agents:[]}},clientId});
  const body=JSON.parse(await response.text());
  assert.equal(response.status,200);
  assert.equal(body.meta_orchestrator.state,'PROVIDER_NOT_READY');
  assert.equal(body.second_scheduler_loop,false);
  assert.equal(calls.some((row)=>row.name==='devos_fleet_reconcile_v1'),true);
  assert.equal(calls.some((row)=>row.name==='devos_fleet_snapshot_v1'),true);
});

test('continuous wiring adds no timer and keeps meta before the existing scheduler reconcile',async()=>{
  const route=await readFile(new URL('../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs',import.meta.url),'utf8');
  const superstep=await readFile(new URL('../supabase/a2-browser-native-supervisor-v1/meta-devos-superstep.mjs',import.meta.url),'utf8');
  for(const source of [route,superstep]){
    assert.equal(source.includes('setInterval'),false);
    assert.equal(source.includes('setTimeout'),false);
  }
  const metaAt=route.indexOf('await metaSuperstep({clientId})');
  const reconcileAt=route.indexOf("rpc('devos_fleet_reconcile_v1'");
  const leaseAt=route.indexOf("rpc('devos_fleet_lease_v1'");
  assert.ok(metaAt>=0&&reconcileAt>metaAt&&leaseAt>reconcileAt);
});

test('leader migrations are RLS fenced, epoch-bound, write-coalesced, and never allocate DevOS leases',async()=>{
  const leaderSql=await readFile(new URL('../../../supabase/migrations/20260901034000_meta_orchestrator_controller_lease_v1.sql',import.meta.url),'utf8');
  const frontierSql=await readFile(new URL('../../../supabase/migrations/20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql',import.meta.url),'utf8');
  assert.match(leaderSql,/enable row level security/i);
  assert.match(leaderSql,/leader_epoch=v_row\.leader_epoch \+ 1/);
  assert.match(leaderSql,/pg_advisory_xact_lock/);
  assert.match(leaderSql,/v_remaining > \(v_seconds::double precision \/ 2\.0\)/);
  assert.match(frontierSql,/for update/i);
  assert.match(frontierSql,/v_lease\.leader_epoch <> p_leader_epoch/);
  assert.match(frontierSql,/interval '2 seconds'/);
  assert.match(frontierSql,/meta_orchestrator_frontier_admit_v1/);
  for(const sql of [leaderSql,frontierSql]){
    assert.equal(sql.includes('devos_fleet_lease_v1'),false);
    assert.equal(sql.includes('devos_fleet_mark_running_v1'),false);
    assert.equal(sql.includes('h205f22_a2_browser_supervisor_lease'),false);
  }
});
