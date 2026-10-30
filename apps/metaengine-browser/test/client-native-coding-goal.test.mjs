import {createNativeCodingCapacityOwner} from '../src/native-coding-capacity-owner.mjs';
import {createNativeHostScopeCleanup,drainNativeHostScopeCleanups,nativeHostScopeCleanupHeld,nativeHostScopeCleanupHold} from '../src/native-host-scope-cleanup.mjs';
import {drainManagedRuntimeWorkers} from '../src/managed-runtime-drain.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ClientGoalJournal} from '../src/client-goal-journal.mjs';
import {createClientNativeCodingGoalRouter,normalizeNativeCodingSeedResult,normalizeNativeCodingGoalProgress,readClientGoalSubmissionMode} from '../src/client-native-coding-goal.mjs';
import {drainManagedRuntimeBindings} from '../src/managed-runtime-drain.mjs';
import {NativeCodingHostIpcError} from '../src/native-coding-host-ipc-client.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
  const input={request_id:randomUUID(),objective:'Implement a useful project increment'};
  const receipt={schema:'metaengine.native-coding.goal-admission.v1',state:'ADMITTED',...input,profile_id:randomUUID(),
    profile_sha256:'1'.repeat(64),workspace_id:randomUUID(),project_id:randomUUID(),root_task_id:randomUUID(),goal_id:randomUUID(),
    goal_sha256:'2'.repeat(64),task_spec_sha256:'3'.repeat(64),permit_ids:[randomUUID(),randomUUID()],
    logical_policy:{max_depth:100,max_tasks:10000,max_children:16},physical_execution_proven:false,global_actuation_granted:false,
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  const body=JSON.stringify(input),canonical=JSON.stringify(receipt);
  const result={state:'ADMITTED',admission:{schema:'metaengine.native-coding.seed-readback.v1',profile_id:receipt.profile_id,
    request_id:input.request_id,body:input,canonical_body_text:body,body_sha256:hash(body),receipt,
    canonical_receipt:canonical,receipt_sha256:hash(canonical),readback_only:true,physical_effect_replayed:false,authority_effect:false},
    production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
  const task={task_id:receipt.root_task_id,parent_task_id:null,depth:0,state:'RUNNING',role:'IMPLEMENTER'};
  const snapshot={schema:'metaengine.devos.project-snapshot.v1',found:true,project_id:receipt.project_id,root_task_id:receipt.root_task_id,
    request_id:input.request_id,state:'ACTIVE',goal:input.objective,last_seq:5,total_tasks:1,tasks:[task],selected_task:task,
    immediate_children:[],task_cursor:{after_seq:0,next_seq:1,has_more:false},authority_effect:false};
  let durable=null,writes=0;
  const storage={loadState:async()=>structuredClone(durable),saveState:async v=>{durable=structuredClone(v);writes++;}};
  const journal=new ClientGoalJournal(storage);
  return {input,receipt,result,snapshot,journal,storage,getDurable:()=>structuredClone(durable),getWrites:()=>writes};
}

function rejectionResult(input,profile_id=randomUUID()){
 return {state:'REJECTED_BEFORE_DISPATCH',admission:null,rejection:{schema:'metaengine.native-coding.seed-rejection.v1',state:'REJECTED_BEFORE_DISPATCH',
  ...input,profile_id,profile_sha256:'a'.repeat(64),body_sha256:hash(JSON.stringify({objective:input.objective,request_id:input.request_id})),
  admission_absent:true,semantic_fence_absent:true,automatic_retry_allowed:false,authority_effect:false},
  production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
}
test('confirmed pre-dispatch rejection survives restart and never replays the old request',async()=>{
 const f=fixture(),calls=[],request=async(op,input)=>{calls.push(op);return rejectionResult(input,f.receipt.profile_id);};
 const router=createClientNativeCodingGoalRouter({journal:f.journal,request,projectSnapshot:async()=>{throw Error('NO_PROJECT');},onAdmitted:async()=>{throw Error('NO_EXECUTION');}});
 await assert.rejects(router.submit({request_id:f.input.request_id,goal:f.input.objective}), /rejected_before_dispatch:/);
 assert.equal(f.journal.latest().state,'FAILED');assert.equal(f.journal.latest().receipt,null);assert.deepEqual(calls,['SEED_GOAL']);
 const restored=new ClientGoalJournal(f.storage);await restored.load();assert.equal(restored.latest().native_rejection.admission_absent,true);
 await restored.markReconcileRequired(f.input.request_id,'late transport failure');assert.equal(restored.latest().state,'FAILED');
 await assert.rejects(restored.recordNativeAdmission(f.receipt),/rejection_conflict/);
 const next=createClientNativeCodingGoalRouter({journal:restored,request,projectSnapshot:async()=>f.snapshot});
 await assert.rejects(next.submit({request_id:f.input.request_id,goal:f.input.objective}),/already_recorded/);assert.equal(calls.length,1);
 // A new explicit user request is possible; refresh never causes it.
 await next.refresh(restored.latest());assert.deepEqual(calls,['SEED_GOAL']);
 const offline=createClientNativeCodingGoalRouter({journal:restored,request:async()=>{throw Error('HOST_REPLACED');},projectSnapshot:async()=>{throw Error('NO_PROJECT');}});
 assert.equal((await offline.refresh(restored.latest())).state,'FAILED');
 assert.equal(restored.latest().project_error,null);
 await assert.rejects(next.submit({request_id:randomUUID(),goal:'A new explicit request after the fix'}));
 assert.deepEqual(calls,['SEED_GOAL','SEED_GOAL']);assert.equal(restored.snapshot().entries.length,2);
});
test('rejection requires matching objective, durable request and affirmative absence observations',()=>{
 const f=fixture(),valid=rejectionResult(f.input);assert.equal(normalizeNativeCodingSeedResult(valid,f.input).state,'REJECTED_BEFORE_DISPATCH');
 for(const mutate of [r=>r.rejection.objective+='different',r=>r.rejection.request_id=randomUUID(),r=>r.rejection.admission_absent=false,
  r=>r.rejection.semantic_fence_absent=false,r=>r.rejection.body_sha256='f'.repeat(64),r=>r.admission=f.result.admission,
  r=>r.automatic_retry_allowed=true,r=>r.rejection.authority_effect=true]){
   const r=structuredClone(valid);mutate(r);assert.throws(()=>normalizeNativeCodingSeedResult(r,f.input),/client_native_goal_/);
 }
});
test('native admission uses its own schema, exact canonical body and complete receipt digest',()=>{
  const f=fixture();const out=normalizeNativeCodingSeedResult(f.result,f.input);
  assert.equal(out.schema,'metaengine.native-coding.goal-admission.v1');assert.equal(out.physical_execution_proven,false);
  for(const mutate of [r=>r.admission.body.objective+='different',r=>r.admission.receipt.logical_policy.max_children++,
    r=>r.admission.receipt.project_id=randomUUID(),r=>r.admission.receipt_sha256='f'.repeat(64),r=>r.admission.physical_effect_replayed=true,
    r=>r.authority_effect=true,r=>r.extra='untyped']){
    const value=structuredClone(f.result);mutate(value);assert.throws(()=>normalizeNativeCodingSeedResult(value,f.input),/client_native_goal_/);
  }
});

test('native journal admission survives restart, keeps real project/root binding and rejects legacy substitution',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'NATIVE_CODING'});
  await f.journal.recordNativeAdmission(f.receipt);
  const restored=new ClientGoalJournal(f.storage);await restored.load();
  assert.equal(restored.latest().kind,'NATIVE_CODING');assert.equal(restored.latest().project.schema,'metaengine.client.native-coding-project.v1');
  assert.equal(restored.latest().project.root_task_id,f.receipt.root_task_id);assert.equal(restored.latest().admitted_task_id,f.receipt.root_task_id);
  await assert.rejects(()=>restored.recordSubmission({schema:'metaengine.client.goal-submission.v1',request_id:f.input.request_id,exact_request_correlation:true}),/kind_mismatch/);
  await assert.rejects(()=>restored.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'BROWSER'}),/request_collision/);
  const forged=f.getDurable();forged.entries[0].receipt.root_task_id=randomUUID();
  await assert.rejects(()=>new ClientGoalJournal({...f.storage,loadState:async()=>forged}).load(),/native_project_drift/);
});

