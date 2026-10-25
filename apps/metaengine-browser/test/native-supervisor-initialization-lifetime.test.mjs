import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {drainManagedRuntimeBindings} from '../src/managed-runtime-drain.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function tracked(promise){const state={settled:false};state.result=promise.then(value=>{state.settled=true;return {value};},error=>{state.settled=true;return {error};});return state;}

// Run the production startup, relay helper and close together. Only the native
// dependencies are fixtures; these tests never open a socket, process or DB.
async function mainFixture({pause=null,cleanupFailure=null}={}){
  const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
  const declarations=main.slice(main.indexOf('let nativeSupervisor = null;'),main.indexOf('const managedTaskProjectClientControl ='));
  const composition=main.slice(main.indexOf('async function initGithubChatRelay('),main.indexOf('function destroyWindowContents()'));
  const recoverySource=main.slice(main.indexOf('async function ensureInterruptedSetupRecovery('),main.indexOf("ipcMain.handle('metaengine:client:interrupted-setup-inspect'"));
  assert.ok(declarations.length>0&&composition.length>0);
  const gate=deferred(),entered=deferred(),events=[],counts={managed:0,project:0,rpc:0,relay:0,mount:0,start:0,command:0,chatCommand:0,goal:0,
    recovery:0,recoverySnapshot:0,recoveryApplyFleet:0,recoveryApplySupervisor:0},recoveryConstructions=[];
  let rpcOptions=null,relayOptions=null;
  const wait=async kind=>{if(pause===kind){entered.resolve();await gate.promise;}};
  let running=false;
  const managed={state:'READY',snapshot(){return {schema:'metaengine.devos.managed-task-project-host.v1',state:this.state,in_flight:0};},
    async close(){events.push('managed.close');if(cleanupFailure==='managed')throw Error('fixture managed cleanup unknown');this.state='CLOSED';}};
  const project={closed:false,snapshot(){return {schema:'metaengine.devos.autonomous-project-runtime.v1',pending_effects:0,in_flight_operations:0};},
    bindNativeCodingRuntime(){},async close(){events.push('project.close');if(cleanupFailure==='project')throw Error('fixture project cleanup unknown');this.closed=true;}};
  const rpc={state:'NEW',async start(){counts.rpc++;await wait('rpc');this.state='LISTENING';return this.snapshot();},
    async stop(){events.push('rpc.stop');if(cleanupFailure==='rpc')throw Error('fixture rpc cleanup unknown');this.state='STOPPED';return this.snapshot();},
    snapshot(){return {state:this.state,port:this.state==='LISTENING'?49152:null,last_error:null};}};
  const relay={state:'ACTIVE',stop(){events.push('relay.stop');if(cleanupFailure==='relay')throw Error('fixture relay cleanup unknown');this.state='REVOKED';return this.snapshot();},
    snapshot(){return {schema:'metaengine.github-chat-relay.v1',state:this.state,authority_effect:false};}};
  const supervisor={snapshot:()=>({running}),stop(){events.push('supervisor.stop');running=false;},
    async start(){counts.start++;await wait('start');running=true;return this.snapshot();},
    bindDevosProjectRuntime(value){if(value)events.push('project.bind');},bindNativeCodingRuntime(){},
    managedTaskProjectRequest:async()=>({}),setInterruptedSetupRecoveryFence(){events.push('supervisor.setRecoveryFence');},
    chatCommandSubmit:async()=>{counts.chatCommand++;return {};},clientGoalSubmit:async()=>{counts.goal++;return {};},
    archiveInterruptedBootstrapForNewEpoch:()=>{counts.recoveryApplySupervisor++;return {};}};
  const scope={Promise,Set,Map,Error,console,globalThis:{},shutdownRequested:false,fixtureSupervisor:supervisor,
    supervisorLoopbackRpc:null,githubChatRelay:null,githubChatRelayError:null,githubChatSetup:null,shellBrainPortConsumerId:'fixture',
    app:{getPath:()=> 'C:/fixture/private',getVersion:()=> 'fixture'},safeStorage:{},shell:{openPath:async()=>''},
    fleet:{snapshot:()=>{counts.recoverySnapshot++;return {};},archiveInterruptedBootstrapAgents:()=>{counts.recoveryApplyFleet++;return {};}},
    registry:{snapshot:()=>({tabs:[]})},
    path:{join:(...parts)=>parts.join('/')},fs:{lstat:async()=>null},
    createManagedTaskProjectBindingTransport:()=>({reserveBinding:()=>{},finalizeBinding:()=>{}}),
    createManagedTaskProjectAuthorityResolver:()=>()=>{},createManagedTaskProjectRepositoryProvisioner:()=>()=>{},
    createManagedTaskProjectHost:async()=>{counts.managed++;await wait('managed');return counts.managed===1?managed:{...managed,state:'READY'};},
    createAutonomousProjectHost:async()=>{counts.project++;await wait('project');return project;},
    ensureNativeCodingRuntimeMounted:async()=>{counts.mount++;return null;},
    InterruptedSetupRecovery:class{constructor(options){counts.recovery++;recoveryConstructions.push({options,instance:this});}
      async init(){await wait('recovery');return {fenced:false};}status(){return {fenced:false};}},
    prepareManagedTaskProjectStorage:async()=>{await wait('storage');return 'C:/fixture/private/projects';},
    verifyManagedProjectPrivateFile:async()=>{},SupervisorLoopbackRpcServer:function(options){rpcOptions=options;return rpc;},
    executeNativeSupervisorCommand:async()=>{counts.command++;return {};},executeNativeSupervisorCommandFenced:()=>{},
    nativeSupervisorState:()=>({}),readClientConnectionStatus:()=>({}),readClientWorkReadiness:()=>({}),
    startInstalledGithubChatRelay:async options=>{relayOptions=options;counts.relay++;await wait('relay');return relay;},
    ensureSupervisorIdentity:()=>({snapshot:()=>({client_id:'fixture-client'})}),explicitLocalSupervisorBase:()=>true,
    CHAT_COMMAND_ACTIONS:[],computerExecutor:{snapshot:()=>({})},
    attachShellBrainPort:()=>{},publishSnapshot:async()=>{},recordStartupSubsystemDegraded:(name,error)=>events.push(name+':'+error.message),
    drainManagedRuntimeBindings};
  const context=vm.createContext(scope);vm.runInContext(declarations+composition+recoverySource+'\nnativeSupervisor=fixtureSupervisor;',context);
  const state=()=>vm.runInContext('({host:managedTaskProjectHost,project:autonomousProjectRuntime,rpc:supervisorLoopbackRpc,relay:githubChatRelay,recovery:interruptedSetupRecovery,closing:managedTaskProjectHostClosing,drain:managedTaskProjectHostDrainPending,pending:nativeRuntimeInitializations.size})',context);
  return {context,scope,gate,entered,events,counts,managed,project,rpc,relay,supervisor,state,recoveryConstructions,
    get rpcOptions(){return rpcOptions;},get relayOptions(){return relayOptions;},get recoveryOptions(){return recoveryConstructions.at(-1)?.options;},
    init:()=>tracked(context.initNativeSupervisor()),close:()=>tracked(context.closeManagedTaskProjectHost()),
    custody:()=>vm.runInContext('typeof nativeInitializationCleanupCandidates===\'undefined\'?[]:[...nativeInitializationCleanupCandidates]',context),
    set:(name,value)=>{scope.fixtureValue=value;vm.runInContext(name+'=fixtureValue;',context);delete scope.fixtureValue;}};
}

