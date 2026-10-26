import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createNativeCodingHostObservers,createNativeCodingPermitRegistry,createNativeCodingWorkerRegistry,
  createNativeCodingResultStore,readNativeCodingProtectedJson,readNativeCodingWindowsProcess,
  readNativeCodingSandboxEvidence} from '../src/native-coding-host-observers.mjs';

// Reader injections below are explicit fixtures. They do not qualify an image,
// ACL, sandbox, provider or useful model result as native runtime evidence.
const hash=v=>createHash('sha256').update(v).digest('hex');
const yes=async()=>({owner_dacl_verified:true});
const id='11111111-1111-4111-8111-111111111111';
const provider='22222222-2222-4222-8222-222222222222';
const agent=`agent_${id}`;
const proc={pid:123,created_at:'2026-10-22T04:00:00.000Z',process_incarnation_id:'pid:123:created_100ns:134055792000000000',
  user_sid:'S-1-5-21-111-1001',exe_path:path.resolve('fixture.exe')};
async function temporary(t){
  const temporary=await fs.realpath(os.tmpdir());
  const root=await fs.realpath(await fs.mkdtemp(path.join(temporary,'metaengine-native-observer-test-')));
  t.after(async()=>{
    const real=await fs.realpath(root);assert.equal(real,path.resolve(root));
    assert.equal(path.dirname(real),temporary);
    assert(path.basename(real).startsWith('metaengine-native-observer-test-'));
    await fs.rm(real,{recursive:true,force:true});
  });return root;
}
async function image(t,overrides={}){
  const root=await temporary(t),resources=path.join(root,'resources'),bundle=path.join(resources,'client-state-runtime');
  await fs.mkdir(bundle,{recursive:true});
  const exe=path.join(root,'fixture.exe'),asar=path.join(resources,'app.asar'),cli=path.join(root,'codex.exe');
  await Promise.all([[exe,'exe'],[asar,'asar'],[cli,'cli'],[path.join(bundle,'runtime.mjs'),'runtime']].map(([file,data])=>fs.writeFile(file,data)));
  let verifications=0,native={...proc,exe_path:exe};
  const options={app:{isPackaged:true,getPath:()=>exe,getAppPath:()=>asar},resourcesPath:resources,cliPath:cli,
    gitExecutable:process.execPath,identity:{snapshot:()=>({})},ownPostgres:{readScope:async()=>{},readLease:async()=>{}},
    permitRegistry:{readProvider:async()=>{}},readNativeWorker:async()=>{},readCriticSubject:async()=>{},
    readProcess:async()=>native,
    readPackage:async()=>({version:'unit-fixture',metaengineClientStateRuntime:{bundle_sha256:'a'.repeat(64),source_head_sha:'b'.repeat(40),package_version:'unit-fixture'}}),
    verifyResources:async()=>{verifications++;},...overrides};
  return {root,resources,bundle,exe,asar,cli,observers:createNativeCodingHostObservers(options),get verifications(){return verifications;},
    changeNative:v=>{native=v;}};
}

test('image qualification happens once before issuer timestamps and every observation has a fresh native guard',async t=>{
  const f=await image(t);
  await assert.rejects(f.observers.readInstalledImage(),/not_prepared/);
  await Promise.all([f.observers.prepareInstalledImage(),f.observers.prepareInstalledImage()]);
  const a=await f.observers.readInstalledImage(),b=await f.observers.readInstalledImage();
  assert.equal(f.verifications,1);assert.equal(a.source,'INSTALLED_IMAGE_NATIVE_VERIFIER');
  assert.equal(a.value.installed_exe_sha256,hash('exe'));assert.deepEqual(a.value,b.value);
  assert(Date.parse(b.observed_at)>=Date.now()-1000);
});

for(const mutation of ['file-bytes','added-entry','deleted-entry','file-replaced'])test(`physical image guard permanently fences ${mutation}`,async t=>{
  const f=await image(t);await f.observers.prepareInstalledImage();const file=path.join(f.bundle,'runtime.mjs');
  if(mutation==='file-bytes')await fs.writeFile(file,'changed');
  if(mutation==='added-entry')await fs.writeFile(path.join(f.bundle,'unexpected.mjs'),'unexpected');
  if(mutation==='deleted-entry')await fs.unlink(file);
  if(mutation==='file-replaced'){await fs.rename(file,`${file}.old`);await fs.writeFile(file,'runtime');}
  await assert.rejects(f.observers.readInstalledImage(),/guard_changed/);
  await assert.rejects(f.observers.prepareInstalledImage(),/invalidated/);assert.equal(f.verifications,1);
});