test('old kindless goal journal remains browser data, never a native admission',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective});
  const saved=f.getDurable();delete saved.entries[0].kind;
  const old=new ClientGoalJournal({...f.storage,loadState:async()=>saved});await old.load();assert.equal(old.latest().kind,'BROWSER');
  await assert.rejects(()=>old.recordNativeAdmission(f.receipt),/native_request_missing/);
});

test('one native effect starts only after durable request and reads actual projectSnapshot progress',async()=>{
  const f=fixture(),calls=[];let mounted=0;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async(op,input)=>{
    assert.equal(f.getDurable().entries[0].state,'SUBMITTING');calls.push({op,input});return f.result;},
    projectSnapshot:async input=>{assert.deepEqual(input,{project_id:f.receipt.project_id,task_after_seq:0,limit:1});return f.snapshot;},onAdmitted:async()=>{mounted++;}});
  const receipt=await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.equal(receipt.project_id,f.receipt.project_id);assert.deepEqual(calls.map(c=>c.op),['SEED_GOAL']);assert.equal(mounted,1);
  assert.equal(f.journal.latest().progress.schema,'metaengine.client.native-coding-goal-progress.v1');assert.equal(f.journal.latest().state,'RUNNING');
  assert.equal(f.journal.latest().progress.physical_execution_proven,false);assert.equal(f.journal.latest().execution_proof,null);
});

test('committed admission with unbounded logical policy mounts and survives journal reload',async()=>{
  const f=fixture();let mounted=0;
  f.receipt.logical_policy={max_depth:null,max_tasks:null,max_children:null};
  f.result.admission.receipt=structuredClone(f.receipt);
  f.result.admission.canonical_receipt=JSON.stringify(f.receipt);
  f.result.admission.receipt_sha256=hash(f.result.admission.canonical_receipt);
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>f.result,
    projectSnapshot:async()=>f.snapshot,onAdmitted:async()=>{mounted++;}});
  const receipt=await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.deepEqual(receipt.logical_policy,{max_depth:null,max_tasks:null,max_children:null});
  assert.equal(mounted,1);assert.equal(f.journal.latest().state,'RUNNING');
  const restored=new ClientGoalJournal(f.storage);await restored.load();
  assert.deepEqual(restored.latest().receipt.logical_policy,receipt.logical_policy);
  for(const value of [-1,0,1.5,Infinity,'unlimited',undefined]){
    const bad=structuredClone(f.result);bad.admission.receipt.logical_policy.max_tasks=value;
    bad.admission.canonical_receipt=JSON.stringify(bad.admission.receipt);
    bad.admission.receipt_sha256=hash(bad.admission.canonical_receipt);
    assert.throws(()=>normalizeNativeCodingSeedResult(bad,f.input),/client_native_goal_/);
  }
});

test('unknown seed effect stays durably fenced across router instances and refresh never replays it',async()=>{
  const f=fixture(),calls=[];const request=async(op)=>{calls.push(op);if(op==='SEED_GOAL')throw Error('lost reply');return {...f.result,state:'READBACK_ONLY',admission:null};};
  const build=journal=>createClientNativeCodingGoalRouter({journal,request,projectSnapshot:async()=>f.snapshot});
  await assert.rejects(()=>build(f.journal).submit({request_id:f.input.request_id,goal:f.input.objective}),/submit_requires_reconciliation/);
  assert.equal(f.journal.latest().state,'RECONCILE_REQUIRED');
  const restarted=new ClientGoalJournal(f.storage);await restarted.load();
  await build(restarted).refresh(restarted.latest());
  await assert.rejects(()=>build(restarted).submit({request_id:randomUUID(),goal:'another task'}),/previous_request_requires_readback/);
  assert.deepEqual(calls,['SEED_GOAL','READ_SEED','READ_SEED']);assert.equal(restarted.latest().automatic_retry_allowed,false);
});

test('lost acknowledgement reconciles committed admission by READ_SEED and still mounts runtime once',async()=>{
  const f=fixture(),calls=[];let mounts=0,checks=0,mounted=false;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async op=>{calls.push(op);if(op==='SEED_GOAL')throw Error('timeout');return {...f.result,state:'READBACK_ONLY'};},
    projectSnapshot:async()=>f.snapshot,onAdmitted:async()=>{checks++;if(!mounted){mounts++;mounted=true;}}});
  await assert.rejects(()=>router.submit({request_id:f.input.request_id,goal:f.input.objective}),/submit_requires_reconciliation/);
  assert.equal(f.journal.latest().receipt.root_task_id,f.receipt.root_task_id);assert.equal(f.journal.latest().state,'RUNNING');
  await router.refresh(f.journal.latest());assert.equal(mounts,1);assert.equal(checks,2);assert.deepEqual(calls,['SEED_GOAL','READ_SEED','READ_SEED']);
});

test('runtime mount or project observation failure preserves committed admission, without execution claim',async()=>{
  const f=fixture();const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>f.result,
    projectSnapshot:async()=>{throw Error('not mounted');},onAdmitted:async()=>{throw Error('mount blocked');}});
  await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.equal(f.journal.latest().state,'ADMITTED');assert.equal(f.journal.latest().progress,null);assert.equal(f.journal.latest().receipt.physical_execution_proven,false);
  assert.equal(f.journal.latest().project_error,'Native project observation unavailable');
});

test('a transient native mount failure is retried by verified READ_SEED without another seed',async()=>{
  const f=fixture(),calls=[];let attempts=0,mounted=false;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async op=>{calls.push(op);return f.result;},
    projectSnapshot:async()=>f.snapshot,onAdmitted:async()=>{attempts++;if(attempts===1)throw Error('transient mount');mounted=true;}});
  await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.equal(mounted,false);assert.equal(f.journal.latest().receipt.root_task_id,f.receipt.root_task_id);
  await router.refresh(f.journal.latest());
  assert.equal(mounted,true);assert.equal(attempts,2);assert.deepEqual(calls,['SEED_GOAL','READ_SEED']);
  assert.equal(f.journal.latest().receipt.project_id,f.receipt.project_id);assert.equal(f.journal.latest().automatic_retry_allowed,false);
});

