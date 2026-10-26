#!/usr/bin/env node
// A consumer of two pinned packages, never a package producer. This entry is
// restricted to an empty, disposable GitHub-hosted Windows profile. Private
// Owner/config/PGDATA and raw child logs never enter the public evidence root.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual,parseArgs,promisify} from 'node:util';
import {writeForwardEvidence,assertForwardPreservedPaths} from './qa-forward-install-policy.mjs';
import {stableUpgradeRead} from './qa-owner-runtime-upgrade.mjs';
import {compareQaInstalledImage} from './qa-operator-install-recovery.mjs';
import {observeWindowsNsisEffects} from './qa-nsis-external-effects.mjs';
import {localStateProviderOwnerFile,validateLocalStateProviderConfig,validateLocalStateRuntimeIdentity,localStateProviderHealthAttested} from '../src/local-state-provider-policy.mjs';
import {assertQaUpgradeAdmission,qaUpgradeAdmissionFile} from '../src/local-provider-upgrade-admission.mjs';
import {validateRuntimeHostConfig} from '../../../infra/client-state-runtime/runtime-host.mjs';
import {runtimeHostPidState,runtimeHostTcpPortState} from '../../../infra/client-state-runtime/runtime-host-orphan-reconciliation.mjs';
import {verifyWindowsTcpListener} from './verify-windows-tcp-listener.mjs';

