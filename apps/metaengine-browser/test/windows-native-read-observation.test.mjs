import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {observeWindowsNativeReads} from '../../../.github/windows-native-read-observation.mjs';

const executable='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const args=['-NoProfile','-NonInteractive','-EncodedCommand','PRIVATE_COMMAND'];
const options=timeout=>({timeout,shell:false,windowsHide:true,maxBuffer:8192,env:{SECRET:'PRIVATE_VALUE'}});
function fixture(overrides={}){
  const calls=[],records=[],child={stdin:{end(){}}};let clock=0;
  const execute=(file,argv,opts)=>{calls.push({file,argv,opts});return Object.assign(Promise.resolve({stdout:'PRIVATE_ROW'}),{child});};
  return {calls,records,child,config:{platform:'win32',execute,now:()=>clock+=23000,emit:row=>records.push(row),
    readBoot:async({exec})=>{const pending=exec(executable,args,options(12000));assert.equal(pending.child,child);return pending;},
    readProcess:async(pid,{exec})=>{assert.equal(pid,process.pid);return exec(executable,args,options(15000));},...overrides}};
}

test('observation changes only the diagnostic transport deadline and preserves child, fixed readers and private data boundaries',async()=>{
  const f=fixture();const records=await observeWindowsNativeReads(f.config);
  assert.equal(f.calls.length,2);
  for(const call of f.calls){assert.equal(call.file,executable);assert.equal(call.argv,args);assert.deepEqual(call.opts,{...options(60000)});}
  assert.deepEqual(records.map(r=>r.production_timeout_ms),[12000,15000]);
  for(const row of records){assert.equal(row.elapsed_ms,23000);assert.equal(row.outcome,'READ_RETURNED');assert.equal(row.transport_calls,1);
    assert.equal(row.original_probe_result_replaced,false);assert.equal(row.authority_effect,false);assert.equal(row.native_qualification_proven,false);assert.equal(row.causal_attribution_proven,false);}
  assert.doesNotMatch(JSON.stringify(records),/PRIVATE_|SECRET|stdout|user_sid|pid|executable/);
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