test('a restored admitted journal still ensures the actual native mount using readonly seed recovery',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'NATIVE_CODING'});
  await f.journal.recordNativeAdmission(f.receipt);
  const restored=new ClientGoalJournal(f.storage);await restored.load();const calls=[];let mounts=0;
  const router=createClientNativeCodingGoalRouter({journal:restored,request:async op=>{calls.push(op);return f.result;},
    projectSnapshot:async()=>f.snapshot,onAdmitted:async()=>{mounts++;}});
  await router.refresh(restored.latest());assert.equal(mounts,1);assert.deepEqual(calls,['READ_SEED']);
  assert.equal(restored.latest().receipt.root_task_id,f.receipt.root_task_id);
});

test('concurrent readonly refreshes sharing a journal join one mount attempt and a later refresh rechecks it',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'NATIVE_CODING'});
  await f.journal.recordNativeAdmission(f.receipt);
  let release,entered;const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let attempts=0;const calls=[];
  const options={journal:f.journal,request:async op=>{calls.push(op);return f.result;},projectSnapshot:async()=>f.snapshot,
    onAdmitted:async()=>{attempts++;entered();await waiting;}};
  const a=createClientNativeCodingGoalRouter(options).refresh(f.journal.latest());
  const observed=await Promise.race([started.then(()=>true),a.then(()=>false)]);
  assert.equal(observed,true,'an existing receipt must not skip mount verification');
  const b=createClientNativeCodingGoalRouter(options).refresh(f.journal.latest());
  await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,1);
  release();await Promise.all([a,b]);await createClientNativeCodingGoalRouter(options).refresh(f.journal.latest());
  assert.equal(attempts,2);assert.deepEqual(calls,['READ_SEED','READ_SEED','READ_SEED']);
});

async function mainMountFixture(){
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  let start=main.indexOf('function assertNativeCodingRuntimeMountOpen(');
  if(start<0)start=main.indexOf('function createNativeGoalRouter(');
  const source=main.slice(start,main.indexOf('async function readNativeGoalSubmissionMode('));
  const summary={state:'READY',instance_id:randomUUID(),pid:42,status_file:'C:/private/runtime/status.json'};
  const generation={schema:'metaengine.browser.runtime-host-generation.v1',instance_id:summary.instance_id,host_pid:42,
    launch_nonce:randomUUID(),ever_ready:true,stopping:false,exited:false,transport_failed:false,terminal_rejected:false,terminal:null};
  const counts={init:0,construct:0,capability:0,capabilityClosed:0,runtimeClosed:0,bind:0};
  let capClosed=false,scopeWait=null,bound=null,failScope=false;
  const runtimeState={schema:'metaengine.native-coding.runtime.v1',closed:false,shutdown_state:'OPEN',host_unavailable_reason:null};
  const runtime={snapshot:()=>({...runtimeState}),close:async()=>{counts.runtimeClosed++;runtimeState.closed=true;runtimeState.shutdown_state='DRAINED';runtimeState.worker_cleanup_confirmed=true;return {...runtimeState};}};
  const capability={drainPhysical:async()=>({schema:'metaengine.native-coding.physical-drain.v1',cleanup_confirmed:true}),snapshot:()=>({instance_id:summary.instance_id,host_pid:42,closed:capClosed}),
    readScope:async()=>{if(scopeWait)await scopeWait;if(failScope){failScope=false;throw Error('transient scope read');}
      return {bindings:[{device_id:'device',client_id:'client',permit:{artifact:{cli_executable_sha256:'a'.repeat(64)}}}]};},
    close:()=>{counts.capabilityClosed++;capClosed=true;}};
  const scope={nativeCodingCapacityOwner:createNativeCodingCapacityOwner(),nativeCodingRuntime:null,nativeCodingHostCapability:null,nativeCodingRuntimeMountPromise:null,nativeCodingRuntimeMountCustody:null,nativeSupervisorMountWaits:new Set(),nativeCodingRuntimeMountGeneration:null,nativeCodingRuntimeMountFailure:null,nativeCodingRuntimeMountDiagnostic:null,
    runtimeRecoveryGenerationLost:false,shutdownRequested:false,managedTaskProjectHostDrainPending:false,
    managedTaskProjectHostClosing:Promise.resolve(),nativeRuntimeInitializations:new Set(),nativeInitializationCleanupCandidates:new Set(),
    nativeSupervisor:{bindNativeCodingRuntime:value=>{counts.bind++;bound=value;},bindDevosProjectRuntime:()=>{},stop:()=>{},snapshot:()=>({})},autonomousProjectRuntime:null,
    managedTaskProjectHost:null,supervisorLoopbackRpc:null,drainManagedRuntimeBindings,drainManagedRuntimeWorkers,createNativeHostScopeCleanup,drainNativeHostScopeCleanups,nativeHostScopeCleanupHeld,nativeHostScopeCleanupHold,managedTaskProjectHostDrainHeld:false,nativeHostQuitShutdownPromise:null,pendingOwnerInitializationsByBarrier:new Map(),nativeSetupRouteInitializationsByBarrier:new Map(),nativeDraftScopeInitializationsByBarrier:new Map(),
    readOwnedLocalRuntimeHostSummary:()=>summary,readOwnedLocalRuntimeHostRecoveryObservation:async()=>({...generation}),
    createOwnedNativeCodingHostCapability:()=>{counts.capability++;capClosed=false;return capability;},
    ensureSupervisorIdentity:()=>({snapshot:()=>({device_id:'device',client_id:'client'})}),
    prepareNativeWorkspaceFromStage:async()=>null,
    readNativeCodingOperatorPaths:async()=>({}),resolveNativeCodingSandboxPin:()=>({}),
    createNativeCodingRuntime:options=>{assert.equal(options.capacityOwner,scope.nativeCodingCapacityOwner);counts.construct++;return runtime;},
    readAgentResourceAdmission:()=>({physical_start_allowed:true}),
    fs:{lstat:async()=>({isFile:()=>true})},path:{dirname:()=> 'C:/private/runtime',join:(...parts)=>parts.join('/')},
    app:{},process:{resourcesPath:'C:/fixture/resources'},globalThis:{},
    initNativeSupervisor:async()=>{counts.init++;},recordStartupSubsystemDegraded:()=>{},
    createClientNativeCodingGoalRouter:options=>options,Error,Promise,Set};
  const closeSource=main.slice(main.indexOf('function closeManagedTaskProjectHost()'),main.indexOf('async function startInstalledRuntimeRecovery()'));
  const cleanupSource=main.slice(main.indexOf('async function cleanupNativeInitializationCandidate('),main.indexOf('function githubChatState()'));
  const context=vm.createContext(scope);vm.runInContext(source+cleanupSource+closeSource,context);
  return {scope,context,summary,generation,runtimeState,counts,runtime,capability,get bound(){return bound;},failScopeOnce:()=>{failScope=true;},
    deferScope(){let release;scopeWait=new Promise(resolve=>{release=resolve;});return release;},
    onAdmitted:()=>context.createNativeGoalRouter({}).onAdmitted(),close:()=>context.closeManagedTaskProjectHost(),
    beforeQuit(){
      let handler;scope.app.on=(name,callback)=>{if(name==='before-quit')handler=callback;};scope.app.quit=()=>{counts.quit=(counts.quit||0)+1;};
      Object.assign(scope,{runtimeRecoveryPlannedQuit:false,runtimeRecoveryGateEpoch:0,runtimeRecoveryController:null,githubChatRelay:null,
        startupRetryTimer:null,managedTaskProjectQuitReady:false,managedTaskProjectQuitPending:false,supervisorLoopbackRpc:null,
        clearTimeout:()=>{},console:{error:()=>{}}});
      const start=main.indexOf("app.on('before-quit'");vm.runInContext(main.slice(start,main.indexOf('\n});',start)+4),context);
      return handler;
    }};
}

