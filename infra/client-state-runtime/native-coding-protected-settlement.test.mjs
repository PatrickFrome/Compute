import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {nativeCodingCanonicalJson} from './native-coding-task-context.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {assertNativeCodingHostRequestOpen,joinNativeCodingHostReads} from './native-coding-host-request-lifetime.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {validateNativeCodingInstalledPathScope,validateNativeCodingOperatorPaths} from '../../apps/metaengine-browser/src/native-coding-operator-paths.mjs';
import {generatedInstalledOperator,generatedInstalledTools,installedOperatorReaderSource} from './test/native-coding-installed-operator-fixture.mjs';
import {validateCodexCliProtectedSettlement,validateCodexCliProtectedLaunch,codexCliLocalOutputDrain,codexCliHelperFileIdentitySha256} from '../../apps/metaengine-browser/src/codex-cli-physical-settlement.mjs';
import {joinedSettlementFixture} from '../../apps/metaengine-browser/test/fixtures/codex-cli-joined-settlement-fixture.mjs';
// Actual private OS-scope reader functions; generated protected file/native
// observations below are NOT Windows ACL, executable or process evidence.
async function fixture({root=null,physical=false}={}){
 const generated=await generatedInstalledTools(),privateTools=generated.privateTools;
 const resources=root?path.join(root,'install','resources'):generated.resources,config={state_directory:root?path.join(root,'state'):path.resolve('generated-host-state')};
 const operator=generatedInstalledOperator({resources,stateDirectory:config.state_directory});
 const scope={task_id:randomUUID(),lease_generation:1,agent_id:'agent_fixture-12345678'};
 const binding={...scope,agent_generation_epoch:1,base_sha:'a'.repeat(40),role:'IMPLEMENTER'};
 const spec={runId:randomUUID(),executablePath:operator.cli_executable,expectedExecutableSha256:privateTools.cliExecutableSha256,
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
 const calls=[],native={worker:{pid:g.proof.pid,process_incarnation_id:g.proof.process_incarnation_id,exe_path:spec.executablePath,user_sid:g.proof.user_sid},
  helper:{...g.proof.helper_process,exe_path:String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,user_sid:g.proof.user_sid}};
 let onRead=null,onNative=null,onAcl=null,onIdentity=null;
 const aclCalls=[];
 if(physical){
  operator.journal_root=path.join(root,'retained-original-journal');
  for(const key of ['cli_executable','git_executable','codex_home'])operator[key]=path.join(root,'old-install-not-present',key);
  for(const pin of Object.values(operator.sandbox_receipts))pin.path=path.join(root,'old-canary-not-present',path.basename(pin.path));
  await fs.mkdir(config.state_directory);
 }
 const directory=path.join(operator.journal_root,hash(JSON.stringify({task_id:scope.task_id,lease_generation:scope.lease_generation,role:'IMPLEMENTER'})));
 if(physical){
  await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(config.state_directory,'native-coding-operator-v1.json'),JSON.stringify(operator));
  for(const [name,value]of files)await fs.writeFile(path.join(directory,name),JSON.stringify(value));
 }
 const storage=async(target,options)=>{aclCalls.push([target,options?.operation]);return await onAcl?.(target,options)??{owner_dacl_verified:true};};
 const protectedJson=async(file,options={})=>readNativeCodingProtectedJson(file,{...options,verifyStorage:storage});
 const source=await fs.readFile(new URL('./native-coding-host-os-scope.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  function journalPath('),end=source.indexOf('  Object.defineProperty(readNativeScope',start);
 assert.ok(start>0&&end>start);
 const readers=new Function('path','createHash','config','resources','readNativeCodingOperatorPaths','readNativeCodingProtectedJson','readNativeCodingWindowsProcess',
  'fileHash','samePath','fail','nativeCodingCanonicalJson','validateCodexCliProtectedSettlement','validateCodexCliProtectedLaunch','fs','codexCliHelperFileIdentitySha256','validateNativeCodingInstalledPathScope','readDirectoryIdentity','verifyOwnerOnlyWindowsStorage','assertNativeCodingHostRequestOpen','joinNativeCodingHostReads','readPrivateTools',installedOperatorReaderSource(source)+source.slice(start,end)+'\nreturn {readProtectedReceipt,readNativeWorker};')
  (path,createHash,config,resources,async(_directory,options)=>validateNativeCodingOperatorPaths(physical?(await protectedJson(path.join(config.state_directory,'native-coding-operator-v1.json'),options)).value:structuredClone(operator)),async(file,options)=>{
   const name=path.basename(file);calls.push(name);await onRead?.(name,file,options);if(!files.has(name))throw Error('fixture_missing_protected_file');
   if(physical)return protectedJson(file,options);
   const value=structuredClone(files.get(name));return {value,sha256:hash(JSON.stringify(value))};
  },async pid=>{calls.push('native:'+pid);await onNative?.(pid);return structuredClone(pid===native.worker.pid?native.worker:native.helper);},
  async file=>file===spec.executablePath?spec.expectedExecutableSha256:g.proof.helper_sha256,
  (a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase(),why=>{throw Error('native_coding_host_os_'+why);},
  nativeCodingCanonicalJson,validateCodexCliProtectedSettlement,validateCodexCliProtectedLaunch,{lstat:async()=>helperStat},codexCliHelperFileIdentitySha256,validateNativeCodingInstalledPathScope,async directory=>{await onIdentity?.(directory);return physical?readDirectoryIdentity(directory):'a'.repeat(64);},storage,assertNativeCodingHostRequestOpen,joinNativeCodingHostReads,async()=>{await privateTools.revalidate();return privateTools;});
 const permit={role:'IMPLEMENTER',artifact:{cli_executable_sha256:spec.expectedExecutableSha256}},job={payload:{run_id:spec.runId}};
 return {scope,permit,job,receipt,processReceipt,files,native,calls,g,readers,operator,config,directory,aclCalls,setRead:fn=>{onRead=fn;},setNative:fn=>{onNative=fn;},setAcl:fn=>{onAcl=fn;},setIdentity:fn=>{onIdentity=fn;}};
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

test('Host worker retains the strict installed guard before native or receipt access',async()=>{
 const f=await fixture();f.operator.journal_root=path.resolve('unowned-old-profile/journal');
 await assert.rejects(f.readers.readNativeWorker(f.native.worker.pid,f),/installed_path_scope_state_not_owned/);
 assert.deepEqual(f.calls,[]);
});

// Real retained filesystem bytes; generated ACL witness only, not Windows or
// installed authority. No current CLI/Git/home/canary exists in this fixture.
async function retainedFixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'metaengine-retained-receipt-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,...await fixture({root,physical:true})};
}

test('retained original protected journal remains readable without current tools/home/canaries',async t=>{
 const f=await retainedFixture(t),before=new Map();
 for(const name of f.files.keys())before.set(name,await fs.readFile(path.join(f.directory,name)));
 const receipt=await f.readers.readProtectedReceipt(f);assert.deepEqual(receipt,f.receipt);
 assert.equal(receipt.local_output_drain.all_effects_cleanup,'UNCONFIRMED');
 assert.equal(f.calls.some(value=>value.startsWith('native:')),false);
 for(const [name,bytes]of before)assert.deepEqual(await fs.readFile(path.join(f.directory,name)),bytes);
 assert.equal(f.aclCalls.some(([target])=>target===f.operator.journal_root),true);
});

test('unprotected retained journal root is refused before reading original files',async t=>{
 const f=await retainedFixture(t);f.setAcl(target=>target===f.operator.journal_root?{owner_dacl_verified:false}:undefined);
 await assert.rejects(f.readers.readProtectedReceipt(f),/retained_journal_unverified/);assert.deepEqual(f.calls,[]);
});

test('missing original protected configuration cannot adopt an outside journal',async t=>{
 const f=await retainedFixture(t);await fs.unlink(path.join(f.config.state_directory,'native-coding-operator-v1.json'));
 await assert.rejects(f.readers.readProtectedReceipt(f),error=>error.code==='ENOENT');assert.deepEqual(f.calls,[]);
});

for(const kind of ['journal-alias','hardlinked-receipt','changed-result','changed-launch','missing-process'])
 test('retained original read refuses '+kind,async t=>{
  const f=await retainedFixture(t);
  if(kind==='journal-alias'){
   const real=f.operator.journal_root+'-original';await fs.rename(f.operator.journal_root,real);
   await fs.symlink(real,f.operator.journal_root,process.platform==='win32'?'junction':'dir');
  }
  if(kind==='hardlinked-receipt')await fs.link(path.join(f.directory,'receipt.json'),path.join(f.root,'receipt-link.json'));
  if(kind==='changed-result')await fs.writeFile(path.join(f.directory,'result.json'),JSON.stringify({changed:true}));
  if(kind==='changed-launch')await fs.writeFile(path.join(f.directory,'launch.json'),JSON.stringify({...f.g.launch,request_sha256:'f'.repeat(64)}));
  if(kind==='missing-process')await fs.unlink(path.join(f.directory,'process.json'));
  await assert.rejects(f.readers.readProtectedReceipt(f));
 });

for(const kind of ['journal-root','state-origin','descriptor'])test('retained read refuses '+kind+' replacement between original reads',async t=>{
 const f=await retainedFixture(t);let changed=false;
 f.setRead(async name=>{
  if(changed||name!=='result.json')return;changed=true;
  if(kind==='journal-root'){
   const old=f.operator.journal_root+'-old';await fs.rename(f.operator.journal_root,old);await fs.mkdir(f.operator.journal_root);
   await fs.rename(path.join(old,path.basename(f.directory)),f.directory);
  }else if(kind==='state-origin'){
   const old=f.config.state_directory+'-old';await fs.rename(f.config.state_directory,old);await fs.mkdir(f.config.state_directory);
   await fs.copyFile(path.join(old,'native-coding-operator-v1.json'),path.join(f.config.state_directory,'native-coding-operator-v1.json'));
  }else{
   await fs.writeFile(path.join(f.config.state_directory,'native-coding-operator-v1.json'),JSON.stringify({...f.operator,cli_executable:path.join(f.root,'different-missing-cli.exe')}));
  }
 });
 await assert.rejects(f.readers.readProtectedReceipt(f),/retained_journal_changed/);
 assert.equal(changed,true);
});

for(const changed of ['task','agent','epoch','permit-role','permit-hash','job-run','job-prompt','job-pid'])
 test('retained receipt remains bound to original supplied '+changed,async()=>{
  const f=await fixture(),scope={...f.scope},permit=structuredClone(f.permit),job=structuredClone(f.job);
  if(changed==='task')scope.task_id=randomUUID();
  if(changed==='agent')scope.agent_id='agent_different123';
  if(changed==='epoch')scope.agent_generation_epoch=2;
  if(changed==='permit-role')permit.role='CRITIC';
  if(changed==='permit-hash')permit.artifact.cli_executable_sha256='f'.repeat(64);
  if(changed==='job-run')job.payload.run_id=randomUUID();
  if(changed==='job-prompt')job.payload.prompt_sha256='f'.repeat(64);
  if(changed==='job-pid')job.payload.worker_process={pid:f.receipt.pid+1,process_incarnation_id:f.receipt.process_incarnation_id};
  await assert.rejects(f.readers.readProtectedReceipt({scope,permit,job}),/retained_receipt_binding_changed/);
 });

test('retained receipt snapshots caller selectors before native awaits and forwards cancellation to all protected reads',async t=>{
 const f=await retainedFixture(t),controller=new AbortController(),scope={...f.scope},job=structuredClone(f.job);
 const seen=[];f.setRead((_name,_file,options)=>seen.push(options.signal));
 f.setAcl((_target,options)=>{assert.equal(options.signal,controller.signal);});
 const work=f.readers.readProtectedReceipt({scope,permit:f.permit,job,request:{signal:controller.signal}});
 scope.task_id=randomUUID();job.payload.run_id=randomUUID();assert.deepEqual(await work,f.receipt);
 assert.ok(seen.length>=4);assert.ok(seen.every(signal=>signal===controller.signal));
});

test('abort during retained protected reads cannot return an original receipt as settled',async t=>{
 const f=await retainedFixture(t),controller=new AbortController();
 f.setRead(name=>{if(name==='result.json')controller.abort();});
 await assert.rejects(f.readers.readProtectedReceipt({...f,request:{signal:controller.signal}}),/request_cancelled/);
});