const exec=promisify(execFile),require=createRequire(import.meta.url);
const SHA=/^[a-f0-9]{64}$/,HEAD=/^[a-f0-9]{40}$/;
const script=name=>fileURLToPath(new URL(name,import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=reason=>{throw Error('manual_forward_'+reason);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const inside=(root,target)=>{const rel=path.relative(root.toLowerCase(),target.toLowerCase());return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};

// Manual migration never discharges these autonomous update requirements.
export const AUTOMATIC_FORWARD_REMAINS=Object.freeze([
  'independent_automatic_N_to_N_plus_1_trigger_and_stage',
  'durable_preinstall_intent_and_exact_installer_handoff',
  'observed_installer_outcome_or_durable_unknown_effect_hold',
  'independently_verified_installed_payload_and_registration',
  'durable_successor_receipt_bound_to_the_same_update_transaction',
  'restart_reconciliation_without_replaying_an_unknown_effect',
]);

export function assertManualForwardHostedEnvironment({env=process.env,platform=process.platform}={}) {
  if(platform!=='win32'||env.GITHUB_ACTIONS!=='true'||env.CI!=='true'
    ||env.RUNNER_ENVIRONMENT!=='github-hosted'||env.RUNNER_OS!=='Windows'
    ||env.GITHUB_REPOSITORY!=='PatrickFrome/Compute'||!HEAD.test(env.GITHUB_SHA||'')
    ||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))fail('disposable_hosted_windows_required');
  for(const key of ['APPDATA','LOCALAPPDATA','RUNNER_TEMP','SystemRoot'])
    if(typeof env[key]!=='string'||!path.win32.isAbsolute(env[key])||/^(?:\\\\|\/\/)/.test(env[key]))fail('runner_path_invalid');
  return true;
}

export function assertManualForwardContinuity(before,after,{restart=false}={}) {
  for(const row of [before,after]) {
    if(!row||!/^\d+$/.test(row.cluster_system_identifier||'')
      ||typeof row.pg_data_directory!=='string'||!path.isAbsolute(row.pg_data_directory)
      ||!Number.isSafeInteger(row.postmaster_pid)||row.postmaster_pid<1
      ||!Number.isFinite(Date.parse(row.postmaster_created_at||''))
      ||typeof row.postmaster_started_at!=='string'||!row.postmaster_started_at
      ||row.sentinel_count!==3||!['sentinel_sha256','vault_sha256','postmaster_pidfile_sha256','runtime_tree_sha256'].every(k=>SHA.test(row[k]||'')))fail('continuity_observation_incomplete');
  }
  for(const key of ['cluster_system_identifier','sentinel_count','sentinel_sha256','vault_sha256','runtime_tree_sha256'])
    if(before[key]!==after[key])fail('preserved_'+key+'_changed');
  if(!same(before.pg_data_directory,after.pg_data_directory))fail('pgdata_changed');
  const sameNative=before.postmaster_pid===after.postmaster_pid&&before.postmaster_created_at===after.postmaster_created_at;
  if(restart) {
    if(sameNative||before.postmaster_started_at===after.postmaster_started_at
      ||before.postmaster_pidfile_sha256===after.postmaster_pidfile_sha256)fail('postgres_restart_unproven');
  } else if(!sameNative||before.postmaster_started_at!==after.postmaster_started_at
    ||before.postmaster_pidfile_sha256!==after.postmaster_pidfile_sha256)fail('keeper_incarnation_changed');
  return true;
}

export function assertManualForwardOwnerReadback({previousOwner,previousConfig,owner,config,status,admission,
  ownerBytes,completionBytes,proofSha256,candidate,stateDirectory,installedRoot,installedTreeSha256}) {
  validateLocalStateProviderConfig(owner);validateRuntimeHostConfig(config);
  const expectedOwner={...previousOwner,runtime_identity_file:path.join(stateDirectory,'runtime-instance.json'),
    runtime_host:{bundle_directory:path.join(installedRoot,'resources','client-state-runtime'),
      expected_bundle_sha256:candidate.bundle_sha256,config_file:path.join(stateDirectory,'installed-runtime-config.json')}};
  const expectedConfig={...previousConfig,state_directory:stateDirectory,
    bundle_directory:expectedOwner.runtime_host.bundle_directory,expected_bundle_sha256:candidate.bundle_sha256};
  if(!isDeepStrictEqual(owner,expectedOwner)||!isDeepStrictEqual(config,expectedConfig))fail('owner_or_config_transition_unbound');
  assertQaUpgradeAdmission(admission,{owner,ownerBytes});
  if(!Buffer.isBuffer(completionBytes)||admission.completed_receipt_sha256!==digest(completionBytes)
    ||admission.proof_sha256!==proofSha256||admission.source_head!==candidate.source_head
    ||admission.package_version!==candidate.package_version||admission.installed_asar_sha256!==candidate.asar_sha256
    ||admission.installed_tree_sha256!==installedTreeSha256||status?.state!=='STOPPED'
    ||status.children_stopped!==true||status.runtime_ready!==false||status.bundle_sha256!==candidate.bundle_sha256)fail('successor_admission_readback_unbound');
  return true;
}

async function absent(file) {
  try {await fs.lstat(file);fail('preexisting_state_requires_review');}
  catch(error) {if(error.code!=='ENOENT')throw error;}
}
async function physical(file,{missing=false}={}) {
  const absolute=path.resolve(file);let current=path.parse(absolute).root;
  for(const piece of path.relative(current,absolute).split(path.sep).filter(Boolean)) {
    current=path.join(current,piece);let info;
    try {info=await fs.lstat(current,{bigint:true});}
    catch(error) {if(missing&&error.code==='ENOENT')return absolute;throw error;}
    if(info.isSymbolicLink()||info.ino<=0n||(!info.isDirectory()&&(!info.isFile()||info.nlink!==1n)))fail('physical_path_unverified');
    const real=await fs.realpath(current),resolved=await fs.lstat(real,{bigint:true});
    if(resolved.ino!==info.ino||resolved.dev!==info.dev)fail('physical_path_unverified');
  }
  return fs.realpath(absolute);
}
function privateEnvironment() {
  const env={};
  for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','USERPROFILE','HOMEDRIVE','HOMEPATH','TEMP','TMP','PATH','Path','APPDATA','LOCALAPPDATA','LANG'])
    if(typeof process.env[key]==='string')env[key]=process.env[key];
  return env;
}
async function powershell(args,{timeout=90000,env=privateEnvironment()}={}) {
  try {
    const task=exec(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive',...args],{env:{...env,PSModulePath:path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')},windowsHide:true,shell:false,timeout,maxBuffer:32768});
    task.child.stdin?.end();return JSON.parse((await task).stdout.replace(/^\uFEFF/,'').trim());
  } catch {fail('native_effect_or_readback_unconfirmed');}
}
async function cleanRunnerPreflight({installedRoot,ownerFile}) {
  for(const file of [installedRoot,path.dirname(ownerFile),ownerFile+'.qa-upgrade-gate.json',path.join(process.env.LOCALAPPDATA,'METAENGINE')])await absent(file);
  for(const file of [process.env.APPDATA,process.env.LOCALAPPDATA,process.env.RUNNER_TEMP,os.tmpdir()])await physical(file);
  const program=String.raw`$ErrorActionPreference='Stop'
if([Environment]::GetFolderPath('ApplicationData') -ine $env:APPDATA -or [Environment]::GetFolderPath('LocalApplicationData') -ine $env:LOCALAPPDATA){throw 'profile_redirect_forbidden'}
$id='c32f3891-2b9e-5a4a-bd4f-5173b65b39bb'
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
 foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
  try{foreach($prefix in @('Software','Software\Microsoft\Windows\CurrentVersion\Uninstall')){
    $key=$base.OpenSubKey(($prefix+'\'+$id));if($null -ne $key){$key.Dispose();throw 'existing_registration'}
  }}finally{$base.Dispose()}
 }
}
if(@(Get-CimInstance Win32_Process -Filter "Name='METAENGINE Browser Test.exe' OR Name='postgres.exe'" -ErrorAction Stop).Count -ne 0){throw 'existing_process'}
if(Get-Service -Name 'METAENGINEBrowserGuardian' -ErrorAction SilentlyContinue){throw 'existing_guardian'}
foreach($shortcut in @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\METAENGINE Browser Test.lnk'),(Join-Path ([Environment]::GetFolderPath('Desktop')) 'METAENGINE Browser Test.lnk'))){if(Test-Path -LiteralPath $shortcut){throw 'existing_shortcut'}}
@{empty_disposable_profile=$true;registration_absent=$true;owner_absent=$true;guardian_absent=$true}|ConvertTo-Json -Compress`;
  const readback=await powershell(['-EncodedCommand',Buffer.from(program,'utf16le').toString('base64')]);
  if(!['empty_disposable_profile','registration_absent','owner_absent','guardian_absent'].every(k=>readback[k]===true))fail('runner_preflight_unconfirmed');
  return readback;
}

