import {readClientDraftScope} from '../src/client-draft-scope.mjs';
import {performance} from 'node:perf_hooks';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createNativeHostScopeCleanup,drainNativeHostScopeCleanups,nativeHostScopeCleanupHeld,nativeHostScopeCleanupHold} from '../src/native-host-scope-cleanup.mjs';
import {drainManagedRuntimeBindings,drainManagedRuntimeWorkers} from '../src/managed-runtime-drain.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});promise.catch(()=>{});return{promise,resolve,reject};};
const proof={schema:'metaengine.native-coding.physical-drain.v1',cleanup_confirmed:true};
const workerProof={schema:'metaengine.native-coding.runtime.v1',shutdown_state:'DRAINED',worker_cleanup_confirmed:true};
function capability(){
 const gate=deferred(),events=[];let ready=false,closed=false;
 return {events,ready(){ready=true;gate.resolve(proof);},snapshot:()=>({closed}),
  drainPhysical:({wait=true}={})=>{events.push(wait?'JOIN':'PROBE');return ready?Promise.resolve(proof):wait?gate.promise:Promise.reject(Error('PHYSICAL_CLEANUP_UNCONFIRMED'));},
  close:()=>{events.push('CLOSE');closed=true;}};
}
test('finite HOLD retains exact capability and unbind through failed and repeated cleanup',async()=>{
 const cap=capability();let unbinds=0;const candidate=createNativeHostScopeCleanup({capability:cap,unbind:async()=>{unbinds++;}});
 for(let i=0;i<3;i++)await assert.rejects(candidate.close(),nativeHostScopeCleanupHeld);
 assert.equal(unbinds,0);assert.equal(candidate.snapshot().cleanup_confirmed,false);assert.equal(cap.snapshot().closed,false);
 const join=candidate.whenSettled();cap.ready();await join;await candidate.close();await candidate.close();assert.equal(unbinds,1);assert.equal(cap.events.filter(e=>e==='CLOSE').length,1);
});
test('ordinary failed cleanup cannot call Host stop, explicit quit requires positive worker drain first',async()=>{
 const cap=capability(),record={kind:'HOST_SCOPE',candidate:createNativeHostScopeCleanup({capability:cap})},events=[];
 const options={cleanup:r=>r.candidate.close(),drainWorkers:async()=>{events.push('WORKERS');},stopHost:async()=>{events.push('HOST');cap.ready();return {cleanup_confirmed:true};}};
 await assert.rejects(drainNativeHostScopeCleanups([record],options),nativeHostScopeCleanupHeld);assert.deepEqual(events,[]);
 await assert.rejects(drainNativeHostScopeCleanups([record],{...options,quit:true,drainWorkers:async()=>{throw Error('workers unknown');}}),/workers unknown/);assert.deepEqual(events,[]);
 await drainNativeHostScopeCleanups([record],{...options,quit:true});assert.deepEqual(events,['WORKERS','HOST']);assert.equal(record.candidate.snapshot().cleanup_confirmed,true);
});
test('plain boolean or foreign drain token cannot bypass native worker drain',async()=>{
 let closed=0;const coding={close:async()=>{closed++;return workerProof;}};
 await drainManagedRuntimeBindings({coding,workersDrained:true,workerDrain:{cleanup_confirmed:true}});assert.equal(closed,1);
 const wrong=await drainManagedRuntimeWorkers(null);await drainManagedRuntimeBindings({coding,workerDrain:wrong});assert.equal(closed,2);
 const exact=await drainManagedRuntimeWorkers(coding);await drainManagedRuntimeBindings({coding,workerDrain:exact});assert.equal(closed,3);
});

