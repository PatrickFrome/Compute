import {createNativeHostScopeCleanup} from '../src/native-host-scope-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {ClientGoalJournal} from '../src/client-goal-journal.mjs';
import {createPreparedActivationRouter,normalizePreparedActivationReceipt} from '../src/client-prepared-goal-activation.mjs';
async function fixture(){
 let durable=null,failSave=false;
 const storage={loadState:async()=>structuredClone(durable),saveState:async v=>{if(failSave)throw Error('disk');durable=structuredClone(v);}};
 const journal=new ClientGoalJournal(storage),id=randomUUID(),selector={preparation_id:randomUUID(),configuration_sha256:'a'.repeat(64),workspace_id:randomUUID(),preparation_grant_epoch:1};
 await journal.begin({request_id:id,goal:'Develop actual goal',kind:'PREPARED_GOAL',prepared_selector:selector});
 const admission={schema:'metaengine.native-coding.pending-goal-admission.v1',state:'PENDING_ACTIVATION',...selector,request_id:id,objective:'Develop actual goal',project_id:randomUUID(),root_task_id:randomUUID(),task_spec_sha256:'b'.repeat(64),root_state:'BLOCKED',project_state:'PAUSED',owner_incarnation_verified:false,execution_ready:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
 await journal.recordPreparedAdmission(admission);
 const pin={profile_id:randomUUID(),profile_sha256:'c'.repeat(64)},activationId=randomUUID(),calls=[];
 const result=input=>({schema:'metaengine.native-coding.pending-activation-result.v1',state:'ACTIVATED',activation:{schema:'metaengine.native-coding.pending-activation-receipt.v1',state:'ACTIVATED',input,...pin,workspace_id:selector.workspace_id,project_id:admission.project_id,root_task_id:admission.root_task_id,task_spec_sha256:admission.task_spec_sha256,root_state:'READY',project_state:'ACTIVE',permit_ids:[randomUUID()],loaded_runtime_code_attested:false,production_qualified:false,automatic_retry_allowed:false,authority_effect:false},automatic_retry_allowed:false,authority_effect:false});
 const base={journal,readProfilePin:async()=>pin,newId:()=>activationId,request:async(op,input)=>{calls.push(op);return result(input);}};
 return {journal,id,pin,activationId,calls,base,result,storage,durable:()=>durable,failSave:()=>{failSave=true;}};
}
test('explicit activation durably records exact selector before dispatch and preserves same project/root',async()=>{
 const f=await fixture();let reply;
 const router=createPreparedActivationRouter({...f.base,request:async(op,input)=>{f.calls.push(op);assert.deepEqual(f.durable().entries[0].activation_input,input);reply=f.result(input);return reply;}});
 const out=await router.activate(f.journal.latest());
 assert.equal(out.state,'ACTIVATED');assert.equal(out.activation_receipt.root_task_id,out.receipt.root_task_id);assert.equal(out.progress,null);assert.equal(out.execution_proof,null);assert.equal(out.activation_receipt.loaded_runtime_code_attested,false);
 assert.deepEqual(f.calls,['ACTIVATE_PREPARED_GOAL_V1']);
 const recovered=createPreparedActivationRouter({...f.base,request:async(op)=>{f.calls.push(op);return reply;}});
 await recovered.activate(out);assert.deepEqual(f.calls,['ACTIVATE_PREPARED_GOAL_V1','READ_PREPARED_GOAL_ACTIVATION_V1']);
});
for(const state of ['NOT_STARTED','READBACK_REQUIRED'])test(`lost ACK and ${state} never replay activation, including restart and explicit click`,async()=>{
 const f=await fixture(),request=async(op)=>{f.calls.push(op);if(op==='ACTIVATE_PREPARED_GOAL_V1')throw Error('lost');return {schema:'metaengine.native-coding.pending-activation-result.v1',state,activation:null,automatic_retry_allowed:false,authority_effect:false};};
 const router=createPreparedActivationRouter({...f.base,request});await assert.rejects(router.activate(f.journal.latest()),/readback_required/);
 assert.equal(f.journal.latest().state,'ACTIVATION_READBACK_REQUIRED');const input=f.journal.latest().activation_input;
 const restarted=new ClientGoalJournal(f.storage);await restarted.load();const again=createPreparedActivationRouter({...f.base,journal:restarted,request});
 await again.refresh(restarted.latest());await again.activate(restarted.latest());assert.deepEqual(restarted.latest().activation_input,input);
 assert.equal(f.calls.filter(x=>x==='ACTIVATE_PREPARED_GOAL_V1').length,1);
});
test('durable persistence failure prevents all activation dispatch',async()=>{
 const f=await fixture();f.failSave();await assert.rejects(createPreparedActivationRouter(f.base).activate(f.journal.latest()));assert.deepEqual(f.calls,[]);
});
test('operator pin changes after journaling produce only readback, not a new activation ID',async()=>{
 const f=await fixture();let reads=0;
 const router=createPreparedActivationRouter({...f.base,readProfilePin:async()=>++reads===1?f.pin:{...f.pin,profile_sha256:'d'.repeat(64)},request:async(op)=>{f.calls.push(op);throw Error('unavailable');}});
 await assert.rejects(router.activate(f.journal.latest()));assert.deepEqual(f.calls,['READ_PREPARED_GOAL_ACTIVATION_V1']);assert.equal(f.journal.latest().activation_input.activation_id,f.activationId);
});
test('receipt rejects foreign project/root/profile, executing state and loaded-code claims',async()=>{
 const f=await fixture();await createPreparedActivationRouter(f.base).activate(f.journal.latest());const entry=f.journal.latest();
 for(const patch of [{project_id:randomUUID()},{root_task_id:randomUUID()},{profile_sha256:'d'.repeat(64)},{root_state:'RUNNING'},{loaded_runtime_code_attested:true},{authority_effect:true},{permit_ids:[]}])assert.throws(()=>normalizePreparedActivationReceipt({...entry.activation_receipt,...patch},entry));
});
test('actual main activation is separate from save/startup; recovery routes by durable selector',async()=>{
 const main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await fs.readFile(new URL('../src/preload-shell.cjs',import.meta.url),'utf8');
 assert.match(main,/ipcMain\.handle\('metaengine:client:activate-prepared-goal'/);
 assert.match(main,/if\(mode!=='READ_CUSTODY'\)throw/);assert.match(main,/activationResult=await capability.withPendingActivationScope/);
 assert.match(main,/latest.activation_input\)await createPreparedGoalActivationRouter\(journal\).refresh/);
 assert.match(main,/entry.activation_input\?await createPreparedGoalActivationRouter\(journal\).refresh/);
 assert.match(preload,/activatePreparedGoal:activatePreparedClientGoal/);
 assert.match(preload,/const activatePreparedClientGoal=requestId=>ipcRenderer.invoke\('metaengine:client:activate-prepared-goal',requestId\)/);
 // Actual named helper channel/arity and Main sender/extra-argument behavior
 // are exercised by client-draft-scope.test.mjs; Save separation stays below.
 const submit=main.slice(main.indexOf('async function submitClientGoal('),main.indexOf('async function latestClientGoal('));assert.doesNotMatch(submit,/activatePreparedClientGoal|ACTIVATE_PREPARED_GOAL_V1/);
});

test('actual Main activation uses private READ_CUSTODY producers and retains lifetime through outer result',async()=>{
 const vm=await import('node:vm'),main=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
 const start=main.indexOf('function createPreparedGoalActivationRouter('),end=main.indexOf('async function activatePreparedClientGoal(',start);
 let options,binding,closed=false,unbound=false,outerDone=false;const events=[];
 const device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64)};
 const native={sealed:'local-only'},result={state:'ACTIVATED'},input={test:'exact signed selector'};
 const identity={ensure:async()=>{},snapshot:()=>device,bindHostOwnerGenesisW74:scope=>{binding=scope;return async()=>{assert.equal(outerDone,true);unbound=true;};},
  readTrustedHostOwnerIncarnationW74:async()=>binding.withOwnerScope('READ_CUSTODY',async tx=>{assert.equal(tx.readOnly,true);await binding.readSourceProof();await binding.readNativeKernel(321);return native;})};
 const cap={drainPhysical:async()=>({schema:'metaengine.native-coding.physical-drain.v1',cleanup_confirmed:true}),snapshot:()=>({closed:false}),close:()=>{assert.equal(unbound,true);closed=true;},withPendingActivationScope:async(signed,body)=>{
  assert.equal(signed.operation,'ACTIVATE_PREPARED_GOAL_V1');assert.deepEqual(signed.input,input);
  assert.equal(await body({readOnly:true}),native);assert.equal(unbound,false);events.push('COMMIT');outerDone=true;return result;
 }};
 const context={createNativeHostScopeCleanup,nativeInitializationCleanupCandidates:new Set(),cleanupPendingNativeHostScope:async record=>record.candidate.close(),createPreparedActivationRouter:value=>{options=value;return value;},randomUUID,managedTaskProjectHostClosing:null,pendingOwnerInitializationsByBarrier:new Map(),runNativeInitialization:(_c,_m,body)=>body(),
  readOwnedLocalRuntimeHostSummary:()=>({}),assertNativeCodingRuntimeMountOpen:()=>{},ensureSupervisorIdentity:()=>identity,createOwnedNativeCodingHostCapability:()=>cap,
  assertNativeSupervisorInitializationOpen:()=>{},ensureGuardianBootstrapLauncher:()=>{},readVerifiedInstalledExecutableW68:async()=>events.push('W68'),app:{},readWindowsKernelProcessW60:async pid=>{assert.equal(pid,321);events.push('KERNEL');},
  signNativeCodingDeviceRequest:async({operation,input})=>({operation,input}),ensureNativeCodingRuntimeMounted:async()=>{events.push('MOUNT_EXISTING_RUNTIME');return {mounted:true};},recordStartupSubsystemDegraded:()=>{}};
 const factory=vm.runInNewContext(`(${main.slice(start,end).trim()})`,context);factory({});
 assert.equal(await options.request('ACTIVATE_PREPARED_GOAL_V1',input),result);assert.deepEqual(events,['W68','KERNEL','COMMIT']);assert.equal(closed,true);assert.equal(unbound,true);
 await options.onActivated();assert.equal(events.at(-1),'MOUNT_EXISTING_RUNTIME');
});

