import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaOrchestratorAdmissionOutcomeError, MetaOrchestratorNativeProvider } from '../src/meta-orchestrator-native-provider.mjs';

const workspace='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const roadmap='metaengine-development-os-v1';
const points=['devos_ide_v1','devos_ide_v1.critic'];
const tasks=['98903ffd-dc3f-4a3e-ab09-55931c5100a9','94a52edc-8edd-4f5f-b8f3-3c81695748bd'];
const identity={async ensure(){return{device_id:'11111111-1111-4111-8111-111111111111'}},async deviceHeaders(){return{'x-test':'ok'}}};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function task(point_id,task_id){return{task_id,point_id,task_spec:{meta_orchestrator:{plan_generation:'3'}},authority_effect:false}}
function inputs(taskRows=[]){return{schema:'metaengine.meta-orchestrator.authoritative-inputs.v1',workspace_id:workspace,roadmap_id:roadmap,plan_state:{found:true,state:'ACTIVE',plan_generation:3},tasks:taskRows,roadmap_receipts:[],capacity:{source:'UNSPECIFIED_FAIL_CLOSED',available_slots:0,authority_effect:false},task_meta_projection_only:true,task_payload_exposed:false,result_summary_exposed:false,scheduler_identity_exposed:false,receipt_summary_exposed:false,receipt_evidence_exposed:false,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false}}
function frontier(){return{schema:'metaengine.meta-orchestrator.frontier-admission.v1',workspace_id:workspace,roadmap_id:roadmap,plan_generation:3,point_count:2,points:points.map((point_id,i)=>({point_id,task_id:tasks[i],duplicate:false,authority_effect:false})),atomic_transaction:true,all_or_none_new_admission:true,task_payload_returned:false,scheduler_identity_returned:false,second_scheduler_loop:false,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false}}

test('confirmed frontier is one effect request with bounded transport',async()=>{
  const calls=[];
  const provider=new MetaOrchestratorNativeProvider({identity,workspace_id:workspace,baseUrl:'https://provider.test',runtimePath:'/native',fetchImpl:async(url,init)=>{calls.push({url,init});return json(200,frontier())},effectDeadlineMs:1500});
  const out=await provider.admitFrontier({roadmap_id:roadmap,plan_generation:3,point_ids:points});
  assert.equal(out.atomic_transaction,true);
  assert.equal(calls.length,1);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(provider.snapshot().last_frontier.state,'EFFECT_CONFIRMED');
});

test('lost frontier response with all tasks visible reconciles present and never repeats POST',async()=>{
  const calls=[];
  const provider=new MetaOrchestratorNativeProvider({identity,workspace_id:workspace,baseUrl:'https://provider.test',runtimePath:'/native',fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/admit-frontier'))throw new Error('connection_lost_after_commit');if(url.endsWith('/authoritative-inputs'))return json(200,inputs(points.map((p,i)=>task(p,tasks[i]))));throw new Error('unexpected')}});
  const out=await provider.admitFrontier({roadmap_id:roadmap,plan_generation:3,point_ids:points});
  assert.equal(out.reconciled,true);
  assert.deepEqual(calls,['https://provider.test/v1/meta/admit-frontier','https://provider.test/v1/meta/authoritative-inputs']);
  assert.equal(provider.snapshot().last_frontier.state,'EFFECT_CONFIRMED');
});

test('zero tasks after lost response proves absence but provider performs no hidden retry',async()=>{
  const calls=[];
  const provider=new MetaOrchestratorNativeProvider({identity,workspace_id:workspace,baseUrl:'https://provider.test',runtimePath:'/native',fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/admit-frontier'))throw new Error('connection_lost');if(url.endsWith('/authoritative-inputs'))return json(200,inputs());throw new Error('unexpected')}});
  await assert.rejects(()=>provider.admitFrontier({roadmap_id:roadmap,plan_generation:3,point_ids:points}),e=>e instanceof MetaOrchestratorAdmissionOutcomeError&&e.effect_state==='EFFECT_ABSENT'&&e.automatic_retry_allowed===true);
  assert.equal(calls.length,2);
});

test('partial readback is first-class ambiguous corruption signal and never fills missing point',async()=>{
  const calls=[];
  const provider=new MetaOrchestratorNativeProvider({identity,workspace_id:workspace,baseUrl:'https://provider.test',runtimePath:'/native',fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/admit-frontier'))throw new Error('connection_lost');if(url.endsWith('/authoritative-inputs'))return json(200,inputs([task(points[0],tasks[0])]));throw new Error('unexpected')}});
  await assert.rejects(()=>provider.admitFrontier({roadmap_id:roadmap,plan_generation:3,point_ids:points}),e=>e instanceof MetaOrchestratorAdmissionOutcomeError&&e.effect_state==='AMBIGUOUS'&&e.automatic_retry_allowed===false);
  assert.deepEqual(calls,['https://provider.test/v1/meta/admit-frontier','https://provider.test/v1/meta/authoritative-inputs']);
  assert.equal(provider.snapshot().last_frontier.state,'AMBIGUOUS_PARTIAL_READBACK');
});