// Execute actual Main lifetime and cleanup functions, not duplicate algorithms.
const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
function mainFixture({workerFail=false,holdCallerAfterStop=false}={}){
 const events=[],cap=capability(),query=deferred(),started=deferred(),localCallback=deferred();let stopCalls=0,binding;
 const device={device_id:randomUUID(),client_id:randomUUID(),key_fingerprint_sha256:'a'.repeat(64),enrolled:true};
 const identity={ensure:async()=>{},snapshot:()=>device,bindHostOwnerGenesisW74:value=>{binding=value;return async()=>events.push('UNBIND');},
  establishHostOwnerW74:async()=>binding.withOwnerScope('WRITE_CUSTODY',async()=>{if(holdCallerAfterStop){events.push('LOCAL_CALLBACK_START');await localCallback.promise;events.push('LOCAL_CALLBACK_END');}return true;}),readTrustedHostOwnerIncarnationW74:async()=>true};
 Object.assign(cap,{readPreparedGoal:async()=>({}),withPendingOwnerScope:async(_action,_request,callback)=>{started.resolve();if(holdCallerAfterStop)await callback({});return query.promise;}});
 const scope={Promise,Set,Map,Error,console,performance,readClientDraftScope,supervisorIdentity:identity,globalThis:{},shutdownRequested:false,runtimeRecoveryGenerationLost:false,
  managedTaskProjectHostDrainPending:false,managedTaskProjectHostClosing:Promise.resolve(),nativeRuntimeInitializations:new Set(),pendingOwnerInitializationsByBarrier:new Map(),nativeSetupRouteInitializationsByBarrier:new Map(),nativeDraftScopeInitializationsByBarrier:new Map(),nativeInitializationCleanupCandidates:new Set(),
  nativeCodingRuntimeMountPromise:null,nativeCodingRuntimeMountCustody:null,nativeSupervisorMountWaits:new Set(),supervisorLoopbackRpc:null,managedTaskProjectHost:null,autonomousProjectRuntime:null,nativeCodingHostCapability:null,
  nativeSupervisor:{bindDevosProjectRuntime(){},bindNativeCodingRuntime(){},stop(){}},
  nativeCodingRuntime:{close:async()=>{events.push('WORKERS');if(workerFail)throw Error('worker drain unconfirmed');return workerProof;}},
  createNativeHostScopeCleanup,drainNativeHostScopeCleanups,nativeHostScopeCleanupHeld,nativeHostScopeCleanupHold,drainManagedRuntimeBindings,drainManagedRuntimeWorkers,
  stopOwnedLocalRuntimeHost:async()=>{stopCalls++;events.push('HOST_STOP');cap.ready();query.reject(Error('UNKNOWN'));return{cleanup_confirmed:true};},
  preparedGoalInput:()=>({}),readOwnedLocalRuntimeHostSummary:()=>({}),assertNativeCodingRuntimeMountOpen:()=>{},ensureSupervisorIdentity:()=>identity,
  createOwnedNativeCodingHostCapability:()=>{events.push('CAPABILITY');return cap;},signNativeCodingDeviceRequest:async v=>v,normalizePreparedGoalResult:()=>true,
  readLoadedClientNativeSetupRoute:async({assertOpen})=>{started.resolve();const value=await query.promise;assertOpen();return value;},
  readManagedTaskProjectRepository:async()=>null,readClientNativeSetupRoute:async({assertOpen})=>{started.resolve();const value=await query.promise;assertOpen();return value;},
  ensureGuardianBootstrapLauncher(){},readWindowsKernelProcessW60(){},readVerifiedInstalledExecutableW68(){},app:{getPath:()=>'/fixture/userData'},randomUUID,createPreparedActivationRouter:options=>options,
 };
 const lifecycle=main.slice(main.indexOf('function assertNativeSupervisorInitializationOpen('),main.indexOf('function githubChatState()'));
 const owner=main.slice(main.indexOf('function continuePreparedGoalOwnerCustody('),main.indexOf('// An explicit renderer action'));
 const close=main.slice(main.indexOf('let managedTaskProjectHostDrainHeld='),main.indexOf('async function startInstalledRuntimeRecovery()'));
 const route=main.slice(main.indexOf('async function readNativeSetupRoute(){'),main.indexOf('async function readNativeGoalSubmissionMode(){'));
 const context=vm.createContext(scope);vm.runInContext(lifecycle+owner+close+route+main.slice(main.indexOf('function createPreparedGoalActivationRouter('),main.indexOf('async function activatePreparedClientGoal(')),context);
 return {scope,context,cap,events,query,started,releaseLocalCallback:()=>localCallback.resolve(),get stopCalls(){return stopCalls;},begin:()=>context.continuePreparedGoalOwnerCustody({kind:'PREPARED_GOAL',state:'PENDING_ACTIVATION'},true)};
}
test('actual Main timeout returns promptly but retains HOST_SCOPE and blocks second Owner initialization',async()=>{
 const f=mainFixture();const caller=f.begin();caller.catch(()=>{});await f.started.promise;assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);
 f.query.reject(Error('UNKNOWN'));await assert.rejects(caller,nativeHostScopeCleanupHeld);await tick();assert.equal(f.scope.nativeRuntimeInitializations.size,0);
 assert.equal(f.scope.pendingOwnerInitializationsByBarrier.size,0);assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);assert.equal(f.stopCalls,0);
 await assert.rejects(f.begin(),/cleanup_unconfirmed/);
 await assert.rejects(f.context.createPreparedGoalActivationRouter({}).request('ACTIVATE_PREPARED_GOAL_V1',{}),/cleanup_unconfirmed/);assert.equal(f.events.filter(e=>e==='CAPABILITY').length,1);assert.ok(!f.events.includes('UNBIND'));
 await assert.rejects(f.context.closeManagedTaskProjectHost(),nativeHostScopeCleanupHeld);await assert.rejects(f.context.closeManagedTaskProjectHost(),nativeHostScopeCleanupHeld);assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);
 f.cap.ready();await tick();await tick();assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);assert.equal(f.events.filter(e=>e==='UNBIND').length,1);assert.equal(f.stopCalls,0);
});
for(const callerTimedOut of [false,true])test(`actual Main explicit quit reaches withheld RELEASE/COMMIT Host after caller timeout=${callerTimedOut}`,async()=>{
 const f=mainFixture();const caller=f.begin();caller.catch(()=>{});await f.started.promise;
 if(callerTimedOut){f.query.reject(Error('UNKNOWN'));await assert.rejects(caller,nativeHostScopeCleanupHeld);await tick();assert.equal(f.scope.nativeRuntimeInitializations.size,0);}
 f.scope.shutdownRequested=true;const first=f.context.closeManagedTaskProjectHost(),second=f.context.closeManagedTaskProjectHost();assert.equal(first,second);
 const done=await first;await assert.rejects(caller,error=>nativeHostScopeCleanupHeld(error)||/UNKNOWN|lifetime/.test(error.message));assert.equal(done.cleanup_confirmed,true);assert.equal(f.stopCalls,1);
 assert.ok(f.events.indexOf('WORKERS')<f.events.indexOf('HOST_STOP'));assert.ok(f.events.indexOf('HOST_STOP')<f.events.indexOf('UNBIND'));
 assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);assert.equal(f.scope.nativeRuntimeInitializations.size,0);
 await assert.rejects(f.begin(),/lifetime_changed/);assert.equal(f.events.filter(e=>e==='CAPABILITY').length,1);
});
test('actual Main failed native worker drain never falls through to Host stop or removes scope',async()=>{
 const f=mainFixture({workerFail:true});const caller=f.begin();caller.catch(()=>{});await f.started.promise;f.scope.shutdownRequested=true;
 await assert.rejects(f.context.closeManagedTaskProjectHost(),/worker drain unconfirmed/);assert.equal(f.stopCalls,0);assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);
 f.query.reject(Error('UNKNOWN'));await assert.rejects(caller);f.cap.ready();await tick();
});

