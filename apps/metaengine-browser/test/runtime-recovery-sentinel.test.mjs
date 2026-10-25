import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {HostResilienceRuntime} from './helpers/host-resilience-offline-fixture.mjs';
const {BrowserSentinelHost,readSentinelState,runtimeRecoverySentinelFencePath}=await import('../src/browser-sentinel.mjs');
const {evaluateParentProgress}=createRequire(import.meta.url)('../src/browser-sentinel-liveness.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function privateFixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-runtime-recovery-sentinel-')));
  t.after(async()=>{assert.ok(root.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(root,{recursive:true,force:true});});
  return {root,statePath:path.join(root,'sentinel.json')};
}
async function endChild(child) {
  if(child.exitCode!==null||child.signalCode!==null)return;
  const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();
  let timer;try{await Promise.race([ended,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('inert_child_stop_timeout')),8000);})]);}finally{clearTimeout(timer);}
}

test('runtime-recovery ticket survives before-quit and cannot become updater/installer authority',async t=>{
  const {root,statePath}=await privateFixture(t),app=new EventEmitter(),calls=[];
  const sentinel=new BrowserSentinelHost({statePath,workerScript:path.join(root,'unused-fixture.cjs'),executable:process.execPath,
    spawnImpl:(exe,args,options)=>{calls.push({exe,args,options});return {pid:4242,unref(){}};},processAliveImpl:()=>true});
  await sentinel.start({app});const ticket=randomUUID();
  await sentinel.prepareRuntimeRecovery(ticket);app.emit('before-quit');
  const state=await readSentinelState(statePath);
  assert.equal(state.lifecycle,'RUNTIME_RECOVERY');assert.equal(state.runtime_recovery_ticket,ticket);
  assert.equal(state.expected_restart,true);assert.equal(state.installer_handoff,false);assert.equal(state.relaunch_attempted,false);
  const fence=JSON.parse(await fs.readFile(runtimeRecoverySentinelFencePath(statePath,state.token),'utf8'));
  assert.equal(fence.ticket_id,ticket);assert.equal(fence.parent_pid,process.pid);
  assert.equal(calls.length,1,'only the initial inert worker was requested, not another Browser');
  assert.equal((await sentinel.prepareRuntimeRecovery(ticket)).runtime_recovery_ticket,ticket);
  await assert.rejects(sentinel.prepareRuntimeRecovery(randomUUID()),/transition_conflict/);
  await assert.rejects(sentinel.prepareRuntimeRecovery('--arbitrary-command'),/ticket_invalid/);
  const decision=evaluateParentProgress({state:{...state,expected_restart:false},progress:null,nowMs:Date.now()});
  assert.equal(decision.terminate_parent,false);assert.equal(decision.relaunch_allowed,false);
});

test('HostResilience forwards the dedicated purpose only to a current ready Sentinel',async t=>{
  const {root}=await privateFixture(t),calls=[],ticket=randomUUID();
  let ready=true;
  const binding={schema:'metaengine.browser-sentinel.state.v1',token:randomUUID(),parent_pid:process.pid,worker_pid:4242,
    lifecycle:'ARMED',expected_restart:false,installer_handoff:false,worker_released:false,authority_effect:false};
  const sentinel={start:async()=>({...binding,worker_ready:ready}),waitUntilHealthy:async()=>({...binding,worker_ready:ready}),
    snapshot:()=>({...binding,worker_ready:ready}),prepareRuntimeRecovery:async value=>calls.push(value),stop:async()=>{},
    recoverWorkerIfProvenAbsent:async()=>({state:'UNNECESSARY',recovered:false,authority_effect:false})};
  const electron={app:{isPackaged:true,getPath:()=>root,setLoginItemSettings(){},getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:true})},powerMonitor:new EventEmitter()};
  const old=process.env.METAENGINE_DISABLE_CRASH_SENTINEL;delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;
  t.after(()=>{if(old===undefined)delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;else process.env.METAENGINE_DISABLE_CRASH_SENTINEL=old;});
  const runtime=new HostResilienceRuntime({electron,platform:'win32',sentinelFactory:()=>sentinel});
  t.after(()=>runtime.stop());await runtime.start();await runtime.prepareRuntimeRecovery(ticket);
  assert.deepEqual(calls,[ticket]);ready=false;
  await assert.rejects(runtime.prepareRuntimeRecovery(ticket),/not_ready_for_runtime_recovery/);assert.equal(calls.length,1);
});

test('real Sentinel worker exits readback-only after inert parent death, with no fallback relaunch producer',async t=>{
  const {statePath}=await privateFixture(t),token=randomUUID(),ticket=randomUUID();
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,shell:false});
  await new Promise((resolve,reject)=>{parent.once('spawn',resolve);parent.once('error',reject);});
  t.after(()=>endChild(parent));
  // A stale writer has restored ARMED/false: the independent durable purpose
  // fence must still deny the generic liveness/relaunch producer.
  const state={schema:'metaengine.browser-sentinel.state.v1',token,parent_pid:parent.pid,executable:process.execPath,
    worker_pid:null,worker_released:false,lifecycle:'ARMED',runtime_recovery_ticket:null,
    expected_restart:false,installer_handoff:false,created_at:new Date().toISOString(),authority_effect:false};
  await fs.writeFile(runtimeRecoverySentinelFencePath(statePath,token),JSON.stringify({schema:'metaengine.browser-sentinel.runtime-recovery-fence.v1',
    token,parent_pid:parent.pid,executable:process.execPath,ticket_id:ticket,authority_effect:false}));
  await fs.writeFile(statePath,JSON.stringify(state));
  const worker=spawn(process.execPath,[fileURLToPath(new URL('../src/browser-sentinel-worker.cjs',import.meta.url))],
    {stdio:'ignore',windowsHide:true,shell:false,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',METAENGINE_SENTINEL_STATE_PATH:statePath,
      METAENGINE_SENTINEL_TOKEN:token,METAENGINE_SENTINEL_PARENT_PID:String(parent.pid)}});
  await new Promise((resolve,reject)=>{worker.once('spawn',resolve);worker.once('error',reject);});
  t.after(()=>endChild(worker));await fs.writeFile(statePath,JSON.stringify({...state,worker_pid:worker.pid}));
  const deadline=Date.now()+15000;
  let heartbeat;
  while(Date.now()<deadline){heartbeat=await fs.readFile(statePath+'.worker-heartbeat-v1.json','utf8').then(JSON.parse).catch(()=>null);if(heartbeat?.worker_pid===worker.pid)break;await delay(50);}
  assert.equal(heartbeat?.worker_pid,worker.pid);
  const exited=new Promise(resolve=>worker.once('exit',resolve));await endChild(parent);
  let timer;try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('runtime_recovery_worker_did_not_hold')),10000);})]);}finally{clearTimeout(timer);}
  const journal=JSON.parse(await fs.readFile(statePath+'.action-journal-v1.json','utf8'));
  assert.equal(journal.state,'SENTINEL_ERROR');assert.equal(journal.result,'runtime_recovery_owned_by_main_transaction');
  assert.equal(journal.automatic_retry_allowed,false);assert.equal(journal.physical_effect_attempted,false);assert.equal(journal.effect_barrier_crossed,false);
  await assert.rejects(fs.access(statePath+'.relaunch-v1.json'),{code:'ENOENT'});
});