test('actual close waits for a deferred managed constructor and prevents its late publication',async()=>{
  const f=await mainFixture({pause:'managed'}),initialization=f.init();await f.entered.promise;
  const closing=f.close();await turn();assert.equal(closing.settled,false,'close must include already registered startup');
  f.gate.resolve();await initialization.result;const result=await closing.result;
  assert.equal(result.error,undefined);assert.equal(result.value.cleanup_confirmed,true);
  assert.equal(f.state().host,null);assert.equal(f.managed.state,'CLOSED');
  assert.equal(f.counts.project,0);assert.equal(f.counts.mount,0);assert.equal(f.counts.start,0);assert.equal(f.state().pending,0);
});

test('a deferred autonomous constructor is closed before the existing managed host is released',async()=>{
  const f=await mainFixture({pause:'project'});f.set('managedTaskProjectHost',f.managed);
  const initialization=f.init();await f.entered.promise;const closing=f.close();await turn();assert.equal(closing.settled,false);
  f.gate.resolve();await initialization.result;const result=await closing.result;assert.equal(result.error,undefined);
  assert.equal(f.state().project,null);assert.equal(f.state().host,null);assert.equal(f.project.closed,true);
  assert.ok(f.events.indexOf('project.close')<f.events.indexOf('managed.close'));
  assert.equal(f.events.includes('project.bind'),false);assert.equal(f.counts.mount,0);assert.equal(f.counts.start,0);
});

