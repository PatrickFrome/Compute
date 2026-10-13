import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileMetaPlan } from '../src/meta-orchestrator-core.mjs';

// Production requires an OWNER-attested, pinned local endpoint. The old
// https://provider.test fixture was a hosted-cloud transport and rightly
// fails closed. Exercise every existing request/reconciliation test through
// an isolated LOCAL_POSTGRES Owner + /health binding instead.
// The server only serves attestation: signed Meta requests still go through
// each test's private fetchImpl and never change the user's PostgreSQL.
const saved = new Map();
for (const key of ['APPDATA', 'XDG_CONFIG_HOME', 'METAENGINE_STATE_PROVIDER',
  'METAENGINE_SUPERVISOR_BASE_URL','METAENGINE_LOCAL_STATE_INSTANCE_ID',
  'METAENGINE_LOCAL_PROVIDER_BOOT_STATE','METAENGINE_LOCAL_PROVIDER_BOOT_REASON']) {
  saved.set(key, process.env[key]);
}
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'meta-native-owner-test-'));
const instanceId = '6cb1bffa-f096-4dfc-9ae8-3e8d1c62c1b0';
const NATIVE_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';
const health = {ok:true, instance_id:instanceId, state_provider:'LOCAL_POSTGRES',
  hosted_supabase_required:false, runtime_ready:true,
  capability_health:{state:'ATTESTED',authority_effect:false}};
const server = createServer((req,res)=>{
  if(req.method!=='GET'||req.url!==NATIVE_RUNTIME_PATH+'/health'){
    res.writeHead(404);res.end();return;
  }
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(health));
});
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const LOCAL_BASE = 'http://127.0.0.1:'+server.address().port+NATIVE_RUNTIME_PATH;
const ownerDir = path.join(runtimeRoot,'@metaengine','browser-shell');
const identityFile = path.join(runtimeRoot,'local-runtime-identity.json');
await mkdir(ownerDir,{recursive:true});
await writeFile(identityFile,JSON.stringify({
  schema:'metaengine.client-state.runtime-status.v1',state:'READY',
  runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,
  automatic_cloud_fallback:false,authority_effect:false,instance_id:instanceId,
  endpoint:LOCAL_BASE,capability_health:{state:'ATTESTED',authority_effect:false}
}));
await writeFile(path.join(ownerDir,'metaengine-state-provider-v1.json'),JSON.stringify({
  schema:'metaengine.browser.local-state-provider-config.v1',
  version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',
  provider:'LOCAL_POSTGRES',base_url:LOCAL_BASE,
  runtime_identity_file:identityFile,authority_effect:false
}));
process.env.APPDATA=runtimeRoot;
process.env.XDG_CONFIG_HOME=runtimeRoot;
delete process.env.METAENGINE_STATE_PROVIDER;
delete process.env.METAENGINE_SUPERVISOR_BASE_URL;
delete process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
delete process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE;
delete process.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON;

// This import bootstraps against the real temporary owner file + loopback
// health proof, not an override of resolveNativeSupervisorBase.
const {MetaOrchestratorActivationOutcomeError,MetaOrchestratorAdmissionOutcomeError,
  MetaOrchestratorNativeProvider} = await import('../src/meta-orchestrator-native-provider.mjs');
assert.equal(process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE,'READY');
after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  await rm(runtimeRoot,{recursive:true,force:true});
  for(const [key,value] of saved){
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
});
test('local Owner fixture is confined to ephemeral loopback and forbids hosted transport',()=>{
  assert.match(LOCAL_BASE,/^http:\/\/127\.0\.0\.1:\d+\/a2-browser-native-supervisor-v1$/);
  assert.throws(()=>new MetaOrchestratorNativeProvider({
    identity:identity(),workspace_id:workspace,baseUrl:'https://provider.test',
    runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async()=>{throw Error('must_not_fetch')}
  }),/meta_native_endpoint_invalid/);
});

