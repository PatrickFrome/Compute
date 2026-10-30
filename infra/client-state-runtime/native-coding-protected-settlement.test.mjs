import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {nativeCodingCanonicalJson} from './native-coding-task-context.mjs';
import {validateCodexCliProtectedSettlement,validateCodexCliProtectedLaunch,codexCliLocalOutputDrain,codexCliHelperFileIdentitySha256} from '../../apps/metaengine-browser/src/codex-cli-physical-settlement.mjs';
import {joinedSettlementFixture} from '../../apps/metaengine-browser/test/fixtures/codex-cli-joined-settlement-fixture.mjs';
// Actual private OS-scope reader functions; generated protected file/native
// observations below are NOT Windows ACL, executable or process evidence.
async function fixture(){
 const scope={task_id:randomUUID(),lease_generation:1,agent_id:'agent_fixture-12345678'};
 const binding={...scope,agent_generation_epoch:1,base_sha:'a'.repeat(40),role:'IMPLEMENTER'};
 const spec={runId:randomUUID(),executablePath:path.resolve('fixture/codex.exe'),expectedExecutableSha256:'b'.repeat(64),
  cwd:path.resolve('fixture/worktree'),args:[],timeoutMs:1000,promptSha256:'c'.repeat(64),binding};
 const g=joinedSettlementFixture(spec),helperStat={dev:1n,ino:2n,birthtimeNs:3n,ctimeNs:4n,mtimeNs:5n,size:6n,nlink:1n};
 g.proof.helper_file_identity_sha256=codexCliHelperFileIdentitySha256(helperStat);
 const result={schema:'generated-fixture',value:'result'},hash=x=>createHash('sha256').update(x).digest('hex');
 const receipt={...binding,run_id:spec.runId,launch_identity:g.proof.launch,process:g.proof,pid:g.proof.pid,process_incarnation_id:g.proof.process_incarnation_id,
  state:'RESULT_READY',physical_settlement:g.complete().joined_settlement,process_result:g.complete(),prompt_sha256:spec.promptSha256,
  executable_sha256:spec.expectedExecutableSha256,worktree_path:spec.cwd,result,result_sha256:hash(JSON.stringify(result))};
 receipt.local_output_drain=codexCliLocalOutputDrain(receipt.physical_settlement);
 const processReceipt=structuredClone(receipt);processReceipt.state='RESERVED';delete processReceipt.physical_settlement;delete processReceipt.local_output_drain;
 const files=new Map([['receipt.json',receipt],['process.json',processReceipt],['launch.json',g.launch],['result.json',result]]);
 const operator={journal_root:path.resolve('fixture/journal'),cli_executable:spec.executablePath};
 const calls=[],native={worker:{pid:g.proof.pid,process_incarnation_id:g.proof.process_incarnation_id,exe_path:spec.executablePath,user_sid:g.proof.user_sid},
  helper:{...g.proof.helper_process,exe_path:String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,user_sid:g.proof.user_sid}};
 let onRead=null,onNative=null;
 const source=await fs.readFile(new URL('./native-coding-host-os-scope.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  function journalPath('),end=source.indexOf('  Object.defineProperty(readNativeScope',start);
 assert.ok(start>0&&end>start);
 const readers=new Function('path','createHash','config','resources','readNativeCodingOperatorPaths','readNativeCodingProtectedJson','readNativeCodingWindowsProcess',
  'fileHash','samePath','fail','nativeCodingCanonicalJson','validateCodexCliProtectedSettlement','validateCodexCliProtectedLaunch','fs','codexCliHelperFileIdentitySha256',source.slice(start,end)+'\nreturn {readProtectedReceipt,readNativeWorker};')
  (path,createHash,{state_directory:'/fixture/state'},'/fixture/resources',async()=>operator,async file=>{
   const name=path.basename(file);calls.push(name);await onRead?.(name);if(!files.has(name))throw Error('fixture_missing_protected_file');
   const value=structuredClone(files.get(name));return {value,sha256:hash(JSON.stringify(value))};
  },async pid=>{calls.push('native:'+pid);await onNative?.(pid);return structuredClone(pid===native.worker.pid?native.worker:native.helper);},
  async file=>file===spec.executablePath?spec.expectedExecutableSha256:g.proof.helper_sha256,
  (a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase(),why=>{throw Error('native_coding_host_os_'+why);},
  nativeCodingCanonicalJson,validateCodexCliProtectedSettlement,validateCodexCliProtectedLaunch,{lstat:async()=>helperStat},codexCliHelperFileIdentitySha256);
 const permit={role:'IMPLEMENTER',artifact:{cli_executable_sha256:spec.expectedExecutableSha256}},job={payload:{run_id:spec.runId}};
 return {scope,permit,job,receipt,processReceipt,files,native,calls,g,readers,setRead:fn=>{onRead=fn;},setNative:fn=>{onNative=fn;}};
}
test('default protected reader joins immutable launch/process/result and exposes only scoped local evidence',async()=>{
 const f=await fixture(),read=await f.readers.readProtectedReceipt(f);assert.deepEqual(read,f.receipt);
 assert.equal(read.local_output_drain.scope,'HELPER_TREE_AND_LOCAL_OUTPUT');assert.equal(read.local_output_drain.host_scope_callbacks,'NOT_ATTESTED');
 assert.equal(read.local_output_drain.all_effects_cleanup,'UNCONFIRMED');
 assert.deepEqual(f.calls,['receipt.json','result.json','launch.json','process.json']);
 await f.readers.readNativeWorker(f.native.worker.pid,f);
 assert.equal(f.calls.filter(x=>x==='native:'+f.native.helper.pid).length,2);
});
for(const name of ['launch.json','process.json'])test('default reader rejects missing or substituted '+name,async()=>{
 for(const mode of ['missing','changed']){const f=await fixture();if(mode==='missing')f.files.delete(name);
  else if(name==='launch.json')f.files.set(name,{...f.g.launch,request_sha256:'f'.repeat(64)});
  else f.processReceipt.process.helper_sha256='f'.repeat(64);
  await assert.rejects(f.readers.readProtectedReceipt(f));}
});
test('legacy result remains readable without fabricating launch or joined cleanup',async()=>{
 const f=await fixture();delete f.receipt.process.launch;delete f.receipt.launch_identity;delete f.receipt.physical_settlement;delete f.receipt.local_output_drain;
 f.files.delete('launch.json');f.files.delete('process.json');const result=await f.readers.readProtectedReceipt(f);
 assert.equal(result.physical_settlement,undefined);assert.deepEqual(f.calls,['receipt.json','result.json']);
});
test('pre-resume default reader refuses helper PID reuse during its final read',async()=>{
 const f=await fixture();let helperReads=0;f.setNative(pid=>{if(pid===f.native.helper.pid&&++helperReads===2)f.native.helper.process_incarnation_id+='1';});
 await assert.rejects(f.readers.readNativeWorker(f.native.worker.pid,f),/worker_helper_changed/);
});
test('changed run/prompt/lease launch cannot pass the default suspended-worker read',async()=>{
 for(const mutate of [f=>f.processReceipt.prompt_sha256='f'.repeat(64),f=>f.processReceipt.launch_identity.request_id=randomUUID(),f=>f.processReceipt.agent_generation_epoch++]){
  const f=await fixture();mutate(f);await assert.rejects(f.readers.readNativeWorker(f.native.worker.pid,f),/protected_launch_scope/);}
});
