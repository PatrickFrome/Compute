import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import {createLoadedNativeRunOwnerCallback} from '../src/native-coding-run-owner-main.mjs';
import {createNativeCodingRuntime} from '../src/native-coding-runtime.mjs';
import {validateNativeCodingInstalledPathScope} from '../src/native-coding-operator-paths.mjs';

const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('function assertNativeCodingRuntimeMountOpen(');
const end=source.indexOf('\nfunction createNativeGoalRouter(',start);
assert.ok(start>=0&&end>start);
const turn=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the actual Main mount and real direct callback. Identity/Host and
// installed paths are generated doubles; this does not attest loaded code,
// Windows, installed PostgreSQL or production readiness.
function fixture({readOwner,realRuntime=false,operatorMutation}={}){
 const events=[],instanceId=randomUUID(),deviceId=randomUUID(),clientId=randomUUID();
 const host={instance_id:instanceId,host_pid:1234,closed:false};
 const device={enrolled:true,device_id:deviceId,client_id:clientId,key_fingerprint_sha256:'a'.repeat(64)};
 const summary={instance_id:instanceId,pid:host.host_pid,status_file:path.resolve('generated-main-host','status.json')};
 const resourcesPath=path.resolve('generated-install','resources'),stateDirectory=path.dirname(summary.status_file);
 const state={summary,capabilityCreates:0,stagePrepares:0};let captured,runtime,ownerCalls=0;
 const forbidden=name=>(..._args)=>{events.push(name);throw Error('generated_forbidden_'+name);};
 const capability={snapshot:()=>({...host}),readScope:async()=>({bindings:[{device_id:deviceId,client_id:clientId,device:{...device},permit:{
  provider_id:randomUUID(),agent_id:'agent_generated123',role:'IMPLEMENTER',physical_slot_budget:1,
  artifact:{cli_executable_sha256:'b'.repeat(64)}}}]}),
  readLease:forbidden('read-lease'),registerProvider:forbidden('register-provider'),agentOperation:forbidden('agent-effect'),
  reserveExecution:forbidden('legacy-reserve'),advanceExecution:forbidden('advance-execution'),readExecution:forbidden('read-execution'),
  prepareAgentRunCustody:forbidden('prepare-custody'),reservePreparedExecution:forbidden('reserve-prepared'),
  takePreparedAgentRunCustody:forbidden('take-custody'),abandonPreparedAgentRunCustody:forbidden('abandon-custody'),
  openAgentRunCustody:forbidden('legacy-custody'),withRunOwnerScope:forbidden('nested-owner-ipc'),drainPhysical:forbidden('global-drain'),
  close:forbidden('capability-close')};
 const identity={snapshot:()=>({...device}),async readLoadedRunOwnerW74(input){
  ownerCalls++;events.push('direct-owner');input.assertLifetime();
  assert.equal(typeof input.readSourceProof,'function');assert.equal(typeof input.readNativeKernel,'function');
  const value=readOwner?await readOwner(input,ownerCalls):{source_only:true,production_qualified:false};
  input.assertLifetime();return value;
 }};
 const runtimeStub={snapshot:()=>({schema:'metaengine.native-coding.runtime.v1',closed:false,shutdown_state:'OPEN',host_unavailable_reason:null})};
 const scope={app:{isPackaged:true},path,Promise,Set,Error,Date,process:{resourcesPath},
  fs:{lstat:async()=>({isFile:()=>true})},globalThis:{},
  runtimeRecoveryGenerationLost:false,shutdownRequested:false,managedTaskProjectHostDrainPending:false,
  managedTaskProjectHostClosing:Promise.resolve(),nativeCodingRuntimeMountFailure:null,nativeCodingRuntimeMountPromise:null,
  nativeCodingRuntime:null,nativeCodingHostCapability:null,nativeCodingRuntimeMountGeneration:null,nativeCodingRuntimeMountCustody:null,
  nativeCodingRuntimeMountDiagnostic:null,nativeRuntimeInitializations:new Set(),nativeCodingCapacityOwner:null,
  readOwnedLocalRuntimeHostSummary:()=>state.summary,
  readOwnedLocalRuntimeHostRecoveryObservation:async()=>({schema:'metaengine.browser.runtime-host-generation.v1',ever_ready:true,
   stopping:false,exited:false,transport_failed:false,terminal_rejected:false,terminal:null,
   instance_id:instanceId,host_pid:host.host_pid,launch_nonce:'generated-launch'}),
  readNativeCodingOperatorPaths:async()=>{
   const value={schema:'metaengine.native-coding.operator-paths.v1',
    cli_executable:path.join(resourcesPath,'client-state-runtime','runtime','codex','codex.exe'),
    git_executable:path.join(resourcesPath,'client-state-runtime','runtime','git','bin','git.exe'),
    ...Object.fromEntries(['codex_home','journal_root','worker_temp_root','result_index_root'].map(key=>[key,path.join(stateDirectory,key)])),
    sandbox_receipts:Object.fromEntries(['IMPLEMENTER','CRITIC'].map(role=>[role,{path:path.join(stateDirectory,role+'.json'),sha256:'c'.repeat(64)}]))};
   operatorMutation?.(value);return value;
  },validateNativeCodingInstalledPathScope,
  createOwnedNativeCodingHostCapability:value=>{state.capabilityCreates++;assert.equal(value,summary);return capability;},
  prepareNativeWorkspaceFromStage:async value=>{state.stagePrepares++;value.assertOpen();},ensureSupervisorIdentity:()=>identity,
  resolveNativeCodingSandboxPin:()=>({generated_only:true}),readAgentResourceAdmission:()=>({physical_start_allowed:true,physical_parallelism:1}),
  nativeSupervisor:{snapshot:()=>({supervisor_mode:'CONTROL',armed:true,continuous_service:{interrupted_setup_recovery_fenced:false,runtime_control:{generation_floor:0}}}),
   bindNativeCodingRuntime:value=>{events.push('bind-runtime');assert.equal(value,runtime);},nativeCodingRequest:forbidden('w30-effect')},
  autonomousProjectRuntime:null,createLoadedNativeRunOwnerCallback,
  readLoadedNativeRunOwner:forbidden('standalone-owner-read'),
  createNativeCodingRuntime:options=>{
   captured=options;
   runtime=realRuntime?createNativeCodingRuntime({...options,
    observers:{prepareInstalledImage:forbidden('prepare-image')},
    issuer:{issueProvider:forbidden('issue-provider'),issueJob:forbidden('issue-job'),close:async()=>{}},
    workerRegistry:{controllerFor:forbidden('worker-controller'),close:async()=>({schema:'metaengine.native-coding.workers-close.v1',cleanup_confirmed:true})},
    permitRegistry:{listProviderSelectors:forbidden('list-providers'),readProvider:forbidden('read-permit')},
    resultStore:{publish:forbidden('publish-result'),resolveRunnerSubject:forbidden('resolve-subject')},
    runnerFactory:forbidden('prepare-runner')}):runtimeStub;
   return runtime;
  }};
 const context=vm.createContext(scope);vm.runInContext(source.slice(start,end),context);
 const abort=new AbortController(),original={signal:abort.signal,assertOpen(){if(abort.signal.aborted)throw Error('generated_scope_closed');}};
 return {scope,state,host,device,events,identity,capability,original,abort,mount:()=>context.ensureNativeCodingRuntimeMounted(),
  get captured(){return captured;},get runtime(){return runtime;},get ownerCalls(){return ownerCalls;}};
}