for(const state of ['absent','closed','unbound'])test(`actual main callback cannot accept a resolved initializer with ${state} native runtime`,async()=>{
  const f=await mainMountFixture();
  if(state==='absent')f.scope.readOwnedLocalRuntimeHostSummary=()=>null;
  else{f.scope.nativeCodingRuntime=f.runtime;if(state==='closed')f.runtimeState.closed=true;else f.runtimeState.shutdown_state='OPEN';}
  await assert.rejects(()=>f.onAdmitted(),/native_coding_.*(?:mount|runtime|host)|fresh_browser_required/);
  assert.equal(f.counts.init,0,'the goal callback must not rerun whole Supervisor/RPC initialization');
  assert.equal(f.counts.construct,0);
});

test('startup and readonly remount use the same pending narrow mount and verify its open binding on every observation',async()=>{
  const f=await mainMountFixture(),release=f.deferScope();
  assert.equal(typeof f.context.ensureNativeCodingRuntimeMounted,'function');
  const startup=f.context.ensureNativeCodingRuntimeMounted();
  assert.equal(f.scope.nativeRuntimeInitializations.size,1,'drain must see pending mount before its first await');
  const a=f.onAdmitted(),b=f.onAdmitted();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.capability,1);
  release();await Promise.all([startup,a,b]);
  assert.equal(f.counts.construct,1);assert.equal(f.counts.bind,1);assert.equal(f.counts.init,0);
  assert.equal(f.scope.nativeCodingRuntime,f.runtime);assert.equal(f.scope.nativeCodingHostCapability,f.capability);
  assert.equal(f.scope.nativeRuntimeInitializations.size,0);await f.onAdmitted();assert.equal(f.counts.construct,1);
  f.runtimeState.closed=true;f.runtimeState.shutdown_state='DRAINING';
  await assert.rejects(()=>f.onAdmitted(),/native_coding_.*(?:mount|runtime|host)|fresh_browser_required/);
  assert.equal(f.counts.construct,1,'an unconfirmed closed runtime must not be replaced');
});

for(const fence of ['generation','shutdown','installer','drain','completed-drain','summary','nonce'])test(`actual narrow mount refuses ${fence} change during scope read without publishing candidates`,async()=>{
  const f=await mainMountFixture(),release=f.deferScope();assert.equal(typeof f.context.ensureNativeCodingRuntimeMounted,'function');
  const pending=f.context.ensureNativeCodingRuntimeMounted();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.capability,1);
  if(fence==='generation')f.scope.runtimeRecoveryGenerationLost=true;
  if(fence==='shutdown')f.scope.shutdownRequested=true;
  if(fence==='installer')f.scope.globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__=true;
  if(fence==='drain')f.scope.managedTaskProjectHostDrainPending=true;
  if(fence==='completed-drain'){
    f.scope.managedTaskProjectHostDrainPending=true;f.scope.managedTaskProjectHostClosing=Promise.resolve();
    f.scope.managedTaskProjectHostDrainPending=false;
  }
  if(fence==='summary')f.scope.readOwnedLocalRuntimeHostSummary=()=>({...f.summary,pid:43});
  if(fence==='nonce')f.generation.launch_nonce=randomUUID();
  release();await assert.rejects(pending,/native_coding_.*(?:mount|runtime|host)|fresh_browser_required/);
  assert.equal(f.counts.construct,0);assert.equal(f.counts.bind,0);assert.equal(f.counts.capabilityClosed,1);
  assert.equal(f.scope.nativeCodingRuntime,null);assert.equal(f.scope.nativeCodingHostCapability,null);
  assert.equal(f.scope.nativeRuntimeInitializations.size,0);
});

test('a binding failure closes local candidates and never leaves a published sticky runtime',async()=>{
  const f=await mainMountFixture();f.scope.nativeSupervisor.bindNativeCodingRuntime=()=>{throw Error('fixture binding failure');};
  await assert.rejects(()=>f.onAdmitted(),/fixture binding failure/);
  assert.equal(f.counts.construct,1);assert.equal(f.counts.runtimeClosed,1);assert.equal(f.counts.capabilityClosed,1);
  assert.equal(f.scope.nativeCodingRuntime,null);assert.equal(f.scope.nativeCodingHostCapability,null);
  assert.equal(f.scope.nativeRuntimeInitializations.size,0);
});

test('actual main transient scope failure recovers on READ_SEED with one goal effect and one bound runtime',async()=>{
  const f=fixture(),main=await mainMountFixture(),calls=[];main.failScopeOnce();
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async op=>{calls.push(op);return f.result;},
    projectSnapshot:async()=>f.snapshot,onAdmitted:main.onAdmitted});
  await router.submit({request_id:f.input.request_id,goal:f.input.objective});
  assert.equal(main.scope.nativeCodingRuntime,null);assert.equal(main.counts.capabilityClosed,1);
  await router.refresh(f.journal.latest());
  assert.equal(main.scope.nativeCodingRuntime,main.runtime);assert.equal(main.bound,main.runtime);
  assert.equal(main.counts.construct,1);assert.equal(main.counts.bind,1);assert.equal(main.counts.init,0);
  assert.deepEqual(calls,['SEED_GOAL','READ_SEED']);assert.equal(f.journal.latest().receipt.root_task_id,f.receipt.root_task_id);
});

test('a completed parallel drain rejects the old mount and the next READ_SEED uses the new barrier without reseeding',async()=>{
  const f=fixture(),main=await mainMountFixture(),calls=[],release=main.deferScope();
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async op=>{calls.push(op);return f.result;},
    projectSnapshot:async()=>f.snapshot,onAdmitted:main.onAdmitted});
  const submitted=router.submit({request_id:f.input.request_id,goal:f.input.objective});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(main.counts.capability,1);
  main.scope.managedTaskProjectHostDrainPending=true;main.scope.managedTaskProjectHostClosing=Promise.resolve();
  main.scope.managedTaskProjectHostDrainPending=false;release();await submitted;
  assert.equal(main.counts.construct,0);assert.equal(main.counts.bind,0);assert.equal(main.counts.capabilityClosed,1);
  await router.refresh(f.journal.latest());
  assert.equal(main.scope.nativeCodingRuntime,main.runtime);assert.equal(main.counts.construct,1);assert.equal(main.counts.bind,1);
  assert.deepEqual(calls,['SEED_GOAL','READ_SEED']);assert.equal(f.journal.latest().receipt.project_id,f.receipt.project_id);
});

