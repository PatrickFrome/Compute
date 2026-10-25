import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {verifyOwnerOnlyWindowsStorage,protectOwnerOnlyWindowsDirectory} from './private-windows-storage-acl.mjs';
import {verifyInstalledClientStateResources} from './local-runtime-host-controller.mjs';
import {readWindowsSandboxHostBoot, evaluateCodexSandboxProbe} from './codex-cli-sandbox-probe.mjs';

const run = promisify(execFile);
const HASH=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9-]{36}$/, HEAD=/^[a-f0-9]{40}$/;
const fail=code=>{throw new Error(`native_coding_observer_${code}`);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const now=()=>new Date().toISOString();
const observe=(source,value)=>({schema:'metaengine.native-coding.host-observation.v1',source,observed_at:now(),value});
const fresh=value=>Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now()-30000&&Date.parse(value)<Date.now()+5000;

async function canonical(file,kind) {
  if(!path.isAbsolute(file||'')||/^(?:\\\\|\/\/)/.test(file))fail('absolute_local_path_required');
  const resolved=path.resolve(file), physical=await fs.realpath(resolved);
  let current=path.parse(resolved).root;
  for(const part of path.relative(current,resolved).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())fail('path_alias');
  }
  const stat=await fs.lstat(physical);
  if(!same(resolved,physical)||(kind==='directory'?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))fail('physical_path_invalid');
  return physical;
}
async function hashFile(file,maxBytes=1024*1024*1024,allowEmpty=false) {
  const physical=await canonical(file,'file'), before=await fs.stat(physical), hash=createHash('sha256');
  if((!allowEmpty&&before.size<1)||before.size>maxBytes)fail('file_budget_exceeded');
  for await(const chunk of createReadStream(physical))hash.update(chunk);
  const after=await fs.stat(physical);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)fail('file_changed');
  return hash.digest('hex');
}
export async function readNativeCodingProtectedJson(file,{maximumBytes=256*1024,verifyStorage=verifyOwnerOnlyWindowsStorage}={}) {
  const physical=await canonical(file,'file');
  for(const [target,operation] of [[path.dirname(physical),'VERIFY_DIRECTORY'],[physical,'VERIFY_FILE']]) {
    const evidence=await verifyStorage(target,{operation});if(evidence?.owner_dacl_verified!==true)fail('private_storage_unverified');
  }
  const before=await fs.stat(physical);if(before.size<1||before.size>maximumBytes)fail('json_budget_exceeded');
  const bytes=await fs.readFile(physical), after=await fs.stat(physical);
  if(bytes.length!==before.size||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)fail('private_file_changed');
  let value;try{value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{fail('private_json_invalid');}
  return {value,sha256:digest(bytes)};
}

// Fixed native inventory. The managed Process handle pins the kernel process
// while CIM supplies its token owner SID; no caller code/path is interpolated.
export async function readNativeCodingWindowsProcess(pid,{exec=run,platform=process.platform}={}) {
  if(platform!=='win32'||!Number.isSafeInteger(pid)||pid<1||pid>0x7fffffff)fail('native_pid_invalid');
  const script=`$ErrorActionPreference='Stop'
$n=[int]$env:METAENGINE_NATIVE_CODING_PID
$p=[Diagnostics.Process]::GetProcessById($n)
try {
 if($p.Handle -eq [IntPtr]::Zero -or $p.Id -ne $n){throw 'native_process_handle'}
 $birth=$p.StartTime.ToUniversalTime(); $image=$p.MainModule.FileName
 $c=Get-CimInstance Win32_Process -Filter ('ProcessId='+$n)
 if(-not $c){throw 'native_process_absent'}
 $owner=Invoke-CimMethod -InputObject $c -MethodName GetOwnerSid
 if($owner.ReturnValue -ne 0 -or $p.HasExited){throw 'native_process_owner'}
 $b64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($image))
 [Console]::Out.WriteLine('{"pid":'+$n+',"created_at":"'+$birth.ToString('o')+'","birth_100ns":"'+$birth.ToFileTimeUtc()+'","exe_b64":"'+$b64+'","user_sid":"'+$owner.Sid+'"}')
} finally {$p.Dispose()}`;
  const root='C:\\Windows';
  if(String(process.env.SystemRoot||process.env.SYSTEMROOT||'').toLowerCase()!==root.toLowerCase())fail('windows_root_unverified');
  let output;
  try {
    const pending=exec(path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,shell:false,timeout:15000,maxBuffer:16384,env:{SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
        PATH:path.win32.join(root,'System32'),PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'),
        METAENGINE_NATIVE_CODING_PID:String(pid)}});
    pending.child?.stdin?.end();output=(await pending).stdout;
  }catch{fail('native_process_unavailable');}
  let value;try{value=JSON.parse(output.trim());}catch{fail('native_process_invalid');}
  if(value.pid!==pid||!/^S-1-\d+(?:-\d+)+$/.test(value.user_sid||'')||!/^[1-9]\d{16,18}$/.test(value.birth_100ns||''))fail('native_process_invalid');
  const created_at=new Date(value.created_at).toISOString();
  if((BigInt(value.birth_100ns)-116444736000000000n)/10000n!==BigInt(Date.parse(created_at)))fail('native_birth_mismatch');
  const exe=Buffer.from(value.exe_b64||'','base64');
  if(exe.toString('base64')!==value.exe_b64||!exe.length||exe.length>4096)fail('native_image_invalid');
  return Object.freeze({pid,created_at,process_incarnation_id:`pid:${pid}:created_100ns:${value.birth_100ns}`,
    exe_path:new TextDecoder('utf8',{fatal:true}).decode(exe),user_sid:value.user_sid});
}
const processOnly=value=>({pid:value.pid,created_at:value.created_at,process_incarnation_id:value.process_incarnation_id});

