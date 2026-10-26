import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import { HostResilienceRuntime } from './helpers/host-resilience-offline-fixture.mjs';
import { BrowserSentinelHost, browserSentinelWorkerHeartbeatPath } from '../src/browser-sentinel.mjs';
import { SelfUpdateRuntime } from '../src/self-update-runtime-v8.mjs';
import { drainManagedRuntimeBindings } from '../src/managed-runtime-drain.mjs';
const require=createRequire(import.meta.url);
const {evaluateParentProgress,DEFAULT_PARENT_PROGRESS_STALE_MS,parentProgressPath}=require('../src/browser-sentinel-liveness.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture(t,{recover=false}={}) {
  const old=process.env.METAENGINE_DISABLE_CRASH_SENTINEL;delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;
  t.after(()=>{if(old===undefined)delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;else process.env.METAENGINE_DISABLE_CRASH_SENTINEL=old;});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-stop-fence-'));
  const app=new EventEmitter();Object.assign(app,{isPackaged:true,getPath:()=>dir,
    getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:true})});
  const f={app,dir,statePath:null,sentinel:null,spawns:0,recoveries:0,stops:0,quitRequests:0,resumes:0,monitor:new EventEmitter()};
  app.quit=()=>{f.quitRequests++;};
  f.runtime=new HostResilienceRuntime({electron:{app,powerMonitor:f.monitor},onResume:async()=>{f.resumes++;},platform:'win32',sentinelFactory:options=>{
    f.statePath=options.statePath;
    const sentinel=f.sentinel=new BrowserSentinelHost({...options,processAliveImpl:pid=>!recover||pid!==424241,
      spawnImpl:()=>{const child=new EventEmitter();child.pid=424240+(++f.spawns);child.unref=()=>{};
        queueMicrotask(()=>child.emit('spawn'));return child;}});
    const wait=sentinel.waitUntilHealthy.bind(sentinel),recovery=sentinel.recoverWorkerIfProvenAbsent.bind(sentinel),stop=sentinel.stop.bind(sentinel);
    sentinel.waitUntilHealthy=async(...args)=>{
      const state=sentinel.snapshot();await fs.writeFile(browserSentinelWorkerHeartbeatPath(f.statePath),JSON.stringify({
        schema:'metaengine.browser-sentinel.worker-heartbeat.v1',token:state.token,parent_pid:process.pid,
        worker_pid:state.worker_pid,lifecycle:'READY',heartbeat_at:new Date().toISOString(),authority_effect:false}));return wait(...args);
    };
    sentinel.recoverWorkerIfProvenAbsent=async(...args)=>{f.recoveries++;return recovery(...args);};
    sentinel.stop=async(...args)=>{f.stops++;return stop(...args);};
    return sentinel;
  }});
  f.cleanup=async()=>{await f.runtime.stop().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});};
  assert.equal((await f.runtime.start()).sentinel_bootstrap.state,'HEALTHY');
  return f;
}

function failPlannedWrite(t,f) {
  const rename=fsSync.renameSync;let attempts=0;
  const mocked=t.mock.method(fsSync,'renameSync',(from,to)=>{
    if(to===f.statePath){attempts++;throw Object.assign(Error('inert planned write failure'),{code:'EIO'});}
    return rename(from,to);
  });
  return {restore:()=>mocked.mock.restore(),attempts:()=>attempts};
}
function requestQuit(app) {let prevented=false;assert.doesNotThrow(()=>app.emit('before-quit',{get defaultPrevented(){return prevented;},preventDefault(){prevented=true;}}));return prevented;}

