#!/usr/bin/env node
// Explicit operator-only recovery of an unsigned LOCAL QA installation. This
// never creates a W74 Owner claim, signs a release, reconciles tasks, or owns PG.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { validateRuntimeHostConfig } from '../../../infra/client-state-runtime/runtime-host.mjs';
import { localRuntimeHostEnvironment } from '../src/local-runtime-host-controller.mjs';
import { localStateProviderOwnerFile, validateLocalStateProviderConfig,
  validateLocalStateRuntimeIdentity, localStateProviderHealthAttested } from '../src/local-state-provider-policy.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from '../src/private-windows-storage-acl.mjs';
import { readWindowsKernelProcessW60 } from '../src/host-native-owner-producers-w60.mjs';
import { verifyWindowsTcpListener } from './verify-windows-tcp-listener.mjs';

const require = createRequire(import.meta.url), exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/, HEAD = /^[a-f0-9]{40}$/;
const SCHEMA = 'metaengine.operator.qa-owner-runtime-upgrade.v1';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error('qa_upgrade_' + code); };
const samePath = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (parent, child) => { const r=path.relative(parent,child); return r==='' || (!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep)); };

export function validateUpgradeArguments(args) {
  const options={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i]?.replace(/^--/,''), value=args[i+1];
    if(!['mode','candidate-resources','installed-resources','expected-version','expected-source',
      'expected-asar-sha256','expected-owner-sha256','receipt','expected-receipt-sha256'].includes(key)
      ||!args[i].startsWith('--')||!value||Object.hasOwn(options,key)) fail('arguments_invalid');
    options[key]=value;
  }
  if(!['prepare','publish','rollback'].includes(options.mode)
    ||!['candidate-resources','installed-resources','receipt'].every(k=>typeof options[k]==='string'&&path.isAbsolute(options[k])&&!/^(?:\\\\|\/\/)/.test(options[k]))
    ||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(options['expected-version']||'')
    ||!HEAD.test(options['expected-source']||'')
    ||!['expected-asar-sha256','expected-owner-sha256'].every(k=>SHA.test(options[k]||''))
    ||inside(options['candidate-resources']||'.',options.receipt||'.')
    ||inside(options['installed-resources']||'.',options.receipt||'.')
    ||(options.mode!=='prepare'&&!SHA.test(options['expected-receipt-sha256']||''))) fail('arguments_invalid');
  return options;
}