test('readonly admission before Supervisor startup remains bounded and does not wait on its own drain accounting',async()=>{
  const f=await mainMountFixture();f.scope.nativeSupervisor=null;
  let finish;const startup=new Promise(resolve=>{finish=resolve;});f.scope.nativeRuntimeInitializations.add(startup);
  await assert.rejects(()=>f.onAdmitted(),/native_coding_runtime_mount_supervisor_unavailable/);
  assert.equal(f.counts.construct,0);assert.equal(f.counts.init,0);assert.equal(f.scope.nativeRuntimeInitializations.size,1);
  finish();f.scope.nativeRuntimeInitializations.delete(startup);
  f.scope.nativeSupervisor={bindNativeCodingRuntime:()=>{f.counts.bind++;}};
  await f.onAdmitted();assert.equal(f.counts.construct,1);assert.equal(f.counts.bind,1);
});

for(const failure of ['unconfirmed','throws'])test(`failed candidate ${failure} cleanup retains drain custody and blocks remount`,async()=>{
  const f=await mainMountFixture();f.scope.nativeSupervisor.bindNativeCodingRuntime=()=>{throw Error('fixture binding failure');};
  f.runtime.close=async()=>{f.counts.runtimeClosed++;f.runtimeState.closed=true;f.runtimeState.shutdown_state='DRAIN_UNCONFIRMED';
    if(failure==='throws')throw Error('fixture cleanup failed');return {...f.runtimeState,worker_cleanup_confirmed:false};};
  await assert.rejects(()=>f.onAdmitted(),/fixture binding failure/);
  assert.equal(f.scope.nativeCodingRuntime,f.runtime);assert.equal(f.scope.nativeCodingHostCapability,f.capability);
  assert.equal(f.counts.capabilityClosed,0);assert.equal(f.scope.nativeRuntimeInitializations.size,0);
  await assert.rejects(()=>f.onAdmitted(),/native_coding_runtime_mount_cleanup_unconfirmed/);
  assert.equal(f.counts.construct,1);
  await assert.rejects(()=>drainManagedRuntimeBindings({coding:f.scope.nativeCodingRuntime,codingHost:f.scope.nativeCodingHostCapability}),
    /managed_runtime_worker_cleanup_unconfirmed|fixture cleanup failed/);
  assert.equal(f.counts.capabilityClosed,0,'physical drain must retain the capability when worker cleanup remains unknown');
});

test('actual empty close fences a pending scope read and allows a fresh mount only after positive cleanup',async()=>{
  const f=await mainMountFixture(),release=f.deferScope(),prior=f.scope.managedTaskProjectHostClosing;
  const mounted=f.onAdmitted();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.capability,1);
  const closing=f.close();assert.notEqual(closing,prior);assert.equal(f.scope.managedTaskProjectHostDrainPending,true);
  let finished=false;closing.then(()=>{finished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
  release();await assert.rejects(mounted,/native_coding_runtime_mount_(?:closing|drain_changed)/);
  const receipt=await closing;assert.equal(receipt.cleanup_confirmed,true);assert.equal(f.counts.construct,0);
  assert.equal(f.counts.capabilityClosed,1);assert.equal(f.scope.managedTaskProjectHostDrainPending,false);
  await f.onAdmitted();assert.equal(f.counts.construct,1);assert.equal(f.bound,f.runtime);
});

test('actual close before the first mount microtask joins concurrent closes and creates a new empty barrier after settlement',async()=>{
  const f=await mainMountFixture(),prior=f.scope.managedTaskProjectHostClosing;
  const mounted=f.onAdmitted(),closing=f.close();assert.notEqual(closing,prior);assert.equal(f.close(),closing);
  await assert.rejects(mounted,/native_coding_runtime_mount_(?:closing|drain_changed)/);
  assert.equal((await closing).cleanup_confirmed,true);assert.equal(f.counts.capability,0);assert.equal(f.counts.construct,0);
  const next=f.close();assert.notEqual(next,closing);assert.equal((await next).cleanup_confirmed,true);
});

for(const cleanup of ['confirmed','unconfirmed','throws'])test(`actual close waits for pending candidate ${cleanup} cleanup and rereads retained custody`,async()=>{
  const f=await mainMountFixture();let finish;const waiting=new Promise(resolve=>{finish=resolve;});
  f.scope.nativeSupervisor.bindNativeCodingRuntime=value=>{if(value)throw Error('fixture binding failure');};
  f.runtime.close=async()=>{
    f.counts.runtimeClosed++;f.runtimeState.closed=true;await waiting;
    f.runtimeState.shutdown_state=cleanup==='confirmed'?'DRAINED':'DRAIN_UNCONFIRMED';f.runtimeState.worker_cleanup_confirmed=cleanup==='confirmed';
    if(cleanup==='throws')throw Error('fixture cleanup failed');return {...f.runtimeState};
  };
  const mounted=f.onAdmitted();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.counts.construct,1);
  assert.equal(f.scope.nativeCodingRuntime,null);const closing=f.close();let finished=false;
  closing.then(()=>{finished=true;},()=>{finished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
  finish();await assert.rejects(mounted,/fixture binding failure/);
  if(cleanup==='confirmed'){
    assert.equal((await closing).cleanup_confirmed,true);assert.equal(f.scope.nativeCodingRuntime,null);
    assert.equal(f.scope.nativeCodingHostCapability,null);assert.equal(f.counts.capabilityClosed,1);
  }else{
    await assert.rejects(closing,/managed_runtime_worker_cleanup_unconfirmed|fixture cleanup failed/);
    assert.equal(f.scope.nativeCodingRuntime,f.runtime);assert.equal(f.scope.nativeCodingHostCapability,f.capability);
    assert.equal(f.scope.managedTaskProjectHostDrainPending,true);assert.equal(f.counts.capabilityClosed,0);assert.equal(f.close(),closing);
  }
});

test('actual close preserves a rejected previous barrier and retained custody instead of reporting an empty successful drain',async()=>{
  const f=await mainMountFixture(),failure=Error('previous cleanup unknown');let hostClosed=0;
  const prior=Promise.reject(failure);prior.catch(()=>{});f.scope.managedTaskProjectHostClosing=prior;
  f.scope.managedTaskProjectHost={close:async()=>{hostClosed++;}};
  const closing=f.close();await assert.rejects(closing,error=>error===failure);
  assert.equal(hostClosed,0);assert.ok(f.scope.managedTaskProjectHost);assert.equal(f.scope.managedTaskProjectHostDrainPending,true);
  assert.equal(f.close(),closing);await assert.rejects(()=>f.onAdmitted(),/native_coding_runtime_mount_closing/);
});

test('actual before-quit waits for a pending mount even when no managed runtime references have been published',async()=>{
  const f=await mainMountFixture(),beforeQuit=f.beforeQuit();let prevented=0;
  const mounted=f.onAdmitted();beforeQuit({preventDefault:()=>{prevented++;}});
  assert.equal(prevented,1);await assert.rejects(mounted,/native_coding_runtime_mount_closing/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.scope.managedTaskProjectQuitReady,true);assert.equal(f.counts.quit,1);
  assert.equal(f.counts.capability,0);assert.equal(f.counts.construct,0);
});

test('unavailable observations mark saved progress stale and clear only after a matching fresh snapshot',async()=>{
  const f=fixture();let failProject=false,failHost=false;
  const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>{if(failHost)throw Error('IPC unavailable');return f.result;},
    projectSnapshot:async()=>{if(failProject)throw Error('read unavailable');return f.snapshot;}});
  await router.submit({request_id:f.input.request_id,goal:f.input.objective});const original=f.journal.latest().progress;
  failProject=true;await router.refresh(f.journal.latest());assert.deepEqual(f.journal.latest().progress,original);
  assert.equal(f.journal.latest().project_error,'Native project observation unavailable');
  failHost=true;await assert.rejects(()=>router.refresh(f.journal.latest()),/IPC unavailable/);
  assert.equal(f.journal.latest().project_error,'Native goal observation unavailable');
  failHost=false;failProject=false;await router.refresh(f.journal.latest());assert.equal(f.journal.latest().project_error,null);
});