test('failed real Sentinel commit retains heartbeat beyond stale horizon without recovery, retry, quit or re-admission',async t=>{
  const startMs=Date.now();t.mock.timers.enable({apis:['Date'],now:startMs});
  const timers=[];t.mock.method(globalThis,'setInterval',(callback,delay)=>{const timer={callback,delay,cleared:false,unref(){}};timers.push(timer);return timer;});
  t.mock.method(globalThis,'clearInterval',timer=>{timer.cleared=true;});
  const f=await fixture(t);const failure=failPlannedWrite(t,f);
  try {
    await assert.rejects(f.runtime.stop(),/host_resilience_stop_unconfirmed/);
    assert.equal(f.runtime.snapshot().state,'STOP_UNCONFIRMED');
    assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'ARMED');
    assert.equal(requestQuit(f.app),true,'ordinary Quit must retain the same unresolved shutdown fence');
    f.monitor.emit('resume');await turn();assert.equal(f.resumes,0,'stop holds resume/re-admission as well as recovery');
    assert.equal(failure.attempts(),1,'ordinary Quit must not replay the failed planned commit');
    await assert.rejects(f.runtime.start(),/stop_latched/);
    for(const method of ['prepareExpectedRestart','prepareInstallerHandoff','prepareRuntimeRecovery'])
      await assert.rejects(f.runtime[method]('fixture'),/stop_latched/);
    const updater=new SelfUpdateRuntime({packaged:true,currentVersion:'0.0.1',updater:new EventEmitter(),hostResilience:f.runtime});
    assert.equal((await updater.start()).state,'ERROR');
    assert.equal(f.runtime.snapshot().external_stop_requested,true);
    assert.equal(timers.length,1,'shutdown must retain the old heartbeat scheduler, not create another');
    assert.equal(timers[0].cleared,false);
    const frozen=f.runtime.snapshot().parent_progress;
    const step=timers[0].delay;
    for(let elapsed=step;elapsed<=DEFAULT_PARENT_PROGRESS_STALE_MS+step;elapsed+=step){
      t.mock.timers.setTime(startMs+elapsed);
      const before=f.runtime.snapshot().parent_progress.progress_seq;
      timers[0].callback();
      // A public mark joins the same serialized lease; +2 proves the scheduled
      // heartbeat also ran, rather than the assertion keeping the parent alive.
      await f.runtime.markProgress({kind:'TEST_JOIN_HEARTBEAT_READBACK'});
      const current=f.runtime.snapshot();assert.equal(current.parent_progress.progress_seq,before+2);
      const state=JSON.parse(await fs.readFile(f.statePath,'utf8'));
      assert.equal(evaluateParentProgress({state,progress:current.parent_progress}).terminate_parent,false);
      assert.equal(current.state,'STOP_UNCONFIRMED');assert.equal(current.external_stop_requested,true);
    }
    const state=JSON.parse(await fs.readFile(f.statePath,'utf8'));
    assert.equal(evaluateParentProgress({state,progress:frozen}).terminate_parent,true,'test crossed the actual stale policy horizon');
    assert.equal(f.spawns,1);assert.equal(f.recoveries,0);assert.equal(f.stops,1);assert.equal(failure.attempts(),1);
    assert.equal(requestQuit(f.app),true);
    failure.restore();await f.runtime.stop();
    assert.equal(f.runtime.snapshot().state,'STOPPED');assert.equal(timers[0].cleared,true);
    assert.equal(requestQuit(f.app),false);
    await assert.rejects(f.runtime.start(),/stop_latched/,'a stopped lifetime is not a fresh generation');
  } finally {failure.restore();await f.cleanup();}
});

test('ordinary Quit failed marker is caught and held without replay until explicit stop',async t=>{
  const f=await fixture(t);const failure=failPlannedWrite(t,f);
  try {
    assert.equal(requestQuit(f.app),true);
    await assert.rejects(f.runtime.stop(),/host_resilience_stop_unconfirmed/);
    assert.equal(requestQuit(f.app),true);
    assert.equal(failure.attempts(),1);
    assert.equal(f.quitRequests,0);
    assert.equal(f.runtime.snapshot().state,'STOP_UNCONFIRMED');
    assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'ARMED');
    failure.restore();await f.runtime.stop();
    assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'PLANNED_SHUTDOWN');
  } finally {failure.restore();await f.cleanup();}
});