test('a deferred RPC listen cannot survive actual teardown as an unpublished server',async()=>{
  const f=await mainFixture({pause:'rpc'}),initialization=f.init();await f.entered.promise;
  const closing=f.close();await turn();assert.equal(closing.settled,false);
  f.gate.resolve();await initialization.result;assert.equal((await closing.result).error,undefined);
  assert.equal(f.rpc.state,'STOPPED');assert.equal(f.state().rpc,null);assert.equal(f.counts.relay,0);
  assert.ok(f.events.includes('rpc.stop'));assert.equal(f.state().pending,0);
});

test('the actual relay startup helper stops a relay returned after its initialization lifetime closed',async()=>{
  const f=await mainFixture({pause:'relay'}),initialization=f.init();await f.entered.promise;
  const closing=f.close();await turn();assert.equal(closing.settled,false);
  f.gate.resolve();await initialization.result;assert.equal((await closing.result).error,undefined);
  assert.equal(f.relay.state,'REVOKED');assert.equal(f.state().relay,null);assert.ok(f.events.includes('relay.stop'));
});

test('an initialization waiting on the old barrier never waits on the close which captures it',async()=>{
  const f=await mainFixture(),old=deferred();f.set('managedTaskProjectHostClosing',old.promise);
  const initialization=f.init(),closing=f.close();await turn();assert.equal(initialization.settled,false);assert.equal(closing.settled,false);
  old.resolve();await initialization.result;const result=await closing.result;
  assert.equal(result.error,undefined);assert.equal(result.value.cleanup_confirmed,true);
  assert.equal(f.counts.managed,0);assert.equal(f.counts.mount,0);assert.equal(f.counts.start,0);assert.equal(f.state().pending,0);
});

test('a new initialization waits on the new close barrier without joining its captured old snapshot',async()=>{
  const f=await mainFixture({pause:'managed'}),old=f.init();await f.entered.promise;
  const closing=f.close(),fresh=f.init();await turn();assert.equal(closing.settled,false);assert.equal(fresh.settled,false);
  f.gate.resolve();await old.result;assert.equal((await closing.result).error,undefined);await fresh.result;
  assert.equal(f.counts.managed,2,'fresh startup must run after the old candidate was closed');
  assert.notEqual(f.state().host,f.managed);assert.equal(f.state().host.snapshot().state,'READY');
  assert.equal(f.managed.state,'CLOSED');assert.equal(f.state().drain,false);assert.equal(f.state().pending,0);
});

test('a stale candidate whose cleanup fails remains in custody and prevents a false successful empty drain',async()=>{
  const f=await mainFixture({pause:'managed',cleanupFailure:'managed'}),initialization=f.init();await f.entered.promise;
  const closing=f.close();f.gate.resolve();await initialization.result;const result=await closing.result;
  assert.match(result.error?.message||'',/cleanup|drain|initialization/);
  assert.ok(f.events.includes('managed.close'));assert.equal(f.state().drain,true);
  assert.ok(f.state().host===f.managed||f.custody().some(record=>record.candidate===f.managed),'the exact unconfirmed candidate must remain reachable by the physical drain');
  assert.equal(f.state().closing,f.context.closeManagedTaskProjectHost());
  const calls=f.counts.managed,next=f.init();await next.result;assert.equal(f.counts.managed,calls);
});

for(const pause of ['recovery','start','storage'])test(`actual teardown waits for pending ${pause} initialization and denies later activation`,async()=>{
  const f=await mainFixture({pause}),initialization=f.init();await f.entered.promise;
  const closing=f.close();await turn();assert.equal(closing.settled,false);
  f.gate.resolve();await initialization.result;assert.equal((await closing.result).error,undefined);
  assert.equal(f.state().host,null);assert.equal(f.state().project,null);assert.equal(f.state().rpc,null);assert.equal(f.state().relay,null);
  assert.equal(f.counts.rpc,0);assert.equal(f.counts.relay,0);
  if(pause==='start')assert.equal(f.supervisor.snapshot().running,false,'late start must be stopped again before drain is confirmed');
});