test('mutation during expensive byte verification cannot seed the prepared inventory',async t=>{
  let root;
  const f=await image(t,{verifyResources:async()=>fs.writeFile(path.join(root,'runtime.mjs'),'during-verify')});root=f.bundle;
  await assert.rejects(f.observers.prepareInstalledImage(),/changed_during_preparation/);
  await assert.rejects(f.observers.readInstalledImage(),/not_prepared/);
});

test('a failed full verifier is fenced without silently attesting a later retry',async t=>{
  let count=0;const f=await image(t,{verifyResources:async()=>{count++;throw Error('fixture_verification_failure');}});
  await assert.rejects(f.observers.prepareInstalledImage(),/fixture_verification_failure/);
  await assert.rejects(f.observers.prepareInstalledImage(),/invalidated/);assert.equal(count,1);
});

test('current kernel image mismatch fences previously qualified bytes',async t=>{
  const f=await image(t);await f.observers.prepareInstalledImage();f.changeNative({...proc,exe_path:f.cli});
  await assert.rejects(f.observers.readInstalledImage(),/guard_changed/);
});

test('protected JSON requires affirmative ACL readback and hashes exact physical bytes',async t=>{
  const root=await temporary(t),file=path.join(root,'private.json'),bytes='{"schema":"fixture"}\n';await fs.writeFile(file,bytes);
  const calls=[];const result=await readNativeCodingProtectedJson(file,{verifyStorage:async(p,{operation})=>{calls.push([p,operation]);return yes();}});
  assert.equal(result.sha256,hash(bytes));assert.equal(calls.length,2);
  await assert.rejects(readNativeCodingProtectedJson(file,{verifyStorage:async()=>({})}),/private_storage_unverified/);
  await assert.rejects(readNativeCodingProtectedJson(file,{maximumBytes:2,verifyStorage:yes}),/json_budget/);
  const alias=path.join(root,'hardlink.json');await fs.link(file,alias);
  await assert.rejects(readNativeCodingProtectedJson(file,{verifyStorage:yes}),/physical_path_invalid/);
});

function permitFixture(){
  const device={device_id:id,client_id:provider,key_fingerprint_sha256:'a'.repeat(64)};
  const permit={schema:'metaengine.native-coding.operator-permit.v1',permit_id:id,provider_id:provider,agent_id:agent,device_id:id,
    device_key_fingerprint_sha256:device.key_fingerprint_sha256,workspace_id:id,project_id:provider,revoked:false,
    expires_at:new Date(Date.now()+60000).toISOString()};
  const binding={permit_id:id,provider_id:provider,agent_id:agent,device_id:id,client_id:provider,workspace_id:id,project_id:provider,permit};
  const scope={schema:'metaengine.native-coding.own-pg-scope.v1',source:'PRIVATE_RUNTIME_HOST_OWN_PG',observed_at:new Date().toISOString(),bindings:[binding]};
  return {scope,permit,binding,registry:createNativeCodingPermitRegistry({identity:{snapshot:()=>device},ownPostgres:{readScope:async()=>scope}})};
}
test('private permit roster is bound to current enrolled device, project and permit row',async()=>{
  const f=permitFixture();assert.deepEqual(await f.registry.listProviderSelectors(),[{provider_id:provider,agent_id:agent}]);
  f.binding.project_id=id;await assert.rejects(f.registry.readProvider({provider_id:provider,agent_id:agent}),/binding_missing/);
});
test('duplicate, revoked, stale and foreign device bindings cannot select a provider',async()=>{
  for(const mutate of [f=>f.scope.bindings.push(f.binding),f=>{f.permit.revoked=true;},f=>{f.scope.observed_at='2020-01-01T00:00:00.000Z';},
    f=>{f.binding.client_id=id;},f=>{f.permit.device_key_fingerprint_sha256='b'.repeat(64);}]){
    const f=permitFixture();mutate(f);await assert.rejects(f.registry.readProvider({provider_id:provider,agent_id:agent}));
  }
});

