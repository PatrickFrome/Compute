import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {PassThrough} from 'node:stream';
const source=await fs.readFile(new URL('../src/codex-cli-sandbox-probe.mjs',import.meta.url),'utf8');
const start=source.indexOf('export async function runCodexCliSandboxProbe(');
assert.ok(start>0);
function fixture({failOpen=0,failSpawn=false,failResume=false,failSync=false,failTerminate=false,holdSync=false,failWrite=false,overflow=false}={}){
 const handles=[],events=[];let opens=0,finish,finishSync;
 const syncGate=new Promise(resolve=>{finishSync=resolve;});
 const completion=new Promise(resolve=>{finish=resolve;});
 const handle={proof:{fixture_only:true},stdout:new PassThrough(),stderr:new PassThrough(),completion,
  resume:async()=>{events.push('resume');if(failWrite)handle.stdout.write(Buffer.from('generated-output'));if(overflow){handle.stdout.write(Buffer.alloc(33000,120));handle.stderr.write(Buffer.alloc(33000,120));}if(failResume)throw Error('generated_resume_failure');},
  terminate:async()=>{events.push('terminate');if(failTerminate)throw Error('generated_termination_failure');}};
 const files={realpath:async p=>p,mkdir:async()=>{},writeFile:async()=>{},readFile:async()=>Buffer.from('fixture'),unlink:async()=>{},rmdir:async()=>{},
  open:async()=>{if(++opens===failOpen)throw Error('generated_open_failure');const h={closed:false,bytes:0,write:async()=>{throw Error('partial-write API must not be used');},writeFile:async bytes=>{if(failWrite&&handles.indexOf(h)<2)throw Error('generated_write_failure');h.bytes+=Buffer.byteLength(bytes);},sync:async()=>{if(holdSync&&handles.indexOf(h)===1)await syncGate;if(failSync)throw Error('generated_sync_failure');},close:async()=>{h.closed=true;events.push('close');}};handles.push(h);return h;}};
 const run=vm.runInNewContext(source.slice(start).replace('export async function','async function')+'\nrunCodexCliSandboxProbe',{
  fs:files,path,Buffer,process:{platform:'win32',env:{LOCALAPPDATA:'/fixture/local',USERPROFILE:'/fixture/user'}},
  randomUUID:()=> '11111111-1111-4111-8111-111111111111',modeValid:()=>true,isWithin:(a,b)=>{const r=path.relative(a,b);return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r);},
  CODEX_SANDBOX_PROBE_SCHEMA:'metaengine.codex-cli.sandbox-probe.v1',evaluateCodexSandboxProbe:()=>({state:'OBSERVED',reason:null,boundary_observed:true,execution_authorized:false,authority_effect:false}),
  canaryScript:()=> 'fixture-only',windowsSandboxBootIdentity:()=> 'fixture',protectOwnerOnlyWindowsDirectory:async()=>({owner_dacl_verified:true}),
  verifyOwnerOnlyWindowsStorage:async()=>({owner_dacl_verified:true}),digest:()=> 'a'.repeat(64),buildCodexSandboxProbeArgs:()=>[],
  codexCliTemporaryEnvironment:v=>v,codexCliEnvironment:()=>({}),POWERSHELL:'/fixture/powershell',
  readWindowsSandboxProcess:async()=>({}),readWindowsSandboxHostBoot:async()=>({}),
 });
 return {handles,events,finish,finishSync,run:extra=>run({cliPath:'/fixture/cli',workspaceRoot:'/fixture/work',receiptDirectory:'/fixture/receipts',
  mode:'read-only',hostUserSid:'S-1-5-21-1',processController:{spawn:async()=>{events.push('spawn');if(failSpawn)throw Error('generated_spawn_failure');return handle;}},...extra})};
}
test('partial log-open failure closes the log already owned without spawning a process',async()=>{
 const f=fixture({failOpen:2});await assert.rejects(f.run(),/generated_open_failure/);
 assert.equal(f.handles.length,1);assert.equal(f.handles[0].closed,true);assert.equal(f.events.includes('spawn'),false);
});
test('probe observer failure joins owned process completion and closes both logs',async()=>{
 const f=fixture();let settled=false;
 const result=f.run({onProcessStarted:()=>{throw Error('generated_observer_failure');}}).then(()=>{settled=true;return null;},e=>{settled=true;return e;});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(f.events.includes('terminate'));assert.equal(settled,false);
 f.finish({fixture_only:true});assert.match((await result).message,/observer_failed/);
 assert.equal(f.handles.length,2);assert.ok(f.handles.every(h=>h.closed));assert.equal(f.events.includes('resume'),false);
});
test('uncertain resume terminates and joins its child before releasing log handles',async()=>{
 const f=fixture({failResume:true});let settled=false;
 const result=f.run().then(()=>{settled=true;return null;},e=>{settled=true;return e;});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(f.events.includes('terminate'));assert.equal(settled,false);
 assert.ok(f.handles.every(h=>!h.closed));f.finish({fixture_only:true});assert.match((await result).message,/process_unconfirmed/);
 assert.ok(f.handles.every(h=>h.closed));
});


