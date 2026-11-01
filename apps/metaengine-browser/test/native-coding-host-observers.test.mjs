import {joinedSettlementFixture} from './fixtures/codex-cli-joined-settlement-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {captureCodexCliPhysicalScope} from '../src/codex-cli-execution-policy.mjs';
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
  return {root,resources,bundle,exe,asar,cli,options,observers:createNativeCodingHostObservers(options),get verifications(){return verifications;},
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

test('private tool tree drift permanently fences a prepared installed image',async t=>{
  const f=await image(t);let drift=false,checks=0;
  const privateTools={cliExecutable:f.cli,gitExecutable:process.execPath,cliExecutableSha256:hash('cli'),gitExecutableSha256:'a'.repeat(64),
    environment:{PATH:''},revalidate:async()=>{checks++;if(drift)throw Error('fixture_private_tools_drift');}};
  const observers=createNativeCodingHostObservers({...f.options,privateTools});
  await observers.prepareInstalledImage();await observers.readInstalledImage();assert.ok(checks>=3);
  drift=true;await assert.rejects(observers.readInstalledImage(),/fixture_private_tools_drift/);
  drift=false;await assert.rejects(observers.prepareInstalledImage(),/invalidated/);
});

test('private tool digest and selection must match the physically observed CLI',async t=>{
  const f=await image(t);
  const privateTools={cliExecutable:f.cli,gitExecutable:process.execPath,cliExecutableSha256:'a'.repeat(64),gitExecutableSha256:'b'.repeat(64),
    environment:{PATH:''},revalidate:async()=>{}};
  assert.throws(()=>createNativeCodingHostObservers({...f.options,privateTools,cliPath:path.join(f.root,'foreign.exe')}),/private_tools_binding/);
  const observers=createNativeCodingHostObservers({...f.options,privateTools});
  await assert.rejects(observers.prepareInstalledImage(),/private_tools_cli_digest_mismatch/);
  await assert.rejects(observers.prepareInstalledImage(),/invalidated/);
});

test('private worktree read uses captured package Git environment and rejects drift before spawn',async t=>{
  const f=await image(t);const calls=[];let drift=false;
  const environment={PATH:'package-only-bin',GIT_EXEC_PATH:'package-only-libexec',GIT_SSL_CAINFO:'package-only-ca'};
  const privateTools={cliExecutable:f.cli,gitExecutable:process.execPath,cliExecutableSha256:hash('cli'),gitExecutableSha256:'a'.repeat(64),
    environment,revalidate:async()=>{if(drift)throw Error('fixture_private_tree_missing');}};
  const observers=createNativeCodingHostObservers({...f.options,privateTools,runGit:async(file,args,options)=>{
    calls.push({file,args,options});throw Error('fixture_stop_after_capture');
  }});
  environment.PATH='mutable-decoy';
  await assert.rejects(observers.readWorktree({worktree_path:f.root}),/fixture_stop_after_capture/);
  assert.equal(calls[0].file,process.execPath);assert.equal(calls[0].options.env.PATH,'package-only-bin');
  assert.equal(calls[0].options.env.GIT_EXEC_PATH,'package-only-libexec');assert.equal(calls[0].options.shell,false);
  drift=true;await assert.rejects(observers.readWorktree({worktree_path:f.root}),/fixture_private_tree_missing/);
  assert.equal(calls.length,1);
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

test('worktree observer strips external Git overrides then restores fixed private config policy',async t=>{
 const calls=[],f=await image(t,{runGit:async(executable,args,options)=>{
  assert.equal(executable,process.execPath);calls.push(options.env);
  if(args.includes('--show-toplevel'))return {stdout:path.join(f.root,'worktree')};
  if(args.includes('--absolute-git-dir'))return {stdout:path.join(f.root,'metadata')};
  if(args.includes('HEAD'))return {stdout:'a'.repeat(40)};
  throw Error('generated_unexpected_git');
 }});
 const worktree=path.join(f.root,'worktree'),metadata=path.join(f.root,'metadata');
 await fs.mkdir(worktree);await fs.mkdir(metadata);
 await fs.writeFile(path.join(worktree,'.git'),'gitdir: '+metadata);await fs.writeFile(path.join(metadata,'locked'),'generated');
 const original=process.env;t.after(()=>{process.env=original;});
 process.env={PATH:'generated-ambient-path',GIT_CONFIG_GLOBAL:'C:\\Program Files\\Git\\etc\\gitconfig',
  GIT_CONFIG_NOSYSTEM:'0',git_config_system:'generated-hostile-system-config',GIT_CONFIG_COUNT:'1',
  GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'generated-hostile-hooks',GIT_ASKPASS:'generated-hostile-askpass',GIT_EXEC_PATH:'generated-hostile-helpers'};
 const result=await f.observers.readWorktree({worktree_path:worktree});assert.equal(result.value.base_sha,'a'.repeat(40));
 assert.equal(calls.length,3);
 for(const env of calls){
  assert.equal(env.GIT_CONFIG_NOSYSTEM,'1');assert.equal(env.GIT_CONFIG_GLOBAL,process.platform==='win32'?'NUL':'/dev/null');
  assert.equal(env.GIT_TERMINAL_PROMPT,'0');
  for(const name of ['git_config_system','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_ASKPASS','GIT_EXEC_PATH'])assert.equal(Object.hasOwn(env,name),false,name);
 }
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

for(const outcome of ['unconfirmed','rejected','missing','bare-true'])test(`worker shutdown retains ${outcome} native cleanup as unknown`,async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let finish,rejectCompletion,terminated=0;
  const completion=new Promise((resolve,reject)=>{finish=resolve;rejectCompletion=reject;});
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>({
    proof:{...proc,job_id:runId},completion,resume:async()=>{},terminate:async()=>{terminated++;throw Error('fixture_terminate_unconfirmed');}})}});
  await registry.controllerFor(scope).spawn({runId,binding:scope});
  if(outcome==='rejected')rejectCompletion(Error('fixture_native_completion_rejected'));
  else finish(outcome==='missing'?undefined:{exit_code:0,tree_cleanup_confirmed:outcome==='bare-true'});
  await new Promise(resolve=>setImmediate(resolve));
  const first=registry.close(),second=registry.close();assert.equal(first,second);
  const closed=await first;assert.equal(closed.cleanup_confirmed,false);assert.deepEqual(closed.unconfirmed_runs,[runId]);
  assert.equal(terminated,1);assert.equal(closed.automatic_retry_allowed,false);
});

test('only request-bound joined native cleanup permits a confirmed worker drain',async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let finish,terminated=0;const generated=joinedSettlementFixture({runId,binding:scope},{pid:proc.pid,birth:proc.process_incarnation_id.split(':')[3],sid:proc.user_sid});
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>({
    proof:generated.proof,completion:new Promise(resolve=>{finish=resolve;}),resume:async()=>{},
    terminate:async()=>{terminated++;finish(generated.complete({exit_code:1}));}})}});
  await registry.controllerFor(scope).spawn({runId,binding:scope});
  const closed=await registry.close();assert.equal(closed.cleanup_confirmed,true);assert.equal(closed.worker_count,1);
  assert.deepEqual(closed.unconfirmed_runs,[]);assert.equal(terminated,1);
});

