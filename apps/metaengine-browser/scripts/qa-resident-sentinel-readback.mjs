#!/usr/bin/env node
// Read-only secondary witness for a detached legacy Sentinel. This is a
// CI diagnostic, not Owner authority, process-control or fallback permission.
// A surviving PID alone never establishes a Sentinel worker incarnation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESIDENT_SENTINEL_SCHEMA='metaengine.browser.qa-resident-sentinel-readback.v1';
const fail=x=>{throw new Error('resident_sentinel_'+x);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validPid=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const canonical=p=>typeof p==='string'&&path.win32.isAbsolute(p)&&!p.startsWith('\\\\')
  ?path.win32.normalize(p).toLowerCase():null;
export function verifyResidentSentinelReadback({
 parentPid,executable,state,heartbeat,process:observed,nowMs=Date.now()
}={}){
 if(!validPid(parentPid)||!canonical(executable)||!Number.isFinite(nowMs))fail('argument_identity_invalid');
 if(state?.schema!=='metaengine.browser-sentinel.state.v1'
   ||!uuid.test(state?.token||'')||state.parent_pid!==parentPid
   ||!validPid(state.worker_pid)
   ||state.worker_released!==false||state.installer_handoff!==false
   ||state.relaunch_attempted!==false||state.authority_effect!==false
   ||!canonical(state.executable)||canonical(state.executable)!==canonical(executable)
   ||typeof state.worker_script!=='string'
   ||path.win32.basename(state.worker_script).toLowerCase()!=='browser-sentinel-worker.cjs')
   fail('custody_state_unverified');
 if(heartbeat?.schema!=='metaengine.browser-sentinel.worker-heartbeat.v1'
   ||heartbeat.token!==state.token||heartbeat.parent_pid!==parentPid
   ||heartbeat.worker_pid!==state.worker_pid||heartbeat.lifecycle!=='READY'
   ||heartbeat.authority_effect!==false)fail('worker_heartbeat_unverified');
 const heartbeatAt=Date.parse(heartbeat.heartbeat_at);
 if(!Number.isFinite(heartbeatAt)||heartbeatAt>nowMs+1000||nowMs-heartbeatAt>8000)
   fail('worker_heartbeat_stale');
 if(!observed||observed.ProcessId!==state.worker_pid||!canonical(observed.ExecutablePath)
   ||canonical(observed.ExecutablePath)!==canonical(executable)
   ||typeof observed.CommandLine!=='string'
   ||!/(?:^|[\\/])browser-sentinel-worker\.cjs(?:[\s"'\x27]|$)/i.test(observed.CommandLine)
   ||observed.CommandLine.length>8192)
   fail('worker_os_process_unverified');
 return Object.freeze({
   schema:RESIDENT_SENTINEL_SCHEMA,state:'VERIFIED',
   parent_pid:parentPid,worker_pid:state.worker_pid,
   worker_custody_token_verified:true,heartbeat_fresh:true,
   process_executable_verified:true,worker_script_verified:true,
   os_parent_pid_matches:observed.ParentProcessId===parentPid,
   automatic_retry_allowed:false,authority_effect:false,
   production_authorized:false
 });
}
async function cli(){
 const parts=[];
 for await(const part of process.stdin){
   parts.push(part);
   if(parts.reduce((n,b)=>n+b.length,0)>32768)fail('input_oversized');
 }
 let row;
 try{row=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('input_invalid');}
 console.log(JSON.stringify(verifyResidentSentinelReadback(row)));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
 await cli().catch(e=>{console.error(/^resident_sentinel_[a-z_]+$/.test(e.message)?e.message:'resident_sentinel_unknown');process.exitCode=1;});