test('actual Main mount supplies the direct transaction callback to the default runtime without a factory override',async()=>{
 const f=fixture();assert.equal((await f.mount()).mounted,true);
 assert.equal(f.captured.identity,f.identity);assert.equal(f.captured.ownPostgres,f.capability);
 assert.equal(typeof f.captured.readPreparedRunOwner,'function');
 assert.equal(Object.hasOwn(f.captured,'preparedCustodyFactory'),false);
 for(let cycle=0;cycle<6;cycle++)assert.deepEqual(await f.captured.readPreparedRunOwner(f.original),{source_only:true,production_qualified:false});
 assert.equal(f.ownerCalls,6);assert.equal(f.events.includes('nested-owner-ipc'),false);
 assert.equal(f.events.includes('standalone-owner-read'),false);assert.equal(f.events.includes('global-drain'),false);
});

for(const field of ['cli_executable','git_executable','codex_home'])test('actual Main refuses preinstalled/old-profile '+field+' before private capability or preparation',async()=>{
 const f=fixture({operatorMutation:operator=>{operator[field]=path.resolve('preinstalled-or-old-profile',field);}});
 await assert.rejects(f.mount(),/native_coding_installed_path_scope_/);
 assert.equal(f.state.capabilityCreates,0);assert.equal(f.state.stagePrepares,0);assert.equal(f.captured,undefined);
 assert.equal(f.scope.nativeCodingRuntimeMountDiagnostic.reason,'INSTALLED_DEPENDENCY_SCOPE_UNBOUND');
 assert.equal(f.ownerCalls,0);assert.deepEqual(f.events,[]);
});

