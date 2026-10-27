import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture,id,hash } from './fixtures/browser-parent-suspension-fixture.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { AutonomousProjectTaskRuntime } from '../src/autonomous-project-task-runtime.mjs';
import { createAutonomousProjectJournal } from '../src/autonomous-project-journal.mjs';
import { browserParentTelemetryFleet } from '../src/browser-parent-suspension-telemetry.mjs';
const flags={authority_effect:false,automatic_retry_allowed:false};
// Composite executable regression: real cycle/runtime/SQLite/fleet/transport;
// the signed database and Electron observers are deterministic test adapters.
// SQL trigger equivalence is tested separately against the full PGlite stack.
test('existing cycle suspends parent and child with one slot, then exact completion and restored receipts unwind without Send replay',async t=>{
 const h=await fixture(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'parent-cycle-'));
 const project=id(90),tasks=new Map(),receipts=new Map();let claims=10,runtime,journal,census=[];
 const control={authoritative:true,state:'OPEN',continuous_service_allowed:true,generation_floor:1};
 const enrich=(l,parent=null)=>({...l,parent_task_id:parent,root_task_id:h.lease.task_id,claim_id:++claims,claim_class:'READ_ONLY',role:h.fleet().snapshot().agents.find(a=>a.agent_id===l.agent_id).role,
  base_sha:'a'.repeat(40),task_spec:{objective:'Read-only coordination regression',project_continuity:{project_id:project}},state:'RUNNING',active_claim_count:1,active_workspace_binding_count:0,...flags});
 const parent=enrich(h.lease);tasks.set(parent.task_id,parent);
 const children=l=>[...tasks.values()].filter(row=>row.parent_task_id===l.task_id);
 const projectRequest=async({path:route,body:b})=>{
  if(route.endsWith('/snapshot')){const task=tasks.get(b.task_id);return {schema:'metaengine.devos.project-snapshot.v1',found:!!task,project_id:project,root_task_id:parent.task_id,
   selected_task:task,tasks:[...tasks.values()],immediate_children:children(task),proposals:[],policy:{},...flags};}
  if(route.endsWith('/reconcile'))return {schema:'metaengine.devos.project-reconcile.v1',project_id:b.project_id,projects:[],bounded_projects:4,...flags};
  if(route.endsWith('/activity'))return {schema:'metaengine.devos.project-activity.v1',project_id:project,...flags};
  if(route.endsWith('/release-browser-child'))return {...b,schema:'metaengine.devos.browser-child-retirement.v1',retired:true,retirement_id:id(99),claim_class:'READ_ONLY',state:tasks.get(b.task_id).state,...flags};
  if(route.endsWith('/suspend-browser')){const task=tasks.get(b.task_id);assert.equal(task.state,'RUNNING');task.state='SUSPENDED';task.active_claim_count=0;
   const r={schema:'metaengine.devos.browser-parent-suspension.v1',seq:receipts.size+1,suspension_id:b.suspension_id,project_id:project,task_id:b.task_id,
    old_claim_id:b.claim_id,old_lease_generation:b.lease_generation,checkpoint:b.checkpoint,checkpoint_sha256:hash(JSON.stringify(b.checkpoint)),status:'SUSPENDED',state:'WAITING_CHILDREN',lease:null,...flags};receipts.set(b.task_id,r);return r;}
  if(route.endsWith('/suspension-read'))return receipts.get(b.task_id)||{found:false,...flags};
  if(route.endsWith('/suspension-list')){const entries=[...receipts.values()].filter(r=>tasks.get(r.task_id).state!=='COMPLETED').map(r=>({...r,state:r.status==='RESUMED'?'RESUMED':children(tasks.get(r.task_id)).every(c=>c.state==='COMPLETED')?'READY_TO_RESUME':'WAITING_CHILDREN'}));return {schema:'metaengine.devos.browser-parent-suspension-list.v1',entries,cursor:{next_seq:0,has_more:false},...flags};}
  if(route.endsWith('/resume-browser')){const r=[...receipts.values()].find(r=>r.suspension_id===b.suspension_id),rest=b.restoration;
   const observed=census.find(a=>a.agent_id===rest.agent_id);if(observed?.lifecycle_state!=='ACTIVE'||observed.browser_parent_restoration?.suspension_id!==r.suspension_id)throw Error('admission_not_yet_published');
   const task=tasks.get(r.task_id);Object.assign(task,{state:'RUNNING',claim_id:++claims,lease_generation:task.lease_generation+1,tab_id:rest.tab_id,target_id:rest.target_id,
    agent_generation_epoch:rest.agent_generation_epoch,active_claim_count:1,conversation_url_sha256:r.checkpoint.conversation_url_sha256});
   Object.assign(r,{status:'RESUMED',state:'RESUMED',lease:{...task}});return r;}
  assert.fail(route);
 };
 const open=()=>{journal=createAutonomousProjectJournal({filePath:path.join(dir,'journal.sqlite')});runtime=new AutonomousProjectTaskRuntime({journal,request:projectRequest,browserParentTransport:h.transport,readRuntimeControl:()=>control,materializeProject:async()=>({state:'NOT_REQUIRED'})});};open();
 t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
 const state=()=>({fleet:h.fleet().snapshot(),active_tab:{tab_id:'user'},tabs:[]});
 let sends=0;
 const cycle=new DevOsNativeTaskCycle({getState:async()=>state(),executeCommand:async c=>{
  if(c.action==='FLEET_RECONCILE')return h.fleet().snapshot();if(c.action==='CAPTURE')return {...await h.capture(c.payload.tab_id),tab_id:c.payload.tab_id};
  if(c.action==='READ_TRANSCRIPT')return {text:'',total_chars:0,has_more:false,census_truncated:false};if(['TYPED_CLICK','SEMANTIC_TYPE'].includes(c.action)){sends++;assert.fail('never replay acknowledged parent Send');}assert.fail(c.action);
 },signedRequest:async(route,{payload}={})=>{
  if(route==='/v1/devos/cycle'){census=browserParentTelemetryFleet(state().fleet).agents;const running=[...tasks.values()].filter(t=>t.state==='RUNNING').map(t=>({...t,conversation_url_sha256:h.fleet().snapshot().agents.find(a=>a.agent_id===t.agent_id).transport_proof.conversation_url_sha256}));return Response.json({schema:'metaengine.devos.browser-cycle.v1',backlog:{ready:0,running:running.length},running,leases:[],...flags});}
  if(route==='/v1/devos/complete'){const task=tasks.get(payload.task_id);Object.assign(task,{state:payload.state,active_claim_count:0});return Response.json({task_id:task.task_id,lease_generation:task.lease_generation,state:task.state,...flags});}assert.fail(route);
 }});cycle.bindProjectRuntime(runtime);
 const confirmed=async l=>{h.setTranscript(h.tabs.get(l.tab_id).url,'');await journal.begin(`turn:${l.task_id}:${l.lease_generation}:ack`,{project_id:project,task_id:l.task_id,agent_id:l.agent_id,lease_generation:l.lease_generation,transcript_floor:0,delivery_history_complete:true,delivered_tool_results:[]});await journal.confirm(`turn:${l.task_id}:${l.lease_generation}:ack`,{transcript_floor:0});};
 tasks.set(id(20),{task_id:id(20),parent_task_id:parent.task_id,state:'READY',role:parent.role});await confirmed(parent);await cycle.runOnce();assert.equal(tasks.get(parent.task_id).state,'SUSPENDED');assert.equal(h.tabs.size,0);
 const child=enrich(await h.spawn(id(20)),parent.task_id);tasks.set(child.task_id,child);tasks.set(id(30),{task_id:id(30),parent_task_id:child.task_id,state:'READY',role:child.role});await confirmed(child);await cycle.runOnce();assert.equal(child.state,'SUSPENDED');assert.equal(h.tabs.size,0);
 // Real SQLite restart before any restored generation; old parent prompts remain acknowledged.
 await runtime.close();open();cycle.bindProjectRuntime(runtime);
 const leaf=enrich(await h.spawn(id(30)),child.task_id);tasks.set(leaf.task_id,leaf);await runtime.refreshContext(leaf);
 await cycle.completeFromTrustedCommand({...leaf,state:'COMPLETED',summary:{verified_test_fixture:true}});assert.equal(h.tabs.size,0);
 await runtime.tick();assert.equal(h.fleet().snapshot().counts.RESUMING,1);census=browserParentTelemetryFleet(state().fleet).agents;
 await runtime.tick();const restoredChild=tasks.get(child.task_id);assert.equal(restoredChild.lease_generation,2);assert.equal(h.tabs.size,1);
 await runtime.refreshContext(restoredChild);await cycle.completeFromTrustedCommand({...restoredChild,state:'COMPLETED',summary:{verified_test_fixture:true}});assert.equal(h.tabs.size,0);
 await runtime.tick();census=browserParentTelemetryFleet(state().fleet).agents;await runtime.tick();
 assert.equal(tasks.get(parent.task_id).state,'RUNNING');assert.equal(tasks.get(parent.task_id).lease_generation,2);assert.equal(h.tabs.size,1);assert.equal(sends,0);
 assert.equal((await runtime.latestTurnForLease(tasks.get(parent.task_id))).state,'CONFIRMED');
});