test('shutdown captures a suspended native handle that arrives after close and forbids duplicate pending spawn',async()=>{
  const runId=randomUUID(),scope={provider_id:provider,agent_id:agent,task_id:id,lease_generation:1,prompt_sha256:hash('prompt')};
  let release,finish,terminated=0,resumed=0;const generated=joinedSettlementFixture({runId,binding:scope},{pid:proc.pid,birth:proc.process_incarnation_id.split(':')[3],sid:proc.user_sid});
  const pending=new Promise(resolve=>{release=resolve;});
  const registry=createNativeCodingWorkerRegistry({readProcess:async()=>proc,processController:{spawn:async()=>pending}});
  const controller=registry.controllerFor(scope),spec={runId,binding:scope};
  const spawning=controller.spawn(spec);const rejected=assert.rejects(spawning,/closed_during_spawn/);
  await assert.rejects(controller.spawn(spec),/worker_scope_changed/);
  const closing=registry.close();let closed=false;closing.then(()=>{closed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);
  release({proof:generated.proof,completion:new Promise(resolve=>{finish=resolve;}),resume:async()=>{resumed++;},
    terminate:async()=>{terminated++;finish(generated.complete());}});
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
  const root=await temporary(t),cliPath=path.join(root,'codex.exe'),receiptPath=path.join(root,'receipt.json'),
    worktreePath=path.join(root,'worktree'),codexHome=path.join(root,'home'),scratchRoot=path.join(root,'scratch');
  for(const directory of [worktreePath,codexHome,scratchRoot])await fs.mkdir(directory);
  await fs.writeFile(cliPath,'fixture-cli');
  const denied={outcome:'ERROR',access_denied:true,error_type:'System.UnauthorizedAccessException'},written={outcome:'WRITTEN',access_denied:false};
  const canary={schema:'metaengine.codex-cli.sandbox-canary.v1',mode:'workspace-write',pid:124,started_at:'2026-10-22T04:00:00.123Z',user_sid:'S-1-5-21-111-1002',
    inside_append:written,inside_create:written,outside_append:denied,outside_create:denied};
  const value={state:'OBSERVED',reason:null,boundary_observed:true,sandbox_backend:'CODEX_WINDOWS_ELEVATED',execution_authorized:false,schema:'metaengine.codex-cli.sandbox-probe.v2',mode:'workspace-write',workspace_path:worktreePath,cli_path:cliPath,cli_sha256:hash('fixture-cli'),
    codex_home_path:codexHome,temporary_root:scratchRoot,
    model_called:false,authority_effect:false,host_boot:{schema:'metaengine.windows.kernel-boot.v1',kernel_boot_id:29,
      system_process:{pid:4,created_at:'2026-10-22T03:00:00.000Z',created_100ns:String(BigInt(Date.parse('2026-10-22T03:00:00.000Z'))*10000n+116444736000000000n)},
      last_boot_at:'2026-10-22T03:00:00.000Z',os_version:'10.0.19045'},canary,
    sandbox_process:{pid:124,started_at:canary.started_at,user_sid:canary.user_sid},
    host_readback:{inside_existing_appended:true,inside_new_written:true,outside_existing_unchanged:true,outside_new_absent:true},
    completion:{exit_code:0,signal:null,tree_cleanup_confirmed:true},logs:{}};
  for(const [name,content] of [['stdout',JSON.stringify(canary)+'\n'],['stderr',''],['exit',JSON.stringify(value.completion)+'\n']]){
    const file=path.join(root,`${name}.log`);await fs.writeFile(file,content);value.logs[`${name}_path`]=file;value.logs[`${name}_sha256`]=hash(content);
  }
  const captureScope=()=>captureCodexCliPhysicalScope({cliPath,codexHome,scratchRoot,workspaceRoot:worktreePath,mode:'workspace-write',verifyStorage:yes});
  value.execution_scope=structuredClone(await captureScope());
  const save=async()=>{const text=JSON.stringify(value);await fs.writeFile(receiptPath,text);return {path:receiptPath,sha256:hash(text)};};
  const options={pin:await save(),cliPath,worktreePath,codexHome,scratchRoot,role:'IMPLEMENTER',readProcess:async()=>proc,
    readBoot:async()=>structuredClone(value.host_boot),verifyStorage:yes};return {root,value,options,save,captureScope};
}
test('prepared sandbox image reader preserves exact bytes and invalidates a changed executable',async t=>{
  const {createNativeCodingHostImageGuard}=await import('../../../infra/client-state-runtime/native-coding-host-os-scope.mjs');
  const f=await sandboxFixture(t),guard=createNativeCodingHostImageGuard();
  await guard.prepare([f.options.cliPath]);
  const options={...f.options,readExecutableSha256:file=>guard.read(file)};
  await assert.rejects(readNativeCodingSandboxEvidence(options),/sandbox_configuration_equivalence_unverified/);
  await fs.writeFile(f.options.cliPath,'changed-cli');
  await assert.rejects(readNativeCodingSandboxEvidence(options),/image_preparation_invalidated/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readExecutableSha256:async()=>null}),/image_digest_invalid/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readExecutableSha256:async()=> 'f'.repeat(64)}),/scope_mismatch/);
});
test('sandbox reader binds exact CLI, worktree, current boot and raw logs including empty stderr',async t=>{
  const f=await sandboxFixture(t);await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_configuration_equivalence_unverified/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,worktreePath:path.join(f.options.worktreePath,'elsewhere')}),/scope_mismatch/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,role:'CRITIC'}),/scope_mismatch/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readBoot:async()=>({...f.value.host_boot,last_boot_at:'2026-10-23T03:00:00.000Z'})}),/sandbox_configuration_equivalence_unverified/);
  await assert.rejects(readNativeCodingSandboxEvidence({...f.options,readBoot:async()=>({...f.value.host_boot,kernel_boot_id:30})}),/scope_mismatch/);
  const old=f.value.host_boot;f.value.host_boot={last_boot_at:old.last_boot_at};await assert.rejects(readNativeCodingSandboxEvidence({...f.options,pin:await f.save()}),/scope_mismatch/);
  f.value.host_boot=old;f.options.pin=await f.save();
  await fs.writeFile(f.value.logs.stdout_path,'tampered');await assert.rejects(readNativeCodingSandboxEvidence(f.options),/log_digest_mismatch/);
});