for(const quitKind of ['explicit stop','first ordinary Quit']) test(quitKind+' waits for an already-pending real Sentinel bind before writing the final marker',async t=>{
  const f=await fixture(t,{recover:true});
  let release,entered;const pending=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{entered=resolve;});
  const rename=fs.rename;let intercepted=false;
  const mocked=t.mock.method(fs,'rename',async(from,to)=>{
    if(to===f.statePath&&!intercepted){const row=JSON.parse(await fs.readFile(from,'utf8'));
      if(row.worker_recovery_state==='CANDIDATE_BOUND_PENDING_HEARTBEAT'){intercepted=true;entered();await pending;}}
    return rename(from,to);
  });
  try {
    await fs.unlink(browserSentinelWorkerHeartbeatPath(f.statePath));
    await f.runtime.markProgress({kind:'START_INERT_RECOVERY'});
    await Promise.race([reached,new Promise((_,reject)=>setTimeout(()=>reject(Error('fixture_bind_not_reached')),2000))]);
    if(quitKind==='first ordinary Quit')assert.equal(requestQuit(f.app),true);
    let settled=false;const stopping=f.runtime.stop().then(value=>{settled=true;return value;});
    await turn();await turn();
    assert.equal(settled,false,'STOPPED must not precede an outstanding candidate-binding write');
    assert.equal(requestQuit(f.app),true);
    const seq=f.runtime.snapshot().parent_progress.progress_seq;
    await f.runtime.markProgress({kind:'STILL_RESPONSIVE_DURING_STOP'});
    assert.equal(f.runtime.snapshot().parent_progress.progress_seq,seq+1);
    release();assert.equal((await stopping).state,'STOPPED');await turn();
    assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'PLANNED_SHUTDOWN');
    assert.equal(f.spawns,2);assert.equal(f.recoveries,1);assert.equal(f.stops,1);
    if(quitKind==='first ordinary Quit')assert.equal(f.quitRequests,1);
  } finally {release();mocked.mock.restore();await f.cleanup();}
});

test('late initial start cannot reopen a stop latch or recreate power handles',async t=>{
  const old=process.env.METAENGINE_DISABLE_CRASH_SENTINEL;delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;
  t.after(()=>{if(old===undefined)delete process.env.METAENGINE_DISABLE_CRASH_SENTINEL;else process.env.METAENGINE_DISABLE_CRASH_SENTINEL=old;});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-stop-during-start-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let release,entered,handles=0;const pending=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{entered=resolve;});
  const app=new EventEmitter();Object.assign(app,{isPackaged:true,getPath:()=>dir,getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:true})});
  const binding={schema:'metaengine.browser-sentinel.state.v1',token:'fixture-start-stop',parent_pid:process.pid,worker_pid:4242,
    worker_ready:true,worker_released:false,lifecycle:'ARMED',expected_restart:false,installer_handoff:false,authority_effect:false};
  const sentinel={start:async()=>binding,waitUntilHealthy:async()=>{entered();await pending;return binding;},snapshot:()=>({...binding}),
    stop:async()=>{binding.lifecycle='PLANNED_SHUTDOWN';return {...binding};}};
  const runtime=new HostResilienceRuntime({electron:{app,powerMonitor:new EventEmitter(),powerSaveBlocker:{start(){handles++;return 1;},isStarted:()=>true,stop(){}}},
    platform:'win32',sentinelFactory:()=>sentinel});
  const starting=assert.rejects(runtime.start(),/stop_latched/);await reached;
  let stopped=false;const stopping=runtime.stop().then(result=>{stopped=true;return result;});
  await turn();assert.equal(stopped,false);assert.equal(requestQuit(app),true);
  release();await starting;assert.equal((await stopping).state,'STOPPED');
  assert.equal(handles,0);assert.equal(runtime.snapshot().external_stop_requested,true);
  await assert.rejects(runtime.start(),/stop_latched/);
});