test('actual Main quit upgrades an already-running ordinary drain, stops Host once but still joins held local callback',async()=>{
 const f=mainFixture({holdCallerAfterStop:true});const caller=f.begin();caller.catch(()=>{});await f.started.promise;
 const ordinary=f.context.closeManagedTaskProjectHost();ordinary.catch(()=>{});let completed=false;ordinary.then(()=>{completed=true;},()=>{});
 await tick();await tick();assert.equal(f.stopCalls,0);
 f.scope.shutdownRequested=true;const quit=f.context.closeManagedTaskProjectHost();assert.equal(quit,ordinary);
 try{
  await tick();await tick();assert.equal(f.stopCalls,1,'explicit quit must upgrade prior drain instead of deadlocking behind Host callback');
  assert.equal(completed,false,'Host stop must not claim the still-running local callback drained');assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);
  assert.ok(f.events.indexOf('WORKERS')<f.events.indexOf('HOST_STOP'));assert.ok(!f.events.includes('UNBIND'));
  assert.ok(f.events.includes('LOCAL_CALLBACK_START'));assert.ok(!f.events.includes('LOCAL_CALLBACK_END'));
  assert.equal(f.context.closeManagedTaskProjectHost(),ordinary);assert.equal(f.stopCalls,1);
 }finally{f.releaseLocalCallback();f.cap.ready();f.query.reject(Error('UNKNOWN'));await caller.catch(()=>{});await ordinary.catch(()=>{});}
 assert.equal(completed,true);assert.equal(f.events.filter(e=>e==='UNBIND').length,1);
});