test('two routers sharing one durable journal cannot issue concurrent native seeds',async()=>{
  const f=fixture();let release;const wait=new Promise(resolve=>{release=resolve;});let sends=0;
  const options={journal:f.journal,request:async()=>{sends++;await wait;return f.result;},projectSnapshot:async()=>f.snapshot};
  const a=createClientNativeCodingGoalRouter(options).submit({request_id:f.input.request_id,goal:f.input.objective});
  await assert.rejects(()=>createClientNativeCodingGoalRouter(options).submit({request_id:randomUUID(),goal:'Concurrent'}),/operation_pending/);
  release();await a;assert.equal(sends,1);
});

test('projectSnapshot root/project/request drift is rejected as progress',async()=>{
  const f=fixture();const entry={request_id:f.input.request_id,goal:f.input.objective,receipt:f.receipt};
  for(const mutate of [s=>s.project_id=randomUUID(),s=>s.root_task_id=randomUUID(),s=>s.request_id=randomUUID(),s=>s.selected_task.task_id=randomUUID(),s=>s.goal+='x']){
    const value=structuredClone(f.snapshot);mutate(value);assert.throws(()=>normalizeNativeCodingGoalProgress(value,entry),/client_(?:native_goal|project)_/);
  }
});

test('native profile presence chooses native/HOLD; stopped Host and inaccessible presence never choose browser',async()=>{
  const summary={status_file:'C:/private/runtime/status.json'};const readSummary=()=>summary;
  assert.equal((await readClientGoalSubmissionMode({readSummary:()=>null})).kind,'UNAVAILABLE');
  assert.equal((await readClientGoalSubmissionMode({readSummary,readNativeSetupRoute:async()=>({retained_intent:false,scope_resolved:true,authority_effect:false}),lstat:async()=>{throw Object.assign(Error(),{code:'ENOENT'});}})).kind,'BROWSER');
  const good=await readClientGoalSubmissionMode({readSummary,lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1})});
  assert.equal(good.kind,'NATIVE_CODING');assert.equal(good.state,'HOST_VERIFICATION_REQUIRED');
  const bad=await readClientGoalSubmissionMode({readSummary,lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>true,nlink:1})});
  assert.equal(bad.kind,'NATIVE_CODING');assert.equal(bad.state,'HOLD');
  assert.equal((await readClientGoalSubmissionMode({readSummary,lstat:async()=>{throw Object.assign(Error(),{code:'EACCES'});}})).state,'HOLD');
});

test('busy native profile is an admission HOLD and failed capacity read cannot choose another route',async()=>{
  const readSummary=()=>({status_file:'C:/private/runtime/status.json'}),lstat=async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1});
  const project_id=randomUUID();const busy=await readClientGoalSubmissionMode({readSummary,lstat,readNativeBusy:async()=>({busy:true,project_id})});
  assert.equal(busy.kind,'NATIVE_CODING');assert.equal(busy.state,'HOLD');assert.equal(busy.reason,'NATIVE_PROFILE_BUSY');assert.equal(busy.project_id,project_id);
  const unknown=await readClientGoalSubmissionMode({readSummary,lstat,readNativeBusy:async()=>{throw Error('readback lost');}});
  assert.equal(unknown.kind,'NATIVE_CODING');assert.equal(unknown.state,'HOLD');assert.equal(unknown.reason,'NATIVE_PROFILE_STATUS_UNAVAILABLE');
});

test('native mode reports bounded private IPC failure reasons and always keeps failed discovery on HOLD',async()=>{
  const readSummary=()=>({status_file:'C:/private/runtime/status.json'}),lstat=async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1});
  const cases=[['UNSUPPORTED_ACTION','NATIVE_PROFILE_CAPABILITY_UNAVAILABLE'],['REQUEST_TIMEOUT','NATIVE_PROFILE_STATUS_TIMEOUT'],
    ...['CHANNEL_CLOSED','CHILD_EXIT','HOST_TERMINATED','SERVER_CLOSED','CLIENT_CLOSED','SEND_FAILED'].map(reason=>[reason,'NATIVE_PROFILE_HOST_UNAVAILABLE']),
    ['OPERATION_FAILED','NATIVE_PROFILE_VERIFICATION_FAILED'],['RESPONSE_INVALID','NATIVE_PROFILE_STATUS_UNAVAILABLE']];
  for(const [cause,reason] of cases){
    const mode=await readClientGoalSubmissionMode({readSummary,lstat,readNativeBusy:async()=>{throw new NativeCodingHostIpcError(cause,{action:'LIST_SEEDS'});}});
    assert.equal(mode.reason,reason);assert.equal(mode.kind,'NATIVE_CODING');assert.equal(mode.state,'HOLD');
    assert.equal(mode.authority_effect,false);assert.equal(mode.automatic_retry_allowed,false);
  }
  const raw=Object.assign(Error('postgresql://private/path secret-token'),{reason:'UNSUPPORTED_ACTION'});
  const mode=await readClientGoalSubmissionMode({readSummary,lstat,readNativeBusy:async()=>{throw raw;}});
  assert.equal(mode.reason,'NATIVE_PROFILE_STATUS_UNAVAILABLE');
  assert.equal(JSON.stringify(mode).includes('private'),false);assert.equal(JSON.stringify(mode).includes('secret'),false);
});

