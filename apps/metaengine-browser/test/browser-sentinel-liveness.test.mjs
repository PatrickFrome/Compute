import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { BrowserParentProgressLease } from '../src/browser-parent-progress-lease.mjs';

const require = createRequire(import.meta.url);
const {
  parentProgressPath,
  evaluateParentProgress,
  DEFAULT_PARENT_PROGRESS_STALE_MS,
} = require('../src/browser-sentinel-liveness.cjs');

const now = Date.parse('2026-09-01T00:00:00Z');
function state(overrides={}) { return {
  schema:'metaengine.browser-sentinel.state.v1', token:'sentinel-token', parent_pid:process.pid,
  lifecycle:'ARMED', expected_restart:false, installer_handoff:false,
  created_at:new Date(now-300_000).toISOString(), authority_effect:false, ...overrides,
}; }
function progress(overrides={}) { return {
  schema:'metaengine.browser-sentinel.parent-progress.v1', token:'sentinel-token', parent_pid:process.pid,
  progress_seq:9, progress_at:new Date(now-5_000).toISOString(), authority_effect:false, ...overrides,
}; }

test('fresh exact parent progress proves health while PID liveness alone is never evaluated as enough',()=>{
  const out=evaluateParentProgress({state:state(),progress:progress(),nowMs:now});
  assert.equal(out.state,'HEALTHY');assert.equal(out.terminate_parent,false);assert.equal(out.progress_bound,true);assert.equal(out.authority_effect,false);
});

test('missing progress receives startup grace then becomes recoverable stale parent',()=>{
  const early=evaluateParentProgress({state:state({created_at:new Date(now-10_000).toISOString()}),progress:null,nowMs:now});
  assert.equal(early.state,'STARTUP_GRACE');assert.equal(early.terminate_parent,false);
  const late=evaluateParentProgress({state:state(),progress:null,nowMs:now});
  assert.equal(late.state,'PROGRESS_MISSING');assert.equal(late.terminate_parent,true);assert.equal(late.automatic_retry_allowed,false);
});

test('stale or wrong-incarnation progress cannot keep a wedged parent healthy',()=>{
  const stale=evaluateParentProgress({state:state(),progress:progress({progress_at:new Date(now-DEFAULT_PARENT_PROGRESS_STALE_MS-1).toISOString()}),nowMs:now});
  assert.equal(stale.state,'PROGRESS_STALE');assert.equal(stale.terminate_parent,true);
  const wrong=evaluateParentProgress({state:state(),progress:progress({token:'old-token'}),nowMs:now});
  assert.equal(wrong.state,'PROGRESS_MISSING');assert.equal(wrong.terminate_parent,true);
});

test('self-update, planned shutdown and prior termination intent suppress duplicate recovery',()=>{
  for(const s of [state({expected_restart:true}),state({installer_handoff:true}),state({lifecycle:'PLANNED_SHUTDOWN'})]){
    const out=evaluateParentProgress({state:s,progress:null,nowMs:now});assert.equal(out.state,'SUPPRESSED_EXPECTED_TRANSITION');assert.equal(out.terminate_parent,false);
  }
  const attempted=evaluateParentProgress({state:state({parent_liveness_termination_attempted:true}),progress:null,nowMs:now});
  assert.equal(attempted.state,'TERMINATION_ALREADY_ATTEMPTED');assert.equal(attempted.terminate_parent,false);
});

test('parent progress lease is exact-token exact-pid and contains no scheduling authority',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-parent-progress-'));
  const statePath=path.join(dir,'metaengine-browser-sentinel-v1.json');
  await fs.writeFile(statePath,JSON.stringify(state()),{mode:0o600});
  const lease=new BrowserParentProgressLease({statePath});
  const row=await lease.mark({kind:'EVENT_LOOP_HEARTBEAT'});
  const disk=JSON.parse(await fs.readFile(parentProgressPath(statePath),'utf8'));
  assert.equal(disk.token,'sentinel-token');assert.equal(disk.parent_pid,process.pid);assert.equal(disk.progress_kind,'EVENT_LOOP_HEARTBEAT');
  assert.equal(disk.authority_effect,false);assert.equal(Object.hasOwn(disk,'task_id'),false);assert.equal(Object.hasOwn(disk,'lease_generation'),false);assert.equal(row.automatic_retry_allowed,false);
});