test('historical v1 sandbox receipts remain HOLD even with copied current scope and public proof flags',async t=>{
 const f=await sandboxFixture(t);f.value.schema='metaengine.codex-cli.sandbox-probe.v1';
 delete f.value.execution_scope;
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,pin:await f.save()}),/historical_sandbox_receipt_hold/);
 f.value.execution_scope={...await f.captureScope(),configuration_attestation:'VERIFIED'};
 f.value.configuration_equivalence_verified=true;
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,pin:await f.save()}),/historical_sandbox_receipt_hold/);
});

test('matching v2 local configuration sources cannot qualify genuine effective configuration',async t=>{
 const f=await sandboxFixture(t),scope=await f.captureScope();
 assert.deepEqual(scope,f.value.execution_scope);assert.equal(scope.configuration_attestation,'UNAVAILABLE');
 assert.equal(scope.local_configuration.exhaustive,false);assert.equal(scope.configuration_semantics.equivalent,false);
 assert.equal(path.dirname(f.options.codexHome),f.root);assert.equal(path.dirname(f.options.scratchRoot),f.root);
 assert.notEqual(f.options.worktreePath,f.root);
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_configuration_equivalence_unverified/);
});

for(const [name,mutate]of [
 ['home',f=>{f.value.execution_scope.home.path=f.options.scratchRoot;}],
 ['scratch',f=>{f.value.execution_scope.scratch.path=f.options.codexHome;}],
 ['workspace',f=>{f.value.execution_scope.workspace.path=f.options.codexHome;}],
 ['CLI',f=>{f.value.execution_scope.cli.path=f.value.logs.stdout_path;}],
 ['local configuration digest',f=>{f.value.execution_scope.local_configuration.sha256='0'.repeat(64);}],
 ['operator choices',f=>{f.value.execution_scope.operator_choices_sha256='0'.repeat(64);}],
 ['permission overrides',f=>{f.value.execution_scope.permission_overrides.push('-c','sandbox_workspace_write.network_access=true');}],
 ['configuration semantics',f=>{f.value.execution_scope.configuration_semantics.equivalent=true;}],
 ['public VERIFIED attestation',f=>{f.value.execution_scope.configuration_attestation='VERIFIED';}],
])test('v2 sandbox consumer rejects repinned tampered '+name,async t=>{
 const f=await sandboxFixture(t);mutate(f);
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,pin:await f.save()}),/sandbox_execution_scope_mismatch/);
});

