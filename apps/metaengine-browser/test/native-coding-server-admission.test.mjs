import test from 'node:test';
import assert from 'node:assert/strict';
import {admitNativeCodingProvider,admitNativeCodingExecution} from '../supabase/a2-browser-native-supervisor-v1/native-coding-admission.mjs';
import {createDevosSupervisorRoutes} from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';
import {admissionFixture,digest} from './fixtures/native-coding-admission-fixture.mjs';
const args=f=>({context:f.context(),identity:f.identity,workspaceId:f.workspaceId,clientId:f.clientId,now:f.now});
test('same enrolled key and protected exact registration admit typed native provider',async()=>{
  const f=admissionFixture();const row=await admitNativeCodingProvider(f.provider,args(f));
  assert.equal(row.target_id,f.binding.target_id);assert.equal(row.tab_id,f.binding.tab_id);assert.equal(row.physical_slot_budget,2);
});
for(const [name,mutate] of [
  ['missing authenticated identity',(f,a)=>{a.identity=null;}],
  ['different device',(f,a)=>{a.identity={...f.identity,device_id:'00000000-1111-4111-8111-111111111111'};}],
  ['revoked admin epoch',(f,a)=>{a.identity={...f.identity,admin_grant_epoch:2};}],
  ['wrong own-PG cluster',(f,a)=>{a.context.postgres_system_identifier='123';}],
  ['missing protected registration',(f,a)=>{a.context.registration=null;}],
  ['unregistered envelope',(f,a)=>{f.provider.payload.owner_epoch=2;}],
  ['bad signature despite registered hash',(f,a)=>{f.provider.signature='A'.repeat(86);a.context.registration.envelope_sha256=digest(f.provider);}],
  ['expired descriptor',(f,a)=>{f.provider=f.envelope({...f.provider.payload,expires_at:f.iso(-1)});a.context.registration.envelope_sha256=digest(f.provider);}],
  ['foreign worktree',(f,a)=>{f.provider=f.envelope({...f.provider.payload,worktree:{...f.permit.worktree,path:'C:\\outside'}});a.context.registration.envelope_sha256=digest(f.provider);}],
])test('native provider rejects '+name,async()=>{const f=admissionFixture(),a=args(f);mutate(f,a);await assert.rejects(admitNativeCodingProvider(f.provider,a),/native_coding_admission_/);});
test('cycle adds native candidates to the same existing W30 lease RPC',async()=>{
  const f=admissionFixture(),calls=[];const rpc=async(name,input)=>{
    calls.push([name,input]);if(name==='native_coding_admission_context_v1')return f.context();
    if(name==='devos_fleet_snapshot_v1')return{active_tasks:[{task_id:f.binding.task_id,state:'READY',role:'IMPLEMENTER'}],active_claims:[]};
    if(name==='devos_fleet_lease_v1')return{leased:true,...f.binding};return{};
  };
  const response=await createDevosSupervisorRoutes({rpc,workspaceId:f.workspaceId})({req:{method:'POST'},path:'/v1/devos/cycle',clientId:f.clientId,identity:f.identity,
    body:{fleet:{agents:[]},native_coding:{schema:'metaengine.native-coding.providers.v1',providers:[f.provider]}}});
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.leases.length,1);
  assert.equal(calls.filter(([name])=>name==='devos_fleet_lease_v1').length,1);assert.equal(result.second_scheduler_loop,false);
});
test('invalid native provider cannot reach leasing or reconcile effects',async()=>{
  const f=admissionFixture(),calls=[];const rpc=async name=>{calls.push(name);return f.context();};
  const response=await createDevosSupervisorRoutes({rpc,workspaceId:f.workspaceId})({req:{method:'POST'},path:'/v1/devos/cycle',clientId:f.clientId,identity:f.identity,
    body:{native_coding:{schema:'metaengine.native-coding.providers.v1',providers:[{...f.provider,signature:'A'.repeat(86)}]}}});
  assert.equal(response.status,409);assert.deepEqual(calls,['native_coding_admission_context_v1']);
});
test('registered job and protected receipt bind native mark-running and result-only completion',async()=>{
  const f=admissionFixture(),rpc=async()=>f.executionContext();
  const mark={...f.binding,native_coding:{schema:'metaengine.native-coding.mark-running.v1',job_proof:f.job}};
  assert.equal((await admitNativeCodingExecution(mark,{...args(f),rpc})).proof.job_proof_sha256,digest(f.job));
  const complete={...f.binding,state:'RESULT_READY',native_coding:{schema:'metaengine.native-coding.complete.v1',receipt:f.receipt}};
  const result=await admitNativeCodingExecution(complete,{...args(f),rpc,complete:true});
  assert.equal(result.summary.receipt_sha256,digest(f.receipt));assert.equal(result.summary.useful_work_verified,false);
  await assert.rejects(admitNativeCodingExecution({...complete,state:'COMPLETED'},{...args(f),rpc,complete:true}),/result_not_registered/);
  await assert.rejects(admitNativeCodingExecution({...complete,native_coding:{...complete.native_coding,receipt:{...f.receipt,git_after:{...f.receipt.git_after,artifact_sha256:'0'.repeat(64)}}}},{...args(f),rpc,complete:true}),/result_not_registered/);
});
test('native typed routes call existing mutators with server-derived summary',async()=>{
  const f=admissionFixture(),calls=[];const rpc=async(name,input)=>{calls.push([name,input]);return name==='native_coding_execution_context_v1'?f.executionContext():{task_id:f.binding.task_id,state:'RESULT_READY'};};
  const route=createDevosSupervisorRoutes({rpc,workspaceId:f.workspaceId});
  const response=await route({req:{method:'POST'},path:'/v1/devos/complete',clientId:f.clientId,identity:f.identity,body:{...f.binding,state:'RESULT_READY',summary:{useful_work_verified:true},native_coding:{schema:'metaengine.native-coding.complete.v1',receipt:f.receipt}}});
  assert.equal(response.status,200);const mutate=calls.find(([name])=>name==='devos_fleet_complete_v1');
  assert.equal((await response.json()).native_coding_ack.result_sha256,f.receipt.result_sha256);
  assert.equal(mutate[1].p_state,'RESULT_READY');assert.equal(mutate[1].p_summary.useful_work_verified,false);
});