test('actual main submit function preserves an admitted busy project before any new UUID/journal/effect',async()=>{
  const f=fixture();await f.journal.begin({request_id:f.input.request_id,goal:f.input.objective,kind:'NATIVE_CODING'});await f.journal.recordNativeAdmission(f.receipt);
  const writes=f.getWrites(),before=f.getDurable();let ids=0,sends=0;
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  const source=main.slice(main.indexOf('async function submitClientGoal('),main.indexOf('async function latestClientGoal('));
  const submit=vm.runInNewContext('('+source+')',{ensureClientGoalJournal:async()=>f.journal,
    readNativeGoalSubmissionMode:async()=>({kind:'NATIVE_CODING',state:'HOLD',reason:'NATIVE_PROFILE_BUSY'}),
    randomUUID:()=>{ids++;return randomUUID();},nativeSupervisor:{clientGoalSubmit:async()=>{sends++;}},Error});
  await assert.rejects(()=>submit('A second user goal'),/client_goal_submission_hold:NATIVE_PROFILE_BUSY/);
  assert.equal(ids,0);assert.equal(sends,0);assert.equal(f.getWrites(),writes);assert.deepEqual(f.getDurable(),before);
  assert.equal(f.journal.latest().project.project_id,f.receipt.project_id);
});

test('primary product routing has fixed native IPC/signing paths and separate admission UI',async()=>{
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await readFile(new URL('../src/preload-shell.cjs',import.meta.url),'utf8');
  const ui=await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx',import.meta.url),'utf8');
  assert.match(main,/signNativeCodingDeviceRequest\(\{identity:ensureSupervisorIdentity\(\),binding:capability\.snapshot\(\),operation,input\}\)/);
  assert.match(main,/operation==='SEED_GOAL'\?await capability\.seedGoal\(signed\):await capability\.readSeed\(signed\)/);
  assert.match(main,/if\(!owned\)capability\.close\(\)/);assert.match(preload,/goalSubmissionMode:clientGoalSubmissionMode/);
  assert.match(ui,/mode\.kind==="BROWSER"/);assert.match(ui,/metaengine\.native-coding\.goal-admission\.v1/);
  assert.match(ui,/data-testid="client-native-goal-progress"/);assert.match(ui,/Execution proof is separate from admission/);
});

test('protected profile mode is reported without changing the authenticated native admission route',async()=>{
  const options={readSummary:()=>({status_file:'/owned/status.json'}),lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1})};
  for(const coordination_mode of ['CHAT_LED','CLI_LED']){
    const value=await readClientGoalSubmissionMode({...options,readNativeBusy:async()=>({busy:false,coordination_mode})});
    assert.equal(value.kind,'NATIVE_CODING');assert.equal(value.coordination_mode,coordination_mode);assert.equal(value.state,'HOST_VERIFICATION_REQUIRED');
  }
  const bad=await readClientGoalSubmissionMode({...options,readNativeBusy:async()=>({busy:false,coordination_mode:'UNVERIFIED'})});
  assert.equal(bad.state,'HOLD');
});

test('chat-led native project retains suspended planner progress across journal restart',async()=>{
 const f=fixture();f.snapshot.selected_task.role='PLANNER';f.snapshot.selected_task.state='SUSPENDED';
 const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>f.result,projectSnapshot:async()=>f.snapshot});
 await router.submit({request_id:f.input.request_id,goal:f.input.objective});
 assert.equal(f.journal.latest().progress?.task_state,'SUSPENDED');assert.equal(f.journal.latest().project_error,null);
 const restored=new ClientGoalJournal(f.storage);await restored.load();
 assert.equal(restored.latest().state,'SUSPENDED');assert.equal(restored.latest().progress.terminal,false);
 f.snapshot.selected_task.state='RUNNING';await router.refresh(f.journal.latest());assert.equal(f.journal.latest().state,'RUNNING');
});

function rejectedReview(project_id){return {schema:'metaengine.native-coding.review-rejection.v1',project_id,verdict:'REJECT',
 writer_task_id:randomUUID(),writer_lease_generation:1,critic_task_id:randomUUID(),critic_lease_generation:1,result_sha256:'a'.repeat(64),
 automatic_retry_allowed:false,authority_effect:false};}

test('bound review rejection remains visible and nonterminal across goal journal reload',async()=>{
 const f=fixture();f.snapshot.state='BLOCKED';f.snapshot.native_review_rejection=rejectedReview(f.receipt.project_id);
 const router=createClientNativeCodingGoalRouter({journal:f.journal,request:async()=>f.result,projectSnapshot:async()=>f.snapshot});
 await router.submit({request_id:f.input.request_id,goal:f.input.objective});
 assert.equal(f.journal.latest().progress.blocked_reason,'NATIVE_REVIEW_REJECTED');assert.equal(f.journal.latest().progress.terminal,false);
 assert.equal(f.journal.latest().progress.physical_execution_proven,false);
 const restored=new ClientGoalJournal(f.storage);await restored.load();
 assert.deepEqual(restored.latest().progress.review_rejection,f.snapshot.native_review_rejection);
});

for(const tamper of [r=>r.project_id=randomUUID(),r=>r.verdict='ACCEPT',r=>r.authority_effect=true,
 r=>r.critic_task_id=r.writer_task_id,r=>r.critic_lease_generation=0,r=>r.result_sha256='invalid',r=>r.secret='not allowed']){
 test('malformed review rejection cannot be accepted as project progress',()=>{
  const f=fixture();f.snapshot.native_review_rejection=rejectedReview(f.receipt.project_id);tamper(f.snapshot.native_review_rejection);
  assert.throws(()=>normalizeNativeCodingGoalProgress(f.snapshot,{request_id:f.input.request_id,goal:f.input.objective,receipt:f.receipt}),/native_review_rejection_invalid/);
 });
}

test('interrupted native preparation cannot silently route a new goal to Browser',async()=>{
 const paths=[];const mode=await readClientGoalSubmissionMode({readSummary:()=>({status_file:'C:/private/runtime/status.json'}),lstat:async file=>{
  paths.push(file);if(file.endsWith('native-coding-seed-operator-v1.json'))throw Object.assign(Error(),{code:'ENOENT'});
  assert.ok(file.endsWith('native-coding-operator-v1.json'));return {isFile:()=>true,isSymbolicLink:()=>false,nlink:1};
 }});assert.equal(mode.kind,'NATIVE_CODING');assert.equal(mode.state,'HOLD');assert.equal(mode.reason,'NATIVE_PROFILE_PREPARATION_REQUIRED');assert.equal(paths.length,2);
});
test('inaccessible or aliased native setup marker cannot authorize Browser fallback',async()=>{
 for(const marker of ['denied','alias']){
  let reads=0;const mode=await readClientGoalSubmissionMode({readSummary:()=>({status_file:'C:/private/runtime/status.json'}),readNativeBusy:async()=>{reads++;},lstat:async file=>{
   if(file.endsWith('native-coding-seed-operator-v1.json'))throw Object.assign(Error(),{code:'ENOENT'});
   if(marker==='denied')throw Object.assign(Error('private path'),{code:'EACCES'});return {isFile:()=>true,isSymbolicLink:()=>true,nlink:1};
  }});assert.equal(mode.state,'HOLD');assert.notEqual(mode.kind,'BROWSER');assert.equal(reads,0);assert.equal(JSON.stringify(mode).includes('private path'),false);
 }
});