for(const argument of ['codexHome','scratchRoot','worktreePath'])test('same-named '+argument+' replacement invalidates v2 sandbox evidence',async t=>{
 const f=await sandboxFixture(t),target=f.options[argument];
 await fs.rename(target,target+'-retired');await fs.mkdir(target);
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_execution_scope_mismatch/);
});

test('same-byte CLI replacement invalidates v2 physical scope after its byte digest still matches',async t=>{
 const f=await sandboxFixture(t);await fs.rename(f.options.cliPath,f.options.cliPath+'.retired');await fs.writeFile(f.options.cliPath,'fixture-cli');
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_execution_scope_mismatch/);
});

for(const argument of ['codexHome','scratchRoot'])test('v2 sandbox consumer requires explicit '+argument+' and rejects changed protected choices',async t=>{
 const f=await sandboxFixture(t);
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,[argument]:undefined}),/scope_arguments_invalid|auth_home_absolute_required/);
 const other=path.join(f.root,'other-'+argument);await fs.mkdir(other);
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,[argument]:other}),/sandbox_execution_scope_mismatch/);
 await fs.rename(f.options[argument],f.options[argument]+'-absent');
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),{code:'ENOENT'});
});

test('v2 sandbox consumer rejects newly broadened home ACL after receipt validation',async t=>{
 const f=await sandboxFixture(t);
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,verifyStorage:async target=>({owner_dacl_verified:target!==f.options.codexHome})}),/storage_unverified/);
});

