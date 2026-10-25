import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {observeWindowsNativeReads,parseWindowsNativeReadPhases} from '../../../.github/windows-native-read-observation.mjs';
import {readWindowsSandboxHostBoot} from '../src/codex-cli-sandbox-probe.mjs';
import {readNativeCodingWindowsProcess} from '../src/native-coding-host-observers.mjs';

const executable='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
// Capture the actual fixed readers through their transport seam, without a
// Windows child or native evidence. Source drift must refuse instrumentation.
const commands={};
const context=['SYSTEMROOT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
const saved=Object.fromEntries(Object.entries(process.env).filter(([key])=>context.includes(key.toUpperCase())));
try{
  for(const key of Object.keys(process.env))if(context.includes(key.toUpperCase()))delete process.env[key];
  process.env.SystemRoot='C:\\Windows';
  const created='2026-10-22T04:00:00.000Z', birth=String(BigInt(Date.parse(created))*10000n+116444736000000000n);
  await readWindowsSandboxHostBoot({platform:'win32',exec:async(file,argv)=>{commands.kernel_boot=argv;return {stdout:JSON.stringify({
    schema:'metaengine.windows.kernel-boot.v1',kernel_boot_id:29,system_process:{pid:4,created_at:created,created_100ns:birth},
    last_boot_at:created,os_version:'10.0.19045'})};}});
  await readNativeCodingWindowsProcess(process.pid,{platform:'win32',exec:async(file,argv)=>{commands.own_process=argv;return {stdout:JSON.stringify({
    pid:process.pid,created_at:created,birth_100ns:birth,exe_b64:Buffer.from('C:\\fixed\\worker.exe').toString('base64'),user_sid:'S-1-5-21-111-1001'})};}});
}finally{
  for(const key of Object.keys(process.env))if(context.includes(key.toUpperCase()))delete process.env[key];
  Object.assign(process.env,saved);
}
const args=commands.kernel_boot;
const options=timeout=>({timeout,shell:false,windowsHide:true,maxBuffer:8192,env:{SECRET:'PRIVATE_VALUE'}});
function fixture(overrides={}){
  const calls=[],records=[],child={stdin:{end(){}}};let clock=0;
  const execute=(file,argv,opts)=>{calls.push({file,argv,opts});return Object.assign(Promise.resolve({stdout:'PRIVATE_ROW',stderr:'ME_NATIVE_READ_STAGE_V1 PS_ENTER 0\n'}),{child});};
  return {calls,records,child,config:{platform:'win32',execute,now:()=>clock+=23000,emit:row=>records.push(row),
    readBoot:async({exec})=>{const pending=exec(executable,args,options(12000));assert.equal(pending.child,child);return pending;},
    readProcess:async(pid,{exec})=>{assert.equal(pid,process.pid);return exec(executable,commands.own_process,options(15000));},...overrides}};
}

test('diagnostic instrumentation preserves transport scope, owned child, production budgets and private data boundaries',async()=>{
  const f=fixture();const records=await observeWindowsNativeReads(f.config);
  assert.equal(f.calls.length,2);
  for(const call of f.calls){assert.equal(call.file,executable);assert.deepEqual(call.argv.slice(0,4),args.slice(0,4));assert.deepEqual(call.opts,{...options(60000)});}
  assert.deepEqual(records.map(r=>r.production_timeout_ms),[12000,15000]);
  for(const row of records){assert.equal(row.elapsed_ms,23000);assert.equal(row.outcome,'READ_RETURNED');assert.equal(row.transport_calls,1);
    assert.equal(row.original_probe_result_replaced,false);assert.equal(row.authority_effect,false);assert.equal(row.native_qualification_proven,false);assert.equal(row.causal_attribution_proven,false);
    assert.deepEqual(row.stages,[{stage:'PS_ENTER',elapsed_ms:0}]);assert.equal(row.phase_stream_invalid,false);}
  assert.doesNotMatch(JSON.stringify(records),/PRIVATE_|SECRET|stdout|user_sid|pid|executable/);
});

test('a changed or duplicated native script anchor refuses before executing, including CRLF commands',async()=>{
  for(const ending of ['\n','\r\n'])for(const change of [source=>source.replace('Get-CimInstance','Other-Command'),source=>source+'\n$boot=Read-KernelBootId']){
    const source=Buffer.from(args[4],'base64').toString('utf16le').replace(/\r\n/g,'\n').replaceAll('\n',ending);
    const changed=[...args.slice(0,4),Buffer.from(change(source),'utf16le').toString('base64')];
    const f=fixture({readBoot:({exec})=>exec(executable,changed,options(12000))});
    const rows=await observeWindowsNativeReads(f.config);
    assert.equal(rows[0].transport_calls,0);assert.equal(rows[0].outcome,'READ_FAILED');assert.equal(f.calls.length,1);
  }
});

test('phase parsing separates fixed stages, rejects repeats/time reversal, and cannot export private stderr',()=>{
  const row=parseWindowsNativeReadPhases('kernel_boot',[
    'ME_NATIVE_READ_STAGE_V1 PS_ENTER 0','ME_NATIVE_READ_STAGE_V1 NATIVE_BIND_READY 3',
    'ME_NATIVE_READ_STAGE_V1 SYSTEM_CIM_BEGIN 8','PRIVATE_PATH PRIVATE_TOKEN',
    'ME_NATIVE_READ_STAGE_V1 SYSTEM_CIM_END 18000','ME_NATIVE_READ_STAGE_V1 SYSTEM_CIM_END 18001',
    'ME_NATIVE_READ_STAGE_V1 OS_CIM_BEGIN 2','ME_NATIVE_READ_STAGE_V1 JSON_END 18020',
  ].join('\r\n'));
  assert.deepEqual(row.stages.map(value=>[value.stage,value.elapsed_ms]),[
    ['PS_ENTER',0],['NATIVE_BIND_READY',3],['SYSTEM_CIM_BEGIN',8],['SYSTEM_CIM_END',18000],['JSON_END',18020],
  ]);
  assert.equal(row.phase_stream_invalid,true);assert.ok(row.unknown_stderr_bytes>0);assert.equal(row.phase_stream_overflow,false);
  assert.doesNotMatch(JSON.stringify(row),/PRIVATE_PATH|PRIVATE_TOKEN/);
  const overflow=parseWindowsNativeReadPhases('own_process','PRIVATE'.repeat(10000)+'\nME_NATIVE_READ_STAGE_V1 PS_ENTER 0');
  assert.equal(overflow.phase_stream_overflow,true);assert.equal(overflow.unknown_stderr_bytes,65537);assert.deepEqual(overflow.stages,[]);
});

test('timed-out diagnostic retains bounded stage timings but never private transport errors',async()=>{
  const error=Object.assign(Error('PRIVATE_TRANSPORT_ERROR'),{stderr:'ME_NATIVE_READ_STAGE_V1 PS_ENTER 0\nME_NATIVE_READ_STAGE_V1 SYSTEM_CIM_BEGIN 8\nPRIVATE_VALUE'});
  const f=fixture({execute:()=>Promise.reject(error)});const rows=await observeWindowsNativeReads(f.config);
  assert.deepEqual(rows.map(row=>row.outcome),['READ_FAILED','READ_FAILED']);
  assert.deepEqual(rows[0].stages,[{stage:'PS_ENTER',elapsed_ms:0},{stage:'SYSTEM_CIM_BEGIN',elapsed_ms:8}]);
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_/);
});