const workspace='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const roadmap='metaengine-development-os-v1';
const baseline='84a71aaedc49186c24a992f507ca1d3f14767181';
const taskId='98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const authority={authority_key:'METAENGINE_DEVOS',roadmap_id:roadmap,active_milestone_key:'DEVOS_IDE_V1',integration_line:'integration/metaengine-development-os-v1',baseline_sha:baseline,alignment_epoch:1,updated_at:'2026-08-31T20:00:00Z'};
const plan=compileMetaPlan({authority,plan_generation:3,nodes:[{point_id:'devos_ide_v1',role:'IMPLEMENTER',objective:'Implement the safe slice.',dependencies:[],required_capabilities:['repo.write'],risk:'HIGH',priority:80,evidence_contract:{required:['roadmap_receipt:mainline_seal'],min_verified:1}}]});
function planState(overrides={}){return{schema:'metaengine.meta-orchestrator.plan-state.v1',found:true,workspace_id:workspace,roadmap_id:roadmap,plan_generation:3,alignment_epoch:1,baseline_sha:baseline,plan_sha256:'a'.repeat(64),plan_spec:plan,state:'ACTIVE',automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false,...overrides}}
function taskRow(){return{task_id:taskId,point_id:'devos_ide_v1',role:'IMPLEMENTER',base_sha:baseline,state:'READY',lease_generation:0,updated_at:'2026-08-31T20:01:00Z',authority_effect:false,task_spec:{meta_orchestrator:{roadmap_id:roadmap,alignment_epoch:'1',plan_generation:'3',parent_plan_point:'devos_ide_v1',parent_point_id:null}}}}
function inputs(overrides={}){return{schema:'metaengine.meta-orchestrator.authoritative-inputs.v1',workspace_id:workspace,roadmap_id:roadmap,roadmap_authority:authority,plan_state:planState(),tasks:[],roadmap_receipts:[],capacity:{source:'UNSPECIFIED_FAIL_CLOSED',available_slots:0,authority_effect:false},task_meta_projection_only:true,task_payload_exposed:false,result_summary_exposed:false,scheduler_identity_exposed:false,receipt_summary_exposed:false,receipt_evidence_exposed:false,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false,...overrides}}
function identity(){const signed=[];return{signed,async ensure(){return{device_id:'11111111-1111-4111-8111-111111111111'}},async deviceHeaders(method,path,body){signed.push({method,path,body});return{'x-test-signature':'ok'}}}}
function json(status,value){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})}

test('read path is one signed bounded Meta request with no caller workspace in body',async()=>{const id=identity();const calls=[];const provider=new MetaOrchestratorNativeProvider({identity:id,workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url,init)=>{calls.push({url,init});return json(200,inputs())}});const value=await provider.readAuthoritativeInputs({workspace_id:workspace,roadmap_id:roadmap});assert.equal(value.roadmap_id,roadmap);assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].init.body),{roadmap_id:roadmap});assert.equal(provider.snapshot().second_polling_loop,false)});

test('privileged adapter consumes one atomic provider bundle, not five independent reads',async()=>{let reads=0;const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url)=>{if(url.endsWith('/authoritative-inputs')){reads++;return json(200,inputs())}throw new Error('unexpected_request')}});const bundle=await provider.privilegedAdapter().readAuthoritativeBundle({workspace_id:workspace,roadmap_id:roadmap});assert.equal(reads,1);assert.equal(bundle.scheduler_authority,false)});

test('task admission sends only roadmap generation and point',async()=>{const calls=[];const id=identity();const provider=new MetaOrchestratorNativeProvider({identity:id,workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url,init)=>{calls.push({url,init});return json(200,{schema:'metaengine.meta-orchestrator.task-admission.v1',workspace_id:workspace,roadmap_id:roadmap,plan_generation:3,point_id:'devos_ide_v1',task_id:taskId,task_payload_returned:false,scheduler_identity_returned:false,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,authority_effect:false})}});const out=await provider.admitTask({roadmap_id:roadmap,plan_generation:3,point_id:'devos_ide_v1'});assert.equal(out.task_id,taskId);assert.deepEqual(JSON.parse(calls[0].init.body),{roadmap_id:roadmap,plan_generation:3,point_id:'devos_ide_v1'});assert.equal(calls[0].init.body.includes('objective'),false);assert.equal(calls[0].init.body.includes('role'),false)});