for(const location of ['home','project','ancestor'])test('new '+location+' configuration source invalidates a pinned v2 sandbox receipt',async t=>{
 const f=await sandboxFixture(t),directory=location==='home'?f.options.codexHome:path.join(location==='project'?f.options.worktreePath:f.root,'.codex');
 await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'config.toml'),'model="source-added-after-probe"\n');
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_execution_scope_mismatch/);
});

test('changed and removed home configuration bytes invalidate a pinned v2 sandbox receipt',async t=>{
 const f=await sandboxFixture(t),file=path.join(f.options.codexHome,'config.toml');await fs.writeFile(file,'model="before"\n');
 f.value.execution_scope=structuredClone(await f.captureScope());f.options.pin=await f.save();
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_configuration_equivalence_unverified/);
 await fs.writeFile(file,'model="changed-after-probe"\n');
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_execution_scope_mismatch/);
 await fs.unlink(file);
 await assert.rejects(readNativeCodingSandboxEvidence(f.options),/sandbox_execution_scope_mismatch/);
});

test('native Windows process inventory independently reads this test process without executing a model',{skip:process.platform!=='win32',timeout:20000},async()=>{
  const actual=await readNativeCodingWindowsProcess(process.pid);
  assert.equal(actual.pid,process.pid);assert.equal(actual.exe_path.toLowerCase(),process.execPath.toLowerCase());
  assert.match(actual.user_sid,/^S-1-/);assert.match(actual.process_incarnation_id,new RegExp(`^pid:${process.pid}:created_100ns:[0-9]+$`));
  assert(Date.parse(actual.created_at)<=Date.now());
});

test('protected JSON forwards cancellation to both ACL reads and rejects their late success',async t=>{
 const root=await temporary(t),file=path.join(root,'cancelled.json');await fs.writeFile(file,'{"schema":"fixture"}');
 const controller=new AbortController();let reads=0;
 await assert.rejects(readNativeCodingProtectedJson(file,{signal:controller.signal,verifyStorage:async(_target,options)=>{
  assert.equal(options.signal,controller.signal);reads++;controller.abort();return yes();
 }}),/request_cancelled/);
 assert.equal(reads,2);
});

test('pre-cancelled native process and sandbox reads start no external reader',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(readNativeCodingWindowsProcess(1,{signal:controller.signal,exec:()=>assert.fail('must not spawn')}),/request_cancelled/);
  await assert.rejects(readNativeCodingSandboxEvidence({signal:controller.signal,readProcess:()=>assert.fail('must not read process')}),/request_cancelled/);
});