// The expensive byte qualification happens before any issuer observation is
// timestamped. Subsequent observations use a complete physical inventory,
// including directory entries; a change invalidates this runtime incarnation.
// This cache is private process memory, never a persisted liveness assertion.
async function imageInventory({exe,asar,cli,bundle}) {
  const entries=[];
  const record=async(file,label)=>{
    const stat=await fs.lstat(file,{bigint:true});
    if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory())||(stat.isFile()&&stat.nlink!==1n))fail('image_inventory_alias');
    entries.push([label,stat.isDirectory()?'directory':'file',...['dev','ino','birthtimeNs','mtimeNs','ctimeNs','size','nlink'].map(k=>String(stat[k]))]);
    if(entries.length>12000)fail('image_inventory_budget');
    return stat;
  };
  for(const [label,file] of [['exe',exe],['asar',asar],['cli',cli]]){
    if(await canonical(file,'file')!==file)fail('image_path_changed');
    await record(file,label);
  }
  if(await canonical(bundle,'directory')!==bundle)fail('image_path_changed');
  const walk=async(directory,relative)=>{
    await record(directory,`bundle/${relative}`);
    const children=(await fs.readdir(directory)).sort();
    for(const child of children){
      const physical=path.join(directory,child),name=relative?`${relative}/${child}`:child;
      const stat=await fs.lstat(physical,{bigint:true});
      if(stat.isDirectory()&&!stat.isSymbolicLink())await walk(physical,name);
      else await record(physical,`bundle/${name}`);
    }
  };
  await walk(bundle,'');
  return digest(JSON.stringify(entries));
}

export function createNativeCodingPermitRegistry({ownPostgres,identity}={}) {
  if(typeof ownPostgres?.readScope!=='function'||typeof identity?.snapshot!=='function')fail('permit_registry_dependencies');
  const rows=async()=>{
    const scope=await ownPostgres.readScope(),device=identity.snapshot();
    if(scope?.schema!=='metaengine.native-coding.own-pg-scope.v1'||scope.source!=='PRIVATE_RUNTIME_HOST_OWN_PG'
      ||!fresh(scope.observed_at)||!Array.isArray(scope.bindings)||scope.bindings.length>64)fail('permit_registry_scope_invalid');
    return scope.bindings.filter(row=>row.device_id===device.device_id&&row.client_id===device.client_id&&row.permit
      &&row.permit.provider_id===row.provider_id&&row.permit.agent_id===row.agent_id&&row.permit.revoked===false
      &&row.permit.device_id===row.device_id&&row.permit.permit_id===row.permit_id
      &&row.permit.workspace_id===row.workspace_id&&row.permit.project_id===row.project_id
      &&row.permit.device_key_fingerprint_sha256===device.key_fingerprint_sha256
      &&Date.parse(row.permit.expires_at)>Date.now());
  };
  return Object.freeze({
    async listProviderSelectors(){return (await rows()).map(row=>({provider_id:row.provider_id,agent_id:row.agent_id}));},
    async readProvider(query){const found=(await rows()).filter(row=>row.provider_id===query.provider_id&&row.agent_id===query.agent_id);
      if(found.length!==1)fail('permit_registry_binding_missing');return structuredClone(found[0].permit);},
  });
}

