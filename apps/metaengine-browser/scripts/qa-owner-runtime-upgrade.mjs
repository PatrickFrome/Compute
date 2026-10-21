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
import { verifyOfflineRuntimeBundle } from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import { captureInstalledTreeFingerprint, INSTALLED_TREE_SCHEMA } from './qa-installed-tree-fingerprint.mjs';
import { stagePrivateQaImageSnapshot, QA_IMAGE_SNAPSHOT_SCHEMA } from './qa-installed-image-snapshot.mjs';
import { observeWindowsNsisEffects, assertNsisEffectsObserved, assertNsisEffectsRestored } from './qa-nsis-external-effects.mjs';
import { localRuntimeHostEnvironment } from '../src/local-runtime-host-controller.mjs';
import { localStateProviderOwnerFile, validateLocalStateProviderConfig,
  validateLocalStateRuntimeIdentity, localStateProviderHealthAttested } from '../src/local-state-provider-policy.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from '../src/private-windows-storage-acl.mjs';
import { readWindowsKernelProcessW60 } from '../src/host-native-owner-producers-w60.mjs';
import { verifyWindowsTcpListener } from './verify-windows-tcp-listener.mjs';
import { compareQaInstalledImage, restoreOperatorQaImage } from './qa-operator-install-recovery.mjs';
import { operatorNsisEffects, assertOperatorNsisReceipt, verifyOperatorNsisSnapshot } from './qa-operator-nsis-recovery.mjs';
import { QA_UPGRADE_ADMISSION_SCHEMA, qaUpgradeAdmissionFile, assertQaUpgradeAdmission } from '../src/local-provider-upgrade-admission.mjs';

const require = createRequire(import.meta.url), exec = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/, HEAD = /^[a-f0-9]{40}$/;
const SCHEMA = 'metaengine.operator.qa-owner-runtime-upgrade.v3';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error('qa_upgrade_' + code); };
const samePath = (a,b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (parent, child) => { const r=path.relative(parent,child); return r==='' || (!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep)); };

export function validateUpgradeArguments(args) {
  const options={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i]?.replace(/^--/,''), value=args[i+1];
    if(!['mode','candidate-resources','installed-resources','expected-version','expected-source',
      'expected-asar-sha256','expected-owner-sha256','receipt','expected-receipt-sha256',
      'predecessor-binding','expected-predecessor-asar-sha256','expected-predecessor-bundle-sha256',
      'expected-uninstaller-sha256','expected-current-image-tree-sha256','expected-current-nsis-sha256',
      'expected-current-image-presence','expected-current-image-preimage-sha256'].includes(key)
      ||!args[i].startsWith('--')||!value||Object.hasOwn(options,key)) fail('arguments_invalid');
    options[key]=value;
  }
  if(!['prepare','publish','finalize','recover','rollback'].includes(options.mode)
    ||!['candidate-resources','installed-resources','receipt'].every(k=>typeof options[k]==='string'&&path.isAbsolute(options[k])&&!/^(?:\\\\|\/\/)/.test(options[k]))
    ||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(options['expected-version']||'')
    ||!HEAD.test(options['expected-source']||'')
    ||!['expected-asar-sha256','expected-owner-sha256'].every(k=>SHA.test(options[k]||''))
    ||inside(options['candidate-resources']||'.',options.receipt||'.')
    ||inside(options['installed-resources']||'.',options.receipt||'.')
    ||(options.mode!=='prepare'&&!SHA.test(options['expected-receipt-sha256']||''))
    ||(options.mode==='finalize'&&!SHA.test(options['expected-uninstaller-sha256']||''))
    ||(options.mode==='recover'&&(!SHA.test(options['expected-current-nsis-sha256']||'')
      ||!['PRESENT','ABSENT','EMPTY'].includes(options['expected-current-image-presence']||'PRESENT')
      ||((options['expected-current-image-presence']||'PRESENT')==='PRESENT'
        ?!SHA.test(options['expected-current-image-tree-sha256']||'')||options['expected-current-image-preimage-sha256']!==undefined
        :!SHA.test(options['expected-current-image-preimage-sha256']||'')||options['expected-current-image-tree-sha256']!==undefined)))) fail('arguments_invalid');
  predecessorReadPolicy(options);
  return options;
}