async function physical(file,kind='file') {
  const absolute=path.resolve(file); let current=path.parse(absolute).root;
  for(const component of path.relative(current,absolute).split(path.sep).filter(Boolean)) {
    current=path.join(current,component); const s=await fs.lstat(current);
    if(s.isSymbolicLink()||(current===absolute&&(kind==='file'? !s.isFile()||s.nlink!==1 : !s.isDirectory()))) fail('path_not_regular');
  }
  return fs.realpath(absolute);
}
export async function stableUpgradeRead(file, maximum=65536) {
  await physical(file); const a=await fs.lstat(file);
  if(a.size<1||a.size>maximum) fail('file_size_invalid');
  const bytes=await fs.readFile(file), b=await fs.lstat(file);
  if(a.ino!==b.ino||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.birthtimeMs!==b.birthtimeMs||bytes.length!==a.size) fail('file_changed');
  return bytes;
}
async function hashFile(file) {
  await physical(file); const h=createHash('sha256');
  for await(const part of createReadStream(file))h.update(part);
  return h.digest('hex');
}
async function absent(file) { try{await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;} fail('existing_attempt_requires_readback'); }
async function exclusive(file,bytes) {const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}}
async function acl(file,directory=false) {
  if((await verifyOwnerOnlyWindowsStorage(file,{operation:directory?'VERIFY_DIRECTORY':'VERIFY_PRIVATE_FILE'})).owner_dacl_verified!==true)fail('private_acl_unverified');
}
async function privateReceiptRoot(file) {
  await physical(path.dirname(file),'directory');
  // Full proposed Owner settings may appear in receipts; refuse public output roots.
  await acl(path.dirname(file),true);
}
async function save(file,value) {
  await privateReceiptRoot(file);
  const temp=file+'.'+randomUUID()+'.tmp';
  await exclusive(temp,JSON.stringify(value,null,2)+'\n');
  await acl(temp);await fs.rename(temp,file);await acl(file);
}
async function portAbsent(port) {
  const state=await new Promise(resolve=>{
    const s=net.createConnection({host:'127.0.0.1',port});let done=false;
    const end=x=>{if(done)return;done=true;s.destroy();resolve(x);};
    s.setTimeout(1500,()=>end('UNKNOWN'));s.once('connect',()=>end('PRESENT'));s.once('error',e=>end(e.code==='ECONNREFUSED'?'ABSENT':'UNKNOWN'));
  });
  if(state!=='ABSENT')fail('runtime_port_not_absent');
}
async function noBrowser() {
  // Fixed native query: no paths, tokens, command lines or operator text enter code.
  const pending=exec('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',
      "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='METAENGINE Browser Test.exe'\" -ErrorAction Stop).Count"],
    {windowsHide:true,shell:false,timeout:60000,maxBuffer:4096,
      env:{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}});
  pending.child.stdin?.end();
  const {stdout}=await pending;
  if(String(stdout).trim()!=='0')fail('browser_must_be_closed');
}
export function assertKeeperIncarnation(actual, expected) {
  if(!actual||actual.state!=='PRESENT'||actual.source!=='OS_PROCESS_INVENTORY'||actual.authority_effect!==false
    ||actual.pid!==expected.pid||actual.created_at!==expected.created_at
    ||!samePath(actual.exe_path||'',expected.exe_path||'')) fail('keeper_incarnation_changed');
  return true;
}
export function makeUpgradeConfigs(old, { stateDirectory, candidateBundle, installedBundle, bundleDigest }) {
  if(old.postgres_mode!=='attached'||old.api_role_mode!=='direct'||!SHA.test(bundleDigest||''))fail('attached_configuration_required');
  const final=validateRuntimeHostConfig({...old,state_directory:stateDirectory,bundle_directory:installedBundle,expected_bundle_sha256:bundleDigest});
  const qualification=validateRuntimeHostConfig({...final,bundle_directory:candidateBundle});
  for(const k of ['database_url','inspect_database_url','pg_data_directory','expected_cluster_system_identifier','api_port','edge_port']) {
    if(final[k]!==old[k]||qualification[k]!==old[k])fail('database_binding_changed');
  }
  return {final,qualification};
}

