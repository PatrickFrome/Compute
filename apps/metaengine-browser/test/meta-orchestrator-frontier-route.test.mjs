import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/meta-routes.mjs';

const workspaceId='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const roadmapId='metaengine-development-os-v1';
const pointIds=['devos_ide_v1','devos_ide_v1.critic'];
const taskIds=['98903ffd-dc3f-4a3e-ab09-55931c5100a9','94a52edc-8edd-4f5f-b8f3-3c81695748bd'];
const request={method:'POST'};
async function body(response){return JSON.parse(await response.text())}

function frontier(){return{
  schema:'metaengine.meta-orchestrator.frontier-admission.v1',
  workspace_id:workspaceId,
  roadmap_id:roadmapId,
  plan_generation:3,
  point_count:2,
  points:pointIds.map((point_id,i)=>({point_id,task_id:taskIds[i],duplicate:false,task_spec_sha256:'a'.repeat(64),authority_effect:false})),
  atomic_transaction:true,
  all_or_none_new_admission:true,
  task_payload_returned:false,
  scheduler_identity_returned:false,
  second_scheduler_loop:false,
  automatic_retry_allowed:false,
  task_content_authority:false,
  scheduler_authority:false,
  browser_authority:false,
  release_authority:false,
  authority_effect:false,
}}

test('frontier route passes only roadmap generation and semantic point ids to one DB RPC',async()=>{
  const calls=[];
  const routes=createMetaSupervisorRoutes({workspaceId,rpc:async(name,args)=>{calls.push({name,args});return frontier()}});
  const response=await routes({req:request,path:'/v1/meta/admit-frontier',body:{roadmap_id:roadmapId,plan_generation:3,point_ids:pointIds},clientId:'device'});
  const out=await body(response);
  assert.equal(response.status,200);
  assert.deepEqual(calls,[{name:'meta_orchestrator_frontier_admit_v1',args:{p_workspace_id:workspaceId,p_roadmap_id:roadmapId,p_plan_generation:3,p_point_ids:pointIds}}]);
  assert.equal(out.atomic_transaction,true);
  assert.equal(out.all_or_none_new_admission,true);
  assert.equal(out.scheduler_identity_returned,false);
});

test('frontier route rejects duplicates, oversized groups, and privileged overrides before RPC',async()=>{
  let calls=0;
  const routes=createMetaSupervisorRoutes({workspaceId,rpc:async()=>{calls++;return frontier()}});
  for(const payload of [
    {roadmap_id:roadmapId,plan_generation:3,point_ids:['devos_ide_v1','devos_ide_v1']},
    {roadmap_id:roadmapId,plan_generation:3,point_ids:Array.from({length:9},(_,i)=>`devos_${i+1}`)},
    {roadmap_id:roadmapId,plan_generation:3,point_ids:pointIds,agent_id:'agent_forbidden'},
  ]){
    const response=await routes({req:request,path:'/v1/meta/admit-frontier',body:payload,clientId:'device'});
    assert.equal(response.status,400);
  }
  assert.equal(calls,0);
});

test('frontier route maps stale canonical task admission to one definitive fence with no retry',async()=>{
  let calls=0;
  const routes=createMetaSupervisorRoutes({workspaceId,rpc:async()=>{calls++;throw new Error('meta_admit_active_plan_missing')}});
  const response=await routes({req:request,path:'/v1/meta/admit-frontier',body:{roadmap_id:roadmapId,plan_generation:3,point_ids:pointIds},clientId:'device'});
  assert.equal(response.status,409);
  assert.equal(calls,1);
  assert.equal((await body(response)).automatic_retry_allowed,false);
});