test('failed spawn closes both logs without pretending any process completed',async()=>{
 const f=fixture({failSpawn:true});await assert.rejects(f.run(),/generated_spawn_failure/);
 assert.equal(f.handles.length,2);assert.ok(f.handles.every(h=>h.closed));assert.equal(f.events.includes('resume'),false);
});
test('failed termination request still retains the owned completion before observer cleanup',async()=>{
 const f=fixture({failTerminate:true});let settled=false;
 const result=f.run({onProcessStarted:()=>{throw Error('generated_observer_failure');}}).then(()=>{settled=true;},e=>{settled=true;return e;});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(f.events.includes('terminate'));assert.equal(settled,false);
 assert.ok(f.handles.every(h=>!h.closed));f.finish({fixture_only:true});assert.match((await result).message,/observer_failed/);
 assert.ok(f.handles.every(h=>h.closed));
});
test('log flush failure after completion still closes both handles and emits no receipt',async()=>{
 const f=fixture({failSync:true});const result=f.run();await new Promise(resolve=>setImmediate(resolve));f.finish({fixture_only:true});
 await assert.rejects(result,/log_sync_failed/);assert.equal(f.handles.length,2);assert.ok(f.handles.every(h=>h.closed));
});


test('one failed log sync does not close either handle while its sibling sync is pending',async()=>{
 const f=fixture({failSync:true,holdSync:true});let settled=false;
 const result=f.run().then(()=>{settled=true;return null;},e=>{settled=true;return e;});
 await new Promise(resolve=>setImmediate(resolve));f.finish({fixture_only:true});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.ok(f.handles.every(h=>!h.closed));
 f.finishSync();assert.match((await result).message,/log_sync_failed/);assert.ok(f.handles.every(h=>h.closed));
});


for(const failTerminate of [false,true])test(`output overflow stays blocked after clean exit (termination failure: ${failTerminate})`,async()=>{
 const f=fixture({overflow:true,failTerminate});const result=f.run();
 await new Promise(resolve=>setImmediate(resolve));f.finish({exit_code:0,signal:null,tree_cleanup_confirmed:true});
 const value=await result;assert.equal(value.state,'BLOCKED');assert.equal(value.reason,'SANDBOX_PROBE_OUTPUT_LIMIT');
 assert.equal(f.events.filter(e=>e==='terminate').length,1,'same owned termination must not fan out');
 assert.ok(f.handles.slice(0,2).every(h=>h.bytes<=32768),'log writes must remain within the byte cap after termination failure');
 assert.ok(f.handles.every(h=>h.closed));
});


test('a rejected asynchronous log write and failed termination remain a blocked receipt without unhandled errors',async()=>{
 const f=fixture({failWrite:true,failTerminate:true});const result=f.run();
 await new Promise(resolve=>setImmediate(resolve));f.finish({exit_code:0,signal:null,tree_cleanup_confirmed:true});
 const value=await result;assert.equal(value.state,'BLOCKED');assert.equal(value.reason,'SANDBOX_PROBE_LOG_WRITE_FAILED');
 assert.equal(f.events.filter(e=>e==='terminate').length,1);assert.ok(f.handles.every(h=>h.closed));
});