async function candidate(options) {
  const resources=await physical(options['candidate-resources'],'directory'), archive=path.join(resources,'app.asar');
  if(await hashFile(archive)!==options['expected-asar-sha256'])fail('candidate_asar_mismatch');
  const asar=require('@electron/asar');
  const pkg=JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));
  if(pkg.version!==options['expected-version']||pkg.metaengineClientStateRuntime?.source_head_sha!==options['expected-source'])fail('candidate_identity_mismatch');
  const binding=pkg.metaengineClientStateRuntime;
  const verifierBytes=asar.extractFile(archive,path.normalize('infra/client-state-runtime/offline-runtime-bundle.mjs'));
  const {assertPackagedOfflineRuntimeBinding}=require('./offline-runtime-package-binding.cjs');
  await assertPackagedOfflineRuntimeBinding(binding,{expectedHead:options['expected-source'],packageVersion:pkg.version,resourcesDir:resources,verifierBytes});
  const verifier=await import('data:text/javascript;base64,'+verifierBytes.toString('base64'));
  const verified=await verifier.verifyOfflineRuntimeBundle({bundleDirectory:path.join(resources,'client-state-runtime'),expectedBundleDigest:binding.bundle_sha256});
  return {resources,binding,verified};
}
async function oldState(options) {
  const file=localStateProviderOwnerFile();if(!file)fail('owner_location_unknown');
  const bytes=await stableUpgradeRead(file);if(sha(bytes)!==options['expected-owner-sha256'])fail('owner_cas_mismatch');
  await acl(file);
  const owner=validateLocalStateProviderConfig(JSON.parse(bytes));if(!owner.runtime_host)fail('owner_runtime_unbound');
  const configBytes=await stableUpgradeRead(owner.runtime_host.config_file);await acl(owner.runtime_host.config_file);
  const config=validateRuntimeHostConfig(JSON.parse(configBytes));
  if(config.postgres_mode!=='attached'||config.api_role_mode!=='direct'
    ||config.expected_bundle_sha256!==owner.runtime_host.expected_bundle_sha256
    ||!samePath(owner.runtime_identity_file,path.join(config.state_directory,'runtime-instance.json'))
    ||!samePath(owner.runtime_host.bundle_directory,path.join(options['installed-resources'],'client-state-runtime'))) fail('predecessor_binding_mismatch');
  const statusBytes=await stableUpgradeRead(owner.runtime_identity_file), status=JSON.parse(statusBytes);
  if(status.schema!=='metaengine.client-state.runtime-status.v1'||status.state!=='STOPPED'||status.runtime_ready!==false
    ||status.children_stopped!==true||status.bundle_sha256!==config.expected_bundle_sha256||status.authority_effect!==false) fail('predecessor_not_stopped');
  await absent(path.join(config.state_directory,'runtime-host-lock.json'));
  return {file,bytes,owner,configBytes,config,statusBytes,status};
}
async function keeper(config) {
  const pidFile=path.join(config.pg_data_directory,'postmaster.pid'), vaultFile=path.join(config.pg_data_directory,'client-vault.key');
  const pidBytes=await stableUpgradeRead(pidFile), pid=Number(pidBytes.toString().split(/\r?\n/)[0]);
  const native=await readWindowsKernelProcessW60(pid);
  if(!native||native.state!=='PRESENT'||!native.exe_path?.toLowerCase().endsWith('\\postgres.exe'))fail('keeper_native_identity_unknown');
  const created=Date.parse(native.created_at), pgEpoch=Number(pidBytes.toString().split(/\r?\n/)[2])*1000;
  if(!Number.isFinite(created)||!Number.isFinite(pgEpoch)||Math.abs(created-pgEpoch)>5000)fail('keeper_birth_mismatch');
  await verifyWindowsTcpListener({port:Number(new URL(config.database_url).port),pid});
  return {pidfile_sha256:sha(pidBytes),vault_sha256:await hashFile(vaultFile),pid:native.pid,created_at:native.created_at,exe_path:native.exe_path};
}
async function keeperUnchanged(config,expected) {
  const observed=await keeper(config);assertKeeperIncarnation({...observed,state:'PRESENT',source:'OS_PROCESS_INVENTORY',authority_effect:false},expected);
  if(observed.pidfile_sha256!==expected.pidfile_sha256||observed.vault_sha256!==expected.vault_sha256)fail('keeper_bytes_changed');
}
async function quiescent(old) {
  await noBrowser();
  for(const pid of [old.status.host_pid,...(old.status.children||[]).map(c=>c.pid)]) {
    const native=await readWindowsKernelProcessW60(pid);
    // A recycled PID is safe only if its kernel birth is later than the old
    // status and it is unrelated to runtime. Never kill it to free an old slot.
    if(!native||native.state!=='NOT_RUNNING')fail('old_runtime_process_presence_unresolved');
  }
  for(const p of [old.config.api_port,old.config.edge_port])await portAbsent(p);
}
async function qualify(verified,configFile,owner) {
  let exited=false,exitCode=null,child;
  const stop=async()=>{
    if(exited)return true;
    if(child.connected)child.send({schema:'compute.runtime-host-control.v1',command:'stop'},()=>{});
    return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),45000);child.once('exit',()=>{clearTimeout(timer);resolve(true);});});
  };
  try {
    child=spawn(verified.paths.nodeExecutable,[verified.paths.hostEntry],{cwd:verified.paths.sourceRoot,
      env:localRuntimeHostEnvironment(configFile),stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,shell:false});
    child.once('exit',c=>{exited=true;exitCode=c;});
    const descriptor=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error('qa_upgrade_runtime_start_timeout')),180000);
      const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('exit',early);child.off('error',early);error?reject(error):resolve(value);};
      const message=value=>{if(value?.schema==='compute.runtime-host-provider.v1')finish(null,value);};
      const early=()=>finish(Error('qa_upgrade_runtime_start_failed'));
      child.on('message',message);child.once('exit',early);child.once('error',early);
    });
    const identity=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file));
    const admitted=validateLocalStateRuntimeIdentity(identity,owner.base_url);
    if(identity.host_pid!==child.pid||descriptor.instance_id!==admitted.instance_id||descriptor.status_file!==owner.runtime_identity_file
      ||descriptor.endpoint!==owner.base_url||descriptor.runtime_ready!==true||descriptor.authority_effect!==false||exited)fail('runtime_identity_unverified');
    const children=identity.children||[];
    for(const entry of children) {
      const config=JSON.parse(await stableUpgradeRead(configFile));
      const port=entry.name==='api'?config.api_port:entry.name==='edge'?config.edge_port:null;
      if(!port)fail('runtime_child_unverified');
      await verifyWindowsTcpListener({port,pid:entry.pid});
    }
    const response=await fetch(owner.base_url+'/health',{signal:AbortSignal.timeout(12000)}), health=await response.json();
    if(!response.ok||!localStateProviderHealthAttested(health,admitted.instance_id)||exited)fail('runtime_health_unattested');
    if(!await stop())fail('runtime_stop_unconfirmed');
    const stopped=JSON.parse(await stableUpgradeRead(owner.runtime_identity_file));
    if(exitCode!==0||stopped.state!=='STOPPED'||stopped.runtime_ready!==false||stopped.children_stopped!==true
      ||stopped.instance_id!==admitted.instance_id||stopped.host_pid!==child.pid)fail('runtime_stop_unattested');
    for(const c of children){const native=await readWindowsKernelProcessW60(c.pid);if(native?.state!=='NOT_RUNNING')fail('runtime_child_stop_unconfirmed');}
    return {host_pid:child.pid,instance_id:admitted.instance_id,exit_code:exitCode,children_stopped:true};
  } finally {if(child&&!exited&&!await stop())fail('runtime_cleanup_unconfirmed');}
}