test('ambiguous task admission reconciles by authoritative readback and never repeats POST',async()=>{const calls=[];const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/admit-task'))throw new Error('connection_lost_after_commit');if(url.endsWith('/authoritative-inputs'))return json(200,inputs({tasks:[taskRow()]}));throw new Error('unexpected_request')}});const out=await provider.admitTask({roadmap_id:roadmap,plan_generation:3,point_id:'devos_ide_v1'});assert.equal(out.task_id,taskId);assert.deepEqual(calls,[`${LOCAL_BASE}/v1/meta/admit-task`,`${LOCAL_BASE}/v1/meta/authoritative-inputs`]);assert.equal(provider.snapshot().last_admission.state,'EFFECT_CONFIRMED')});

test('admission readback proving absence permits caller-controlled retry but performs no hidden retry',async()=>{const calls=[];const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/admit-task'))throw new Error('connection_lost');if(url.endsWith('/authoritative-inputs'))return json(200,inputs());throw new Error('unexpected_request')}});await assert.rejects(()=>provider.admitTask({roadmap_id:roadmap,plan_generation:3,point_id:'devos_ide_v1'}),(e)=>e instanceof MetaOrchestratorAdmissionOutcomeError&&e.effect_state==='EFFECT_ABSENT'&&e.automatic_retry_allowed===true);assert.deepEqual(calls,[`${LOCAL_BASE}/v1/meta/admit-task`,`${LOCAL_BASE}/v1/meta/authoritative-inputs`])});

test('409 admission fence is definitive with no readback replay',async()=>{let calls=0;const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async()=>{calls++;return json(409,{error:'meta_task_admission_fenced'})}});await assert.rejects(()=>provider.admitTask({roadmap_id:roadmap,plan_generation:3,point_id:'devos_ide_v1'}),(e)=>e.effect_state==='FENCED'&&e.automatic_retry_allowed===false);assert.equal(calls,1)});

test('ambiguous activation is reconciled by readback and never retried when effect is present',async()=>{const calls=[];const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/activate-plan'))throw new Error('connection_lost_after_send');if(url.endsWith('/authoritative-inputs'))return json(200,inputs());throw new Error('unexpected_request')}});const result=await provider.activatePlan({p_workspace_id:workspace,p_roadmap_id:roadmap,p_expected_current_generation:2,p_plan:plan});assert.equal(result.plan_generation,3);assert.deepEqual(calls,[`${LOCAL_BASE}/v1/meta/activate-plan`,`${LOCAL_BASE}/v1/meta/authoritative-inputs`]);assert.equal(provider.snapshot().last_activation.state,'EFFECT_CONFIRMED')});

test('readback proving activation effect absent marks retryable but performs no hidden retry',async()=>{const calls=[];const prior=compileMetaPlan({authority,plan_generation:2,nodes:plan.nodes});const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/activate-plan'))throw new Error('connection_lost_before_result');if(url.endsWith('/authoritative-inputs'))return json(200,inputs({plan_state:planState({plan_generation:2,plan_spec:prior})}));throw new Error('unexpected_request')}});await assert.rejects(()=>provider.activatePlan({p_workspace_id:workspace,p_roadmap_id:roadmap,p_expected_current_generation:2,p_plan:plan}),(error)=>error instanceof MetaOrchestratorActivationOutcomeError&&error.effect_state==='EFFECT_ABSENT'&&error.automatic_retry_allowed===true);assert.equal(calls.length,2)});

test('workspace and zero-authority fences fail before network',async()=>{let calls=0;const provider=new MetaOrchestratorNativeProvider({identity:identity(),workspace_id:workspace,baseUrl:LOCAL_BASE,runtimePath:NATIVE_RUNTIME_PATH,fetchImpl:async()=>{calls++;return json(500,{})}});await assert.rejects(()=>provider.readAuthoritativeInputs({workspace_id:'11111111-1111-4111-8111-111111111111',roadmap_id:roadmap}),/workspace_drift/);await assert.rejects(()=>provider.activatePlan({p_workspace_id:workspace,p_roadmap_id:roadmap,p_expected_current_generation:2,p_plan:{...plan,scheduler_authority:true}}),/zero_authority/);assert.equal(calls,0)});