test('an RPC candidate still starting cannot execute a command after its captured lifetime closes',async()=>{
  const f=await mainFixture({pause:'rpc'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  await assert.rejects(async()=>f.rpcOptions.executeCommand({action:'fixture'}),/closing|changed|lost|initialization|lifetime/);
  assert.equal(f.counts.command,0);f.gate.resolve();await initialization.result;await closing.result;
});

test('relay control callbacks cannot submit commands or goals while their unpublished relay finishes stale startup',async()=>{
  const f=await mainFixture({pause:'relay'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  await assert.rejects(async()=>f.relayOptions.control.commandSubmit({}),/closing|changed|lost|initialization|lifetime/);
  await assert.rejects(async()=>f.relayOptions.control.goalSubmit({}),/closing|changed|lost|initialization|lifetime/);
  assert.equal(f.counts.chatCommand,0);assert.equal(f.counts.goal,0);
  f.gate.resolve();await initialization.result;await closing.result;
});

test('a late Supervisor start is stopped on the captured old instance rather than a successor',async()=>{
  const f=await mainFixture({pause:'start'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  let successorStops=0;const successor={...f.supervisor,snapshot:()=>({running:true}),stop:()=>{successorStops++;}};
  f.set('nativeSupervisor',successor);f.gate.resolve();await initialization.result;await closing.result;
  assert.equal(f.supervisor.snapshot().running,false);assert.equal(successorStops,0);
});

test('a stale recovery failure never applies its fence to a successor Supervisor',async()=>{
  const f=await mainFixture({pause:'recovery'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  let successorFences=0;const successor={...f.supervisor,setInterruptedSetupRecoveryFence:()=>{successorFences++;}};
  f.set('nativeSupervisor',successor);f.gate.reject(Error('fixture stale recovery failure'));
  await initialization.result;await closing.result;assert.equal(successorFences,0);
});

test('the actual recovery helper cannot clear its fence or publish recovery after teardown during init',async()=>{
  const f=await mainFixture({pause:'recovery'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  const fenceCalls=f.events.filter(value=>value==='supervisor.setRecoveryFence').length;
  f.gate.resolve();await initialization.result;await closing.result;
  assert.equal(f.events.filter(value=>value==='supervisor.setRecoveryFence').length,fenceCalls);
  assert.equal(f.state().recovery,null);
});

test('a failed local RPC start never stops or clears a successor published RPC',async()=>{
  const f=await mainFixture({pause:'rpc'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  let successorStops=0;const successor={snapshot:()=>({state:'LISTENING',last_error:null}),stop:async()=>{successorStops++;}};
  f.set('supervisorLoopbackRpc',successor);f.gate.reject(Error('fixture stale listen failure'));
  await initialization.result;await closing.result;
  assert.equal(successorStops,0);assert.equal(f.state().rpc,successor);
});

test('concurrent startup in one lifetime shares construction and the actual successful initialization path',async()=>{
  const f=await mainFixture({pause:'managed'}),first=f.init(),second=f.init();await f.entered.promise;await turn();
  assert.equal(f.counts.managed,1);f.gate.resolve();
  assert.equal((await first.result).error,undefined);assert.equal((await second.result).error,undefined);
  assert.equal(f.counts.project,1);assert.equal(f.counts.start,1);assert.equal(f.counts.rpc,1);assert.equal(f.counts.relay,1);
  assert.equal(f.state().host,f.managed);assert.equal(f.state().rpc,f.rpc);assert.equal(f.state().relay,f.relay);
  assert.equal(f.state().pending,0);
});

test('an old rejected close barrier cannot be converted into successful initialization or drain',async()=>{
  const f=await mainFixture(),failure=Error('fixture previous cleanup unknown'),prior=Promise.reject(failure);prior.catch(()=>{});
  f.set('managedTaskProjectHostClosing',prior);const initialization=f.init(),closing=f.close();
  assert.ok((await initialization.result).error);assert.equal((await closing.result).error,failure);
  assert.equal(f.counts.managed,0);assert.equal(f.counts.start,0);assert.equal(f.state().drain,true);
});

test('same-barrier Supervisor substitution cannot redirect a provisional relay goal callback to its successor',async()=>{
  const f=await mainFixture({pause:'relay'}),initialization=f.init();await f.entered.promise;
  const barrier=f.state().closing;let successorGoals=0;
  f.set('nativeSupervisor',{...f.supervisor,clientGoalSubmit:async()=>{successorGoals++;return {};}});
  await assert.rejects(async()=>f.relayOptions.control.goalSubmit({}),/supervisor_changed|initialization|lifetime/);
  assert.equal(f.state().closing,barrier,'this rejection must not depend on teardown changing the barrier');
  assert.equal(successorGoals,0);assert.equal(f.counts.goal,0);
  f.gate.resolve();await initialization.result;await f.close().result;
});

test('actual recovery callbacks reject teardown while init is pending before reading or applying fleet and Supervisor state',async()=>{
  const f=await mainFixture({pause:'recovery'}),initialization=f.init();await f.entered.promise;const closing=f.close();
  for(const callback of [f.recoveryOptions.getSnapshot,f.recoveryOptions.applyFleet,f.recoveryOptions.applySupervisor])
    await assert.rejects(async()=>callback({}),/initialization|lifetime|changed|closing/);
  assert.equal(f.counts.recoverySnapshot,0);assert.equal(f.counts.recoveryApplyFleet,0);assert.equal(f.counts.recoveryApplySupervisor,0);
  f.gate.resolve();await initialization.result;await closing.result;
});

test('a new recovery lifetime reloads the same protected journal with fresh callbacks and rejects the cached old callbacks',async()=>{
  const f=await mainFixture(),first=await f.context.ensureInterruptedSetupRecovery(),old=f.recoveryOptions;
  assert.equal((await f.close().result).error,undefined);
  const current=await f.context.ensureInterruptedSetupRecovery(),fresh=f.recoveryOptions;
  assert.notEqual(current,first);assert.equal(f.counts.recovery,2);
  assert.equal(fresh.directory,old.directory,'a new lifetime must read the existing protected journal');
  for(const callback of [old.getSnapshot,old.applyFleet,old.applySupervisor])
    await assert.rejects(async()=>callback({}),/initialization|lifetime|changed|closing/);
  assert.equal(f.counts.recoverySnapshot,0);assert.equal(f.counts.recoveryApplyFleet,0);assert.equal(f.counts.recoveryApplySupervisor,0);
  await fresh.getSnapshot();await fresh.applyFleet({});await fresh.applySupervisor({});
  assert.equal(f.counts.recoverySnapshot,1);assert.equal(f.counts.recoveryApplyFleet,1);assert.equal(f.counts.recoveryApplySupervisor,1);
});

test('same-barrier Fleet replacement refreshes cached recovery against the same journal without redirecting old callbacks',async()=>{
  const f=await mainFixture(),first=await f.context.ensureInterruptedSetupRecovery(),old=f.recoveryOptions,barrier=f.state().closing;
  let snapshots=0,applications=0;
  f.scope.fleet={snapshot:()=>{snapshots++;return {instance:'successor-fleet'};},
    archiveInterruptedBootstrapAgents:()=>{applications++;return {};}};
  const current=await f.context.ensureInterruptedSetupRecovery(),fresh=f.recoveryOptions;
  assert.equal(f.state().closing,barrier);assert.notEqual(current,first);assert.equal(f.counts.recovery,2);
  assert.equal(fresh.directory,old.directory);
  for(const callback of [old.getSnapshot,old.applyFleet,old.applySupervisor])
    await assert.rejects(async()=>callback({}),/fleet_changed|initialization|lifetime|changed/);
  assert.equal(f.counts.recoverySnapshot,0);assert.equal(f.counts.recoveryApplyFleet,0);assert.equal(f.counts.recoveryApplySupervisor,0);
  assert.equal(snapshots,0);assert.equal(applications,0);
  assert.equal((await fresh.getSnapshot()).fleet.instance,'successor-fleet');await fresh.applyFleet({});
  assert.equal(snapshots,1);assert.equal(applications,1);assert.equal(f.counts.recoveryApplyFleet,0);
});