for(const order of ['sentinel-first','native-first']) test('ordinary quit preserves independent native/Host fences: '+order,async t=>{
  const f=await fixture(t);
  let releaseSentinel,releaseNative;
  const sentinelPending=new Promise(resolve=>{releaseSentinel=resolve;}),nativePending=new Promise(resolve=>{releaseNative=resolve;});
  const originalStop=f.sentinel.stop.bind(f.sentinel);
  f.sentinel.stop=async()=>{await sentinelPending;return originalStop();};
  let nativeStarted=false,nativeDone=false,hostDone=false,hostStops=0,exits=0;
  const event=()=>({defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
  f.app.quit=()=>{
    f.quitRequests++;
    const before=event();f.app.emit('before-quit',before);if(before.defaultPrevented)return;
    const will=event();f.app.emit('will-quit',will);if(!will.defaultPrevented)exits++;
  };
  // Production drain with controlled workers, plus the canonical main and
  // local-controller lifecycle ordering. Actual IPC custody is covered by the
  // local-provider-singleton-admission and controller/terminal test suites.
  f.app.on('before-quit',ev=>{
    if(nativeDone)return;ev.preventDefault();if(nativeStarted)return;nativeStarted=true;
    void drainManagedRuntimeBindings({coding:{close:async()=>{
      assert.equal(hostDone,false);await nativePending;assert.equal(hostDone,false);
      return {schema:'metaengine.native-coding.runtime.v1',shutdown_state:'DRAINED',worker_cleanup_confirmed:true};
    }}}).then(()=>{nativeDone=true;f.app.quit();});
  });
  f.app.on('will-quit',ev=>{
    if(hostDone)return;ev.preventDefault();assert.equal(nativeDone,true);hostStops++;
    void Promise.resolve().then(()=>{hostDone=true;f.app.quit();});
  });
  try {
    f.app.quit();f.app.quit();await turn();
    assert.equal(hostStops,0);assert.equal(exits,0);
    (order==='sentinel-first'?releaseSentinel:releaseNative)();
    await turn();await turn();assert.equal(hostStops,0);assert.equal(exits,0);
    (order==='sentinel-first'?releaseNative:releaseSentinel)();
    await turn();await turn();await turn();
    assert.equal(hostStops,1);assert.equal(exits,1);assert.equal(f.stops,1);
    assert.equal(f.runtime.snapshot().state,'STOPPED');
    assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'PLANNED_SHUTDOWN');
  } finally {releaseSentinel();releaseNative();await f.cleanup();}
});

test('stop joins an already-started explicit transition before committing its final marker',async t=>{
  const f=await fixture(t);let release,entered;
  const pending=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{entered=resolve;});
  const rename=fs.rename;let intercepted=false;
  const mocked=t.mock.method(fs,'rename',async(from,to)=>{
    if(to===f.statePath&&!intercepted){const row=JSON.parse(await fs.readFile(from,'utf8'));
      if(row.lifecycle==='EXPECTED_RESTART'){intercepted=true;entered();await pending;}}
    return rename(from,to);
  });
  try {
    const preparing=f.runtime.prepareExpectedRestart('EXPLICIT_FIXTURE_TRANSITION');await reached;
    let settled=false;const stopping=f.runtime.stop().then(row=>{settled=true;return row;});
    await turn();await turn();assert.equal(settled,false);
    assert.equal(requestQuit(f.app),true);
    release();await preparing;assert.equal((await stopping).state,'STOPPED');
    const final=await fs.readFile(f.statePath,'utf8');await turn();await turn();
    assert.equal(await fs.readFile(f.statePath,'utf8'),final,'no owned transition write can land after stop resolves');
    assert.equal(JSON.parse(final).lifecycle,'EXPECTED_RESTART','the pre-authorized transition is preserved, not invented by stop');
  } finally {release();mocked.mock.restore();await f.cleanup();}
});