test('only privately registered, still suspended native workers can be signed and resumed',async()=>{
  let finish,resumes=0;const runId=randomUUID(),prompt='fixture prompt';
  const proof={...proc,started_at:proc.created_at,job_id:runId,tree_control_bound:true,started_suspended:true,job_bound_before_resume:true};
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>({proof,
    completion:new Promise(r=>{finish=r;}),resume:async()=>{resumes++;},terminate:async()=>{finish();}})}});
  const scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash(prompt)};
  await assert.rejects(registry.readNativeWorker({...scope,run_id:runId}),/not_privately_bound/);
  const child=await registry.controllerFor(scope).spawn({runId,binding:scope,executablePath:proc.exe_path});
  const readback=await registry.readNativeWorker({...scope,run_id:runId});assert.equal(readback.value.worker_process.process_incarnation_id,proc.process_incarnation_id);
  await assert.rejects(child.resume('different'),/resume_changed/);assert.equal(resumes,0);
  await child.resume(prompt);assert.equal(resumes,1);
  await assert.rejects(registry.readNativeWorker({...scope,run_id:runId}),/not_privately_bound/);
  await assert.rejects(child.resume(prompt),/resume_changed/);await registry.close();
});

test('PID reuse or changed owner cannot become a suspended job observation',async()=>{
  for(const replacement of [{...proc,process_incarnation_id:proc.process_incarnation_id+'1'},{...proc,user_sid:'S-1-5-21-111-1002'}]){
    const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};let finish;
    const registry=createNativeCodingWorkerRegistry({readProcess:async()=>replacement,processController:{spawn:async()=>({
      proof:{...proc,job_id:runId,tree_control_bound:true,started_suspended:true,job_bound_before_resume:true},
      completion:new Promise(r=>{finish=r;}),resume:async()=>{},terminate:async()=>{finish();}})}});
    await registry.controllerFor(scope).spawn({runId,binding:scope,executablePath:proc.exe_path});
    await assert.rejects(registry.readNativeWorker({...scope,run_id:runId}),/native_binding_changed/);await registry.close();
  }
});

for(const outcome of ['unconfirmed','rejected','missing'])test(`worker shutdown retains ${outcome} native cleanup as unknown`,async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let finish,rejectCompletion,terminated=0;
  const completion=new Promise((resolve,reject)=>{finish=resolve;rejectCompletion=reject;});
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>({
    proof:{...proc,job_id:runId},completion,resume:async()=>{},terminate:async()=>{terminated++;throw Error('fixture_terminate_unconfirmed');}})}});
  await registry.controllerFor(scope).spawn({runId,binding:scope});
  if(outcome==='rejected')rejectCompletion(Error('fixture_native_completion_rejected'));
  else finish(outcome==='missing'?undefined:{exit_code:0,tree_cleanup_confirmed:false});
  await new Promise(resolve=>setImmediate(resolve));
  const first=registry.close(),second=registry.close();assert.equal(first,second);
  const closed=await first;assert.equal(closed.cleanup_confirmed,false);assert.deepEqual(closed.unconfirmed_runs,[runId]);
  assert.equal(terminated,1);assert.equal(closed.automatic_retry_allowed,false);
});

test('only explicit native tree cleanup permits a confirmed worker drain',async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let finish,terminated=0;
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>({
    proof:{...proc,job_id:runId},completion:new Promise(resolve=>{finish=resolve;}),resume:async()=>{},
    terminate:async()=>{terminated++;finish({exit_code:1,tree_cleanup_confirmed:true});}})}});
  await registry.controllerFor(scope).spawn({runId,binding:scope});
  const closed=await registry.close();assert.equal(closed.cleanup_confirmed,true);assert.equal(closed.worker_count,1);
  assert.deepEqual(closed.unconfirmed_runs,[]);assert.equal(terminated,1);
});

test('shutdown captures a suspended native handle that arrives after close and forbids duplicate pending spawn',async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let release,finish,terminated=0,resumed=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>pending}});
  const controller=registry.controllerFor(scope),spec={runId,binding:scope};
  const spawning=controller.spawn(spec);const rejected=assert.rejects(spawning,/closed_during_spawn/);
  await assert.rejects(controller.spawn(spec),/worker_scope_changed/);
  const closing=registry.close();let closed=false;closing.then(()=>{closed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
  release({proof:{...proc,job_id:runId},completion:new Promise(resolve=>{finish=resolve;}),resume:async()=>{resumed++;},
    terminate:async()=>{terminated++;finish({tree_cleanup_confirmed:true});}});
  await rejected;assert.equal((await closing).cleanup_confirmed,true);assert.equal(terminated,1);assert.equal(resumed,0);
});