// An explicit byte-pinned recovery preserves a broken installation as a fenced
// rollback target. It never converts its mismatching Owner into an admission.
export function predecessorReadPolicy(options) {
  const mode=options['predecessor-binding'];
  const asar=options['expected-predecessor-asar-sha256'];
  const bundle=options['expected-predecessor-bundle-sha256'];
  if(mode===undefined&&asar===undefined&&bundle===undefined)return {mode:'owner-bound'};
  if(mode!=='preserve-fenced'||!SHA.test(asar||'')||!SHA.test(bundle||''))
    fail('predecessor_recovery_pins_required');
  return {mode,asar_sha256:asar,bundle_sha256:bundle};
}
export function classifyPredecessorBinding(image,ownerBundleDigest,policy={mode:'owner-bound'}) {
  if(!SHA.test(ownerBundleDigest||'')||!SHA.test(image?.asar_sha256||'')
    ||!SHA.test(image?.bundle_sha256||''))fail('predecessor_owner_pin_invalid');
  if(!policy||typeof policy!=='object'||Array.isArray(policy))fail('predecessor_recovery_policy_invalid');
  if(policy.mode==='owner-bound') {
    if(Object.keys(policy).length!==1)fail('predecessor_recovery_policy_invalid');
    if(image.bundle_sha256!==ownerBundleDigest)fail('predecessor_owner_package_mismatch');
    return Object.freeze({state:'OWNER_BOUND',owner_bundle_sha256:ownerBundleDigest,
      restore_admits_runtime:false,authority_effect:false});
  }
  if(policy.mode!=='preserve-fenced'||Object.keys(policy).length!==3
    ||!SHA.test(policy.asar_sha256||'')||!SHA.test(policy.bundle_sha256||''))
    fail('predecessor_recovery_policy_invalid');
  if(image.asar_sha256!==policy.asar_sha256||image.bundle_sha256!==policy.bundle_sha256)
    fail('predecessor_recovery_preimage_changed');
  if(image.bundle_sha256===ownerBundleDigest)fail('predecessor_recovery_not_fenced');
  return Object.freeze({state:'OWNER_DIGEST_MISMATCH_FENCED',owner_bundle_sha256:ownerBundleDigest,
    restore_admits_runtime:false,authority_effect:false});
}
function validStoredPredecessorBinding(image) {
  const binding=image?.owner_binding;
  if(!binding||Object.keys(binding).length!==4||!SHA.test(binding.owner_bundle_sha256||'')
    ||binding.restore_admits_runtime!==false||binding.authority_effect!==false)return false;
  return binding.state==='OWNER_BOUND'?image.bundle_sha256===binding.owner_bundle_sha256:
    binding.state==='OWNER_DIGEST_MISMATCH_FENCED'&&image.bundle_sha256!==binding.owner_bundle_sha256;
}
function assertPredecessorBindingReceipt(image,options) {
  const binding=image?.owner_binding;
  const expected=classifyPredecessorBinding(image,binding?.owner_bundle_sha256,predecessorReadPolicy(options));
  if(!validStoredPredecessorBinding(image)||binding.state!==expected.state
    ||binding.owner_bundle_sha256!==expected.owner_bundle_sha256)
    fail('predecessor_binding_receipt_invalid');
  return true;
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
// Old Owner must only be restored together with the *same* physically verified
// application image. Restoring a JSON descriptor after NSIS changed app.asar is
// not rollback; it can strand the runtime in an incompatible generation.
export function assertPredecessorImageMatches(expected, actual) {
  if (!expected || !actual
    || !SHA.test(expected.asar_sha256 || '') || !SHA.test(actual.asar_sha256 || '')
    || !SHA.test(expected.bundle_sha256 || '') || !SHA.test(actual.bundle_sha256 || '')
    || !SHA.test(expected.executable_sha256 || '') || !SHA.test(actual.executable_sha256 || '')
    || expected.schema !== INSTALLED_TREE_SCHEMA || actual.schema !== INSTALLED_TREE_SCHEMA
    || !SHA.test(expected.tree_sha256 || '') || !SHA.test(actual.tree_sha256 || '')
    || !Number.isSafeInteger(expected.file_count) || expected.file_count < 1
    || !Number.isSafeInteger(actual.file_count) || actual.file_count < 1
    || !Number.isSafeInteger(expected.total_bytes) || expected.total_bytes < 1
    || !Number.isSafeInteger(actual.total_bytes) || actual.total_bytes < 1
    || !HEAD.test(expected.source_head || '') || !HEAD.test(actual.source_head || '')
    || typeof expected.package_version !== 'string' || expected.package_version !== actual.package_version
    || expected.tree_sha256 !== actual.tree_sha256
    || expected.file_count !== actual.file_count
    || expected.total_bytes !== actual.total_bytes
    || expected.executable_sha256 !== actual.executable_sha256
    || expected.asar_sha256 !== actual.asar_sha256
    || expected.bundle_sha256 !== actual.bundle_sha256
    || expected.source_head !== actual.source_head
    || JSON.stringify(expected.owner_binding) !== JSON.stringify(actual.owner_binding)
    || !validStoredPredecessorBinding(expected) || !validStoredPredecessorBinding(actual)
    || expected.owner_binding.restore_admits_runtime !== false
    || actual.owner_binding.restore_admits_runtime !== false
    || expected.owner_binding.authority_effect !== false
    || actual.owner_binding.authority_effect !== false) fail('predecessor_image_not_restored');
  return true;
}
export async function readPredecessorImage(installedResources, ownerBundleDigest, policy={mode:'owner-bound'}) {
  if (!SHA.test(ownerBundleDigest || '')) fail('predecessor_owner_pin_invalid');
  const resources = await physical(installedResources, 'directory');
  const archive = path.join(resources, 'app.asar');
  const asarSha256 = await hashFile(archive);
  const executableSha256 = await hashFile(path.join(path.dirname(resources), 'METAENGINE Browser Test.exe'));
  let pkg;
  try {
    const asar = require('@electron/asar');
    pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  } catch { fail('predecessor_asar_unreadable'); }
  const binding = pkg?.metaengineClientStateRuntime;
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(pkg?.version || '')
    || !HEAD.test(binding?.source_head_sha || '') || !SHA.test(binding?.bundle_sha256 || ''))
    fail('predecessor_package_identity_invalid');
  const image = Object.freeze({ asar_sha256: asarSha256, executable_sha256: executableSha256, package_version: pkg.version,
    source_head: binding.source_head_sha, bundle_sha256: binding.bundle_sha256 });
  const ownerBinding=classifyPredecessorBinding(image,ownerBundleDigest,policy);
  // Use the trusted source verifier, never execute JS extracted from the
  // potentially replaced installer payload.
  try {
    await verifyOfflineRuntimeBundle({ bundleDirectory: path.join(resources, 'client-state-runtime'),
      expectedBundleDigest: image.bundle_sha256 });
  } catch { fail('predecessor_bundle_unverified'); }
  // Fingerprint the full NSIS install image (including native resources and
  // uninstaller), not only Electron EXE/ASAR and the runtime payload.
  const tree=await captureInstalledTreeFingerprint(path.dirname(resources));
  return Object.freeze({...image,...tree,owner_binding:ownerBinding});
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
  const image=await captureInstalledTreeFingerprint(path.dirname(resources));
  return {resources,binding,verified,image};
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
  const checked=await candidate(options), old=await oldState(options);
  const predecessorImage=await readPredecessorImage(options['installed-resources'],old.owner.runtime_host.expected_bundle_sha256,predecessorReadPolicy(options));
  const predecessorNsis=await observeWindowsNsisEffects({expectedVersion:predecessorImage.package_version});
  await quiescent(old);
  const pg=await keeper(old.config);
  const stateDirectory=path.join(path.dirname(old.config.state_directory),'client-state-qa-upgrade-'+randomUUID());
  for(const root of [old.config.pg_data_directory,checked.resources,options['installed-resources']])if(inside(root,stateDirectory)||inside(stateDirectory,root))fail('state_boundary_invalid');
  await fs.mkdir(stateDirectory,{mode:0o700});await protectOwnerOnlyWindowsDirectory(stateDirectory);await acl(stateDirectory,true);
  const snapshotContainer=path.join(stateDirectory,'predecessor-image-snapshot');
  await fs.mkdir(snapshotContainer,{mode:0o700});
  await protectOwnerOnlyWindowsDirectory(snapshotContainer);await acl(snapshotContainer,true);
  const predecessorSnapshot=await stagePrivateQaImageSnapshot({
    installedRoot:path.dirname(options['installed-resources']),snapshotContainer});
  if(predecessorSnapshot.tree_sha256!==predecessorImage.tree_sha256
    ||predecessorSnapshot.file_count!==predecessorImage.file_count
    ||predecessorSnapshot.total_bytes!==predecessorImage.total_bytes)fail('snapshot_predecessor_mismatch');
  const predecessorNsisSnapshot=await operatorNsisEffects({mode:'Capture',stateDirectory,
    expectedVersion:predecessorImage.package_version});
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
    candidate_image:checked.image,predecessor_image:predecessorImage,predecessor_snapshot:predecessorSnapshot,
    predecessor_nsis_snapshot:predecessorNsisSnapshot,
    predecessor_nsis_effects:predecessorNsis,
    production_authorized:false,provenance_verified:false,provider_published:false,historical_effects_reconciled:false,automatic_retry_allowed:false,authority_effect:false};
  await exclusive(options.receipt,JSON.stringify(receipt,null,2)+'\n');await acl(options.receipt);
  return {state:receipt.state,receipt_file:options.receipt,receipt_sha256:sha(await stableUpgradeRead(options.receipt)),provider_published:false,production_authorized:false};
}