test('actual Main quit upgrade cannot bypass a failed native worker drain',async()=>{
 const f=mainFixture({workerFail:true,holdCallerAfterStop:true});const caller=f.begin();caller.catch(()=>{});await f.started.promise;
 const ordinary=f.context.closeManagedTaskProjectHost();ordinary.catch(()=>{});await tick();await tick();assert.equal(f.stopCalls,0);
 f.scope.shutdownRequested=true;assert.equal(f.context.closeManagedTaskProjectHost(),ordinary);
 await assert.rejects(ordinary,/worker drain unconfirmed/);assert.equal(f.stopCalls,0);assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);assert.ok(!f.events.includes('UNBIND'));
 f.releaseLocalCallback();f.cap.ready();f.query.reject(Error('UNKNOWN'));await caller.catch(()=>{});
});

test('quit upgrade stays latched but cannot bypass non-Host initialization cleanup',async()=>{
 const f=mainFixture({holdCallerAfterStop:true}),other=deferred();f.scope.nativeRuntimeInitializations.add(other.promise);
 const caller=f.begin();caller.catch(()=>{});await f.started.promise;const drain=f.context.closeManagedTaskProjectHost();drain.catch(()=>{});
 await tick();f.scope.shutdownRequested=true;assert.equal(f.context.closeManagedTaskProjectHost(),drain);await tick();
 assert.equal(f.stopCalls,0);assert.ok(f.events.includes('WORKERS'),'existing runtime admission fences before unrelated initialization joins');
 other.resolve();await tick();await tick();assert.equal(f.stopCalls,1);assert.ok(!f.events.includes('LOCAL_CALLBACK_END'));
 f.releaseLocalCallback();await caller.catch(()=>{});assert.equal((await drain).cleanup_confirmed,true);assert.equal(f.stopCalls,1);
});

test('actual Main setup route timeout retains exact scope and prevents overlapping Owner/activation; no ordinary Host stop',async()=>{
 const f=mainFixture(),read=f.context.readNativeSetupRoute();read.catch(()=>{});await f.started.promise;
 f.query.reject(Error('UNKNOWN'));await assert.rejects(read,nativeHostScopeCleanupHeld);await tick();
 assert.equal(f.scope.nativeSetupRouteInitializationsByBarrier.size,0);assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);assert.equal(f.stopCalls,0);
 await assert.rejects(f.begin(),/cleanup_unconfirmed/);await assert.rejects(f.context.createPreparedGoalActivationRouter({}).request('ACTIVATE_PREPARED_GOAL_V1',{}),/cleanup_unconfirmed/);
 f.cap.ready();await tick();await tick();assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);assert.equal(f.stopCalls,0);
});
test('actual Main explicit quit classifies pending setup route as Host scope before dispatch and reaches existing shutdown',async()=>{
 const f=mainFixture(),read=f.context.readNativeSetupRoute();read.catch(()=>{});await f.started.promise;
 const ordinary=f.context.closeManagedTaskProjectHost();await tick();assert.equal(f.stopCalls,0);
 f.scope.shutdownRequested=true;assert.equal(f.context.closeManagedTaskProjectHost(),ordinary);await ordinary;await assert.rejects(read);
 assert.equal(f.stopCalls,1);assert.ok(f.events.indexOf('WORKERS')<f.events.indexOf('HOST_STOP'));assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);
});

