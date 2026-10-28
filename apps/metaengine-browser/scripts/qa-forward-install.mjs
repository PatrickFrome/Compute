#!/usr/bin/env node
// Explicit manual LOCAL QA migration. It does not authorize autonomous updates,
// erase task history, run an old uninstaller, or manufacture a STOPPED status.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateRuntimeHostConfig} from '../../../infra/client-state-runtime/runtime-host.mjs';
import {verifyOfflineRuntimeBundle} from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import {reconcileAbandonedAttachedRuntimeLock,runtimeHostPidState,runtimeHostTcpPortState} from '../../../infra/client-state-runtime/runtime-host-orphan-reconciliation.mjs';
import {localStateProviderOwnerFile,validateLocalStateProviderConfig,validateLocalStateRuntimeIdentity,localStateProviderHealthAttested} from '../src/local-state-provider-policy.mjs';
import {localRuntimeHostEnvironment} from '../src/local-runtime-host-controller.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../src/private-windows-storage-acl.mjs';
import {readWindowsKernelProcessW60} from '../src/host-native-owner-producers-w60.mjs';
import {verifyWindowsTcpListener} from './verify-windows-tcp-listener.mjs';
import {readUpgradeAsarPackage,readUpgradeAsarVerifier,stableUpgradeRead,makeUpgradeConfigs,completeUpgradeFiles,commitUpgradeAdmission,assertKeeperIncarnation} from './qa-owner-runtime-upgrade.mjs';
import {captureInstalledTreeFingerprint} from './qa-installed-tree-fingerprint.mjs';
import {compareQaInstalledImage} from './qa-operator-install-recovery.mjs';
import {observeWindowsNsisEffects} from './qa-nsis-external-effects.mjs';
import {forwardDigest as sha,writeForwardEvidence as write,retireForwardImage,assertForwardScope,assertForwardPreservedPaths,writeForwardPreservedGate,assertForwardArtifactsUnchanged,assertForwardInstallNotAttempted,runForwardEffect,publishForwardOwner} from './qa-forward-install-policy.mjs';
import {QA_UPGRADE_ADMISSION_SCHEMA} from '../src/local-provider-upgrade-admission.mjs';
import {runtimeRecoveryPostgresProof} from '../../../infra/client-state-runtime/runtime-recovery-postgres-proof.mjs';
import {assertStoppedQualificationReadback,preserveStoppedQualificationAttempt} from './qa-forward-stopped-readback.mjs';

const exec=promisify(execFile),require=createRequire(import.meta.url);
const ps='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const fail=x=>{throw Error('qa_forward_install_'+x);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const script=name=>fileURLToPath(new URL(name,import.meta.url));
async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function acl(file,directory=false){if((await verifyOwnerOnlyWindowsStorage(file,{operation:directory?'VERIFY_DIRECTORY':'VERIFY_PRIVATE_FILE'})).owner_dacl_verified!==true)fail('acl_unverified');}
async function runPs(args,timeout=90000){const p=exec(ps,['-NoLogo','-NoProfile','-NonInteractive',...args],{windowsHide:true,shell:false,timeout,maxBuffer:16384,env:{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}});p.child.stdin?.end();return (await p).stdout;}
async function noBrowser(){const count=await runPs(['-Command',"$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='METAENGINE Browser Test.exe'\" -ErrorAction Stop).Count"]);if(count.trim()!=='0')fail('browser_must_be_closed');}
async function absent(file){await fs.lstat(file).then(()=>fail('path_must_be_absent'),e=>{if(e.code!=='ENOENT')throw e;});}
const artifactPins=(plan,image)=>({candidateRoot:plan.candidate_root,installerFile:plan.installer_file,
  expectedTreeSha256:image.tree_sha256,expectedInstallerSha256:plan.installer_sha256});