function validNsisPredecessorReceipt(proof,version) {
  try {return assertNsisEffectsObserved(proof,version)===true;}
  catch {return false;}
}
function validNsisSnapshot(proof,stateDirectory){
  try{return assertOperatorNsisReceipt(proof,'Capture')===proof
    &&samePath(proof.snapshot_directory,path.join(stateDirectory,'predecessor-nsis'));}catch{return false;}
}
export function assertUpgradeReceipt(receipt,options) {
  if(receipt?.schema!==SCHEMA||receipt.state!=='QUALIFIED_AND_STOPPED'||receipt.provider_published!==false
    ||receipt.production_authorized!==false||receipt.provenance_verified!==false||receipt.authority_effect!==false
    ||receipt.historical_effects_reconciled!==false||receipt.automatic_retry_allowed!==false
    ||receipt.source_head!==options['expected-source']||receipt.package_version!==options['expected-version']
    ||receipt.asar_sha256!==options['expected-asar-sha256']||receipt.old_owner_sha256!==options['expected-owner-sha256']
    ||!samePath(receipt.candidate_resources,options['candidate-resources'])||!samePath(receipt.installed_resources,options['installed-resources'])
    ||!SHA.test(receipt.bundle_sha256||'')||!SHA.test(receipt.config_sha256||'')||!SHA.test(receipt.old_config_sha256||'')
    ||receipt.runtime?.exit_code!==0||receipt.runtime?.children_stopped!==true
    ||receipt.candidate_image?.schema!==INSTALLED_TREE_SCHEMA
    ||!SHA.test(receipt.candidate_image?.tree_sha256||'')
    ||!Number.isSafeInteger(receipt.candidate_image?.file_count)||receipt.candidate_image.file_count<1
    ||!Number.isSafeInteger(receipt.candidate_image?.total_bytes)||receipt.candidate_image.total_bytes<1
    ||!validNsisSnapshot(receipt.predecessor_nsis_snapshot,receipt.state_directory)
    ||!SHA.test(receipt.predecessor_image?.asar_sha256 || '')
    ||!SHA.test(receipt.predecessor_image?.bundle_sha256 || '')
    ||!SHA.test(receipt.predecessor_image?.executable_sha256 || '')
    ||receipt.predecessor_image?.schema !== INSTALLED_TREE_SCHEMA
    ||!SHA.test(receipt.predecessor_image?.tree_sha256 || '')
    ||!Number.isSafeInteger(receipt.predecessor_image?.file_count) || receipt.predecessor_image.file_count < 1
    ||!Number.isSafeInteger(receipt.predecessor_image?.total_bytes) || receipt.predecessor_image.total_bytes < 1
    ||!HEAD.test(receipt.predecessor_image?.source_head || '')
    ||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(receipt.predecessor_image?.package_version || '')
    ||receipt.predecessor_snapshot?.schema!==QA_IMAGE_SNAPSHOT_SCHEMA
    ||receipt.predecessor_snapshot?.tree_sha256!==receipt.predecessor_image.tree_sha256
    ||receipt.predecessor_snapshot?.file_count!==receipt.predecessor_image.file_count
    ||receipt.predecessor_snapshot?.total_bytes!==receipt.predecessor_image.total_bytes
    ||receipt.predecessor_snapshot?.copied_tree_verified!==true
    ||receipt.predecessor_snapshot?.source_unchanged!==true
    ||receipt.predecessor_snapshot?.installed_mutated!==false
    ||receipt.predecessor_snapshot?.restore_authorized!==false
    ||receipt.predecessor_snapshot?.production_authorized!==false
    ||receipt.predecessor_snapshot?.authority_effect!==false
    ||receipt.predecessor_nsis_effects?.version!==receipt.predecessor_image?.package_version
    ||!validNsisPredecessorReceipt(receipt.predecessor_nsis_effects,receipt.predecessor_image?.package_version)
    ||!samePath(receipt.predecessor_snapshot?.image_directory||'.',path.join(receipt.state_directory,'predecessor-image-snapshot','image'))
    ||!samePath(receipt.predecessor_snapshot?.receipt_file||'.',path.join(receipt.state_directory,'predecessor-image-snapshot','snapshot-proof.json')))
    fail('receipt_unverified');
  try {assertPredecessorBindingReceipt(receipt.predecessor_image,options);}
  catch {fail('receipt_unverified');}
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
  if(JSON.stringify(checked.image)!==JSON.stringify(proof.candidate_image))fail('candidate_image_changed');
  const old=await oldState(options);
  assertPredecessorImageMatches(proof.predecessor_image,
    await readPredecessorImage(options['installed-resources'],old.owner.runtime_host.expected_bundle_sha256,predecessorReadPolicy(options)));
  assertNsisEffectsRestored(proof.predecessor_nsis_effects,
    await observeWindowsNsisEffects({expectedVersion:proof.predecessor_image.package_version}));
  await acl(proof.predecessor_snapshot.image_directory,true);
  await acl(proof.predecessor_snapshot.receipt_file);
  const stagedPredecessor=await captureInstalledTreeFingerprint(proof.predecessor_snapshot.image_directory);
  if(stagedPredecessor.tree_sha256!==proof.predecessor_image.tree_sha256
    ||stagedPredecessor.file_count!==proof.predecessor_image.file_count
    ||stagedPredecessor.total_bytes!==proof.predecessor_image.total_bytes)fail('predecessor_snapshot_changed');
  await quiescent(old);await keeperUnchanged(old.config,proof.keeper);
  await verifyOperatorNsisSnapshot(proof.predecessor_nsis_snapshot,proof.predecessor_image.package_version);
  const nsisNow=await operatorNsisEffects({mode:'Observe',stateDirectory:proof.state_directory,expectedVersion:proof.predecessor_image.package_version});
  if(nsisNow.external_effects_sha256!==proof.predecessor_nsis_snapshot.external_effects_sha256)fail('nsis_predecessor_changed');
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
  const gateBytes=Buffer.from(JSON.stringify({schema:SCHEMA,nonce:randomUUID(),pid:process.pid,old_owner_sha256:sha(old.bytes),new_owner_sha256:sha(nextBytes)})+'\n');
  await exclusive(gate,gateBytes);await acl(gate);
  journal.publication_gate_sha256=sha(gateBytes);await save(publicationFile,journal);
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

export function assertPendingPublication(journal,proof,proofDigest,ownerFile){
  if(journal?.schema!==SCHEMA||journal.state!=='PUBLISHED_INSTALL_PENDING'||journal.provider_published!==true
    ||journal.proof_sha256!==proofDigest||journal.old_owner_sha256!==proof.old_owner_sha256
    ||!SHA.test(journal.new_owner_sha256||'')||!SHA.test(journal.publication_gate_sha256||'')
    ||!samePath(journal.owner_file||'.',ownerFile)||!samePath(journal.publication_gate||'.',ownerFile+'.qa-upgrade-gate.json')
    ||!samePath(journal.backup_owner_file||'.',proof.backup_owner_file||'.')
    ||journal.production_authorized!==false||journal.historical_effects_reconciled!==false
    ||journal.automatic_retry_allowed!==false||journal.authority_effect!==false)fail('publication_receipt_invalid');
  return true;
}
async function pendingUpgrade(options){
  await privateReceiptRoot(options.receipt);await acl(options.receipt);
  const bytes=await stableUpgradeRead(options.receipt);if(sha(bytes)!==options['expected-receipt-sha256'])fail('receipt_digest_mismatch');
  const proof=JSON.parse(bytes);assertUpgradeReceipt(proof,options);
  const publicationFile=options.receipt+'.publication.json';await acl(publicationFile);
  const journal=JSON.parse(await stableUpgradeRead(publicationFile));
  assertPendingPublication(journal,proof,sha(bytes),localStateProviderOwnerFile());
  return {proof,bytes,publicationFile,journal};
}
async function pendingCustody(journal){
  const owner=await stableUpgradeRead(journal.owner_file),gate=await stableUpgradeRead(journal.publication_gate);
  await acl(journal.owner_file);await acl(journal.publication_gate);
  if(sha(owner)!==journal.new_owner_sha256||sha(gate)!==journal.publication_gate_sha256)fail('publication_cas_changed');
  let g;try{g=JSON.parse(gate);}catch{fail('publication_gate_invalid');}
  if(g.schema!==SCHEMA||g.old_owner_sha256!==journal.old_owner_sha256||g.new_owner_sha256!==journal.new_owner_sha256)fail('publication_gate_invalid');
  return {owner,gate};
}
export async function completeUpgradeFiles({ownerFile,gateFile,terminalFile,retiredGateFile,
  expectedOwnerSha256,expectedGateSha256,receipt},{verify=async()=>{},protect=async()=>{}}={}){
  await absent(terminalFile);await absent(retiredGateFile);
  const check=async()=>{
    if(sha(await stableUpgradeRead(ownerFile))!==expectedOwnerSha256
      ||sha(await stableUpgradeRead(gateFile))!==expectedGateSha256)fail('publication_cas_changed');
    await verify();
  };
  await check();
  // A durable exact-image receipt exists BEFORE the admission gate is retired.
  await exclusive(terminalFile,JSON.stringify({...receipt,launch_allowed:false,gate_retired:false},null,2)+'\n');
  await protect(terminalFile);await check();
  await fs.rename(gateFile,retiredGateFile);await protect(retiredGateFile);
  if(sha(await stableUpgradeRead(retiredGateFile))!==expectedGateSha256
    ||sha(await stableUpgradeRead(ownerFile))!==expectedOwnerSha256)fail('finalization_effect_unknown');
  await verify();
  return {...receipt,launch_allowed:false,gate_retired:true,admission_commit_required:true};
}
// The admission marker is the sole last commit point. Gate retirement and the
// earlier completion receipt still deny launch, including after a crash.
export async function commitUpgradeAdmission({ownerFile,gateFile,completionFile,admission},
  {verify=async()=>{},protect=async()=>{}}={}){
  const ownerBytes=await stableUpgradeRead(ownerFile),owner=validateLocalStateProviderConfig(JSON.parse(ownerBytes));
  assertQaUpgradeAdmission(admission,{owner,ownerBytes});
  const markerFile=qaUpgradeAdmissionFile(owner),markerBytes=Buffer.from(JSON.stringify(admission,null,2)+'\n');
  if(!markerFile)fail('admission_state_directory_invalid');
  const check=async()=>{
    await absent(gateFile);await absent(markerFile);
    if(sha(await stableUpgradeRead(ownerFile))!==admission.owner_sha256)fail('publication_cas_changed');
    const completedBytes=await stableUpgradeRead(completionFile);
    if(sha(completedBytes)!==admission.completed_receipt_sha256)fail('completion_receipt_changed');
    const completed=JSON.parse(completedBytes);
    if(completed.state!=='INSTALLED_VERIFIED'||completed.installed_payload_verified!==true
      ||completed.launch_allowed!==false||completed.gate_retired!==true||completed.admission_commit_required!==true
      ||completed.owner_sha256!==admission.owner_sha256||completed.bundle_sha256!==admission.bundle_sha256
      ||completed.source_head!==admission.source_head||completed.package_version!==admission.package_version
      ||completed.installed_asar_sha256!==admission.installed_asar_sha256
      ||completed.installed_image?.installed_tree_sha256!==admission.installed_tree_sha256
      ||completed.production_authorized!==false||completed.authority_effect!==false)fail('completion_receipt_unverified');
    await verify();
  };
  await check();
  const staged=markerFile+'.'+randomUUID()+'.tmp';await exclusive(staged,markerBytes);await protect(staged);
  if(sha(await stableUpgradeRead(staged))!==sha(markerBytes))fail('admission_staged_changed');
  await check();
  await fs.rename(staged,markerFile);
  // Nothing that can reject admission follows this atomic commit. A caller
  // interrupted here must read this immutable record instead of replaying.
  return {admission_file:markerFile,admission_sha256:sha(markerBytes),launch_allowed:true};
}
export async function finalizeUpgrade(options){
  if(process.platform!=='win32')fail('windows_required');
  const {proof,publicationFile,journal}=await pendingUpgrade(options);
  const checked=await candidate(options);
  if(checked.binding.bundle_sha256!==proof.bundle_sha256
    ||JSON.stringify(checked.image)!==JSON.stringify(proof.candidate_image))fail('candidate_image_changed');
  const configBytes=await stableUpgradeRead(proof.config_file);await acl(proof.config_file);
  if(sha(configBytes)!==proof.config_sha256)fail('successor_config_changed');
  const config=validateRuntimeHostConfig(JSON.parse(configBytes));
  let verifiedImage;
  const verify=async()=>{await noBrowser();await keeperUnchanged(config,proof.keeper);
    for(const port of [config.api_port,config.edge_port])await portAbsent(port);
    if(verifiedImage&&(await captureInstalledTreeFingerprint(path.dirname(options['installed-resources']))).tree_sha256!==verifiedImage.installed_tree_sha256)
      fail('installed_image_changed');};
  await verify();await pendingCustody(journal);
  // Reuse the complete runtime verifier with the ACTUAL installed resource root.
  await candidate({...options,'candidate-resources':options['installed-resources']});
  const image=await compareQaInstalledImage(path.dirname(checked.resources),path.dirname(options['installed-resources']),
    {expectedUninstallerSha256:options['expected-uninstaller-sha256']});
  verifiedImage=image;
  const nsis=await observeWindowsNsisEffects({expectedVersion:proof.package_version});
  const receipt={schema:SCHEMA,state:'INSTALLED_VERIFIED',proof_sha256:journal.proof_sha256,
    source_head:proof.source_head,package_version:proof.package_version,owner_sha256:journal.new_owner_sha256,
    bundle_sha256:proof.bundle_sha256,installed_asar_sha256:proof.asar_sha256,
    installed_image:image,nsis_effects:nsis,keeper:proof.keeper,installed_payload_verified:true,
    production_authorized:false,provenance_verified:false,historical_effects_reconciled:false,
    automatic_retry_allowed:false,authority_effect:false};
  const terminalFile=options.receipt+'.installed.json';
  const completed=await completeUpgradeFiles({ownerFile:journal.owner_file,gateFile:journal.publication_gate,
    terminalFile,retiredGateFile:path.join(proof.state_directory,'completed-upgrade-gate.json'),
    expectedOwnerSha256:journal.new_owner_sha256,expectedGateSha256:journal.publication_gate_sha256,receipt},
    {verify,protect:async file=>acl(file)});
  journal.state='INSTALLED_VERIFIED';journal.installed_payload_verified=true;journal.gate_retired=true;
  journal.installed_receipt_sha256=sha(await stableUpgradeRead(terminalFile));
  await save(publicationFile,journal);
  // This receipt still denies launch; only the last atomic admission marker
  // below permits the new QA state to bootstrap.
  const completionFile=options.receipt+'.completed.json';await exclusive(completionFile,JSON.stringify(completed,null,2)+'\n');await acl(completionFile);
  const completionSha=sha(await stableUpgradeRead(completionFile));
  const admission={schema:QA_UPGRADE_ADMISSION_SCHEMA,state:'INSTALLED_VERIFIED',
    owner_sha256:journal.new_owner_sha256,bundle_sha256:proof.bundle_sha256,
    proof_sha256:journal.proof_sha256,completed_receipt_sha256:completionSha,
    source_head:proof.source_head,package_version:proof.package_version,
    installed_asar_sha256:proof.asar_sha256,installed_tree_sha256:image.installed_tree_sha256,
    publication_gate_sha256:journal.publication_gate_sha256,launch_allowed:true,gate_retired:true,
    production_authorized:false,provenance_verified:false,automatic_retry_allowed:false,authority_effect:false};
  const committed=await commitUpgradeAdmission({ownerFile:journal.owner_file,gateFile:journal.publication_gate,completionFile,admission},
    {verify,protect:async file=>acl(file)});
  return {state:completed.state,completion_file:completionFile,completion_sha256:completionSha,
    ...committed,installed_payload_verified:true,production_authorized:false};
}
export async function recoverUpgrade(options){
  if(process.platform!=='win32')fail('windows_required');
  const {proof,journal}=await pendingUpgrade(options);
  const bytes=await stableUpgradeRead(proof.backup_config_file);await acl(proof.backup_config_file);
  if(sha(bytes)!==proof.old_config_sha256)fail('backup_changed');
  const config=validateRuntimeHostConfig(JSON.parse(bytes));
  const verify=async()=>{await noBrowser();await pendingCustody(journal);await keeperUnchanged(config,proof.keeper);
    for(const port of [config.api_port,config.edge_port])await portAbsent(port);};
  await verify();await verifyOperatorNsisSnapshot(proof.predecessor_nsis_snapshot,proof.predecessor_image.package_version);
  const observed=await operatorNsisEffects({mode:'Observe',stateDirectory:proof.state_directory,expectedVersion:proof.predecessor_image.package_version});
  if(observed.external_effects_sha256!==options['expected-current-nsis-sha256'])fail('nsis_preimage_changed');
  await restoreOperatorQaImage({installedRoot:path.dirname(options['installed-resources']),stateDirectory:proof.state_directory,
    snapshotRoot:proof.predecessor_snapshot.image_directory,expectedSnapshotSha256:proof.predecessor_image.tree_sha256,
    expectedPreimagePresence:options['expected-current-image-presence']||'PRESENT',
    expectedPreimageSha256:(options['expected-current-image-presence']||'PRESENT')==='PRESENT'
      ?options['expected-current-image-tree-sha256']:options['expected-current-image-preimage-sha256'],beforeMutation:verify});
  await verify();
  await operatorNsisEffects({mode:'Restore',stateDirectory:proof.state_directory,expectedVersion:proof.predecessor_image.package_version,
    expectedSnapshotSha256:proof.predecessor_nsis_snapshot.snapshot_sha256,expectedPreimageSha256:options['expected-current-nsis-sha256']});
  await verify();
  return rollbackUpgrade(options);
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
  assertPendingPublication(journal,proof,sha(bytes),localStateProviderOwnerFile());await pendingCustody(journal);
  await noBrowser();
  // NSIS is non-atomic. Refuse Owner-only rollback unless the predecessor
  // application image AND complete offline runtime were independently restored.
  // UNKNOWN is terminal for automatic replay; preserve the published Owner.
  try {
    assertPredecessorImageMatches(proof.predecessor_image,
      await readPredecessorImage(options['installed-resources'],proof.predecessor_image.owner_binding.owner_bundle_sha256,predecessorReadPolicy(options)));
  } catch {
    journal.state='EFFECT_UNKNOWN_IMAGE_NOT_RESTORED';
    await save(publicationFile,journal);
    fail('predecessor_image_not_restored');
  }
  // NSIS registry and Start Menu link are external installer effects. Never
  // publish an Owner-only rollback if these are still changed or unverified.
  try {
    assertNsisEffectsRestored(proof.predecessor_nsis_effects,
      await observeWindowsNsisEffects({expectedVersion:proof.predecessor_image.package_version}));
  } catch {
    journal.state='EFFECT_UNKNOWN_EXTERNAL_EFFECTS_NOT_RESTORED';
    await save(publicationFile,journal);
    fail('predecessor_nsis_effects_not_restored');
  }
  const oldBytes=await stableUpgradeRead(proof.backup_owner_file);await acl(proof.backup_owner_file);
  if(sha(oldBytes)!==proof.old_owner_sha256)fail('backup_changed');
  const current=await stableUpgradeRead(journal.owner_file);if(sha(current)!==journal.new_owner_sha256)fail('rollback_cas_mismatch');
  const config=validateRuntimeHostConfig(JSON.parse(await stableUpgradeRead(proof.backup_config_file)));
  for(const p of [config.api_port,config.edge_port])await portAbsent(p);await keeperUnchanged(config,proof.keeper);
  const staged=path.join(proof.state_directory,'rollback-owner-'+randomUUID()+'.json');await exclusive(staged,oldBytes);await acl(staged);
  if(!(await stableUpgradeRead(journal.owner_file)).equals(current))fail('rollback_cas_mismatch');
  await fs.rename(staged,journal.owner_file);
  if(!(await stableUpgradeRead(journal.owner_file)).equals(oldBytes))fail('rollback_unconfirmed');
  await acl(journal.owner_file);journal.state='ROLLED_BACK';await save(publicationFile,journal);
  if(sha(await stableUpgradeRead(journal.publication_gate))!==journal.publication_gate_sha256)fail('publication_gate_invalid');
  const retiredGate=path.join(proof.state_directory,'rolled-back-upgrade-gate.json');await absent(retiredGate);
  await fs.rename(journal.publication_gate,retiredGate);await acl(retiredGate);
  return {state:'ROLLED_BACK',old_owner_sha256:proof.old_owner_sha256,launch_allowed:false,production_authorized:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    const options=validateUpgradeArguments(process.argv.slice(2));
    const result=await ({prepare:prepareUpgrade,publish:publishUpgrade,finalize:finalizeUpgrade,recover:recoverUpgrade,rollback:rollbackUpgrade}[options.mode])(options);
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch(error) {
    const reason=/^[a-z][a-z0-9_]{1,160}$/.test(error?.message||'')?error.message:'qa_upgrade_operation_failed';
    process.stderr.write(JSON.stringify({state:'BLOCKED_REQUIRES_READBACK',reason,automatic_retry_allowed:false,production_authorized:false})+'\n');process.exitCode=1;
  }
}