// A private immutable locator for already-fsynced runner receipts. This is not
// an execution journal, acceptance authority, or a model-provided result store.
export function createNativeCodingResultStore({journalRoot,indexRoot,verifyStorage=verifyOwnerOnlyWindowsStorage,
  protectStorage=protectOwnerOnlyWindowsDirectory}={}) {
  if(!path.isAbsolute(journalRoot||'')||!path.isAbsolute(indexRoot||''))fail('result_store_paths_required');
  const fileFor=binding=>path.join(journalRoot,digest(JSON.stringify({task_id:binding.task_id,lease_generation:binding.lease_generation,role:'IMPLEMENTER'})),'receipt.json');
  const source=async binding=>{
    const result=await readNativeCodingProtectedJson(fileFor(binding),{verifyStorage});
    if(result.value.state!=='RESULT_READY'||result.value.role!=='IMPLEMENTER'||result.value.result?.outcome!=='DONE'
      ||result.value.task_id!==binding.task_id||result.value.lease_generation!==binding.lease_generation)fail('result_store_source_invalid');
    return result;
  };
  return Object.freeze({
    async resolveRunnerSubject(query) {
      const expected=query.verification_subject;
      if(!UUID.test(expected?.run_id||''))fail('critic_subject_selector_invalid');
      const pointer=(await readNativeCodingProtectedJson(path.join(indexRoot,`${expected.run_id}.json`),{verifyStorage})).value;
      const actual=await source(pointer),receipt=actual.value;
      if(pointer.run_id!==expected.run_id||actual.sha256!==pointer.receipt_sha256||receipt.run_id!==expected.run_id
        ||receipt.result_sha256!==expected.result_sha256||receipt.git_after?.artifact_sha256!==expected.git_artifact_sha256
        ||receipt.git_after?.head!==expected.source_head||receipt.workspace_id!==query.workspace_id||receipt.project_id!==query.project_id)fail('critic_subject_changed');
      return {task_id:receipt.task_id,lease_generation:receipt.lease_generation,...structuredClone(expected)};
    },
    async publish(receipt) {
      if(receipt.role!=='IMPLEMENTER')return;
      const actual=await source(receipt);
      if(actual.value.run_id!==receipt.run_id||actual.value.result_sha256!==receipt.result_sha256)fail('result_store_source_changed');
      let created=false;try{await fs.mkdir(indexRoot,{mode:0o700});created=true;}catch(error){if(error.code!=='EEXIST')throw error;}
      const storage=created?await protectStorage(indexRoot):await verifyStorage(indexRoot,{operation:'VERIFY_DIRECTORY'});
      if(storage?.owner_dacl_verified!==true)fail('private_storage_unverified');
      const pointer={schema:'metaengine.native-coding.result-pointer.v1',run_id:receipt.run_id,task_id:receipt.task_id,
        lease_generation:receipt.lease_generation,receipt_sha256:actual.sha256};
      const file=path.join(indexRoot,`${receipt.run_id}.json`);let handle;
      try{handle=await fs.open(file,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
      if(handle){try{await handle.writeFile(JSON.stringify(pointer)+'\n');await handle.sync();}finally{await handle.close();}}
      const stored=await readNativeCodingProtectedJson(file,{verifyStorage});
      if(JSON.stringify(stored.value)!==JSON.stringify(pointer))fail('result_store_pointer_conflict');
    },
    async readCriticSubject(query) {
      const expected=query.verification_subject;if(!UUID.test(expected?.run_id||''))fail('critic_subject_selector_invalid');
      const pointer=(await readNativeCodingProtectedJson(path.join(indexRoot,`${expected.run_id}.json`),{verifyStorage})).value;
      if(pointer.schema!=='metaengine.native-coding.result-pointer.v1'||pointer.run_id!==expected.run_id||!UUID.test(pointer.task_id||''))fail('critic_pointer_invalid');
      const actual=await source(pointer),receipt=actual.value;
      if(actual.sha256!==pointer.receipt_sha256||receipt.run_id!==expected.run_id||receipt.result_sha256!==expected.result_sha256
        ||receipt.git_after?.artifact_sha256!==expected.git_artifact_sha256||receipt.git_after?.head!==expected.source_head
        ||receipt.workspace_id!==query.workspace_id||receipt.project_id!==query.project_id)fail('critic_subject_changed');
      const p=receipt.process;
      if(!p||p.pid!==receipt.pid||p.process_incarnation_id!==receipt.process_incarnation_id)fail('critic_author_process_invalid');
      return observe('PROTECTED_NATIVE_CODING_RECEIPT',{run_id:receipt.run_id,result_sha256:receipt.result_sha256,
        git_artifact_sha256:receipt.git_after.artifact_sha256,source_head:receipt.git_after.head,agent_id:receipt.agent_id,
        worker_process:{pid:p.pid,created_at:new Date(p.started_at).toISOString(),process_incarnation_id:p.process_incarnation_id}});
    },
  });
}

export async function readNativeCodingSandboxEvidence({pin,cliPath,worktreePath,role,hostProcessId=process.pid,
  readProcess=readNativeCodingWindowsProcess,readBoot=readWindowsSandboxHostBoot,verifyStorage=verifyOwnerOnlyWindowsStorage}={}) {
  if(!pin||!HASH.test(pin.sha256||'')||!['IMPLEMENTER','CRITIC'].includes(role))fail('sandbox_receipt_not_pinned');
  const {value,sha256}=await readNativeCodingProtectedJson(pin.path,{verifyStorage});
  const boot=await readBoot(),host=await readProcess(hostProcessId),mode=role==='CRITIC'?'read-only':'workspace-write';
  if(sha256!==pin.sha256||value.schema!=='metaengine.codex-cli.sandbox-probe.v1'||value.mode!==mode
    ||!same(value.workspace_path||'',worktreePath)||value.cli_sha256!==await hashFile(cliPath,512*1024*1024)
    ||!same(value.cli_path||'',cliPath)||value.model_called!==false||value.authority_effect!==false
    ||Date.parse(value.host_boot?.last_boot_at)!==Date.parse(boot.last_boot_at))fail('sandbox_receipt_scope_mismatch');
  const evaluation=evaluateCodexSandboxProbe({mode,report:value.canary,nativeProcess:value.sandbox_process,hostReadback:value.host_readback,
    completion:value.completion,hostUserSid:host.user_sid,hostBootStartedAt:boot.last_boot_at});
  if(evaluation.state!=='OBSERVED'||evaluation.boundary_observed!==true)fail('sandbox_boundary_unverified');
  for(const [fileKey,hashKey] of [['stdout_path','stdout_sha256'],['stderr_path','stderr_sha256'],['exit_path','exit_sha256']]) {
    if(!HASH.test(value.logs?.[hashKey]||'')||await hashFile(value.logs[fileKey],16*1024*1024,true)!==value.logs[hashKey])fail('sandbox_log_digest_mismatch');
  }
  return {backend:'CODEX_WINDOWS_ELEVATED',mode,evidence_sha256:sha256,outside_write_denied:true,worktree_write_denied:role==='CRITIC'};
}

export function createNativeCodingWorkerRegistry({processController,readProcess=readNativeCodingWindowsProcess}={}) {
  if(typeof processController?.spawn!=='function'||typeof readProcess!=='function')fail('worker_dependencies_required');
  const workers=new Map();let closed=false,closePromise=null;
  const terminate=entry=>{
    if(!entry.termination)entry.termination=(async()=>{
      try{await entry.handle.terminate('HOST_RUNTIME_CLOSED');}catch{/* Completion must independently prove cleanup. */}
      await entry.completion;
      return entry.cleanup_confirmed===true;
    })();
    return entry.termination;
  };
  return Object.freeze({
    controllerFor(scope) {
      if(closed||!UUID.test(scope?.provider_id||'')||!HASH.test(scope.prompt_sha256||''))fail('worker_scope_invalid');
      const pinned=structuredClone(scope);
      return Object.freeze({async spawn(spec) {
        if(closed||workers.has(spec.runId)||spec.binding?.task_id!==pinned.task_id||spec.binding?.agent_id!==pinned.agent_id
          ||spec.binding?.lease_generation!==pinned.lease_generation)fail('worker_scope_changed');
        if(workers.size>=128)for(const [id,row] of workers){if(row.state==='EXITED'&&row.cleanup_confirmed===true)workers.delete(id);if(workers.size<128)break;}
        if(workers.size>=128)fail('worker_registry_capacity');
        // Reserve the exact run before awaiting native spawn. Shutdown must
        // retain a suspended handle that arrives after the close signal.
        const entry={handle:null,spec,scope:pinned,state:'SPAWNING',cleanup_confirmed:false,spawned:null,completion:null,termination:null};
        workers.set(spec.runId,entry);
        entry.spawned=(async()=>{
          let handle;
          try{handle=await processController.spawn(spec);}catch(error){entry.state='UNKNOWN';throw error;}
          entry.handle=handle;entry.state='SUSPENDED';
          entry.completion=Promise.resolve(handle.completion).then(result=>{
            entry.cleanup_confirmed=result?.tree_cleanup_confirmed===true;
            entry.state=entry.cleanup_confirmed?'EXITED':'UNKNOWN';return result;
          },()=>{entry.state='UNKNOWN';entry.cleanup_confirmed=false;return null;});
          if(closed){void terminate(entry);fail('worker_closed_during_spawn');}
          return Object.freeze({...handle,async resume(prompt,options) {
            if(closed||entry.state!=='SUSPENDED'||digest(prompt)!==pinned.prompt_sha256)fail('worker_resume_changed');
            entry.state='RESUMING';await handle.resume(prompt,options);
            if(entry.state==='RESUMING')entry.state='RUNNING';
          }});
        })();
        return entry.spawned;
      }});
    },
    async readNativeWorker(query) {
      const entry=workers.get(query.run_id);
      if(closed||!entry||entry.state!=='SUSPENDED'||['provider_id','agent_id','task_id','lease_generation','prompt_sha256'].some(key=>entry.scope[key]!==query[key]))fail('worker_not_privately_bound');
      const actual=await readProcess(entry.handle.proof.pid), proof=entry.handle.proof;
      if(actual.process_incarnation_id!==proof.process_incarnation_id||actual.user_sid!==proof.user_sid
        ||!same(actual.exe_path,entry.spec.executablePath)||proof.tree_control_bound!==true||proof.started_suspended!==true
        ||proof.job_bound_before_resume!==true||proof.job_id!==entry.spec.runId)fail('worker_native_binding_changed');
      return observe('OS_PROCESS_INVENTORY',{run_id:query.run_id,worker_process:processOnly(actual),job_id:proof.job_id,prompt_sha256:entry.scope.prompt_sha256});
    },
    close(){
      if(closePromise)return closePromise;
      closed=true;
      closePromise=(async()=>{
        const entries=[...workers.values()];
        const results=await Promise.allSettled(entries.map(async entry=>{
          if(entry.handle&&entry.cleanup_confirmed!==true)void terminate(entry);
          await entry.spawned.catch(()=>{});
          if(entry.cleanup_confirmed===true)return true;
          return entry.handle?terminate(entry):false;
        }));
        const unconfirmed=entries.filter((_entry,index)=>results[index].status!=='fulfilled'||results[index].value!==true).map(entry=>entry.spec.runId);
        return Object.freeze({schema:'metaengine.native-coding.workers-close.v1',cleanup_confirmed:unconfirmed.length===0,
          worker_count:entries.length,unconfirmed_runs:Object.freeze(unconfirmed),automatic_retry_allowed:false,authority_effect:false});
      })();
      return closePromise;
    },
  });
}

/** These closures are native main/Host capabilities, never renderer parameters. */
export function createNativeCodingHostObservers({app,resourcesPath,cliPath,identity,ownPostgres,permitRegistry,
  sandboxReceipts=[],gitExecutable,readNativeWorker,readCriticSubject,readProcess=readNativeCodingWindowsProcess,
  readBoot=readWindowsSandboxHostBoot,verifyStorage=verifyOwnerOnlyWindowsStorage,
  verifyResources=verifyInstalledClientStateResources,readPackage=null,runGit=run,processId=process.pid}={}) {
  if(!app||app.isPackaged!==true||typeof app.getAppPath!=='function'||typeof app.getPath!=='function'
    ||!identity||typeof identity.snapshot!=='function'||typeof ownPostgres?.readScope!=='function'
    ||typeof ownPostgres?.readLease!=='function'||typeof permitRegistry?.readProvider!=='function'
    ||typeof readNativeWorker!=='function'||typeof readCriticSubject!=='function'
    ||!path.isAbsolute(gitExecutable||''))fail('private_dependencies_required');
  let preparedImage=null,preparingImage=null,imageInvalidated=false;
  const imagePaths=async()=>({exe:await canonical(app.getPath('exe'),'file'),asar:await canonical(app.getAppPath(),'file'),
    cli:await canonical(cliPath,'file'),bundle:await canonical(path.join(resourcesPath,'client-state-runtime'),'directory')});
  const prepareInstalledImage=async()=>{
    if(imageInvalidated)fail('image_preparation_invalidated');
    if(preparedImage)return;
    if(preparingImage)return preparingImage;
    preparingImage=(async()=>{
      const paths=await imagePaths();if(!paths.asar.toLowerCase().endsWith('app.asar'))fail('installed_asar_required');
      const before=await imageInventory(paths);
      const pkg=readPackage?await readPackage():JSON.parse(await fs.readFile(path.join(paths.asar,'package.json'),'utf8'));
      const binding=pkg?.metaengineClientStateRuntime;
      if(!HASH.test(binding?.bundle_sha256||'')||!HEAD.test(binding?.source_head_sha||'')||binding.package_version!==pkg.version)fail('installed_package_binding_invalid');
      const verifiedResources=await verifyResources({bundleDirectory:paths.bundle,expectedBundleDigest:binding.bundle_sha256});
      const [installed_exe_sha256,installed_asar_sha256,cli_executable_sha256]=await Promise.all([
        hashFile(paths.exe),hashFile(paths.asar),hashFile(paths.cli,512*1024*1024)]);
      if(before!==await imageInventory(paths))fail('installed_image_changed_during_preparation');
      preparedImage={paths,inventory:before,verifiedResources,artifact:{installed_exe_sha256,installed_asar_sha256,
        runtime_bundle_sha256:binding.bundle_sha256,source_sha:binding.source_head_sha,cli_executable_sha256}};
    })();
    try{await preparingImage;}catch(error){imageInvalidated=true;throw error;}finally{preparingImage=null;}
  };
  const pins=structuredClone(Array.isArray(sandboxReceipts)?sandboxReceipts:Object.entries(sandboxReceipts).map(([role,pin])=>({role,path:pin.file??pin.path,sha256:pin.sha256})));
  const readScope=async()=>{
    const value=await ownPostgres.readScope();
    if(value?.schema!=='metaengine.native-coding.own-pg-scope.v1'||value.source!=='PRIVATE_RUNTIME_HOST_OWN_PG'||!fresh(value.observed_at)
      ||!Array.isArray(value.bindings)||value.bindings.length>64)fail('own_pg_scope_unverified');
    return value;
  };
  const readPermit=async query=>{
    const permit=await permitRegistry.readProvider({provider_id:query.provider_id,agent_id:query.agent_id});
    if(!permit||permit.schema!=='metaengine.native-coding.operator-permit.v1'||permit.provider_id!==query.provider_id
      ||permit.agent_id!==query.agent_id||permit.revoked!==false||!HASH.test(permit.record_sha256||'')
      ||!HASH.test(permit.storage_evidence_sha256||''))fail('protected_permit_unverified');
    return observe('PROTECTED_OPERATOR_PERMIT_READBACK',permit);
  };
  return Object.freeze({readPermit,readNativeWorker,readCriticSubject,prepareInstalledImage,
    async readAgentMcpLaunchPins(){
      if(imageInvalidated||!preparedImage)fail('installed_image_not_prepared');
      const paths=await imagePaths(),verified=preparedImage.verifiedResources;
      const nodeExecutable=path.join(paths.bundle,'runtime','node','node.exe');
      const node=verified?.manifest?.files?.find(file=>file.path==='runtime/node/node.exe');
      if(!HASH.test(node?.sha256||'')||!same(verified?.paths?.nodeExecutable||'',nodeExecutable)
        ||Object.keys(paths).some(key=>paths[key]!==preparedImage.paths[key])
        ||preparedImage.inventory!==await imageInventory(paths))fail('agent_bridge_image_unverified');
      const files={entrypoint:'native-coding-agent-mcp-entry.mjs',broker:'native-coding-agent-mcp-broker.mjs',adapter:'native-coding-agent-mcp-stdio.mjs'};
      const bridgeSha256={};
      for(const [key,name]of Object.entries(files)){
        const bytes=await fs.readFile(path.join(paths.asar,'src',name));
        if(!bytes.length||bytes.length>256*1024)fail('agent_bridge_source_budget');bridgeSha256[key]=digest(bytes);
      }
      if(preparedImage.inventory!==await imageInventory(paths))fail('agent_bridge_image_changed');
      return Object.freeze({nodeExecutable,nodeSha256:node.sha256,
        entrypointPath:path.join(resourcesPath,'native-coding','agent-mcp',files.entrypoint),bridgeSha256:Object.freeze(bridgeSha256)});
    },
    async listProviderSelectors(){return permitRegistry.listProviderSelectors();},
    async readInstalledImage() {
      if(imageInvalidated||!preparedImage)fail('installed_image_not_prepared');
      try{
        const paths=await imagePaths(),native=await readProcess(processId);
        if(Object.keys(paths).some(k=>paths[k]!==preparedImage.paths[k])||!same(native.exe_path,paths.exe)
          ||preparedImage.inventory!==await imageInventory(paths))fail('installed_image_guard_changed');
        return observe('INSTALLED_IMAGE_NATIVE_VERIFIER',structuredClone(preparedImage.artifact));
      }catch(error){imageInvalidated=true;throw error;}
    },
    async readNativeHost(){const p=await readProcess(processId);return observe('OS_PROCESS_INVENTORY',{host_process:processOnly(p),user_sid:p.user_sid});},
    async readPostgres(query) {
      const scope=await readScope(), device=identity.snapshot();
      const binding=scope.bindings.find(v=>v.permit_id===query.permit_id&&v.provider_id===query.provider_id&&v.agent_id===query.agent_id
        &&v.workspace_id===query.workspace_id&&v.project_id===query.project_id&&v.device_id===device.device_id&&v.client_id===device.client_id);
      if(!binding)fail('own_pg_project_binding_missing');
      const actual=await readProcess(scope.postgres?.postmaster?.pid);
      if(actual.process_incarnation_id!==scope.postgres.postmaster.process_incarnation_id)fail('own_pg_postmaster_changed');
      return observe('ATTACHED_OWN_POSTGRES_READBACK',{postgres:scope.postgres,workspace_id:binding.workspace_id,project_id:binding.project_id});
    },
    async readWorktree(query) {
      const root=await canonical(query.worktree_path,'directory');
      const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
      const git=async args=>(await runGit(gitExecutable,['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=',...args],
        {cwd:root,env,shell:false,windowsHide:true,timeout:15000,maxBuffer:8192})).stdout.trim();
      if(!same(await git(['rev-parse','--show-toplevel']),root))fail('worktree_root_mismatch');
      const gitDir=await canonical(await git(['rev-parse','--absolute-git-dir']),'directory');
      if(!(await fs.lstat(path.join(root,'.git'))).isFile()||!(await fs.lstat(path.join(gitDir,'locked'))).isFile())fail('locked_worktree_required');
      const head=await git(['rev-parse','HEAD']);if(!HEAD.test(head))fail('worktree_head_invalid');
      const identityHash=await readDirectoryIdentity(root);if(!HASH.test(identityHash))fail('worktree_identity_invalid');
      return observe('NATIVE_FILESYSTEM_AND_GIT_READBACK',{path:root,root_identity_sha256:identityHash,base_sha:head});
    },
    async readLiveLease(query) {
      const value=await ownPostgres.readLease({workspace_id:query.workspace_id,project_id:query.project_id,task_id:query.task_id,
        agent_id:query.agent_id,lease_generation:query.lease_generation,provider_id:query.provider_id});
      if(value?.schema!=='metaengine.native-coding.own-pg-lease.v1'||value.source!=='PRIVATE_RUNTIME_HOST_OWN_PG'||!fresh(value.observed_at)
        ||value.value?.task_id!==query.task_id||value.value?.agent_id!==query.agent_id||value.value?.lease_generation!==query.lease_generation)fail('own_pg_lease_unverified');
      return observe('W30_OWN_PG_LIVE_LEASE',value.value);
    },
    async readSandbox(query) {
      const pin=pins.find(v=>(v.provider_id===undefined||v.provider_id===query.provider_id)&&(v.agent_id===undefined||v.agent_id===query.agent_id)&&v.role===query.role);
      return observe('OS_SANDBOX_CANARY_READBACK',await readNativeCodingSandboxEvidence({pin,cliPath,worktreePath:query.worktree_path,
        role:query.role,hostProcessId:processId,readProcess,readBoot,verifyStorage}));
    },
  });
}