test('actual Main draft read is single-flight and retains physical scope after UNKNOWN, with no ensure',async()=>{
 const f=mainFixture(),repo={coordination_workspace_id:randomUUID()};f.scope.readManagedTaskProjectRepository=async()=>repo;
 f.scope.supervisorIdentity.ensure=()=>{throw Error('ensure forbidden');};
 const first=f.context.readCurrentClientDraftScope(),second=f.context.readCurrentClientDraftScope();await f.started.promise;
 assert.equal(f.events.filter(e=>e==='CAPABILITY').length,1);f.query.reject(Error('UNKNOWN'));
 assert.equal((await first).state,'UNKNOWN');assert.equal((await second).state,'UNKNOWN');await tick();
 assert.equal(f.scope.nativeInitializationCleanupCandidates.size,1);assert.equal(f.stopCalls,0);await assert.rejects(f.begin(),/cleanup_unconfirmed/);
 f.cap.ready();await tick();await tick();assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);
});
test('actual Main draft read joins quit upgrade through exact existing Host without waiting on remote response',async()=>{
 const f=mainFixture(),repo={coordination_workspace_id:randomUUID()};f.scope.readManagedTaskProjectRepository=async()=>repo;
 const pending=f.context.readCurrentClientDraftScope();await f.started.promise;const closing=f.context.closeManagedTaskProjectHost();await tick();assert.equal(f.stopCalls,0);
 f.scope.shutdownRequested=true;assert.equal(f.context.closeManagedTaskProjectHost(),closing);await closing;assert.equal((await pending).state,'UNKNOWN');
 assert.equal(f.stopCalls,1);assert.ok(f.events.indexOf('WORKERS')<f.events.indexOf('HOST_STOP'));assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);
});
test('actual Main draft read refuses a replaced identity object even if public tuple matches',async()=>{
 const f=mainFixture(),repo={coordination_workspace_id:randomUUID()};f.scope.readManagedTaskProjectRepository=async()=>repo;
 const pending=f.context.readCurrentClientDraftScope();await f.started.promise;f.scope.supervisorIdentity={...f.scope.supervisorIdentity};f.cap.ready();
 f.query.resolve({scope_resolved:true,retained_intent:true,authority_effect:false});assert.equal((await pending).state,'UNKNOWN');
});

test('actual Main published agent request after UNKNOWN reaches owned Host shutdown instead of waiting forever on SQL',async()=>{
 const f=mainFixture();f.scope.nativeCodingHostCapability=f.cap;
 // The public request already returned UNKNOWN; its exact private physical
 // row remains pending. There is no pending Owner/setup initialization.
 assert.equal(f.scope.nativeInitializationCleanupCandidates.size,0);f.scope.shutdownRequested=true;
 const closing=f.context.closeManagedTaskProjectHost();let done=false;closing.then(()=>{done=true;},()=>{});
 try{
  await tick();await tick();assert.equal(f.stopCalls,1,'published Host scope must reach the existing stop owner, not await pending SQL first');
  assert.ok(f.events.indexOf('WORKERS')<f.events.indexOf('HOST_STOP'));await closing;assert.equal(done,true);
 }finally{f.cap.ready();await closing.catch(()=>{});}
});