test('sandbox reader joins initial siblings after a synchronous observation failure',{timeout:5000},async t=>{
 const f=await sandboxFixture(t),original=Error('generated_boot_observation_failure');
 let release;const held=new Promise(resolve=>{release=resolve;}),signals=[];let ended=false;
 const work=readNativeCodingSandboxEvidence({...f.options,readBoot:()=>{throw original;},
  readProcess:async(_pid,{signal})=>{signals.push(signal);await held;return proc;},
  readExecutableSha256:async(_file,{signal}={})=>{signals.push(signal);await held;return hash('fixture-cli');},
 });work.then(()=>{ended=true;},()=>{ended=true;});
 t.after(async()=>{release();await work.catch(()=>{});});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(signals.length,2);assert(signals.every(signal=>signal?.aborted));assert.equal(signals[0],signals[1]);
 assert.equal(ended,false);release();await assert.rejects(work,error=>error===original);
});

test('sandbox cancellation reaches every initial reader and joins late ACL, process and image cleanup',{timeout:5000},async t=>{
 const f=await sandboxFixture(t),controller=new AbortController();let release,entered;
 const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const signals=[];let ended=false,logReads=0;
 const work=readNativeCodingSandboxEvidence({...f.options,signal:controller.signal,
  verifyStorage:async(_target,{operation,signal})=>{signals.push(signal);if(operation==='VERIFY_FILE'){entered();await held;}return yes();},
  readBoot:async({signal})=>{signals.push(signal);return structuredClone(f.value.host_boot);},
  readProcess:async(_pid,{signal})=>{signals.push(signal);await held;return proc;},
  readExecutableSha256:async(_file,{signal}={})=>{signals.push(signal);await held;return hash('fixture-cli');},
  readLogSha256:()=>{logReads++;assert.fail('cancelled initial observations must not start log reads');},
 });work.then(()=>{ended=true;},()=>{ended=true;});
 t.after(async()=>{release();await work.catch(()=>{});});
 await started;controller.abort();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(signals.length,5);assert(signals.every(signal=>signal?.aborted));
 assert(signals.every(signal=>signal===signals[0]));assert.notEqual(signals[0],controller.signal);
 assert.equal(ended,false);release();await assert.rejects(work,/request_cancelled/);assert.equal(logReads,0);
});

test('sandbox ACL failure aborts siblings while retaining a held ACL observation',{timeout:5000},async t=>{
 const f=await sandboxFixture(t),original=Error('generated_sandbox_acl_failure');let release,entered;
 const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 let heldSignal,ended=false;
 const work=readNativeCodingSandboxEvidence({...f.options,
  verifyStorage:async(_target,{operation,signal})=>{
   if(operation==='VERIFY_DIRECTORY')throw original;heldSignal=signal;entered();await held;return yes();
  },
 });work.then(()=>{ended=true;},()=>{ended=true;});
 t.after(async()=>{release();await work.catch(()=>{});});
 await started;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(heldSignal?.aborted,true);assert.equal(ended,false);
 release();await assert.rejects(work,error=>error===original);
});

test('sandbox log failure aborts and joins both delayed log siblings',{timeout:5000},async t=>{
 const f=await sandboxFixture(t),original=Error('generated_sandbox_log_failure');let release,entered;
 const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;}),signals=[];let ended=false;
 const work=readNativeCodingSandboxEvidence({...f.options,readLogSha256:async(file,{signal})=>{
  if(file===f.value.logs.stdout_path)throw original;signals.push(signal);if(signals.length===2)entered();await held;
  return file===f.value.logs.stderr_path?f.value.logs.stderr_sha256:f.value.logs.exit_sha256;
 }});work.then(()=>{ended=true;},()=>{ended=true;});
 t.after(async()=>{release();await work.catch(()=>{});});
 await Promise.race([started,work.catch(()=>{})]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(signals.length,2);assert(signals.every(signal=>signal?.aborted));assert.equal(ended,false);
 release();await assert.rejects(work,error=>error===original);
});