test('actual mount records missing protected setup and clears it on successful later mount',async()=>{
 const f=await mainMountFixture();f.scope.fs.lstat=async()=>null;
 assert.equal(await f.context.ensureNativeCodingRuntimeMounted(),null);
 assert.equal(f.scope.nativeCodingRuntimeMountDiagnostic.reason,'OPERATOR_CONFIGURATION_MISSING');
 assert.equal(f.scope.nativeCodingRuntimeMountDiagnostic.host,f.summary);
 assert.equal(f.counts.capability,0);
 f.scope.fs.lstat=async()=>({});await f.context.ensureNativeCodingRuntimeMounted();
 assert.equal(f.scope.nativeCodingRuntimeMountDiagnostic,null);
});
test('actual mount failure diagnostic does not retain raw read errors',async()=>{
 const f=await mainMountFixture();f.failScopeOnce();
 await assert.rejects(f.context.ensureNativeCodingRuntimeMounted(),/transient scope read/);
 assert.equal(f.scope.nativeCodingRuntimeMountDiagnostic.reason,'SETUP_READBACK_FAILED');
 assert.doesNotMatch(JSON.stringify(f.scope.nativeCodingRuntimeMountDiagnostic),/transient scope read/);
 await f.context.ensureNativeCodingRuntimeMounted();assert.equal(f.scope.nativeCodingRuntimeMountDiagnostic,null);
});

test('actual mount distinguishes absent Host from unavailable protected permits',async()=>{
 const absent=await mainMountFixture();absent.scope.readOwnedLocalRuntimeHostSummary=()=>null;
 assert.equal(await absent.context.ensureNativeCodingRuntimeMounted(),null);
 assert.equal(absent.scope.nativeCodingRuntimeMountDiagnostic.reason,'HOST_UNAVAILABLE');
 const missing=await mainMountFixture();missing.capability.readScope=async()=>({bindings:[]});
 await assert.rejects(missing.context.ensureNativeCodingRuntimeMounted(),/protected_permits_required/);
 assert.equal(missing.scope.nativeCodingRuntimeMountDiagnostic.reason,'PROTECTED_PERMITS_UNAVAILABLE');
 assert.equal(missing.counts.capabilityClosed,1);assert.equal(missing.counts.construct,0);
});


test('actual main consumes explicit preparation before permits; unknown blocks mount and releases capability',async()=>{
 for(const failure of [null,'native_workspace_preparation_outcome_unknown','native_workspace_preparation_workspace_authorization_required']){
  const f=await mainMountFixture();let calls=0;
  f.scope.prepareNativeWorkspaceFromStage=async options=>{calls++;assert.equal(options.capability,f.capability);assert.equal(options.stateDirectory,'C:/private/runtime');options.assertOpen();if(failure)throw Error(failure);return {state:'PREPARED'};};
  if(failure){await assert.rejects(f.onAdmitted(),new RegExp(failure));assert.equal(f.counts.construct,0);assert.equal(f.counts.capabilityClosed,1);}
  else{await f.onAdmitted();assert.equal(f.counts.construct,1);}
  assert.equal(calls,1);
 }
});

test('actual Main default owner exists before descriptors and a missing descriptor leaves zero capacity',async()=>{
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 assert.ok(main.indexOf('const nativeCodingCapacityOwner = createNativeCodingCapacityOwner();')<main.indexOf('function ensureNativeCodingRuntimeMounted()'));
 const f=await mainMountFixture();f.scope.fs.lstat=async()=>null;
 assert.equal(await f.context.ensureNativeCodingRuntimeMounted(),null);
 assert.equal(f.scope.nativeCodingCapacityOwner.snapshot({configuredCeiling:4,resourceCeiling:4}).projection.free_slots,0);
 assert.equal(f.counts.construct,0);
});

for(const stage of ['preparation','scope'])for(const upgrade of [false,true])test(`unpublished ${stage} scope is registered before dispatch and quit upgrade=${upgrade} fences late runtime creation`,async()=>{
 const f=await mainMountFixture();let release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const operation=async()=>{assert.equal(f.scope.nativeCodingRuntimeMountCustody?.capability,f.capability);entered();await waiting;throw Error('fixture Host terminal UNKNOWN');};
 if(stage==='preparation')f.scope.prepareNativeWorkspaceFromStage=operation;else f.capability.readScope=operation;
 let stops=0;f.scope.stopOwnedLocalRuntimeHost=async()=>{stops++;release();return{cleanup_confirmed:true};};
 const mount=f.context.ensureNativeCodingRuntimeMounted();mount.catch(()=>{});await started;
 assert.equal(f.scope.nativeCodingRuntime,null);assert.equal(f.counts.construct,0);
 f.scope.shutdownRequested=!upgrade;const close=f.close();assert.equal(f.close(),close);
 try{
  if(upgrade){await new Promise(r=>setImmediate(r));assert.equal(stops,0);f.scope.shutdownRequested=true;assert.equal(f.close(),close);}
  await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(stops,1,'unpublished Host query must not strand explicit quit');
  assert.equal((await close).cleanup_confirmed,true);await assert.rejects(mount,/fixture Host terminal UNKNOWN/);
 }finally{release();await mount.catch(()=>{});await close.catch(()=>{});}
 assert.equal(f.counts.construct,0);assert.equal(f.bound,null);assert.equal(f.counts.capabilityClosed,1);assert.equal(f.scope.nativeCodingRuntimeMountCustody,null);
 await assert.rejects(f.onAdmitted(),/mount_closing/);assert.equal(f.counts.capability,1);
});
test('mount caller UNKNOWN cannot retire original capability before physical settlement; quit joins retained scope',async()=>{
 const f=await mainMountFixture();let physical=false,stops=0;
 f.capability.readScope=async()=>{throw Error('fixture caller UNKNOWN');};
 f.capability.drainPhysical=async()=>{if(!physical)throw Error('fixture SQL pending');return{schema:'metaengine.native-coding.physical-drain.v1',cleanup_confirmed:true};};
 await assert.rejects(f.onAdmitted(),/fixture caller UNKNOWN/);assert.equal(f.counts.capabilityClosed,0);
 assert.equal(f.scope.nativeCodingRuntimeMountCustody.capability,f.capability);assert.equal(f.scope.nativeCodingRuntimeMountCustody.failed,true);
 assert.equal(f.scope.nativeCodingHostCapability,f.capability);assert.equal(f.scope.nativeRuntimeInitializations.size,0);
 await assert.rejects(f.onAdmitted(),/cleanup_unconfirmed/);assert.equal(f.counts.capability,1);
 await assert.rejects(f.close(),nativeHostScopeCleanupHeld);assert.equal(stops,0);assert.equal(f.counts.capabilityClosed,0);
 f.scope.shutdownRequested=true;f.scope.stopOwnedLocalRuntimeHost=async()=>{stops++;physical=true;return{cleanup_confirmed:true};};
 assert.equal((await f.close()).cleanup_confirmed,true);assert.equal(stops,1);assert.equal(f.counts.capabilityClosed,1);
 assert.equal(f.scope.nativeCodingRuntimeMountCustody,null);assert.equal(f.scope.nativeCodingHostCapability,null);
});
