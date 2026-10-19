import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifyResidentSentinelReadback,RESIDENT_SENTINEL_SCHEMA}
  from '../scripts/qa-resident-sentinel-readback.mjs';

const pid=7401,worker=7402,exe='C:\\Program Files\\METAENGINE Browser Test\\METAENGINE Browser Test.exe';
const now=Date.parse('2026-10-19T03:15:00.000Z');
function witness(){
 const token=randomUUID();
 return {parentPid:pid,executable:exe,nowMs:now,
  state:{schema:'metaengine.browser-sentinel.state.v1',token,
    parent_pid:pid,worker_pid:worker,worker_script:'C:\\x\\browser-sentinel-worker.cjs',
    executable:exe,worker_released:false,installer_handoff:false,
    relaunch_attempted:false,authority_effect:false},
  heartbeat:{schema:'metaengine.browser-sentinel.worker-heartbeat.v1',
    token,parent_pid:pid,worker_pid:worker,lifecycle:'READY',
    heartbeat_at:new Date(now-900).toISOString(),authority_effect:false},
  process:{ProcessId:worker,ParentProcessId:4,
    ExecutablePath:exe,
    CommandLine:'"'+exe+'" "C:\\x\\browser-sentinel-worker.cjs"'}};
}
test('healthy detached Windows Sentinel needs custody, heartbeat and exact OS image',()=>{
 const proof=verifyResidentSentinelReadback(witness());
 assert.equal(proof.schema,RESIDENT_SENTINEL_SCHEMA);
 assert.equal(proof.state,'VERIFIED');
 assert.equal(proof.worker_pid,worker);
 assert.equal(proof.os_parent_pid_matches,false);
 assert.equal(proof.authority_effect,false);
 assert.equal(proof.automatic_retry_allowed,false);
 assert.equal(proof.production_authorized,false);
});
test('parent-match path also requires identical authoritative custody proof',()=>{
 const x=witness();x.process.ParentProcessId=pid;
 assert.equal(verifyResidentSentinelReadback(x).os_parent_pid_matches,true);
});
test('recycled PID, spoofed executable, swapped token or wrong worker path fail closed',()=>{
 for(const change of [
  x=>{x.process.ProcessId=77;},
  x=>{x.process.ExecutablePath='C:\\Elsewhere\\METAENGINE Browser Test.exe';},
  x=>{x.process.CommandLine='node.exe "C:\\x\\unrelated.js"';},
  x=>{x.state.token=randomUUID();},
  x=>{x.heartbeat.worker_pid=worker+1;},
  x=>{x.state.parent_pid=999;},
  x=>{x.state.worker_released=true;},
  x=>{x.state.installer_handoff=true;},
  x=>{x.state.authority_effect=true;},
  x=>{x.heartbeat.authority_effect=true;},
  x=>{x.heartbeat.lifecycle='STOPPED';},
  x=>{x.state.worker_script='C:\\x\\other.cjs';},
 ]){
  const x=witness();change(x);
  assert.throws(()=>verifyResidentSentinelReadback(x),/resident_sentinel_/);
 }
});
test('stale heartbeat, future heartbeat, invalid parent identity and missing OS readback fail closed',()=>{
 for(const t of [now-8001,now+1100,NaN]){
  const x=witness();x.heartbeat.heartbeat_at=Number.isNaN(t)?'invalid':new Date(t).toISOString();
  assert.throws(()=>verifyResidentSentinelReadback(x),/resident_sentinel_worker_heartbeat_stale/);
 }
 for(const change of [x=>{x.process=null},x=>{x.parentPid=-1},x=>{x.executable='relative.exe'}]){
  const x=witness();change(x);assert.throws(()=>verifyResidentSentinelReadback(x),/resident_sentinel_/);
 }
});