async function candidate(plan){
  const resources=path.join(plan.candidate_root,'resources'),archive=path.join(resources,'app.asar');
  if(await hash(archive)!==plan.asar_sha256)fail('candidate_asar_mismatch');
  const pkg=await readUpgradeAsarPackage(archive),binding=pkg.metaengineClientStateRuntime;
  if(pkg.version!==plan.package_version||binding?.source_head_sha!==plan.source_head)fail('candidate_identity_mismatch');
  const verifierBytes=await readUpgradeAsarVerifier(archive);
  await require('./offline-runtime-package-binding.cjs').assertPackagedOfflineRuntimeBinding(binding,{expectedHead:plan.source_head,packageVersion:pkg.version,resourcesDir:resources,verifierBytes});
  // Independently verify with the audited source implementation as well.
  const verified=await verifyOfflineRuntimeBundle({bundleDirectory:path.join(resources,'client-state-runtime'),expectedBundleDigest:binding.bundle_sha256});
  return {binding,verified,image:await captureInstalledTreeFingerprint(plan.candidate_root)};
}
async function keeper(config){
  const bytes=await stableUpgradeRead(path.join(config.pg_data_directory,'postmaster.pid'));
  const pid=Number(bytes.toString().split(/\r?\n/)[0]),native=await readWindowsKernelProcessW60(pid);
  if(native?.state!=='PRESENT'||!native.exe_path?.toLowerCase().endsWith('\\postgres.exe'))fail('keeper_identity_unknown');
  await verifyWindowsTcpListener({port:Number(new URL(config.database_url).port),pid});
  return {pid,created_at:native.created_at,exe_path:native.exe_path,pidfile_sha256:sha(bytes),vault_sha256:await hash(path.join(config.pg_data_directory,'client-vault.key'))};
}
async function keeperSame(config,expected){const now=await keeper(config);assertKeeperIncarnation({...now,state:'PRESENT',source:'OS_PROCESS_INVENTORY',authority_effect:false},expected);if(now.pidfile_sha256!==expected.pidfile_sha256||now.vault_sha256!==expected.vault_sha256)fail('keeper_bytes_changed');}
async function quiescent(config,status){
  await noBrowser();
  for(const pid of [status.host_pid,...status.children.map(c=>c.pid)])if(runtimeHostPidState(pid)!=='ABSENT')fail('old_process_presence_unresolved');
  for(const port of [config.api_port,config.edge_port])if(await runtimeHostTcpPortState(port)!=='ABSENT')fail('endpoint_presence_unresolved');
}
export async function qualifyForwardRuntime({verified,configFile,owner,stateDirectory,logDirectory=stateDirectory}){
  const config=JSON.parse(await stableUpgradeRead(configFile));
  if(!path.isAbsolute(stateDirectory||'')||!path.isAbsolute(config.state_directory||'')
    ||!same(config.state_directory,stateDirectory)||!path.isAbsolute(logDirectory||''))fail('runtime_state_directory_mismatch');
  let child,exited=false,exitCode,terminal=null,stopAttempt=null;
  const nonce=randomUUID();
  const stop=()=>{
    // A timeout remains an unknown stop outcome. Cleanup must await the same
    // attempt, never send another stop or restart its 45-second deadline.
    if(stopAttempt)return stopAttempt;
    stopAttempt=(async()=>{
      if(exited)return;
      await new Promise((resolve,reject)=>{
        const onExit=()=>{clearTimeout(timer);resolve();};
        const timer=setTimeout(()=>{child.off('exit',onExit);reject(Error('qa_forward_install_host_stop_timeout'));},45000);
        child.once('exit',onExit);
        if(exited)onExit();
        else if(child.connected)child.send({schema:'compute.runtime-host-control.v1',command:'stop'},()=>{});
      });
    })();
    return stopAttempt;
  };
  try{
    child=spawn(verified.paths.nodeExecutable,[verified.paths.hostEntry],{cwd:verified.paths.sourceRoot,env:{...localRuntimeHostEnvironment(configFile),COMPUTE_RUNTIME_HOST_LAUNCH_NONCE:nonce},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true,shell:false});
    child.once('exit',c=>{exited=true;exitCode=c;});
    const log=await fs.open(path.join(logDirectory,'qualification-host.stderr'),'wx',0o600);let logBytes=0;
    child.stderr.on('data',b=>{if((logBytes+=b.length)<262144)void log.write(b).catch(()=>{});});
    child.once('exit',()=>void log.close());
    child.on('message',v=>{if(v?.schema==='compute.runtime-host-terminal.v1')terminal=v;});
    const descriptor=await new Promise((resolve,reject)=>{
      const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('exit',early);child.off('error',early);error?reject(error):resolve(value);};
      const message=v=>{if(v?.schema==='compute.runtime-host-provider.v1')finish(null,v);else if(v?.schema==='compute.runtime-host-failure.v1')finish(Error('qa_forward_install_candidate_host_failed'));};
      const early=()=>finish(Error('qa_forward_install_candidate_host_exited'));
      const timer=setTimeout(()=>finish(Error('qa_forward_install_candidate_host_timeout')),180000);
      child.on('message',message);child.once('exit',early);child.once('error',early);
    });
    const status=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file)),identity=validateLocalStateRuntimeIdentity(status,owner.base_url);
    if(status.host_pid!==child.pid||descriptor.instance_id!==identity.instance_id||descriptor.runtime_ready!==true||descriptor.status_file!==owner.runtime_identity_file||descriptor.authority_effect!==false||exited)fail('candidate_identity_unverified');
    for(const c of status.children){const port=c.name==='api'?config.api_port:c.name==='edge'?config.edge_port:null;if(!port)fail('candidate_child_invalid');await verifyWindowsTcpListener({port,pid:c.pid});}
    const response=await fetch(owner.base_url+'/health',{signal:AbortSignal.timeout(12000)}),health=await response.json();
    if(!response.ok||!localStateProviderHealthAttested(health,identity.instance_id)||exited)fail('candidate_health_unattested');
    await stop();
    const final=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file));
    if(exitCode!==0||final.state!=='STOPPED'||final.children_stopped!==true||final.runtime_ready!==false||final.host_pid!==child.pid||final.instance_id!==identity.instance_id)fail('candidate_stop_unconfirmed');
    if(terminal?.state!=='STOPPED'||terminal.children_stopped!==true||terminal.ownership_released!==true||terminal.launch_nonce!==nonce||terminal.host_pid!==child.pid||terminal.instance_id!==identity.instance_id||terminal.authority_effect!==false)fail('candidate_terminal_unconfirmed');
    for(const c of status.children)if(runtimeHostPidState(c.pid)!=='ABSENT')fail('candidate_child_not_stopped');
    await absent(path.join(stateDirectory,'runtime-host-lock.json'));
    return {host_pid:child.pid,instance_id:identity.instance_id,children:status.children,health_verified:true,children_stopped:true,ownership_released:true,exit_code:exitCode};
  }finally{if(child&&!exited)await stop();}
}
function validatePlan(p){
  if(process.platform!=='win32'||p?.schema!=='metaengine.operator.forward-install-plan.v1'
    ||p.operator_choice!=='INSTALL_FIXED_QA_PRESERVE_DATABASE_NO_AUTOMATIC_ROLLBACK'
    ||!['asar_sha256','installer_sha256','uninstaller_sha256','owner_sha256'].every(k=>/^[a-f0-9]{64}$/.test(p[k]||''))
    ||!/^[a-f0-9]{40}$/.test(p.source_head||'')||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(p.package_version||'')
    ||!['candidate_root','installer_file','state_directory'].every(k=>typeof p[k]==='string'&&path.isAbsolute(p[k])))fail('plan_invalid');
  const installedRoot=path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
  assertForwardScope({installedRoot,stateDirectory:p.state_directory,retiredRoot:path.join(p.state_directory,'retired-installation')});
  for(const root of [installedRoot,p.state_directory]){const rel=path.relative(root,p.candidate_root);if(!rel||(!rel.startsWith('..')&&!path.isAbsolute(rel)))fail('candidate_scope_invalid');}
  return p;
}
async function oldState(plan){
  const file=localStateProviderOwnerFile(),bytes=await stableUpgradeRead(file);await acl(file);if(sha(bytes)!==plan.owner_sha256)fail('owner_preimage_changed');
  const owner=validateLocalStateProviderConfig(JSON.parse(bytes)),configBytes=await stableUpgradeRead(owner.runtime_host.config_file),config=validateRuntimeHostConfig(JSON.parse(configBytes));
  const statusBytes=await stableUpgradeRead(owner.runtime_identity_file),status=JSON.parse(statusBytes);
  if(config.postgres_mode!=='attached'||config.api_role_mode!=='direct'||config.expected_bundle_sha256!==owner.runtime_host.expected_bundle_sha256
    ||!same(owner.runtime_identity_file,path.join(config.state_directory,'runtime-instance.json'))
    ||!same(config.bundle_directory,path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test','resources','client-state-runtime'))
    ||status.bundle_sha256!==config.expected_bundle_sha256||!Array.isArray(status.children))fail('predecessor_binding_invalid');
  return {file,bytes,owner,config,configBytes,status,statusBytes};
}
function preservedPathScope(plan,old,pg){
  return {
    installedRoot:path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test'),
    stateDirectory:plan.state_directory,retiredRoot:path.join(plan.state_directory,'retired-installation'),
    keeperExecutable:pg.exe_path,pgDataDirectory:old.config.pg_data_directory,
    candidateRoot:plan.candidate_root,installerFile:plan.installer_file,
    ownerFile:old.file,configFile:old.owner.runtime_host.config_file,
    statusFile:old.owner.runtime_identity_file,predecessorStateDirectory:old.config.state_directory,
  };
}
export async function prepareForwardInstall(plan,{resume=false,resumeStopped=false}={}){
  if(resume&&resumeStopped)fail('resume_mode_ambiguous');
  const stoppedResume=resumeStopped;resume=resume||stoppedResume;
  validatePlan(plan);if(!resume)await absent(plan.state_directory);
  const checked=await candidate(plan),old=await oldState(plan);await quiescent(old.config,old.status);
  await assertForwardArtifactsUnchanged(artifactPins(plan,checked.image));
  const pg=await keeper(old.config),installedRoot=path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
  const preservedPaths=preservedPathScope(plan,old,pg),preserve=()=>assertForwardPreservedPaths(preservedPaths);
  await preserve();
  const oldPkg=await readUpgradeAsarPackage(path.join(installedRoot,'resources','app.asar'));
  if(stoppedResume&&oldPkg.metaengineClientStateRuntime?.bundle_sha256!==old.config.expected_bundle_sha256)fail('resume_predecessor_image_unbound');
  const predecessor=await captureInstalledTreeFingerprint(installedRoot);
  const nsis=await observeWindowsNsisEffects({expectedVersion:oldPkg.version});
  const gate=old.file+'.qa-upgrade-gate.json';let gateBytes,stoppedReadback=null,logDirectory=plan.state_directory;
  if(resume){
    await acl(plan.state_directory,true);await absent(path.join(plan.state_directory,'forward-qualification.json'));
    if(JSON.stringify(JSON.parse(await stableUpgradeRead(path.join(plan.state_directory,'input-plan.json'))))!==JSON.stringify(plan))fail('resume_plan_changed');
    gateBytes=await stableUpgradeRead(gate);await acl(gate);const priorGate=JSON.parse(gateBytes);
    if(priorGate.schema!=='metaengine.operator.forward-install-gate.v1'||priorGate.owner_sha256!==plan.owner_sha256||priorGate.source_head!==plan.source_head||runtimeHostPidState(priorGate.pid)!=='ABSENT')fail('resume_gate_unverified');
    const failedBytes=await stableUpgradeRead(path.join(plan.state_directory,'runtime-instance.json')),failed=JSON.parse(failedBytes);
    if(stoppedResume){
      await assertForwardInstallNotAttempted(plan.state_directory);
      const {default:postgres}=await import(pathToFileURL(path.join(checked.verified.paths.sourceRoot,'infra/client-state-runtime/node_modules/postgres/src/index.js')).href);
      const db=postgres(old.config.inspect_database_url,{max:1,prepare:false,fetch_types:false,connect_timeout:30,
        connection:{statement_timeout:10000,default_transaction_read_only:'on',application_name:'metaengine-qualification-stopped-readback'},onnotice:()=>{}});
      let identity;
      try{const rows=await db.unsafe("select json_build_object('data_directory',current_setting('data_directory'),'version',current_setting('server_version_num')::int,'port',inet_server_port(),'started_at',pg_postmaster_start_time(),'system_identifier',(select system_identifier::text from pg_catalog.pg_control_system())) as identity");
        if(rows.length!==1)fail('resume_postgres_readback_invalid');identity={...rows[0].identity,pid:pg.pid};}
      finally{await db.end({timeout:5});}
      const continuity=await runtimeRecoveryPostgresProof({identity,pgDataDirectory:old.config.pg_data_directory,
        expectedClusterSystemIdentifier:old.config.expected_cluster_system_identifier});
      const verify=async()=>{
        await assertForwardInstallNotAttempted(plan.state_directory);await preserve();await quiescent(old.config,old.status);await keeperSame(old.config,pg);
        if(runtimeHostPidState(priorGate.pid)!=='ABSENT')fail('resume_gate_unverified');
        if(!failedBytes.equals(await stableUpgradeRead(path.join(plan.state_directory,'runtime-instance.json')))
          ||!gateBytes.equals(await stableUpgradeRead(gate))||sha(await stableUpgradeRead(old.file))!==plan.owner_sha256)fail('resume_evidence_changed');
        await absent(path.join(plan.state_directory,'runtime-host-lock.json'));
        await assertStoppedQualificationReadback({status:failed,bundleSha256:checked.binding.bundle_sha256,postgresContinuity:continuity,
          pidState:runtimeHostPidState,portState:runtimeHostTcpPortState,ports:[old.config.api_port,old.config.edge_port]});
      };
      await verify();stoppedReadback={statusBytes:failedBytes,stderrBytes:await stableUpgradeRead(path.join(plan.state_directory,'qualification-host.stderr'),262144),verify};
    }else if(failed.state!=='FAILED'||failed.reason!=='api_process_failed'||failed.runtime_ready!==false||runtimeHostPidState(failed.host_pid)!=='ABSENT')fail('resume_failed_host_unverified');
    await absent(path.join(plan.state_directory,'runtime-host-lock.json'));
    const rows=JSON.parse(await runPs(['-Command',"$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='deno.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress"]));
    for(const row of Array.isArray(rows)?rows:[rows]){
      if(!row?.ExecutablePath)fail('resume_process_census_unknown');
      for(const root of [plan.candidate_root,plan.state_directory]){const rel=path.relative(root,row.ExecutablePath);if(!rel||(!rel.startsWith('..')&&!path.isAbsolute(rel)))fail('resume_owned_process_present');}
    }
    await preserve();
    if(!stoppedResume){
      await write(path.join(plan.state_directory,'failed-qualification-readback.json'),{state:'FAILED_STARTUP_QUIESCENT',prior_status_sha256:sha(failedBytes),host_pid:failed.host_pid,owned_executable_processes_absent:true,ports_absent:true,automatic_retry_allowed:false,authority_effect:false});
      await fs.rename(path.join(plan.state_directory,'qualification-host.stderr'),path.join(plan.state_directory,'first-qualification-host.stderr'));
    }
  }else{
    await preserve();
    await fs.mkdir(plan.state_directory,{mode:0o700});await protectOwnerOnlyWindowsDirectory(plan.state_directory);await acl(plan.state_directory,true);
    await write(path.join(plan.state_directory,'input-plan.json'),plan);
    gateBytes=Buffer.from(JSON.stringify({schema:'metaengine.operator.forward-install-gate.v1',nonce:randomUUID(),pid:process.pid,owner_sha256:plan.owner_sha256,source_head:plan.source_head})+'\n');
    await writeForwardPreservedGate(gate,gateBytes,preservedPaths);await acl(gate);
  }
  // Retain the legacy READY snapshot unchanged. The existing runtime reconciler
  // proves every recorded process and endpoint absent before retiring its lock.
  let reconciliation;
  await preserve();
  if(old.status.state==='READY')reconciliation=await reconcileAbandonedAttachedRuntimeLock({config:old.config});
  else if(old.status.state==='STOPPED'&&old.status.children_stopped===true&&old.status.runtime_ready===false){await absent(path.join(old.config.state_directory,'runtime-host-lock.json'));reconciliation={state:'ALREADY_STOPPED'};}
  else fail('predecessor_custody_unverified');
  const configs=makeUpgradeConfigs(old.config,{stateDirectory:plan.state_directory,candidateBundle:path.join(plan.candidate_root,'resources','client-state-runtime'),installedBundle:path.join(installedRoot,'resources','client-state-runtime'),bundleDigest:checked.binding.bundle_sha256});
  const configFile=path.join(plan.state_directory,'installed-runtime-config.json'),qualificationFile=path.join(plan.state_directory,'qualification-config.json');
  if(resume){for(const [file,value] of [[configFile,configs.final],[qualificationFile,configs.qualification]])if(JSON.stringify(JSON.parse(await stableUpgradeRead(file)))!==JSON.stringify(value))fail('resume_config_changed');}
  else{await write(configFile,configs.final);await write(qualificationFile,configs.qualification);}
  await acl(configFile);await acl(qualificationFile);
  const proposed=validateLocalStateProviderConfig({...old.owner,runtime_identity_file:path.join(plan.state_directory,'runtime-instance.json'),runtime_host:{bundle_directory:configs.final.bundle_directory,expected_bundle_sha256:checked.binding.bundle_sha256,config_file:configFile}});
  await preserve();
  await assertForwardArtifactsUnchanged(artifactPins(plan,checked.image));
  if(stoppedReadback)logDirectory=await preserveStoppedQualificationAttempt({stateDirectory:plan.state_directory,...stoppedReadback,
    protect:async directory=>{await protectOwnerOnlyWindowsDirectory(directory);await acl(directory,true);}});
  const runtime=await qualifyForwardRuntime({verified:checked.verified,configFile:qualificationFile,owner:proposed,stateDirectory:plan.state_directory,logDirectory});
  await preserve();
  await assertForwardArtifactsUnchanged(artifactPins(plan,checked.image));
  await quiescent(old.config,old.status);await keeperSame(old.config,pg);
  if(sha(await stableUpgradeRead(old.file))!==plan.owner_sha256||!old.configBytes.equals(await stableUpgradeRead(old.owner.runtime_host.config_file))||!old.statusBytes.equals(await stableUpgradeRead(old.owner.runtime_identity_file)))fail('predecessor_changed');
  const registration=JSON.parse(await runPs(['-File',script('qa-forward-registration.ps1'),'-Mode','Observe','-StateDirectory',plan.state_directory,'-ExpectedVersion',oldPkg.version]));
  const proof={schema:'metaengine.operator.forward-install-proof.v1',state:'QUALIFIED_AND_STOPPED',plan,old_version:oldPkg.version,owner_file:old.file,old_config_sha256:sha(old.configBytes),old_status_sha256:sha(old.statusBytes),old_nsis:nsis,registration,predecessor,keeper:pg,reconciliation,runtime,candidate:checked.image,proposed,bundle_sha256:checked.binding.bundle_sha256,config_sha256:sha(await stableUpgradeRead(configFile)),qualification_config_sha256:sha(await stableUpgradeRead(qualificationFile)),runtime_status_sha256:sha(await stableUpgradeRead(proposed.runtime_identity_file)),gate_file:gate,gate_sha256:sha(gateBytes),production_authorized:false,automatic_retry_allowed:false,authority_effect:false,
    ...(stoppedResume?{previous_failed_qualification:{state:'PRESERVED_NOT_QUALIFIED',evidence_directory:logDirectory,
      prior_status_sha256:sha(stoppedReadback.statusBytes),prior_stderr_sha256:sha(stoppedReadback.stderrBytes),new_qualification_attempted:true}}:{})};
  const proofFile=path.join(plan.state_directory,'forward-qualification.json'),proofSha=await write(proofFile,proof);await acl(proofFile);
  return {state:proof.state,proof_file:proofFile,proof_sha256:proofSha,provider_published:false,installed:false};
}
async function successorUnchanged(proof,old){
  const plan=proof.plan,state=plan.state_directory,installedRoot=path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
  const expected=makeUpgradeConfigs(old.config,{stateDirectory:state,candidateBundle:path.join(plan.candidate_root,'resources','client-state-runtime'),installedBundle:path.join(installedRoot,'resources','client-state-runtime'),bundleDigest:proof.bundle_sha256});
  const configFile=path.join(state,'installed-runtime-config.json'),qualificationFile=path.join(state,'qualification-config.json');
  const proposed=validateLocalStateProviderConfig({...old.owner,runtime_identity_file:path.join(state,'runtime-instance.json'),runtime_host:{bundle_directory:expected.final.bundle_directory,expected_bundle_sha256:proof.bundle_sha256,config_file:configFile}});
  if(JSON.stringify(proposed)!==JSON.stringify(proof.proposed))fail('successor_binding_changed');
  for(const [file,pin,value] of [[configFile,proof.config_sha256,expected.final],[qualificationFile,proof.qualification_config_sha256,expected.qualification]]){
    const bytes=await stableUpgradeRead(file);await acl(file);
    if(sha(bytes)!==pin||JSON.stringify(JSON.parse(bytes))!==JSON.stringify(value))fail('successor_config_changed');
  }
  const bytes=await stableUpgradeRead(proposed.runtime_identity_file),stopped=JSON.parse(bytes);
  if(sha(bytes)!==proof.runtime_status_sha256||stopped.state!=='STOPPED'||stopped.runtime_ready!==false
    ||stopped.children_stopped!==true||stopped.instance_id!==proof.runtime.instance_id
    ||stopped.host_pid!==proof.runtime.host_pid||stopped.bundle_sha256!==proof.bundle_sha256)fail('qualification_changed');
  await absent(path.join(state,'runtime-host-lock.json'));
}
export async function installForwardQualified({proofFile,expectedProofSha256}){
  const proofBytes=await stableUpgradeRead(proofFile,262144);await acl(proofFile);if(sha(proofBytes)!==expectedProofSha256)fail('proof_pin_mismatch');
  const proof=JSON.parse(proofBytes),plan=validatePlan(proof.plan);if(proof.state!=='QUALIFIED_AND_STOPPED')fail('proof_state_invalid');
  await assertForwardInstallNotAttempted(plan.state_directory);
  const old=await oldState(plan),checked=await candidate(plan),state=plan.state_directory;
  if(checked.image.tree_sha256!==proof.candidate.tree_sha256||checked.binding.bundle_sha256!==proof.bundle_sha256)fail('candidate_changed');
  if(await hash(plan.installer_file)!==plan.installer_sha256)fail('installer_changed');
  const preservedPaths=preservedPathScope(plan,old,proof.keeper);
  const verify=async()=>{await assertForwardPreservedPaths(preservedPaths);await quiescent(old.config,old.status);await keeperSame(old.config,proof.keeper);if(sha(await stableUpgradeRead(proof.gate_file))!==proof.gate_sha256)fail('gate_changed');await successorUnchanged(proof,old);await assertForwardPreservedPaths(preservedPaths);};
  await verify();
  if(sha(old.configBytes)!==proof.old_config_sha256||sha(old.statusBytes)!==proof.old_status_sha256)fail('predecessor_changed');
  const stopped=JSON.parse(await stableUpgradeRead(proof.proposed.runtime_identity_file));
  if(stopped.state!=='STOPPED'||stopped.children_stopped!==true||stopped.instance_id!==proof.runtime.instance_id||stopped.host_pid!==proof.runtime.host_pid)fail('qualification_changed');
  const installedRoot=path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
  const registrationArgs=['-File',script('qa-forward-registration.ps1'),'-StateDirectory',state,'-ExpectedVersion',proof.old_version];
  const reg=JSON.parse(await runPs([...registrationArgs,'-Mode','Observe']));if(reg.digest!==proof.registration.digest)fail('registration_changed');
  await assertForwardArtifactsUnchanged(artifactPins(plan,proof.candidate));
  await retireForwardImage({installedRoot,stateDirectory:state,retiredRoot:path.join(state,'retired-installation'),expectedTreeSha256:proof.predecessor.tree_sha256,preservedPaths},{verify});
  await verify();
  const retired=JSON.parse(await runPs([...registrationArgs,'-Mode','Retire','-ExpectedDigest',reg.digest]));if(retired.state!=='RETIRED_VERIFIED'||retired.digest!==reg.digest)fail('registration_retirement_unconfirmed');
  await runForwardEffect({stateDirectory:state,effect:'installer',identity:{installer_sha256:plan.installer_sha256}}, {
    verifyBefore:async()=>{await verify();await assertForwardArtifactsUnchanged(artifactPins(plan,proof.candidate));},
    invoke:async()=>JSON.parse(await runPs(['-File',script('install-package-bounded.ps1'),'-InstallerPath',plan.installer_file,'-ExpectedSha256',plan.installer_sha256,'-TimeoutSeconds','1800'],1850000)),
    verifyAfter:async installed=>{
      if(installed.installer_exit_code!==0||installed.installer_sha256!==plan.installer_sha256)fail('installer_result_unconfirmed');
      await verify();await assertForwardArtifactsUnchanged(artifactPins(plan,proof.candidate));
    },
  });
  return finalizeForwardPayload({proof,plan,old,expectedProofSha256,verify});
}
// Explicit operator readback after an interrupted installer. Never run NSIS
// again, infer exit 0, or relax the complete installed-file/registration check.
export async function finalizeForwardAfterInstallerReadback({proofFile,expectedProofSha256}){
  const proofBytes=await stableUpgradeRead(proofFile,262144);await acl(proofFile);
  if(sha(proofBytes)!==expectedProofSha256)fail('proof_pin_mismatch');
  const proof=JSON.parse(proofBytes),plan=validatePlan(proof.plan),state=plan.state_directory;
  if(proof.state!=='QUALIFIED_AND_STOPPED')fail('proof_state_invalid');
  const old=await oldState(plan),checked=await candidate(plan);
  if(checked.image.tree_sha256!==proof.candidate.tree_sha256||checked.binding.bundle_sha256!==proof.bundle_sha256)fail('candidate_changed');
  if(await hash(plan.installer_file)!==plan.installer_sha256)fail('installer_changed');
  if(sha(old.configBytes)!==proof.old_config_sha256||sha(old.statusBytes)!==proof.old_status_sha256)fail('predecessor_changed');
  const attempt=JSON.parse(await stableUpgradeRead(path.join(state,'installer-attempt.json')));
  if(attempt.state!=='EFFECT_PENDING'||attempt.installer_sha256!==plan.installer_sha256)fail('installer_attempt_changed');
  await absent(path.join(state,'installer-completed.json'));
  if((await captureInstalledTreeFingerprint(path.join(state,'retired-installation'))).tree_sha256!==proof.predecessor.tree_sha256)fail('retired_image_changed');
  const retired=JSON.parse(await stableUpgradeRead(path.join(state,'registration-retirement-completed.json')));
  if(retired.state!=='RETIRED_VERIFIED'||retired.digest!==proof.registration.digest)fail('retired_registration_changed');
  const stopped=JSON.parse(await stableUpgradeRead(proof.proposed.runtime_identity_file));
  if(stopped.state!=='STOPPED'||stopped.children_stopped!==true||stopped.instance_id!==proof.runtime.instance_id||stopped.host_pid!==proof.runtime.host_pid)fail('qualification_changed');
  const verify=async()=>{
    await assertForwardPreservedPaths(preservedPathScope(plan,old,proof.keeper));
    await quiescent(old.config,old.status);await keeperSame(old.config,proof.keeper);
    if(sha(await stableUpgradeRead(proof.gate_file))!==proof.gate_sha256)fail('gate_changed');
    await successorUnchanged(proof,old);
    const rows=JSON.parse(await runPs(['-Command',"$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'METAENGINE%Setup%' OR Name LIKE 'Uninstall METAENGINE%'\" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress"] )||'[]');
    if((Array.isArray(rows)?rows:[rows]).length!==0)fail('installer_process_still_present');
    await assertForwardPreservedPaths(preservedPathScope(plan,old,proof.keeper));
  };
  await verify();
  await write(path.join(state,'installer-readback-attempt.json'),{state:'READBACK_PENDING',installer_exit_code:null,installer_replayed:false,automatic_retry_allowed:false,authority_effect:false});
  return finalizeForwardPayload({proof,plan,old,expectedProofSha256,verify,readback:true});
}
async function finalizeForwardPayload({proof,plan,old,expectedProofSha256,verify,readback=false}){
  const state=plan.state_directory,installedRoot=path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
  await assertForwardArtifactsUnchanged(artifactPins(plan,proof.candidate));
  await successorUnchanged(proof,old);
  const image=await compareQaInstalledImage(plan.candidate_root,installedRoot,{expectedUninstallerSha256:plan.uninstaller_sha256});
  const actual=await candidate({...plan,candidate_root:installedRoot});if(actual.binding.bundle_sha256!==proof.bundle_sha256)fail('installed_bundle_changed');
  const nsis=await observeWindowsNsisEffects({expectedVersion:plan.package_version});
  const registrationArgs=['-File',script('qa-forward-registration.ps1'),'-Mode','Observe','-StateDirectory',state,'-ExpectedVersion',plan.package_version];
  const registration=JSON.parse(await runPs(registrationArgs));
  const verifyPayload=async()=>{
    await verify();
    if((await captureInstalledTreeFingerprint(installedRoot)).tree_sha256!==image.installed_tree_sha256)fail('installed_image_changed');
    if(JSON.parse(await runPs(registrationArgs)).digest!==registration.digest)fail('installed_registration_changed');
  };
  await verify();
  if(readback)await write(path.join(state,'installer-readback-completed.json'),{state:'COMPLETE_PAYLOAD_AND_REGISTRATION_VERIFIED',installed_image:image,nsis_effects:nsis,installer_exit_code:null,installer_replayed:false,automatic_retry_allowed:false,authority_effect:false});
  if(sha(await stableUpgradeRead(old.file))!==plan.owner_sha256)fail('owner_changed_before_publication');
  const nextBytes=Buffer.from(JSON.stringify(proof.proposed,null,2)+'\n'),staged=path.join(state,'pending-owner.json');await write(staged,nextBytes);await acl(staged);
  await assertForwardArtifactsUnchanged(artifactPins(plan,proof.candidate));
  await publishForwardOwner({stateDirectory:state,ownerFile:old.file,stagedFile:staged,oldBytes:old.bytes,nextBytes},{verify:verifyPayload});
  const receipt={schema:'metaengine.operator.forward-install-receipt.v1',state:'INSTALLED_VERIFIED',proof_sha256:expectedProofSha256,source_head:plan.source_head,package_version:plan.package_version,owner_sha256:sha(nextBytes),bundle_sha256:proof.bundle_sha256,installed_asar_sha256:plan.asar_sha256,installed_image:image,nsis_effects:nsis,registration,keeper:proof.keeper,installed_payload_verified:true,production_authorized:false,provenance_verified:false,historical_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false};
  const postVerify=async()=>{await assertForwardPreservedPaths(preservedPathScope(plan,old,proof.keeper));await quiescent(old.config,old.status);await keeperSame(old.config,proof.keeper);await successorUnchanged(proof,old);if((await captureInstalledTreeFingerprint(installedRoot)).tree_sha256!==image.installed_tree_sha256)fail('installed_image_changed');if(JSON.parse(await runPs(registrationArgs)).digest!==registration.digest)fail('installed_registration_changed');await assertForwardPreservedPaths(preservedPathScope(plan,old,proof.keeper));};
  const completed=await completeUpgradeFiles({ownerFile:old.file,gateFile:proof.gate_file,terminalFile:path.join(state,'forward-installed.json'),retiredGateFile:path.join(state,'completed-upgrade-gate.json'),expectedOwnerSha256:sha(nextBytes),expectedGateSha256:proof.gate_sha256,receipt},{verify:postVerify,protect:acl});
  const completionFile=path.join(state,'forward-completed.json'),completionSha=await write(completionFile,completed);
  const admission={schema:QA_UPGRADE_ADMISSION_SCHEMA,state:'INSTALLED_VERIFIED',owner_sha256:sha(nextBytes),bundle_sha256:proof.bundle_sha256,proof_sha256:expectedProofSha256,completed_receipt_sha256:completionSha,source_head:plan.source_head,package_version:plan.package_version,installed_asar_sha256:plan.asar_sha256,installed_tree_sha256:image.installed_tree_sha256,publication_gate_sha256:proof.gate_sha256,launch_allowed:true,gate_retired:true,production_authorized:false,provenance_verified:false,automatic_retry_allowed:false,authority_effect:false};
  return {...await commitUpgradeAdmission({ownerFile:old.file,gateFile:proof.gate_file,completionFile,admission},{verify:postVerify,protect:acl}),state:'INSTALLED_VERIFIED',package_version:plan.package_version,source_head:plan.source_head};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const [mode,file,pin]=process.argv.slice(2);let result;
    if(['prepare','resume-after-schema-readback','resume-after-stopped-readback'].includes(mode)&&file&&!pin)result=await prepareForwardInstall(JSON.parse(await stableUpgradeRead(file)),{resume:mode==='resume-after-schema-readback',resumeStopped:mode==='resume-after-stopped-readback'});
    else if(mode==='install'&&file&&/^[a-f0-9]{64}$/.test(pin||''))result=await installForwardQualified({proofFile:file,expectedProofSha256:pin});
    else if(mode==='finalize-after-installer-readback'&&file&&/^[a-f0-9]{64}$/.test(pin||''))result=await finalizeForwardAfterInstallerReadback({proofFile:file,expectedProofSha256:pin});
    else fail('arguments_invalid');
    console.log(JSON.stringify(result));
  }catch(error){console.error(JSON.stringify({state:'STOPPED_REQUIRES_READBACK',reason:String(error?.message||error),automatic_retry_allowed:false,authority_effect:false}));process.exitCode=1;}
}