function publicContinuity(row) {
  return {...Object.fromEntries(['cluster_system_identifier','postmaster_pid','postmaster_created_at','postmaster_started_at',
    'postmaster_pidfile_sha256','sentinel_count','sentinel_sha256','vault_sha256','runtime_tree_sha256'].map(k=>[k,row[k]])),
    pgdata_path_sha256:digest(path.resolve(row.pg_data_directory).toLowerCase())};
}
function publicPackage(pkg) {
  return Object.fromEntries(['source_head','package_version','producer_run_id','producer_run_attempt','installer_sha256',
    'asar_sha256','uninstaller_sha256','bundle_sha256','image_tree_sha256','pg_tree_sha256'].map(k=>[k,pkg[k]]));
}
async function registration(state,version) {
  const result=await powershell(['-File',script('qa-forward-registration.ps1'),'-Mode','Observe','-StateDirectory',state,'-ExpectedVersion',version]);
  if(result.state!=='OBSERVED'||result.key_count!==2||result.mutation!==false||!SHA.test(result.digest||''))fail('exact_registration_unconfirmed');
  return result;
}
async function verifyAdmissionSource(install) {
  const asar=require('@electron/asar'),archive=path.join(install,'resources','app.asar');
  asar.uncache(archive);
  const files=['local-state-provider-bootstrap.mjs','local-runtime-host-controller.mjs','local-state-provider-policy.mjs','local-provider-upgrade-admission.mjs'];
  for(const name of files)if(!asar.extractFile(archive,path.join('src',name)).equals(await fs.readFile(new URL('../src/'+name,import.meta.url))))fail('installed_admission_source_changed');
  return files.length;
}