test('activation records a new validated task-spec hash while keeping pending history',async()=>{
 const f=await fixture(),router=createPreparedActivationRouter({...f.base,request:async(_op,input)=>{
  const result=f.result(input);result.activation.task_spec_sha256='e'.repeat(64);return result;
 }});
 const entry=await router.activate(f.journal.latest());assert.equal(entry.receipt.task_spec_sha256,'b'.repeat(64));assert.equal(entry.activation_receipt.task_spec_sha256,'e'.repeat(64));
});

test('post-commit runtime mount failure preserves durable activation; readonly recovery retries mount only',async()=>{
 const f=await fixture();let mounts=0,result;
 const router=createPreparedActivationRouter({...f.base,request:async(op,input)=>{f.calls.push(op);return result||=f.result(input);},onActivated:async entry=>{
  assert.equal(entry.state,'ACTIVATED');assert.equal(f.durable().entries[0].activation_receipt.state,'ACTIVATED');if(++mounts===1)throw Error('runtime absent');
 }});
 const first=await router.activate(f.journal.latest());assert.equal(first.state,'ACTIVATED');assert.equal(first.project_error,'ACTIVATION_RUNTIME_MOUNT_UNAVAILABLE');
 const second=await router.refresh(first);assert.equal(second.state,'ACTIVATED');assert.equal(second.project_error,null);assert.equal(mounts,2);
 assert.deepEqual(f.calls,['ACTIVATE_PREPARED_GOAL_V1','READ_PREPARED_GOAL_ACTIVATION_V1']);
});
