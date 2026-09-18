import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceObservationRoutes } from '../supabase/a2-browser-native-supervisor-v1/workspace-observation-routes.mjs';

const coordination='33333333-3333-4333-8333-333333333333';
const raw=()=>({schema:'metaengine.devos.workspace-binding-snapshot.v1',state:'AVAILABLE',coordination_workspace_id:coordination,observed_at:'2026-09-02T10:00:00.000Z',filesystem_paths_exposed:false,scheduler_authority:false,browser_actuation_authority:false,automatic_retry_allowed:false,authority_effect:false,bindings:[{workspace_id:'11111111-1111-4111-8111-111111111111',workspace_generation:1,coordination_workspace_id:coordination,task_id:'22222222-2222-4222-8222-222222222222',claim_id:3,point_id:'c5',repo_id:'PatrickFrome/Compute',base_sha:'a'.repeat(40),branch_name:'work/example',agent_id:'agent_12345678',tab_id:'tab_44444444-4444-4444-8444-444444444444',target_id:'webcontents:9',agent_generation_epoch:2,lease_generation:5,lease_expires_at:'2026-09-02T12:00:00.000Z',lease_current:true,state:'READY',last_verified_head_sha:'a'.repeat(40),ambiguity_code:null,dirty_hold:false,updated_at:'2026-09-02T10:00:00.000Z',automatic_retry_allowed:false,scheduler_authority:false,browser_actuation_authority:false,page_data_authority:false,authority_effect:false}]});

test('workspace observation route is device-authenticated GET and read-only',async()=>{
  const calls=[];const route=createWorkspaceObservationRoutes({workspaceId:coordination,rpc:async(name,args)=>{calls.push({name,args});return raw()}});
  assert.equal(await route({req:{method:'GET'},path:'/v1/other',clientId:'client'}),null);
  const denied=await route({req:{method:'GET'},path:'/v1/devos/workspace-snapshot',clientId:null});
  assert.equal(denied.status,401);
  const response=await route({req:{method:'GET'},path:'/v1/devos/workspace-snapshot',clientId:'client_1'});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.state,'AVAILABLE');
  assert.equal(body.bindings.length,1);
  assert.deepEqual(calls,[{name:'h205f22_a2_workspace_binding_snapshot_v1',args:{p_coordination_workspace_id:coordination}}]);
  assert.equal(body.scheduler_authority,false);
  assert.equal(body.browser_actuation_authority,false);
});

test('missing source RPC maps to explicit runtime-not-deployed evidence',async()=>{
  const route=createWorkspaceObservationRoutes({workspaceId:coordination,rpc:async()=>{throw new Error('PGRST202 Could not find the function h205f22_a2_workspace_binding_snapshot_v1')}});
  const response=await route({req:{method:'GET'},path:'/v1/devos/workspace-snapshot',clientId:'client_1'});
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.state,'RUNTIME_NOT_DEPLOYED');
  assert.equal(body.bindings.length,0);
  assert.equal(body.automatic_retry_allowed,false);
});

test('generic DB read failure is not mislabeled as not deployed',async()=>{
  const route=createWorkspaceObservationRoutes({workspaceId:coordination,rpc:async()=>{throw new Error('connection reset')}});
  const response=await route({req:{method:'GET'},path:'/v1/devos/workspace-snapshot',clientId:'client_1'});
  const body=await response.json();
  assert.equal(response.status,503);
  assert.equal(body.state,'READ_UNAVAILABLE');
});

test('filesystem-bearing or authority-bearing readback is rejected',async()=>{
  for(const patch of [{worktree_path:'C:/secret'},{authority_effect:true},{scheduler_authority:true}]){
    const route=createWorkspaceObservationRoutes({workspaceId:coordination,rpc:async()=>{const v=raw();v.bindings[0]={...v.bindings[0],...patch};return v}});
    const response=await route({req:{method:'GET'},path:'/v1/devos/workspace-snapshot',clientId:'client_1'});
    const body=await response.json();
    assert.equal(response.status,503);
    assert.equal(body.state,'READ_UNAVAILABLE');
  }
});