for (const stage of ['before-stop','before-mutation','after-commit']) {
  const faults = stage === 'after-commit'
    ? ['missing','foreign-token','foreign-parent','wrong-lifecycle','wrong-revision']
    : (stage === 'before-mutation' ? ['foreign-token'] : ['missing','foreign-token','foreign-parent']);
  for (const fault of faults) test(`stop retains custody when durable marker proof is ${fault} ${stage}`,async t=>{
    const f=await fixture(t);
    const original=await fs.readFile(f.statePath,'utf8');
    const owned=JSON.parse(original),progressPath=parentProgressPath(f.statePath);
    let corruption=null,mutations=0,readHook=null,renameHook=null;
    const corrupt=()=>{
      const row={...owned};
      if(fault==='foreign-token')row.token='foreign-generation';
      if(fault==='foreign-parent')row.parent_pid=process.pid+1;
      if(fault==='wrong-lifecycle')row.lifecycle='ARMED';
      if(fault==='wrong-revision'){row.lifecycle='PLANNED_SHUTDOWN';row.state_revision=owned.state_revision+9;}
      corruption=fault==='missing'?null:JSON.stringify(row);
      if(corruption===null)fsSync.unlinkSync(f.statePath);else fsSync.writeFileSync(f.statePath,corruption);
      fsSync.writeFileSync(progressPath,JSON.stringify({schema:'metaengine.browser-sentinel.parent-progress.v1',
        token:row.token,parent_pid:row.parent_pid,progress_seq:899,progress_at:new Date().toISOString(),authority_effect:false}));
    };
    const rename=fsSync.renameSync;
    renameHook=t.mock.method(fsSync,'renameSync',(from,to)=>{
      const result=rename(from,to);
      if(to===f.statePath){mutations++;if(stage==='after-commit')corrupt();}
      return result;
    });
    if(stage==='before-stop')corrupt();
    if(stage==='before-mutation'){
      const read=fsSync.readFileSync;let reads=0;
      readHook=t.mock.method(fsSync,'readFileSync',(file,...args)=>{
        if(file===f.statePath&&++reads===2)corrupt();
        return read(file,...args);
      });
    }
    try {
      await assert.rejects(f.runtime.stop(),/host_resilience_stop_unconfirmed/);
      readHook?.mock.restore();
      assert.equal(f.runtime.snapshot().state,'STOP_UNCONFIRMED');
      assert.equal(f.runtime.snapshot().shutdown_latched,true);
      assert.equal(requestQuit(f.app),true,'ordinary quit cannot release missing or foreign marker custody');
      assert.equal(f.quitRequests,0);assert.equal(f.stops,1);
      assert.equal(mutations,stage==='after-commit'?1:0,'no write may overwrite an already foreign binding');
      const current=await fs.readFile(f.statePath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      assert.equal(current,corruption,'the unconfirmed record is not repaired or replaced automatically');
      if(['missing','foreign-token','foreign-parent'].includes(fault)){
        const foreignProgress=await fs.readFile(progressPath,'utf8');
        await assert.rejects(f.runtime.markProgress({kind:'INERT_POST_FAILURE_HEARTBEAT'}),/parent_progress_binding_unconfirmed/);
        assert.equal(await fs.readFile(progressPath,'utf8'),foreignProgress,'cached old identity cannot overwrite foreign progress');
        assert.equal(await fs.readFile(f.statePath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}),corruption);
      }
      await assert.rejects(f.runtime.start(),/stop_latched/);
      assert.equal(f.spawns,1);assert.equal(f.recoveries,0);
      renameHook.mock.restore();
      await fs.writeFile(f.statePath,original);
      assert.equal(requestQuit(f.app),true,'restoring exact bytes alone does not release the stop latch');
      assert.equal((await f.runtime.stop()).state,'STOPPED','only explicit same-custody revalidation may release the fence');
      assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'PLANNED_SHUTDOWN');
    } finally {
      readHook?.mock.restore();renameHook.mock.restore();
      await fs.writeFile(f.statePath,original);await f.cleanup();
    }
  });
}


test('successful stop joins an already-started exact parent-progress write before releasing custody',async t=>{
  const f=await fixture(t);const progressPath=parentProgressPath(f.statePath);
  let release,entered;const pending=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{entered=resolve;});
  const rename=fs.rename;let writes=0;
  const mocked=t.mock.method(fs,'rename',async(from,to)=>{
    if(to===progressPath){writes++;entered();await pending;}
    return rename(from,to);
  });
  try {
    const marking=f.runtime.markProgress({kind:'INERT_PENDING_PARENT_PROGRESS'});await reached;
    let stopped=false;const stopping=f.runtime.stop().then(row=>{stopped=true;return row;});
    await turn();await turn();
    assert.equal(JSON.parse(await fs.readFile(f.statePath,'utf8')).lifecycle,'PLANNED_SHUTDOWN');
    assert.equal(stopped,false,'owned heartbeat work must settle before STOPPED');
    assert.equal(requestQuit(f.app),true);
    assert.equal(f.runtime.snapshot().shutdown_parent_progress_only,false,'new marks cannot enter the draining tail');
    await f.runtime.markProgress({kind:'INERT_MARK_AFTER_TERMINAL_MARKER'});assert.equal(writes,1);
    release();await marking;assert.equal((await stopping).state,'STOPPED');
    const committed=await fs.readFile(progressPath,'utf8');await turn();await turn();
    assert.equal(await fs.readFile(progressPath,'utf8'),committed);
    assert.equal(requestQuit(f.app),false);assert.equal(f.spawns,1);assert.equal(f.recoveries,0);
  } finally {release();mocked.mock.restore();await f.cleanup();}
});