for(const upgrade of [false,true])test(`actual Main staged published drain reaches Host before held callback; ordinary upgrade=${upgrade}`,async()=>{
 const f=mainFixture(),workers=deferred(),callback=deferred();let fenced=false,fullStarts=0,done=false;
 f.scope.nativeCodingHostCapability=f.cap;
 f.scope.nativeCodingRuntime={drainNativeWorkers:async()=>{fenced=true;f.events.push('WORKERS');await workers.promise;
   return{schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false};},
  drainClosedWork:async()=>{fullStarts++;await callback.promise;return workerProof;}};
 f.scope.shutdownRequested=!upgrade;const closing=f.context.closeManagedTaskProjectHost();closing.then(()=>{done=true;},()=>{});
 try{
  await tick();assert.equal(fenced,true);assert.equal(f.stopCalls,0,'pending actual tree drain cannot fall through to Host stop');
  if(upgrade){f.scope.shutdownRequested=true;assert.equal(f.context.closeManagedTaskProjectHost(),closing);}
  await tick();assert.equal(f.stopCalls,0);workers.resolve();await tick();await tick();
  assert.equal(f.stopCalls,1);assert.equal(done,false);assert.equal(fullStarts,1);assert.equal(f.scope.nativeCodingHostCapability,f.cap);
  assert.equal(f.context.closeManagedTaskProjectHost(),closing);assert.equal(f.stopCalls,1);
 }finally{workers.resolve();callback.resolve();f.cap.ready();await closing;}
 assert.equal(done,true);assert.equal(f.cap.events.filter(e=>e==='CLOSE').length,1);
});
test('actual Main ordinary full runtime join upgrades after worker proof and never repeats its callback close',async()=>{
 const f=mainFixture(),callback=deferred(),entered=deferred();let fullStarts=0;
 f.scope.nativeCodingHostCapability=f.cap;f.scope.nativeCodingRuntime={
  drainNativeWorkers:async()=>{f.events.push('WORKERS');return{schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false};},
  drainClosedWork:async()=>{fullStarts++;entered.resolve();await callback.promise;return workerProof;}};
 const ordinary=f.context.closeManagedTaskProjectHost();await entered.promise;assert.equal(f.stopCalls,0);
 f.scope.shutdownRequested=true;assert.equal(f.context.closeManagedTaskProjectHost(),ordinary);await tick();await tick();
 try{assert.equal(f.stopCalls,1);assert.equal(fullStarts,1);assert.equal(f.scope.nativeCodingHostCapability,f.cap);}
 finally{callback.resolve();await ordinary;}
});
test('published physical HOLD remains retained and explicit quit retries cleanup only against one owned Host shutdown',async()=>{
 const f=mainFixture();f.scope.nativeCodingHostCapability=f.cap;
 const original=f.cap.drainPhysical;let held=true;
 f.cap.drainPhysical=options=>held?Promise.reject(Error('generated transport HOLD')):original(options);
 await assert.rejects(f.context.closeManagedTaskProjectHost(),nativeHostScopeCleanupHeld);assert.equal(f.stopCalls,0);assert.equal(f.scope.nativeCodingHostCapability,f.cap);
 held=false;f.scope.shutdownRequested=true;const quit=f.context.closeManagedTaskProjectHost();assert.equal((await quit).cleanup_confirmed,true);
 assert.equal(f.stopCalls,1);assert.equal(f.cap.events.filter(e=>e==='CLOSE').length,1);
});
test('unconfirmed or rejected exact Host shutdown stays fenced and is never issued twice',async()=>{
 for(const rejected of [false,true]){
  const f=mainFixture();f.scope.nativeCodingHostCapability=f.cap;f.scope.shutdownRequested=true;let stops=0;
  f.scope.stopOwnedLocalRuntimeHost=async()=>{stops++;if(rejected)throw Error('generated shutdown failure');return{cleanup_confirmed:false};};
  for(let i=0;i<2;i++)await assert.rejects(f.context.closeManagedTaskProjectHost());
  assert.equal(stops,1);assert.equal(f.scope.nativeCodingHostCapability,f.cap);assert.equal(f.scope.managedTaskProjectHostDrainPending,true);
  assert.ok(!f.cap.events.includes('CLOSE'));
 }
});
test('synchronous worker fence sees the already-published Main drain promise under reentrant quit',async()=>{
 const f=mainFixture();f.scope.nativeCodingHostCapability=f.cap;f.scope.shutdownRequested=true;let reentered,workerCalls=0;
 f.scope.nativeCodingRuntime={drainNativeWorkers:async()=>{workerCalls++;reentered=f.context.closeManagedTaskProjectHost();
  return{schema:'metaengine.native-coding.runtime-worker-drain.v1',admission_fenced:true,worker_cleanup_confirmed:true,authority_effect:false};},drainClosedWork:async()=>workerProof};
 const original=f.context.closeManagedTaskProjectHost();assert.equal(reentered,original);assert.equal(workerCalls,1);
 assert.equal((await original).cleanup_confirmed,true);assert.equal(f.stopCalls,1);
});