test('parent progress lease serializes concurrent writes and delegates fsync durability to the shared committed-record helper',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-parent-progress-concurrent-'));
  const statePath=path.join(dir,'metaengine-browser-sentinel-v1.json');
  await fs.writeFile(statePath,JSON.stringify(state()),{mode:0o600});
  const lease=new BrowserParentProgressLease({statePath});
  const rows=await Promise.all(Array.from({length:16},(_,index)=>lease.mark({kind:'CONTROL_PLANE_CYCLE',detail:`step-${index}`})));
  assert.deepEqual(rows.map((row)=>row.progress_seq),Array.from({length:16},(_,index)=>index+1));
  const disk=JSON.parse(await fs.readFile(parentProgressPath(statePath),'utf8'));
  assert.equal(disk.progress_seq,16);assert.equal(disk.detail,'step-15');assert.equal(disk.authority_effect,false);
  const names=await fs.readdir(dir);
  assert.equal(names.some((name)=>name.endsWith('.tmp')),false);
  const leaseSource=await fs.readFile(new URL('../src/browser-parent-progress-lease.mjs',import.meta.url),'utf8');
  const durableSource=await fs.readFile(new URL('../src/durable-json-file.cjs',import.meta.url),'utf8');
  assert.match(leaseSource,/durableWriteJson\(parentProgressPath\(this\.#statePath\), row/);
  assert.match(durableSource,/await handle\.sync\(\)/);
  assert.match(durableSource,/await committed\.sync\(\)/);
  assert.match(durableSource,/await syncDirectory\(directory\)/);
});

test('failed progress mark does not poison the serialized write tail',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-parent-progress-recovery-'));
  const statePath=path.join(dir,'metaengine-browser-sentinel-v1.json');
  let binding=state({token:''});
  const lease=new BrowserParentProgressLease({statePath,getBinding:()=>binding});
  await assert.rejects(()=>lease.mark({kind:'CONTROL_PLANE_CYCLE'}),/binding_invalid/);
  binding=state();
  const recovered=await lease.mark({kind:'CONTROL_PLANE_CYCLE',detail:'after-failure'});
  assert.equal(recovered.progress_seq,1);assert.equal(recovered.detail,'after-failure');assert.equal(recovered.authority_effect,false);
});

test('worker persists one-shot termination and relaunch intents around the exact-parent absence boundary',async()=>{
  const source=await fs.readFile(new URL('../src/browser-sentinel-worker.cjs',import.meta.url),'utf8');
  const terminateStart=source.indexOf('async function terminateStalledParentOnce');
  const terminateEnd=source.indexOf('async function relaunchOnce');
  const terminateSource=source.slice(terminateStart,terminateEnd);
  const beginTermination=terminateSource.indexOf('await journal.beginTermination(state, decision)');
  const kill=terminateSource.indexOf("process.kill(PARENT_PID, 'SIGTERM')");
  const confirmed=terminateSource.indexOf("markTermination(state, 'PARENT_TERMINATION_CONFIRMED'");
  assert.ok(beginTermination>=0&&kill>beginTermination&&confirmed>kill);

  const relaunchStart=source.indexOf('async function relaunchOnce');
  const relaunchEnd=source.indexOf('async function main');
  const relaunchSource=source.slice(relaunchStart,relaunchEnd);
  const beginRelaunch=relaunchSource.indexOf("await journal.beginRelaunch(state, 'EXACT_OLD_PARENT_ABSENT')");
  const spawn=relaunchSource.indexOf('spawn(state.executable');
  assert.ok(beginRelaunch>=0&&spawn>beginRelaunch);

  const absentGuard=source.lastIndexOf('if (parentAlive()) return;');
  const relaunch=source.lastIndexOf('await relaunchOnce(state, journal)');
  assert.ok(absentGuard>=0&&relaunch>absentGuard);
  assert.match(source,/journal\.terminationAttempted\(\)/);
  assert.match(source,/journal\.relaunchAttempted\(\)/);
  assert.match(source,/PARENT_TERMINATION_AMBIGUOUS/);
  assert.match(source,/automatic_retry_allowed: false/);
  assert.equal(source.includes('devos_fleet_lease_v1'),false);
});