test('failed diagnostics are not promoted, leaked, or allowed to suppress the other fixed reader',async()=>{
  const f=fixture({readBoot:async({exec})=>{await exec(executable,args,options(12000));throw Error('PRIVATE_FAILURE');}});
  const rows=await observeWindowsNativeReads(f.config);
  assert.deepEqual(rows.map(r=>r.outcome),['READ_FAILED','READ_RETURNED']);assert.equal(f.calls.length,2);
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_FAILURE/);
});

test('observation refuses non-Windows, arbitrary transport targets, changed production budgets and repeated transports',async()=>{
  const f=fixture({platform:'linux'});await assert.rejects(observeWindowsNativeReads(f.config),/windows_required/);assert.equal(f.calls.length,0);
  for(const change of [exec=>exec('C:\\attacker.exe',args,options(12000)),exec=>exec(executable,args,options(12001)),
    async exec=>{await exec(executable,args,options(12000));await exec(executable,args,options(12000));}]){
    const x=fixture({readBoot:({exec})=>change(exec)});const rows=await observeWindowsNativeReads(x.config);
    assert.equal(rows[0].outcome,'READ_FAILED');assert.ok(x.calls.length<=2);
  }
});

test('caught refused or failed transports cannot manufacture a returned native observation',async()=>{
  for(const invalid of [exec=>exec('C:\\attacker.exe',args,options(12000)),exec=>exec(executable,args,options(1))]){
    const f=fixture({readBoot:async({exec})=>{try{await invalid(exec);}catch{}return {fabricated:true};}});
    const rows=await observeWindowsNativeReads(f.config);
    assert.equal(rows[0].outcome,'READ_FAILED');assert.equal(rows[0].transport_calls,0);assert.equal(f.calls.length,1);
  }
  const f=fixture({execute:()=>Promise.reject(Error('PRIVATE_TRANSPORT_ERROR')),
    readBoot:async({exec})=>{try{await exec(executable,args,options(12000));}catch{}return {fabricated:true};}});
  const rows=await observeWindowsNativeReads(f.config);assert.equal(rows[0].outcome,'READ_FAILED');
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_TRANSPORT_ERROR/);
});

test('read-duration diagnostics run only after a failed Windows probe, never replace it or suppress full coverage',async()=>{
  const source=(await fs.readFile(new URL('../../../.github/workflows/client-live-mechanics-recovery-v1.yml',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  const marker='      - name: Observe failed Windows native reads without replacing qualification\n';
  const at=source.indexOf(marker);assert.ok(at>=0);const end=source.indexOf('\n      - name:',at+marker.length);
  const step=source.slice(at,end<0?source.length:end);
  assert.match(step,/if: \$\{\{ !cancelled\(\) && runner\.os == 'Windows' && steps\.windows_native_probe\.outcome == 'failure' \}\}/);
  assert.match(step,/timeout-minutes: 3/);assert.match(step,/run: node \.github\/windows-native-read-observation\.mjs/);
  assert.doesNotMatch(step,/continue-on-error|\|\|\s*true/);
  assert.ok(source.indexOf('name: Exercise all Browser mechanics including real local IPC')<at);
  assert.ok(source.includes("      - '.github/windows-native-read-observation.mjs'"));
  assert.ok(source.includes('node --test test/windows-native-read-observation.test.mjs'));
});