for(const change of ['mount-barrier','host-summary','generation-lost','shutdown','installer-stop','host-closed','host-instance','device-key'])
 test('actual Main callback fences '+change+' between original Owner phases',async()=>{
  const f=fixture();await f.mount();await f.captured.readPreparedRunOwner(f.original);
  if(change==='mount-barrier')f.scope.managedTaskProjectHostClosing=Promise.resolve();
  if(change==='host-summary')f.state.summary={...f.state.summary};
  if(change==='generation-lost')f.scope.runtimeRecoveryGenerationLost=true;
  if(change==='shutdown')f.scope.shutdownRequested=true;
  if(change==='installer-stop')f.scope.globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__=true;
  if(change==='host-closed')f.host.closed=true;
  if(change==='host-instance')f.host.instance_id=randomUUID();
  if(change==='device-key')f.device.key_fingerprint_sha256='c'.repeat(64);
  await assert.rejects(f.captured.readPreparedRunOwner(f.original),/changed|closing|fresh_browser_required/);
  assert.equal(f.ownerCalls,1);assert.equal(f.events.includes('nested-owner-ipc'),false);
 });

for(const change of ['mount-barrier','scope-abort'])test('actual Main retains a pending native Owner read across '+change,async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();
 const f=fixture({readOwner:async({scope})=>{assert.equal(scope,f.original);entered.resolve();await release.promise;return {source_only:true};}});
 await f.mount();let settled=false;
 const pending=f.captured.readPreparedRunOwner(f.original);pending.then(()=>settled=true,()=>settled=true);
 await entered.promise;
 if(change==='mount-barrier')f.scope.managedTaskProjectHostClosing=Promise.resolve();else f.abort.abort();
 await turn();assert.equal(settled,false);
 release.resolve();await assert.rejects(pending,/changed|closed/);assert.equal(f.ownerCalls,1);
 assert.equal(f.events.includes('global-drain'),false);
});

test('actual Main default runtime remains CLOSED before prepared custody, reserve, broker, worker or W30 effects',async()=>{
 const f=fixture({realRuntime:true});await f.mount();
 try{
  const lease={task_id:randomUUID(),lease_generation:1};
  assert.deepEqual((await f.runtime.observeProviders()).providers,[]);
  for(const call of ['dispatchLease','advanceUnattemptedLease']){
   const result=f.runtime[call](lease);assert.equal(result.state,'HOLD');assert.equal(result.reason,'NATIVE_CALLBACK_PUBLICATION_UNQUALIFIED');
   assert.equal(result.authority_effect,false);assert.equal(result.automatic_retry_allowed,false);
  }
  await turn();assert.equal(f.ownerCalls,0);
  assert.deepEqual(f.events,['bind-runtime']);assert.equal(f.runtime.snapshot().occupied_slots,0);
  assert.equal(f.runtime.snapshot().production_qualified,false);
 }finally{assert.equal((await f.runtime.close()).shutdown_state,'DRAINED');}
});

for(const value of [null,{source_only:true,loaded_runtime_code_attested:false,execution_ready:false}])
 test('direct '+(value===null?'missing':'SOURCE_ONLY')+' Owner observation cannot open the actual Main runtime',async()=>{
  const f=fixture({realRuntime:true,readOwner:async()=>value});await f.mount();
  try{
   assert.equal(await f.captured.readPreparedRunOwner(f.original),value);
   const result=f.runtime.dispatchLease({task_id:randomUUID(),lease_generation:1});
   assert.equal(result.state,'HOLD');assert.equal(result.reason,'NATIVE_CALLBACK_PUBLICATION_UNQUALIFIED');
   assert.deepEqual(f.events,['bind-runtime','direct-owner']);assert.equal(f.runtime.snapshot().occupied_slots,0);
  }finally{assert.equal((await f.runtime.close()).shutdown_state,'DRAINED');}
 });