test('spawn rejection without a returned native handle cannot establish cleanup',async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>{throw Error('fixture_spawn_unknown');}}});
  await assert.rejects(registry.controllerFor(scope).spawn({runId,binding:scope}),/fixture_spawn_unknown/);
  const closed=await registry.close();assert.equal(closed.cleanup_confirmed,false);assert.deepEqual(closed.unconfirmed_runs,[runId]);
});

test('unknown native handles cannot be evicted to admit additional physical work',async()=>{
  const scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let spawned=0;
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>{
    spawned++;return {proof:proc,completion:Promise.resolve({tree_cleanup_confirmed:false}),resume:async()=>{},terminate:async()=>{}};
  }}});
  const controller=registry.controllerFor(scope);
  for(let i=0;i<128;i++)await controller.spawn({runId:randomUUID(),binding:scope});
  await assert.rejects(controller.spawn({runId:randomUUID(),binding:scope}),/registry_capacity/);
  assert.equal(spawned,128);const closed=await registry.close();assert.equal(closed.cleanup_confirmed,false);
  assert.equal(closed.unconfirmed_runs.length,128);
});

test('independent Critic subject resolves only exact immutable author receipt, patch and process',async t=>{
  const root=await temporary(t),journalRoot=path.join(root,'journal'),indexRoot=path.join(root,'index'),run_id=randomUUID();
  const directory=path.join(journalRoot,hash(JSON.stringify({task_id:id,lease_generation:1,role:'IMPLEMENTER'})));
  await fs.mkdir(directory,{recursive:true});
  const receipt={state:'RESULT_READY',role:'IMPLEMENTER',task_id:id,lease_generation:1,workspace_id:id,project_id:provider,agent_id:agent,
    run_id,result:{outcome:'DONE'},result_sha256:'a'.repeat(64),git_after:{artifact_sha256:'b'.repeat(64),head:'c'.repeat(40)},
    pid:proc.pid,process_incarnation_id:proc.process_incarnation_id,process:{...proc,started_at:proc.created_at}};
  const file=path.join(directory,'receipt.json');await fs.writeFile(file,JSON.stringify(receipt));
  const store=createNativeCodingResultStore({journalRoot,indexRoot,verifyStorage:yes,protectStorage:yes});await store.publish(receipt);
  const query={workspace_id:id,project_id:provider,verification_subject:{run_id,result_sha256:receipt.result_sha256,
    git_artifact_sha256:receipt.git_after.artifact_sha256,source_head:receipt.git_after.head}};
  const resolved=await store.resolveRunnerSubject(query);assert.equal(resolved.task_id,id);
  const result=await store.readCriticSubject(query);assert.equal(result.value.agent_id,agent);assert.equal(result.value.worker_process.pid,proc.pid);
  for(const field of ['result_sha256','git_artifact_sha256','source_head']){
    await assert.rejects(store.readCriticSubject({...query,verification_subject:{...query.verification_subject,[field]:'d'.repeat(field==='source_head'?40:64)}}),/subject_changed/);
  }
  receipt.git_after.head='e'.repeat(40);await fs.writeFile(file,JSON.stringify(receipt));
  await assert.rejects(store.resolveRunnerSubject(query),/subject_changed/);
});