export async function prepareUpgrade(options) {
  if(process.platform!=='win32')fail('windows_required');
  await absent(options.receipt);await privateReceiptRoot(options.receipt);
  const checked=await candidate(options), old=await oldState(options);await quiescent(old);
  const pg=await keeper(old.config);
  const stateDirectory=path.join(path.dirname(old.config.state_directory),'client-state-qa-upgrade-'+randomUUID());
  for(const root of [old.config.pg_data_directory,checked.resources,options['installed-resources']])if(inside(root,stateDirectory)||inside(stateDirectory,root))fail('state_boundary_invalid');
  await fs.mkdir(stateDirectory,{mode:0o700});await protectOwnerOnlyWindowsDirectory(stateDirectory);await acl(stateDirectory,true);
  const backupOwner=path.join(stateDirectory,'predecessor-owner.json'), backupConfig=path.join(stateDirectory,'predecessor-config.json');
  await exclusive(backupOwner,old.bytes);await exclusive(backupConfig,old.configBytes);await acl(backupOwner);await acl(backupConfig);
  const configs=makeUpgradeConfigs(old.config,{stateDirectory,candidateBundle:path.join(checked.resources,'client-state-runtime'),
    installedBundle:path.join(options['installed-resources'],'client-state-runtime'),bundleDigest:checked.binding.bundle_sha256});
  const configFile=path.join(stateDirectory,'installed-runtime-config.json'), qualificationFile=path.join(stateDirectory,'qualification-config.json');
  await exclusive(configFile,JSON.stringify(configs.final,null,2)+'\n');await exclusive(qualificationFile,JSON.stringify(configs.qualification,null,2)+'\n');
  await acl(configFile);await acl(qualificationFile);
  const proposed=validateLocalStateProviderConfig({...old.owner,runtime_identity_file:path.join(stateDirectory,'runtime-instance.json'),
    runtime_host:{bundle_directory:configs.final.bundle_directory,expected_bundle_sha256:checked.binding.bundle_sha256,config_file:configFile}});
  const runtime=await qualify(checked.verified,qualificationFile,proposed);
  await quiescent(old);await keeperUnchanged(old.config,pg);
  if(!(await stableUpgradeRead(old.file)).equals(old.bytes)||!(await stableUpgradeRead(old.owner.runtime_host.config_file)).equals(old.configBytes))fail('predecessor_changed');
  const receipt={schema:SCHEMA,state:'QUALIFIED_AND_STOPPED',created_at:new Date().toISOString(),
    source_head:options['expected-source'],package_version:options['expected-version'],candidate_resources:checked.resources,
    installed_resources:path.resolve(options['installed-resources']),asar_sha256:options['expected-asar-sha256'],bundle_sha256:checked.binding.bundle_sha256,
    old_owner_file:old.file,old_owner_sha256:sha(old.bytes),old_config_file:old.owner.runtime_host.config_file,old_config_sha256:sha(old.configBytes),
    old_status_file:old.owner.runtime_identity_file,old_status_sha256:sha(old.statusBytes),backup_owner_file:backupOwner,backup_config_file:backupConfig,
    config_file:configFile,config_sha256:sha(await stableUpgradeRead(configFile)),qualification_config_file:qualificationFile,
    state_directory:stateDirectory,proposed_provider:proposed,runtime,keeper:pg,
    production_authorized:false,provenance_verified:false,provider_published:false,historical_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false};
  await exclusive(options.receipt,JSON.stringify(receipt,null,2)+'\n');await acl(options.receipt);
  return {state:receipt.state,receipt_file:options.receipt,receipt_sha256:sha(await stableUpgradeRead(options.receipt)),provider_published:false,production_authorized:false};
}