test('cycle returns retained LEASED native binding for the existing first-dispatch tick, without allocating again',async()=>{
 const f=admissionFixture(),calls=[];
 const row={task_id:f.binding.task_id,state:'LEASED',role:'IMPLEMENTER',base_sha:'a'.repeat(40),
  lease_generation:f.binding.lease_generation,lease_agent_id:f.binding.agent_id,lease_tab_id:f.binding.tab_id,
  lease_target_id:f.binding.target_id,lease_agent_generation_epoch:f.binding.agent_generation_epoch};
 const rpc=async(name,input)=>{calls.push([name,input]);if(name==='native_coding_admission_context_v1')return f.context();
  if(name==='devos_fleet_snapshot_v1')return {active_tasks:[row,{...row,task_id:'11111111-1111-4111-8111-111111111111',lease_target_id:'webcontents:10'},
   {...row,task_id:'22222222-2222-4222-8222-222222222222',lease_agent_id:'agent_foreign'}],active_claims:[]};
  if(name==='devos_fleet_lease_v1')assert.fail('no READY task should allocate');return {};};
 const response=await createDevosSupervisorRoutes({rpc,workspaceId:f.workspaceId})({req:{method:'POST'},path:'/v1/devos/cycle',clientId:f.clientId,identity:f.identity,
  body:{fleet:{agents:[]},native_coding:{schema:'metaengine.native-coding.providers.v1',providers:[f.provider]}}});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.running.length,1);assert.deepEqual(result.leases,[]);
 for(const key of ['task_id','lease_generation','agent_id','tab_id','target_id','agent_generation_epoch'])assert.equal(result.running[0][key],f.binding[key]);
 assert.equal(calls.some(([name])=>name==='devos_fleet_lease_v1'),false);
});