async function sandboxFixture(t){
  const root=await temporary(t),cliPath=path.join(root,'codex.exe'),receiptPath=path.join(root,'receipt.json');await fs.writeFile(cliPath,'fixture-cli');
  const denied={outcome:'ERROR',access_denied:true,error_type:'System.UnauthorizedAccessException'},written={outcome:'WRITTEN',access_denied:false};
  const canary={schema:'metaengine.codex-cli.sandbox-canary.v1',mode:'workspace-write',pid:124,started_at:'2026-10-22T04:00:00.123Z',user_sid:'S-1-5-21-111-1002',
    inside_append:written,inside_create:written,outside_append:denied,outside_create:denied};
  const value={schema:'metaengine.codex-cli.sandbox-probe.v1',mode:'workspace-write',workspace_path:root,cli_path:cliPath,cli_sha256:hash('fixture-cli'),
    model_called:false,authority_effect:false,host_boot:{schema:'metaengine.windows.kernel-boot.v1',kernel_boot_id:29,
      system_process:{pid:4,created_at:'2026-10-22T03:00:00.000Z',created_100ns:String(BigInt(Date.parse('2026-10-22T03:00:00.000Z'))*10000n+116444736000000000n)},
      last_boot_at:'2026-10-22T03:00:00.000Z',os_version:'10.0.19045'},canary,
    sandbox_process:{pid:124,started_at:canary.started_at,user_sid:canary.user_sid},
    host_readback:{inside_existing_appended:true,inside_new_written:true,outside_existing_unchanged:true,outside_new_absent:true},
    completion:{exit_code:0,signal:null,tree_cleanup_confirmed:true},logs:{}};
  for(const [name,content] of [['stdout',JSON.stringify(canary)+'\n'],['stderr',''],['exit',JSON.stringify(value.completion)+'\n']]){
    const file=path.join(root,`${name}.log`);await fs.writeFile(file,content);value.logs[`${name}_path`]=file;value.logs[`${name}_sha256`]=hash(content);
  }
  const save=async()=>{const text=JSON.stringify(value);await fs.writeFile(receiptPath,text);return {path:receiptPath,sha256:hash(text)};};
  const options={pin:await save(),cliPath,worktreePath:root,role:'IMPLEMENTER',readProcess:async()=>proc,
    readBoot:async()=>structuredClone(value.host_boot),verifyStorage:yes};return {value,options,save};
}
test('prepared sandbox image reader preserves exact bytes and invalidates a changed executable',async t=>{
  const {createNativeCodingHostImageGuard}=await import('../../../infra/client-state-runtime/native-coding-host-os-scope.mjs');
  const f=await sandboxFixture(t),guard=createNativeCodingHostImageGuard();
  await guard.prepare([f.options.cliPath]);
  const options={...f.options,readExecutableSha256:file=>guard.read(file)};
  assert.equal((await readNativeCodingSandboxEvidence(options)).mode,'workspace-write');
  await fs.writeFile(f.options.cliPath,'changed-cli');
  await assert.rejects(readNativeCodingSandboxEvidence(options),/image_preparation_invalidated/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readExecutableSha256:async()=>null}),/image_digest_invalid/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readExecutableSha256:async()=> 'f'.repeat(64)}),/scope_mismatch/);
});
test('sandbox reader binds exact CLI, worktree, current boot and raw logs including empty stderr',async t=>{
  const f=await sandboxFixture(t);assert.equal((await readNativeCodingSandboxEvidence(f.options)).mode,'workspace-write');
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,worktreePath:path.join(f.options.worktreePath,'elsewhere')}),/scope_mismatch/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,role:'CRITIC'}),/scope_mismatch/);
  assert.equal((await readNativeCodingSandboxEvidence({...f.options,readBoot:async()=>({...f.value.host_boot,last_boot_at:'2026-10-23T03:00:00.000Z'})})).mode,'workspace-write');
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readBoot:async()=>({...f.value.host_boot,kernel_boot_id:30})}),/scope_mismatch/);
  const old=f.value.host_boot;f.value.host_boot={last_boot_at:old.last_boot_at};await assert.rejects(readNativeCodingSandboxEvidence({...f.options,pin:await f.save()}),/scope_mismatch/);
  f.value.host_boot=old;f.options.pin=await f.save();
  await fs.writeFile(f.value.logs.stdout_path,'tampered');await assert.rejects(readNativeCodingSandboxEvidence(f.options),/log_digest_mismatch/);
});

test('native Windows process inventory independently reads this test process without executing a model',{skip:process.platform!=='win32',timeout:20000},async()=>{
  const actual=await readNativeCodingWindowsProcess(process.pid);
  assert.equal(actual.pid,process.pid);assert.equal(actual.exe_path.toLowerCase(),process.execPath.toLowerCase());
  assert.match(actual.user_sid,/^S-1-/);assert.match(actual.process_incarnation_id,new RegExp(`^pid:${process.pid}:created_100ns:[0-9]+$`));
  assert(Date.parse(actual.created_at)<=Date.now());
});
