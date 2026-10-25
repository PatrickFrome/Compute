import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8');
const mount=source.slice(source.indexOf('async function startInstalledRuntimeRecovery()'),source.indexOf('async function initNativeSupervisor()'));
const init=source.slice(source.indexOf('async function initNativeSupervisor()'),source.indexOf('function destroyWindowContents()'));
function fixture(){
  const events=[],state={update:null,epoch:0,shutdown:false,installedShutdown:false},bindings=[];
  let dependencies;
  const scope={app:{isPackaged:true},isSmoke:false,isDevelopmentPlaneSmoke:false,
    runtimeRecoveryController:null,runtimeRecoveryGenerationLost:false,runtimeRecoveryGateEpoch:0,runtimeRecoveryPlannedQuit:false,
    shutdownRequested:false,globalThis:{__METAENGINE_HOST_RESILIENCE_RUNTIME__:{prepareRuntimeRecovery:async ticket=>events.push('sentinel:'+ticket)}},
    process:{env:{}},persistentLocalProviderBootstrap:{state:'READY',actual_fixture_bootstrap:true},
    readOwnedLocalRuntimeHostSummary:()=>null,readOwnedLocalRuntimeHostRecoveryObservation:async()=>null,
    subscribeOwnedLocalRuntimeHostGeneration:()=>{},createInstalledRuntimeRecoveryBindingReader:options=>{bindings.push(options);return async()=>({});},
    createRuntimeRecoveryMainController:options=>{dependencies=options;return {start:async()=>events.push('start')};},
    nativeSupervisor:{snapshot:()=>({self_update:state.update}),stop:()=>events.push('fence')},
    nativeRuntimeInitializations:new Set(),supervisorLoopbackRpc:{stop:async()=>events.push('rpc-drained')},
    closeManagedTaskProjectHost:async()=>{await scope.supervisorLoopbackRpc?.stop();events.push('workers-drained');return {schema:'metaengine.managed-runtime-drain.v1',cleanup_confirmed:true};},
    drainManagedRuntimeBindings:async()=>({schema:'metaengine.managed-runtime-drain.v1',cleanup_confirmed:true}),
    console:{log:()=>{}},Error,Promise};
  const context=vm.createContext(scope);vm.runInContext(mount+init,context);
  return {scope,state,bindings,events,get dependencies(){return dependencies;},start:()=>context.startInstalledRuntimeRecovery(),init:()=>context.initNativeSupervisor()};
}
test('actual main mount uses normal bootstrap and actual controller; installer/update/quit hold its private gate',async()=>{
  const f=fixture();await f.start();assert.deepEqual(f.events,['start']);assert.equal(f.bindings[0].getBootstrap(),f.scope.persistentLocalProviderBootstrap);
  assert.equal(f.dependencies.readGate().state,'OPEN');f.scope.shutdownRequested=true;assert.equal(f.dependencies.readGate().state,'HOLD');
  f.scope.shutdownRequested=false;f.scope.globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__=true;assert.equal(f.dependencies.readGate().state,'HOLD');
  f.scope.globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__=false;f.state.update={state:'RESTARTING'};assert.equal(f.dependencies.readGate().state,'HOLD');
  f.state.update={state:'IDLE',install_effect_quarantined:true};assert.equal(f.dependencies.readGate().state,'HOLD');
});
test('actual main mount fences delayed initialization and waits for its settlement before physical drain',async()=>{
  const f=fixture();await f.start();f.dependencies.fenceNative();assert.equal(f.scope.runtimeRecoveryGenerationLost,true);
  await assert.rejects(f.init(),/fresh_browser_required/);
  let finish;const pending=new Promise(resolve=>{finish=resolve;});f.scope.nativeRuntimeInitializations.add(pending);
  const draining=f.dependencies.drain();await new Promise(resolve=>setImmediate(resolve));assert.ok(!f.events.includes('workers-drained'));
  finish();await draining;assert.deepEqual(f.events.slice(-2),['rpc-drained','workers-drained']);
});
test('actual main authorizes same-version relaunch only through dedicated live Sentinel handoff',async()=>{
  const f=fixture();await f.start();await f.dependencies.beforeRelaunch('synthetic-ticket');
  assert.equal(f.events.at(-1),'sentinel:synthetic-ticket');assert.equal(f.scope.runtimeRecoveryPlannedQuit,true);
  f.scope.runtimeRecoveryPlannedQuit=false;delete f.scope.globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;
  await assert.rejects(f.dependencies.beforeRelaunch('synthetic-ticket'),/sentinel_unavailable/);assert.equal(f.scope.runtimeRecoveryPlannedQuit,false);
});