test('sandbox log cancellation joins all late successful reads before rejecting',{timeout:5000},async t=>{
 const f=await sandboxFixture(t),controller=new AbortController();let release,entered;
 const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const signals=[];let ended=false;
 const work=readNativeCodingSandboxEvidence({...f.options,signal:controller.signal,readLogSha256:async(file,{signal})=>{
  signals.push(signal);if(signals.length===3)entered();await held;
  const [key]=Object.entries(f.value.logs).find(([key,value])=>key.endsWith('_path')&&value===file);
  return f.value.logs[key.replace('_path','_sha256')];
 }});work.then(()=>{ended=true;},()=>{ended=true;});
 t.after(async()=>{release();await work.catch(()=>{});});
 await Promise.race([started,work.catch(()=>{})]);assert.equal(signals.length,3);
 controller.abort();await new Promise(resolve=>setImmediate(resolve));
 assert(signals.every(signal=>signal?.aborted));assert(signals.every(signal=>signal===signals[0]));
 assert.equal(ended,false);release();await assert.rejects(work,/request_cancelled/);
});

test('host sandbox observer forwards the private request cancellation before any observation',async t=>{
 const f=await image(t,{readProcess:()=>assert.fail('must not start cancelled native process observation')}),controller=new AbortController();controller.abort();
 await assert.rejects(f.observers.readSandbox({role:'IMPLEMENTER',worktree_path:f.root,signal:controller.signal}),/request_cancelled/);
});

test('protected JSON joins the exact held ACL sibling before propagating original rejection',async t=>{
 const root=await temporary(t),file=path.join(root,'held-acl.json');await fs.writeFile(file,'{"schema":"fixture"}');
 let release,entered;const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;}),original=Error('generated_original_acl_failure');
 let ended=false,calls=0;
 const work=readNativeCodingProtectedJson(file,{verifyStorage:(_target,{operation})=>{
  calls++;if(operation==='VERIFY_DIRECTORY')throw original;entered();return held;
 }});work.then(()=>{ended=true;},()=>{ended=true;});
 await started;await new Promise(r=>setImmediate(r));assert.equal(ended,false);assert.equal(calls,2);
 release({owner_dacl_verified:true});await assert.rejects(work,error=>error===original);assert.equal(ended,true);
});

test('abort reaches held ACL observation without waiting for its join; late success remains denied',async t=>{
 const root=await temporary(t),file=path.join(root,'abort-acl.json');await fs.writeFile(file,'{"schema":"fixture"}');
 const controller=new AbortController();let entered,release,aborted=false,ended=false;
 const started=new Promise(r=>{entered=r;}),cleanup=new Promise(r=>{release=r;});
 const work=readNativeCodingProtectedJson(file,{signal:controller.signal,verifyStorage:async(_target,{operation,signal})=>{
  if(operation==='VERIFY_DIRECTORY')return yes();assert.equal(signal,controller.signal);
  signal.addEventListener('abort',()=>{aborted=true;},{once:true});entered();await cleanup;return yes();
 }});work.then(()=>{ended=true;},()=>{ended=true;});
 await started;controller.abort();assert.equal(aborted,true);await new Promise(r=>setImmediate(r));assert.equal(ended,false);
 release();await assert.rejects(work,/request_cancelled/);
});

for(const patch of [
 {state:'BLOCKED',reason:'SANDBOX_PROBE_OUTPUT_LIMIT',boundary_observed:false},
 {state:'BLOCKED',reason:'SANDBOX_PROBE_LOG_WRITE_FAILED',boundary_observed:false},
 {state:'OBSERVED',reason:'SANDBOX_PROBE_OUTPUT_LIMIT'},
 {boundary_observed:false},{state:undefined},{reason:undefined},
 {sandbox_backend:'OTHER'},{execution_authorized:true},
])test('sandbox reader refuses blocked or incomplete producer outcome '+JSON.stringify(patch),async t=>{
 const f=await sandboxFixture(t);Object.assign(f.value,patch);
 await assert.rejects(readNativeCodingSandboxEvidence({...f.options,pin:await f.save()}),/sandbox_producer_outcome_invalid/);
});