// No dependency injection in this physical entry. Model tests exercise the
// observation validators separately and cannot emit this physical receipt.
export async function qualifyManualForwardPhysical({inputsFile,inputsSha256,evidenceDirectory}) {
  assertManualForwardHostedEnvironment();
  if(!SHA.test(inputsSha256||'')||![inputsFile,evidenceDirectory].every(p=>typeof p==='string'&&path.isAbsolute(p)))fail('arguments_invalid');
  const temporary=await physical(process.env.RUNNER_TEMP);
  if(!inside(temporary,path.resolve(evidenceDirectory)))fail('evidence_scope_invalid');
  await physical(path.dirname(evidenceDirectory));await absent(evidenceDirectory);
  await fs.mkdir(evidenceDirectory,{mode:0o700});
  let effectStarted=false,phase='INPUT_VERIFICATION',fixture,stopHost;
  let hostPossiblyRunning=false,hostStopAttempted=false,hostCleanupConfirmed=null;
  const phaseRecord=async(name,value)=>writeForwardEvidence(path.join(evidenceDirectory,name+'.json'),value);
  const phaseIntent=async name=>{phase=name;await phaseRecord(name+'-intent',{state:'EFFECT_PENDING',phase:name,automatic_retry_allowed:false});effectStarted=true;};
  try {
    const inputBytes=await stableUpgradeRead(inputsFile,1024*1024);
    if(digest(inputBytes)!==inputsSha256)fail('inputs_pin_changed');
    const input=JSON.parse(inputBytes);
    const {verifyForwardInputDirectory}=await import('./qa-forward-install-evidence.mjs');
    const reverify=()=>verifyForwardInputDirectory({pins:input.pins,inputRoot:input.input_root,expectedSourceHead:process.env.GITHUB_SHA});
    const inputs=await reverify(),candidate=inputs.candidate,predecessor=inputs.predecessor;
    if(candidate.source_head!==process.env.GITHUB_SHA||candidate.source_head===predecessor.source_head
      ||candidate.package_version===predecessor.package_version)fail('transition_identity_invalid');
    const installedRoot=path.join(process.env.LOCALAPPDATA,'Programs','METAENGINE Browser Test');
    const ownerFile=localStateProviderOwnerFile();
    await phaseRecord('inputs',{schema:'metaengine.browser.manual-forward-input-binding.v1',consumer_source_head:process.env.GITHUB_SHA,
      inputs_sha256:inputsSha256,artifact_binding_sha256:inputs.artifact_binding_sha256,candidate:publicPackage(candidate),predecessor:publicPackage(predecessor)});
    await phaseRecord('preflight',await cleanRunnerPreflight({installedRoot,ownerFile}));
    // Import while there is provably no Owner, before any automatic top-level
    // bootstrap can start a host. Later explicit calls use this exact source,
    // byte-compared to the installed successor ASAR before launch.
    const {bootstrapPersistentLocalProvider}=await import('../src/local-state-provider-bootstrap.mjs');
    const controller=await import('../src/local-runtime-host-controller.mjs');stopHost=controller.stopOwnedLocalRuntimeHost;
    const fixtureRoot=path.join(await physical(os.tmpdir()),'metaengine-forward-fixture-'+randomUUID());
    const stateDirectory=path.join(process.env.LOCALAPPDATA,'METAENGINE','client-state-qa-upgrade-'+randomUUID());
    await physical(path.dirname(stateDirectory),{missing:true});await absent(stateDirectory);
    await reverify();await cleanRunnerPreflight({installedRoot,ownerFile});
    await phaseIntent('predecessor-install');
    const install=await powershell(['-File',script('install-package-bounded.ps1'),'-InstallerPath',predecessor.installer_file,
      '-ExpectedSha256',predecessor.installer_sha256,'-TimeoutSeconds','1800'],{timeout:1850000});
    if(install.installer_exit_code!==0||install.installer_sha256!==predecessor.installer_sha256
      ||install.process_tree_scoped_job!==true||install.descendant_cleanup_on_job_close!==true)fail('predecessor_install_unconfirmed');
    const predecessorImage=await compareQaInstalledImage(predecessor.candidate_root,installedRoot,{expectedUninstallerSha256:predecessor.uninstaller_sha256});
    const predecessorNsis=await observeWindowsNsisEffects({expectedVersion:predecessor.package_version});
    await phaseRecord('predecessor-install-readback',{installer:install,image:predecessorImage,nsis:predecessorNsis});
    await phaseIntent('fixture-provision');
    const {provisionForwardFixture}=await import('./qa-forward-install-fixture.mjs');
    fixture=await provisionForwardFixture({predecessor,installedBundle:path.join(installedRoot,'resources','client-state-runtime'),fixtureRoot,appData:process.env.APPDATA});
    if(!same(fixture.ownerFile,ownerFile))fail('fixture_owner_route_changed');
    const previousOwner=fixture.owner,previousConfig=fixture.config;
    const before=await fixture.readbackSql();assertManualForwardContinuity(before,before);
    await phaseRecord('fixture-baseline',{...fixture.fixtureEvidence,continuity:publicContinuity(before)});
    const ownerBytes=await stableUpgradeRead(ownerFile),plan={schema:'metaengine.operator.forward-install-plan.v1',
      operator_choice:'INSTALL_FIXED_QA_PRESERVE_DATABASE_NO_AUTOMATIC_ROLLBACK',source_head:candidate.source_head,
      package_version:candidate.package_version,candidate_root:candidate.candidate_root,installer_file:candidate.installer_file,
      asar_sha256:candidate.asar_sha256,installer_sha256:candidate.installer_sha256,uninstaller_sha256:candidate.uninstaller_sha256,
      owner_sha256:digest(ownerBytes),state_directory:stateDirectory};
    const scope={installedRoot,stateDirectory,retiredRoot:path.join(stateDirectory,'retired-installation'),
      keeperExecutable:path.join(fixture.postgresBinDirectory,'postgres.exe'),pgDataDirectory:fixture.dataDirectory,
      candidateRoot:candidate.candidate_root,installerFile:candidate.installer_file,ownerFile,
      configFile:previousOwner.runtime_host.config_file,statusFile:previousOwner.runtime_identity_file,predecessorStateDirectory:previousConfig.state_directory};
    await assertForwardPreservedPaths(scope);await reverify();
    await fs.mkdir(path.dirname(stateDirectory),{mode:0o700});
    const {prepareForwardInstall,installForwardQualified}=await import('./qa-forward-install.mjs');
    await phaseIntent('prepare');const prepared=await prepareForwardInstall(plan);
    if(prepared.state!=='QUALIFIED_AND_STOPPED'||prepared.provider_published!==false||prepared.installed!==false)fail('prepare_unconfirmed');
    const afterPrepare=await fixture.readbackSql();assertManualForwardContinuity(before,afterPrepare);
    if(!(await stableUpgradeRead(ownerFile)).equals(ownerBytes))fail('owner_changed_during_prepare');
    let gateRejected=false;
    try {await bootstrapPersistentLocalProvider({env:privateEnvironment(),ownerFile});}
    catch(error) {gateRejected=error.message==='local_state_provider_upgrade_install_pending';}
    if(!gateRejected||controller.readOwnedLocalRuntimeHostSummary()!==null)fail('prepared_gate_not_enforced');
    await phaseRecord('prepare-readback',{state:prepared.state,proof_sha256:prepared.proof_sha256,
      owner_sha256:plan.owner_sha256,publication_gate_enforced:true,continuity:publicContinuity(afterPrepare)});
    await reverify();await assertForwardPreservedPaths(scope);
    await phaseIntent('forward-install');
    const installed=await installForwardQualified({proofFile:prepared.proof_file,expectedProofSha256:prepared.proof_sha256});
    if(installed.state!=='INSTALLED_VERIFIED'||installed.source_head!==candidate.source_head||installed.package_version!==candidate.package_version)fail('forward_install_unconfirmed');
    const image=await compareQaInstalledImage(candidate.candidate_root,installedRoot,{expectedUninstallerSha256:candidate.uninstaller_sha256});
    const reg=await registration(stateDirectory,candidate.package_version),nsis=await observeWindowsNsisEffects({expectedVersion:candidate.package_version});
    const sourceFiles=await verifyAdmissionSource(installedRoot);
    const successorOwnerBytes=await stableUpgradeRead(ownerFile),owner=validateLocalStateProviderConfig(JSON.parse(successorOwnerBytes));
    const configBytes=await stableUpgradeRead(owner.runtime_host.config_file),config=validateRuntimeHostConfig(JSON.parse(configBytes));
    const stopped=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file));
    const admissionFile=qaUpgradeAdmissionFile(owner),admissionBytes=await stableUpgradeRead(admissionFile);
    const admission=JSON.parse(admissionBytes),completionBytes=await stableUpgradeRead(path.join(stateDirectory,'forward-completed.json'));
    await absent(ownerFile+'.qa-upgrade-gate.json');
    assertManualForwardOwnerReadback({previousOwner,previousConfig,owner,config,status:stopped,admission,ownerBytes:successorOwnerBytes,
      completionBytes,proofSha256:prepared.proof_sha256,candidate,stateDirectory,installedRoot,installedTreeSha256:image.installed_tree_sha256});
    const afterInstall=await fixture.readbackSql();assertManualForwardContinuity(before,afterInstall);
    await phaseRecord('forward-install-readback',{image,registration:reg,nsis,admission_sha256:digest(admissionBytes),
      owner_sha256:digest(successorOwnerBytes),config_sha256:digest(configBytes),installed_admission_source_files_verified:sourceFiles,
      continuity:publicContinuity(afterInstall)});
    const unchanged=async()=>{
      await assertForwardPreservedPaths(scope);await absent(ownerFile+'.qa-upgrade-gate.json');
      if(!(await stableUpgradeRead(ownerFile)).equals(successorOwnerBytes)
        ||!(await stableUpgradeRead(owner.runtime_host.config_file)).equals(configBytes)
        ||!(await stableUpgradeRead(admissionFile)).equals(admissionBytes))fail('published_binding_changed');
      if((await registration(stateDirectory,candidate.package_version)).digest!==reg.digest)fail('successor_registration_changed');
      if((await compareQaInstalledImage(candidate.candidate_root,installedRoot,{expectedUninstallerSha256:candidate.uninstaller_sha256})).installed_tree_sha256!==image.installed_tree_sha256)fail('successor_payload_changed');
    };
    let priorStatus=stopped;
    const runtimeCycle=async(label,expectedPg,{restart=false}={})=>{
      await unchanged();await phaseIntent(label+'-start');
      hostPossiblyRunning=true;hostStopAttempted=false;hostCleanupConfirmed=null;
      let boot;
      try {boot=await bootstrapPersistentLocalProvider({env:privateEnvironment(),ownerFile});}
      catch(error) {
        // Bootstrap already performs its own bounded cleanup on startup
        // failure. An unknown result does not authorize another stop request.
        hostStopAttempted=true;hostCleanupConfirmed=false;throw error;
      }
      const status=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file)),identity=validateLocalStateRuntimeIdentity(status,owner.base_url);
      if(boot.state!=='READY'||!boot.runtime_host||boot.instance_id!==identity.instance_id||priorStatus.instance_id===identity.instance_id
        ||status.bundle_sha256!==candidate.bundle_sha256||status.postgres_mode!=='attached'||status.api_role_mode!=='direct'
        ||status.host_pid!==boot.runtime_host.pid||boot.runtime_host.runtime_owned!==true
        ||!Array.isArray(status.children)||status.children.length!==2)fail('runtime_owner_status_mismatch');
      for(const child of status.children) {
        const port=child.name==='api'?config.api_port:child.name==='edge'?config.edge_port:null;
        if(!port)fail('runtime_child_unbound');await verifyWindowsTcpListener({port,pid:child.pid});
      }
      const health=await fetch(owner.base_url+'/health',{redirect:'error',signal:AbortSignal.timeout(12000)});
      if(!health.ok||!localStateProviderHealthAttested(await health.json(),identity.instance_id))fail('runtime_health_unattested');
      const during=await fixture.readbackSql();assertManualForwardContinuity(expectedPg,during,{restart});
      await unchanged();
      await phaseIntent(label+'-stop');hostStopAttempted=true;
      const cleanup=await stopHost({timeoutMs:45000});hostCleanupConfirmed=cleanup.cleanup_confirmed===true;
      if(hostCleanupConfirmed)hostPossiblyRunning=false;
      const final=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file));
      if(cleanup.state!=='STOPPED'||cleanup.cleanup_confirmed!==true||final.state!=='STOPPED'||final.children_stopped!==true
        ||final.runtime_ready!==false||final.instance_id!==identity.instance_id||final.host_pid!==status.host_pid)fail('runtime_stop_unconfirmed');
      await absent(path.join(stateDirectory,'runtime-host-lock.json'));
      for(const pid of [status.host_pid,...status.children.map(c=>c.pid)])if(runtimeHostPidState(pid)!=='ABSENT')fail('runtime_process_cleanup_unconfirmed');
      for(const port of [config.api_port,config.edge_port])if(await runtimeHostTcpPortState(port)!=='ABSENT')fail('runtime_port_cleanup_unconfirmed');
      const after=await fixture.readbackSql();assertManualForwardContinuity(during,after);priorStatus=final;
      await phaseRecord(label+'-readback',{runtime_instance_id:identity.instance_id,host_pid:status.host_pid,
        status_attested:true,health_attested:true,cleanup_confirmed:true,continuity:publicContinuity(after)});
      return after;
    };
    const firstRuntime=await runtimeCycle('successor',before);
    await phaseIntent('postgres-clean-stop');const pgStop=await fixture.stopPostgres();
    if(pgStop?.cleanup_confirmed!==true||pgStop.clean_shutdown_verified!==true
      ||pgStop.cluster_system_identifier!==before.cluster_system_identifier||!SHA.test(pgStop.control_readback_sha256||''))fail('postgres_clean_stop_unconfirmed');
    await phaseRecord('postgres-clean-stop-readback',{cleanup_confirmed:true,clean_shutdown_verified:true,
      cluster_system_identifier:pgStop.cluster_system_identifier,control_readback_sha256:pgStop.control_readback_sha256});
    await phaseIntent('postgres-restart');await fixture.restartPostgres();
    const restarted=await fixture.readbackSql();assertManualForwardContinuity(firstRuntime,restarted,{restart:true});
    await runtimeCycle('successor-restart',restarted);
    await phaseIntent('final-postgres-stop');const finalStop=await fixture.stopPostgres();
    if(finalStop?.cleanup_confirmed!==true||finalStop.clean_shutdown_verified!==true
      ||finalStop.cluster_system_identifier!==before.cluster_system_identifier||!SHA.test(finalStop.control_readback_sha256||''))fail('final_cleanup_unconfirmed');
    await phaseRecord('final-postgres-stop-readback',{cleanup_confirmed:true,clean_shutdown_verified:true,
      cluster_system_identifier:finalStop.cluster_system_identifier,control_readback_sha256:finalStop.control_readback_sha256});
    await unchanged();await reverify();
    const receipt={schema:'metaengine.browser.manual-forward-physical-proof.v1',state:'PASSED_DISPOSABLE_WINDOWS_MANUAL_FORWARD',
      consumer_source_head:process.env.GITHUB_SHA,consumer_run_id:process.env.GITHUB_RUN_ID,consumer_run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT),
      artifact_binding_sha256:inputs.artifact_binding_sha256,inputs_sha256:inputsSha256,candidate:publicPackage(candidate),predecessor:publicPackage(predecessor),
      real_nsis_migration_verified:true,exact_registration_and_payload_verified:true,owner_config_status_gate_admission_verified:true,
      pgdata_cluster_sentinel_vault_preserved:true,live_keeper_preserved_during_migration:true,clean_shutdown_and_restart_verified:true,
      fixture_postgres_cleanup_confirmed:true,source_data_rows_restored:0,production_database_modified:false,
      runtime_launch_scope:'SOURCE_ADMISSION_WITH_INSTALLED_OFFLINE_RUNTIME',browser_ui_boot_proven:false,
      physical_negative_fault_injection_proven:false,negative_test_evidence:'SEPARATE_NATIVE_FILESYSTEM_AND_MODEL_TEST_REPORT',
      automatic_self_update_qualified:false,automatic_self_update_remaining:AUTOMATIC_FORWARD_REMAINS,
      production_authorized:false,automatic_retry_allowed:false,authority_effect:false};
    await phaseRecord('manual-forward-proof',receipt);return receipt;
  } catch(error) {
    // An unknown external effect stays held. Stop only the runtime handle this
    // process owns; retain the private fixture and never replay NSIS, publish
    // Owner again, restore the predecessor, or guess a postmaster to kill.
    let runtimeCleanup=hostCleanupConfirmed;
    if(stopHost&&hostPossiblyRunning&&!hostStopAttempted) {
      hostStopAttempted=true;
      try {runtimeCleanup=(await stopHost({timeoutMs:45000})).cleanup_confirmed===true;}catch {runtimeCleanup=false;}
    }
    const raw=String(error?.message||''),reason=/^[a-z][a-z0-9_]{0,159}$/.test(raw)?raw:'manual_forward_external_observation_unconfirmed';
    const result={schema:'metaengine.browser.manual-forward-physical-proof.v1',state:effectStarted?'HOLD':'BLOCKED',phase,reason,
      consumer_source_head:process.env.GITHUB_SHA,runtime_cleanup_confirmed:runtimeCleanup,physical_qualification_proven:false,
      fixture_retained:true,automatic_retry_allowed:false,automatic_self_update_qualified:false,authority_effect:false};
    try {await phaseRecord('manual-forward-hold',result);}
    catch {throw Error('manual_forward_hold_evidence_not_durable_requires_readback');}
    throw Object.assign(Error(reason),{result});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {values}=parseArgs({options:{inputs:{type:'string'},'inputs-sha256':{type:'string'},evidence:{type:'string'}}});
    const result=await qualifyManualForwardPhysical({inputsFile:values.inputs,inputsSha256:values['inputs-sha256']||process.env.ME2_FORWARD_INPUTS_SHA256,evidenceDirectory:values.evidence});
    console.log(JSON.stringify(result));
  } catch(error) {
    const reason=/^[a-z][a-z0-9_]{0,159}$/.test(error.message||'')?error.message:'manual_forward_unconfirmed';
    console.error(JSON.stringify(error.result||{state:'BLOCKED',reason,physical_qualification_proven:false,automatic_retry_allowed:false}));process.exitCode=1;
  }
}
