#!/usr/bin/env node
// Read-only secondary witness for a detached legacy Sentinel. This is a
// CI diagnostic, not Owner authority, process-control or fallback permission.
// A surviving PID alone never establishes a Sentinel worker incarnation.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizePackagedOwnerAdmissionStderr } from './qa-soak-startup-readback.mjs';

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

export const RESIDENT_STARTUP_FAILURE_SCHEMA='metaengine.browser.qa-resident-startup-failure.v1';
const startupStates=new Set([
 'BOOT_STARTED','RUNTIME_IMPORT_OK','RUNTIME_IMPORT_FAILED','RUNTIME_HOLD_NO_WINDOW',
 'SELF_UPDATE_INSPECTION_STARTED','CONTINUITY_WATCHDOG_IMPORT_STARTED',
 'CONTINUITY_WATCHDOG_MODULE_IMPORTED','CONTINUITY_WATCHDOG_INSTALLED',
 'SIGNED_HEARTBEAT_HOOK_INSTALLED','APP_READY_CONTINUATION_ARMED','APP_READY',
 'HOST_RESILIENCE_BOOTSTRAP_STARTED','HOST_RESILIENCE_BOOTSTRAP_SETTLED',
 'HOST_RESILIENCE_BOOTSTRAPPED','BROWSER_BOOTSTRAP_BARRIER_RELEASED',
 'RUNTIME_IMPORT_FAILED_HOST_ALIVE','PRIMARY_WINDOW_STABLE','PRIMARY_WINDOW_STABLE_TIMEOUT',
 'PRIMARY_WINDOW_OBSERVER_FAILED','RUNTIME_FAILURE_PRESENTED','RUNTIME_FAILURE_PRESENTATION_FAILED'
]);
const hostStates=new Set(['UNINITIALIZED','ACTIVE','DEGRADED_LOGIN_START',
 'DEGRADED_SENTINEL','ERROR','DISABLED_UNPACKAGED','STOPPED']);