export function assertUpgradeReceipt(receipt,options) {
  if(receipt?.schema!==SCHEMA||receipt.state!=='QUALIFIED_AND_STOPPED'||receipt.provider_published!==false
    ||receipt.production_authorized!==false||receipt.provenance_verified!==false||receipt.authority_effect!==false
    ||receipt.historical_effects_reconciled!==false||receipt.automatic_retry_allowed!==false
    ||receipt.source_head!==options['expected-source']||receipt.package_version!==options['expected-version']
    ||receipt.asar_sha256!==options['expected-asar-sha256']||receipt.old_owner_sha256!==options['expected-owner-sha256']
    ||!samePath(receipt.candidate_resources,options['candidate-resources'])||!samePath(receipt.installed_resources,options['installed-resources'])
    ||!SHA.test(receipt.bundle_sha256||'')||!SHA.test(receipt.config_sha256||'')||!SHA.test(receipt.old_config_sha256||'')
    ||receipt.runtime?.exit_code!==0||receipt.runtime?.children_stopped!==true)fail('receipt_unverified');
  return true;
}
// One descriptor transaction. A failed final readback restores the predecessor
// only while the exact descriptor written by this attempt is still present.
// Never overwrite another operator's concurrent publication during rollback.
export async function publishOwnerFile({ownerFile,stagedFile,oldBytes,nextBytes,rollbackFile},
  {verifyPublished=async()=>{}}={}) {
  if(!(await stableUpgradeRead(ownerFile)).equals(oldBytes))fail('owner_cas_mismatch');
  if(!(await stableUpgradeRead(stagedFile)).equals(nextBytes))fail('owner_stage_mismatch');
  if(path.parse(stagedFile).root.toLowerCase()!==path.parse(ownerFile).root.toLowerCase())fail('cross_volume_forbidden');
  await fs.rename(stagedFile,ownerFile);
  try {
    if(!(await stableUpgradeRead(ownerFile)).equals(nextBytes))fail('owner_readback_mismatch');
    await verifyPublished();
    return {state:'PUBLISHED_INSTALL_PENDING'};
  } catch(error) {
    if(!(await stableUpgradeRead(ownerFile)).equals(nextBytes))fail('publication_effect_unknown');
    await exclusive(rollbackFile,oldBytes);
    await fs.rename(rollbackFile,ownerFile);
    if(!(await stableUpgradeRead(ownerFile)).equals(oldBytes))fail('rollback_unconfirmed');
    error.rollbackConfirmed=true;
    throw error;
  }
}
export async function publishUpgrade(options) {
  if(process.platform!=='win32')fail('windows_required');
  await privateReceiptRoot(options.receipt);
  const proofBytes=await stableUpgradeRead(options.receipt);await acl(options.receipt);
  if(sha(proofBytes)!==options['expected-receipt-sha256'])fail('receipt_digest_mismatch');
  const proof=JSON.parse(proofBytes);assertUpgradeReceipt(proof,options);
  const checked=await candidate(options);if(checked.binding.bundle_sha256!==proof.bundle_sha256)fail('candidate_changed');
  const old=await oldState(options);await quiescent(old);await keeperUnchanged(old.config,proof.keeper);
  const proposed=validateLocalStateProviderConfig(proof.proposed_provider), finalBytes=await stableUpgradeRead(proof.config_file);
  const final=validateRuntimeHostConfig(JSON.parse(finalBytes));
  const expected=makeUpgradeConfigs(old.config,{stateDirectory:proof.state_directory,candidateBundle:path.join(checked.resources,'client-state-runtime'),
    installedBundle:path.join(options['installed-resources'],'client-state-runtime'),bundleDigest:proof.bundle_sha256}).final;
  if(JSON.stringify(final)!==JSON.stringify(expected)||sha(finalBytes)!==proof.config_sha256
    ||!samePath(proposed.runtime_host.config_file,proof.config_file)||proposed.runtime_host.expected_bundle_sha256!==proof.bundle_sha256
    ||!samePath(proposed.runtime_host.bundle_directory,expected.bundle_directory)||proposed.base_url!==old.owner.base_url
    ||!samePath(proposed.runtime_identity_file,path.join(proof.state_directory,'runtime-instance.json')))fail('successor_binding_changed');
  for(const [file,bytes] of [[proof.backup_owner_file,old.bytes],[proof.backup_config_file,old.configBytes]]) {
    if(!(await stableUpgradeRead(file)).equals(bytes))fail('backup_changed');await acl(file);
  }
  if(sha(old.configBytes)!==proof.old_config_sha256||sha(old.statusBytes)!==proof.old_status_sha256)fail('predecessor_evidence_changed');
  await acl(proof.state_directory,true);await acl(proof.config_file);
  const status=JSON.parse(await stableUpgradeRead(proposed.runtime_identity_file));
  if(status.state!=='STOPPED'||status.instance_id!==proof.runtime.instance_id||status.host_pid!==proof.runtime.host_pid
    ||status.runtime_ready!==false||status.children_stopped!==true||status.bundle_sha256!==proof.bundle_sha256)fail('qualification_state_changed');
  await absent(path.join(proof.state_directory,'runtime-host-lock.json'));
  const gate=old.file+'.qa-upgrade-gate.json', staged=path.join(proof.state_directory,'pending-owner-'+randomUUID()+'.json');
  await acl(path.dirname(old.file),true);
  await absent(gate); const nextBytes=Buffer.from(JSON.stringify(proposed,null,2)+'\n');
  await exclusive(staged,nextBytes);await acl(staged);
  const publicationFile=options.receipt+'.publication.json';await absent(publicationFile);
  const journal={schema:SCHEMA,state:'PUBLICATION_PREPARED',proof_sha256:sha(proofBytes),old_owner_sha256:sha(old.bytes),
    new_owner_sha256:sha(nextBytes),backup_owner_file:proof.backup_owner_file,owner_file:old.file,publication_gate:gate,
    installed_payload_verified:false,production_authorized:false,historical_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false};
  await exclusive(publicationFile,JSON.stringify(journal,null,2)+'\n');await acl(publicationFile);
  await exclusive(gate,JSON.stringify({schema:SCHEMA,nonce:randomUUID(),pid:process.pid,old_owner_sha256:sha(old.bytes),new_owner_sha256:sha(nextBytes)})+'\n');await acl(gate);
  await quiescent(old);await keeperUnchanged(old.config,proof.keeper);
  if(!(await stableUpgradeRead(old.file)).equals(old.bytes)||!(await stableUpgradeRead(options.receipt)).equals(proofBytes))fail('owner_cas_mismatch');
  // Publication deliberately precedes NSIS. The Browser must remain closed
  // until root verifies the whole installed candidate; rollback restores only
  // our exact new descriptor when installer replacement cannot be completed.
  try {
    await publishOwnerFile({ownerFile:old.file,stagedFile:staged,oldBytes:old.bytes,nextBytes,
      rollbackFile:path.join(proof.state_directory,'rollback-owner-'+randomUUID()+'.json')},
    {verifyPublished:async()=>{await acl(old.file);await keeperUnchanged(old.config,proof.keeper);}});
    journal.state='PUBLISHED_INSTALL_PENDING';journal.provider_published=true;
    await save(publicationFile,journal);
  } catch(error) {
    if(error.rollbackConfirmed===true) {
      journal.state='ROLLED_BACK';await save(publicationFile,journal);
    }
    throw error;
  }
  return {state:journal.state,publication_file:publicationFile,new_owner_sha256:journal.new_owner_sha256,
    launch_allowed:false,installed_payload_verified:false,production_authorized:false};
}
export async function rollbackUpgrade(options) {
  if(process.platform!=='win32')fail('windows_required');
  await privateReceiptRoot(options.receipt);
  const bytes=await stableUpgradeRead(options.receipt);await acl(options.receipt);
  if(sha(bytes)!==options['expected-receipt-sha256'])fail('receipt_digest_mismatch');
  const proof=JSON.parse(bytes);assertUpgradeReceipt(proof,options);
  const publicationFile=options.receipt+'.publication.json';
  await acl(publicationFile);
  const journal=JSON.parse(await stableUpgradeRead(publicationFile));
  if(journal.schema!==SCHEMA||journal.state!=='PUBLISHED_INSTALL_PENDING'||journal.proof_sha256!==sha(bytes))fail('rollback_receipt_invalid');
  await noBrowser();const oldBytes=await stableUpgradeRead(proof.backup_owner_file);await acl(proof.backup_owner_file);
  if(sha(oldBytes)!==proof.old_owner_sha256)fail('backup_changed');
  const current=await stableUpgradeRead(journal.owner_file);if(sha(current)!==journal.new_owner_sha256)fail('rollback_cas_mismatch');
  const config=validateRuntimeHostConfig(JSON.parse(await stableUpgradeRead(proof.backup_config_file)));
  for(const p of [config.api_port,config.edge_port])await portAbsent(p);await keeperUnchanged(config,proof.keeper);
  const staged=path.join(proof.state_directory,'rollback-owner-'+randomUUID()+'.json');await exclusive(staged,oldBytes);await acl(staged);
  if(!(await stableUpgradeRead(journal.owner_file)).equals(current))fail('rollback_cas_mismatch');
  await fs.rename(staged,journal.owner_file);
  if(!(await stableUpgradeRead(journal.owner_file)).equals(oldBytes))fail('rollback_unconfirmed');
  await acl(journal.owner_file);journal.state='ROLLED_BACK';await save(publicationFile,journal);
  return {state:'ROLLED_BACK',old_owner_sha256:proof.old_owner_sha256,production_authorized:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    const options=validateUpgradeArguments(process.argv.slice(2));
    const result=await ({prepare:prepareUpgrade,publish:publishUpgrade,rollback:rollbackUpgrade}[options.mode])(options);
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {
    const reason=/^[a-z][a-z0-9_]{1,160}$/.test(error?.message||'')?error.message:'qa_upgrade_operation_failed';
    process.stderr.write(JSON.stringify({state:'BLOCKED_REQUIRES_READBACK',reason,automatic_retry_allowed:false,production_authorized:false})+'\n');process.exitCode=1;
  }
}
