import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {verifyResidentSentinelReadback,RESIDENT_SENTINEL_SCHEMA,summarizeResidentStartupFailure}
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

const run=promisify(execFile);
const version='0.7.0-dev.34759310781.1';
function failure(){
 const w=witness(),boot=randomUUID();
 return {phase:'LEGACY_BEFORE_INSTALL',parentPid:pid,version,executable:exe,nowMs:now,parentAlive:true,
  sentinelText:JSON.stringify(w.state),heartbeatText:JSON.stringify(w.heartbeat),workerProcess:w.process,
  journalText:JSON.stringify({schema:'metaengine.browser.startup-journal.v1',version:1,
   current_boot_id:boot,current_pid:pid,current_version:version,authority_effect:false,
   events:['BOOT_STARTED','RUNTIME_IMPORT_OK','APP_READY_CONTINUATION_ARMED'].map((state,i)=>
    ({sequence:i+1,boot_id:boot,pid,version,state,authority_effect:false}))})};
}
test('resident failure distinguishes startup before ready without admitting later healthy custody',()=>{
 const x=summarizeResidentStartupFailure(failure());
 assert.equal(x.state,'UNQUALIFIED');assert.equal(x.journal_binding,'EXPECTED_PROCESS');
 assert.equal(x.last_known_startup_state,'APP_READY_CONTINUATION_ARMED');
 assert.equal(x.startup_event_flags.APP_READY,false);
 assert.equal(x.startup_event_flags.HOST_RESILIENCE_BOOTSTRAP_STARTED,false);
 assert.equal(x.custody_recheck,'CONSISTENT_AT_LATER_READ');
 assert.equal(x.verification_succeeded,false);assert.equal(x.automatic_retry_allowed,false);
});
test('another PID, version, boot or inconsistent sequence never supplies current phases',()=>{
 for(const mutate of [
  j=>{j.current_pid=pid+1},j=>{j.current_version='0.7.0-dev.1.1'},
  j=>{j.events[1].pid=pid+1},j=>{j.events[1].sequence=1},
  j=>{j.current_boot_id='bad'}
 ]){
  const f=failure(),j=JSON.parse(f.journalText);mutate(j);f.journalText=JSON.stringify(j);
  const x=summarizeResidentStartupFailure(f);
  assert.equal(x.startup_event_flags.RUNTIME_IMPORT_OK,false);
  assert.equal(x.last_known_startup_state,null);
 }
 const f=failure(),j=JSON.parse(f.journalText);j.current_boot_id=randomUUID();f.journalText=JSON.stringify(j);
 assert.equal(summarizeResidentStartupFailure(f).boot_event_count,0);
});
test('missing or stale worker evidence records a fixed failed witness category',()=>{
 const f=failure();f.sentinelText=null;
 assert.equal(summarizeResidentStartupFailure(f).custody_recheck,'CUSTODY_STATE_UNVERIFIED');
 const g=failure();g.heartbeatText=JSON.stringify({...JSON.parse(g.heartbeatText),heartbeat_at:new Date(now-8001).toISOString()});
 const x=summarizeResidentStartupFailure(g);
 assert.equal(x.custody_recheck,'WORKER_HEARTBEAT_STALE');assert.equal(x.heartbeat_fresh,false);
});
test('failure evidence drops paths, tokens, credentials, stack and arbitrary states',()=>{
 const secret='DO_NOT_PUBLISH_PRIVATE_PAYLOAD';
 const f=failure(),j=JSON.parse(f.journalText);
 j.events.push({...j.events[0],sequence:4,state:secret,error:{message:secret},details:{host_state:secret,path:'C:\\'+secret}});
 f.journalText=JSON.stringify(j);
 f.stdout=JSON.stringify({schema:'metaengine.browser.secondary-launch.v1',state:'PRIMARY_UI_ACTIVATION_UNPROVEN',authority_effect:false,token:secret});
 f.stderr=JSON.stringify({schema:'metaengine.browser.provider-startup.v1',state:'LOCAL_PROVIDER_STARTUP_BLOCKED',
  browser_runtime_started:false,automatic_cloud_fallback:false,authority_effect:false,
  reason:'local_state_packaged_owner_not_ready',phase:'PACKAGED_OWNER_ADMISSION',
  bootstrap_state:'NO_OWNER_CONFIG',attachment_state:'NO_DESCRIPTOR',error:secret,url:'https://'+secret});
 const x=summarizeResidentStartupFailure(f),text=JSON.stringify(x);
 assert.equal(x.owner_admission.reason,'local_state_packaged_owner_not_ready');
 assert.equal(x.secondary_launch_state,'PRIMARY_UI_ACTIVATION_UNPROVEN');
 assert.equal(text.includes(secret),false);assert.equal(text.includes(JSON.parse(f.sentinelText).token),false);
 assert.equal(x.production_authorized,false);assert.equal(x.authority_effect,false);
});
test('bounded malformed input and unknown argument labels cannot become evidence',()=>{
 const f=failure();f.journalText='x'.repeat(262145);f.stdout='x'.repeat(65537);
 const x=summarizeResidentStartupFailure(f);
 assert.equal(x.journal_binding,'UNREADABLE_OR_OVERSIZED');assert.equal(x.activation_hook_observed,false);
 for(const changed of [{phase:'UNREVIEWED'},{parentPid:-1},{version:'SECRET'},{executable:'relative'}])
  assert.throws(()=>summarizeResidentStartupFailure({...failure(),...changed}),/resident_sentinel_failure_arguments_invalid/);
});
test('failure CLI returns only a bounded redacted receipt on its real stdin boundary',async()=>{
 const file=fileURLToPath(new URL('../scripts/qa-resident-sentinel-readback.mjs',import.meta.url));
 const pending=run(process.execPath,[file,'--startup-failure-readback'],{windowsHide:true,shell:false,timeout:30000,maxBuffer:32768});
 pending.child.stdin.end(JSON.stringify(failure()));
 const {stdout}=await pending,x=JSON.parse(stdout);
 assert.equal(x.state,'UNQUALIFIED');assert.equal(x.verification_succeeded,false);
 assert.equal(x.last_known_startup_state,'APP_READY_CONTINUATION_ARMED');
});
test('native Windows readback reads only generated fixture and leaves every input byte unchanged',{
 skip:process.platform!=='win32'?'Windows native readback unavailable (UNKNOWN)':false
},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-resident-readback-fixture-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=failure(),j=JSON.parse(f.journalText);
 j.current_pid=process.pid;j.events.forEach(e=>e.pid=process.pid);
 const journal=path.join(root,'metaengine-browser-startup-journal-v1.json');
 const stderr=path.join(root,'child.err'),stdout=path.join(root,'child.out');
 const secret='FIXTURE_PRIVATE_TEXT_DO_NOT_EMIT';
 const initial=JSON.stringify(j);
 await fs.writeFile(journal,initial);await fs.writeFile(stderr,secret);
 await fs.writeFile(stdout,JSON.stringify({schema:'metaengine.browser.final-runtime-entry.v1',
  state:'ACTIVATION_HOOK_INSTALLED',authority_effect:false,private:secret}));
 const ps=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const helper=fileURLToPath(new URL('../scripts/qa-resident-startup-failure.ps1',import.meta.url));
 const pending=run(ps,['-NoProfile','-NonInteractive','-File',helper,
  '-ParentPid',String(process.pid),'-Executable',process.execPath,'-ProfilePath',root,
  '-ExpectedVersion',version,'-Phase','LEGACY_BEFORE_INSTALL','-StdoutPath',stdout,'-StderrPath',stderr],
  {windowsHide:true,shell:false,timeout:60000,maxBuffer:32768,cwd:root});
 pending.child.stdin.end();
 const result=await pending,x=JSON.parse(result.stdout);
 assert.equal(x.schema,'metaengine.browser.qa-resident-startup-failure.v1');
 assert.equal(x.state,'UNQUALIFIED');assert.equal(x.parent_process_present,true);
 assert.equal(x.journal_binding,'EXPECTED_PROCESS');assert.equal(x.file_read_states.journal,'READ');
 assert.equal(x.activation_hook_observed,true);assert.equal(x.verification_succeeded,false);
 assert.equal(result.stdout.includes(secret),false);
 assert.equal(await fs.readFile(journal,'utf8'),initial);
 assert.equal(await fs.readFile(stderr,'utf8'),secret);
 assert.deepEqual((await fs.readdir(root)).sort(),['child.err','child.out','metaengine-browser-startup-journal-v1.json'].sort());
});