const phases=new Set(['LEGACY_BEFORE_INSTALL','SUCCESSOR_AFTER_INSTALL']);
const boolean=x=>typeof x==='boolean'?x:null;
function parseDiagnosticText(text,maximum){
 if(text==null)return {kind:'MISSING',value:null};
 if(typeof text!=='string'||text.length>maximum)return {kind:'UNREADABLE_OR_OVERSIZED',value:null};
 try{
  const value=JSON.parse(text);
  return value&&typeof value==='object'&&!Array.isArray(value)
   ?{kind:'PARSED',value}:{kind:'MALFORMED',value:null};
 }catch{return {kind:'MALFORMED',value:null};}
}
// Fixed-category evidence only. It neither admits a worker nor changes the
// failed gate, even if a worker appears after the original native observation.
export function summarizeResidentStartupFailure({
 phase,parentPid,version,executable,journalText=null,sentinelText=null,heartbeatText=null,
 stdout=null,stderr=null,parentAlive=null,exitCode=null,workerProcess=null,readStates={},nowMs=Date.now()
}={}){
 if(!phases.has(phase)||!validPid(parentPid)||!canonical(executable)
   ||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(version||'')||!Number.isFinite(nowMs))
   fail('failure_arguments_invalid');
 const parsed=parseDiagnosticText(journalText,262144),journal=parsed.value;
 let journalBinding=parsed.kind;
 let current=[];
 if(journal){
  if(journal.schema!=='metaengine.browser.startup-journal.v1'||journal.version!==1
    ||journal.authority_effect!==false||!uuid.test(journal.current_boot_id||'')
    ||!Array.isArray(journal.events)||journal.events.length>128)journalBinding='MALFORMED';
  else if(journal.current_pid!==parentPid)journalBinding='OTHER_PID';
  else if(journal.current_version!==version)journalBinding='OTHER_VERSION';
  else{
   current=journal.events.filter(e=>e?.boot_id===journal.current_boot_id);
   let sequence=0;
   const consistent=current.every(e=>e?.pid===parentPid&&e?.version===version
     &&e?.authority_effect===false&&Number.isSafeInteger(e?.sequence)
     &&e.sequence>sequence&&((sequence=e.sequence)>0));
   if(!consistent){journalBinding='MALFORMED';current=[];}
   else journalBinding='EXPECTED_PROCESS';
  }
 }
 const allowed=current.filter(e=>startupStates.has(e.state));
 const flags=Object.fromEntries([...startupStates].map(state=>[state,false]));
 for(const e of allowed)flags[e.state]=true;
 const host=current.filter(e=>e.state==='HOST_RESILIENCE_BOOTSTRAP_SETTLED'
   ||e.state==='HOST_RESILIENCE_BOOTSTRAPPED').at(-1)?.details;
 const state=parseDiagnosticText(sentinelText,32768),heartbeat=parseDiagnosticText(heartbeatText,32768);
 const custody=state.value,pulse=heartbeat.value;
 const custodyBinding=state.kind!=='PARSED'?state.kind:
  custody.schema!=='metaengine.browser-sentinel.state.v1'?'MALFORMED':
  custody.parent_pid!==parentPid?'OTHER_PID':'EXPECTED_PROCESS';
 let custodyRecheck='UNQUALIFIED';
 try{
  verifyResidentSentinelReadback({parentPid,executable,state:custody,heartbeat:pulse,process:workerProcess,nowMs});
  custodyRecheck='CONSISTENT_AT_LATER_READ';
 }catch(e){
  const known=new Set(['argument_identity_invalid','custody_state_unverified',
   'worker_heartbeat_unverified','worker_heartbeat_stale','worker_os_process_unverified']);
  const reason=String(e?.message||'').replace(/^resident_sentinel_/,'');
  custodyRecheck=known.has(reason)?reason.toUpperCase():'UNQUALIFIED';
 }
 const heartbeatAt=typeof pulse?.heartbeat_at==='string'?Date.parse(pulse.heartbeat_at):NaN;
 const age=Number.isFinite(heartbeatAt)?nowMs-heartbeatAt:null;
 const heartbeatBound=custodyBinding==='EXPECTED_PROCESS'&&uuid.test(custody?.token||'')
   &&pulse?.schema==='metaengine.browser-sentinel.worker-heartbeat.v1'
   &&pulse?.token===custody.token&&pulse?.parent_pid===parentPid
   &&pulse?.worker_pid===custody.worker_pid&&pulse?.authority_effect===false;
 let hook=false,secondary='UNKNOWN',loggedHost='UNKNOWN';
 for(const input of [stdout,stderr]){
  if(typeof input!=='string'||input.length>65536)continue;
  for(const line of input.split(/\r?\n/).slice(-120)){
   if(line.length>4096||!line.trimStart().startsWith('{'))continue;
   let row;try{row=JSON.parse(line);}catch{continue;}
   if(row?.authority_effect!==false)continue;
   if(row.schema==='metaengine.browser.final-runtime-entry.v1'
     &&row.state==='ACTIVATION_HOOK_INSTALLED')hook=true;
   if(row.schema==='metaengine.browser.secondary-launch.v1'
     &&['PRIMARY_UI_ACTIVATION_UNPROVEN','PRIMARY_UI_ACTIVATION_ACKNOWLEDGED'].includes(row.state))
     secondary=row.state;
   if(row.schema==='metaengine.host-resilience-bootstrap.v2'&&hostStates.has(row.state))loggedHost=row.state;
  }
 }
 return Object.freeze({
  schema:RESIDENT_STARTUP_FAILURE_SCHEMA,state:'UNQUALIFIED',failure_phase:phase,
  expected_parent_pid:parentPid,parent_process_present:boolean(parentAlive),
  parent_exit_code:Number.isSafeInteger(exitCode)&&exitCode>=-2147483648&&exitCode<=4294967295?exitCode:null,
  file_read_states:Object.fromEntries(['journal','sentinel','heartbeat','stdout','stderr'].map(key=>[key,
   ['READ','MISSING','OVERSIZED','NOT_REGULAR','READ_FAILED'].includes(readStates?.[key])?readStates[key]:'UNKNOWN'])),
  journal_binding:journalBinding,boot_event_count:current.length,
  startup_event_flags:flags,last_known_startup_state:allowed.at(-1)?.state??null,
  host_state:hostStates.has(host?.host_state)?host.host_state:'UNKNOWN',
  host_logged_state:loggedHost,sentinel_worker_healthy:boolean(host?.sentinel_worker_healthy),
  activation_hook_observed:hook,secondary_launch_state:secondary,
  owner_admission:summarizePackagedOwnerAdmissionStderr(stderr),
  sentinel_binding:custodyBinding,worker_pid_recorded:validPid(custody?.worker_pid),
  worker_released:boolean(custody?.worker_released),installer_handoff:boolean(custody?.installer_handoff),
  heartbeat_parse_state:heartbeat.kind,heartbeat_bound:heartbeatBound,
  heartbeat_age_ms:age!==null&&age>=0&&age<=120000?age:null,
  heartbeat_fresh:heartbeatBound&&pulse.lifecycle==='READY'&&age!==null&&age>=-1000&&age<=8000,
  custody_recheck:custodyRecheck,capture_only:true,verification_succeeded:false,
  automatic_retry_allowed:false,production_authorized:false,authority_effect:false
 });
}

async function cli(){
 const diagnostic=process.argv.length===3&&process.argv[2]==='--startup-failure-readback';
 if(process.argv.length>2&&!diagnostic)fail('arguments_invalid');
 const parts=[];
 for await(const part of process.stdin){
   parts.push(part);
   if(parts.reduce((n,b)=>n+b.length,0)>(diagnostic?524288:32768))fail('input_oversized');
 }
 let row;
 try{row=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('input_invalid');}
 console.log(JSON.stringify(diagnostic?summarizeResidentStartupFailure(row):verifyResidentSentinelReadback(row)));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))
 await cli().catch(e=>{console.error(/^resident_sentinel_[a-z_]+$/.test(e.message)?e.message:'resident_sentinel_unknown');process.exitCode=1;});
