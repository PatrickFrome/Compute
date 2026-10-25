import {createHash} from 'node:crypto';
import nativeFs from 'node:fs';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {validateLocalStateProviderConfig,localStateProviderOwnerFile} from './local-state-provider-policy.mjs';
import {validatePackagedLocalRuntimeBinding} from './local-runtime-host-controller.mjs';
import {verifyOwnerOnlyWindowsStorage} from './private-windows-storage-acl.mjs';
import {readRuntimeRecoveryProcess} from './runtime-recovery-process-adapter.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('runtime_recovery_installed_binding_unproven');};
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
// Electron's ordinary fs treats app.asar as a virtual directory. Custody pins
// require the physical archive and its metadata; package.json reads below must
// retain ASAR support. Never fall back to virtual fs inside Electron.
const physicalFs=process.versions.electron?createRequire(import.meta.url)('original-fs'):nativeFs;
const physical=physicalFs.promises;
async function regular(file,maximum) {
  if(typeof file!=='string'||!path.isAbsolute(file)||/^(?:\\\\|\/\/)/.test(file))fail();
  let current=path.parse(file).root;
  for(const segment of path.relative(current,file).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);if((await physical.lstat(current)).isSymbolicLink())fail();
  }
  const stat=await physical.lstat(file);
  if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>maximum||!samePath(await physical.realpath(file),file))fail();
  return stat;
}
const unchanged=(a,b)=>a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
async function bytes(file,maximum) {
  const before=await regular(file,maximum),value=await physical.readFile(file),after=await regular(file,maximum);
  if(!unchanged(before,after)||value.length!==before.size)fail();return value;
}
async function fileHash(file) {
  const before=await regular(file,1024*1024*1024),digest=createHash('sha256');
  for await(const chunk of physicalFs.createReadStream(file))digest.update(chunk);
  if(!unchanged(before,await regular(file,1024*1024*1024)))fail();return digest.digest('hex');
}
function postgresProof(value) {
  const keys=['schema','pid','version','system_identifier','started_at','data_directory_sha256','postmaster_pid_sha256','authority_effect','sha256'];
  if(!value||Object.keys(value).sort().join()!==keys.sort().join()
    ||value.schema!=='metaengine.client-state.postgres-continuity.v1'||!Number.isSafeInteger(value.pid)||value.pid<1
    ||!Number.isSafeInteger(value.version)||value.version<170000||value.version>=180000
    ||!/^[1-9][0-9]{15,19}$/.test(value.system_identifier||'')||!Number.isFinite(Date.parse(value.started_at))
    ||value.authority_effect!==false||['data_directory_sha256','postmaster_pid_sha256','sha256'].some(key=>!HASH.test(value[key]||'')))fail();
  // Rehydrate producer order explicitly; JSON/SQL field order is not authority.
  const ordered={schema:value.schema,pid:value.pid,version:value.version,system_identifier:value.system_identifier,
    started_at:value.started_at,data_directory_sha256:value.data_directory_sha256,postmaster_pid_sha256:value.postmaster_pid_sha256,authority_effect:false};
  if(hash(JSON.stringify(ordered))!==value.sha256)fail();return {...ordered,sha256:value.sha256};
}
function statusPin(value) {
  return JSON.stringify({schema:value.schema,bundle_sha256:value.bundle_sha256,host_pid:value.host_pid,
    instance_id:value.instance_id,state:value.state,runtime_ready:value.runtime_ready,authority_effect:value.authority_effect,
    postgres_continuity:postgresProof(value.postgres_continuity)});
}

// Native main closes over actual app/bootstrap/controller objects. No renderer
// selects a file, PID, bundle, profile, executable, database URL or proof.
export function createInstalledRuntimeRecoveryBindingReader({app,getBootstrap,readSummary,readGeneration,
  resourcesPath=process.resourcesPath,verifyStorage=verifyOwnerOnlyWindowsStorage,readProcess=readRuntimeRecoveryProcess,
  readPackage=async appPath=>JSON.parse(await fs.readFile(path.join(appPath,'package.json'),'utf8')),
  ownerFile=localStateProviderOwnerFile()}={}) {
  if(!app||[getBootstrap,readSummary,readGeneration,verifyStorage,readProcess].some(fn=>typeof fn!=='function'))fail();
  return async()=>{
    if(app.isPackaged!==true||!ownerFile)fail();
    const bootstrap=getBootstrap();
    if(bootstrap?.state!=='READY'||bootstrap.persistent!==true||!samePath(bootstrap.owner_file,ownerFile))fail();
    for(const [target,operation] of [[path.dirname(ownerFile),'VERIFY_DIRECTORY'],[ownerFile,'VERIFY_FILE']]) {
      if((await verifyStorage(target,{operation}))?.owner_dacl_verified!==true)fail();
    }
    // An operator install transaction and runtime recovery never overlap.
    try{await fs.lstat(ownerFile+'.qa-upgrade-gate.json');fail();}catch(error){if(error.code!=='ENOENT')throw error;}
    const ownerBytes=await bytes(ownerFile,16384),owner=validateLocalStateProviderConfig(JSON.parse(ownerBytes));
    if(!owner.runtime_host)fail();
    const appPath=app.getAppPath();if(!/[\\/]app\.asar$/i.test(appPath||''))fail();
    const pkg=await readPackage(appPath);
    const binding=validatePackagedLocalRuntimeBinding(pkg,{bundleDirectory:owner.runtime_host.bundle_directory,
      expectedBundleDigest:owner.runtime_host.expected_bundle_sha256,resourcesPath});
    if(pkg.version!==app.getVersion())fail();
    const manifest=await bytes(path.join(owner.runtime_host.bundle_directory,'offline-runtime-bundle.json'),8*1024*1024);
    if(hash(manifest)!==binding.bundle_manifest_sha256)fail();
    for(const [target,operation] of [[path.dirname(owner.runtime_identity_file),'VERIFY_DIRECTORY'],[owner.runtime_identity_file,'VERIFY_FILE']]) {
      if((await verifyStorage(target,{operation}))?.owner_dacl_verified!==true)fail();
    }
    const statusBytes=await bytes(owner.runtime_identity_file,128*1024),status=JSON.parse(statusBytes);
    if(status.schema!=='metaengine.client-state.runtime-status.v1'||status.bundle_sha256!==binding.bundle_sha256||status.authority_effect!==false)fail();
    const pg=postgresProof(status.postgres_continuity),physical=await readProcess(pg.pid);
    if(physical?.schema!=='metaengine.browser.runtime-recovery-process.v1'||physical.state!=='PRESENT'||physical.pid!==pg.pid
      ||physical.authority_effect!==false||!/^[1-9][0-9]{16,18}$/.test(physical.created_100ns||'')
      ||typeof physical.executable!=='string'||!/[\\/]postgres\.exe$/i.test(physical.executable))fail();
    const pgIdentity={proof_sha256:pg.sha256,pid:pg.pid,created_100ns:physical.created_100ns,
      executable:path.resolve(physical.executable).toLowerCase(),executable_sha256:await fileHash(physical.executable)};
    const summary=readSummary(),generation=await readGeneration();
    const ready=Boolean(summary&&generation?.ever_ready===true&&generation.exited===false&&generation.stopping===false
      &&generation.transport_failed===false&&generation.terminal===null&&generation.terminal_rejected===false
      &&generation.instance_id===summary.instance_id&&generation.host_pid===summary.pid
      &&status.state==='READY'&&status.runtime_ready===true&&status.host_pid===summary.pid&&status.instance_id===summary.instance_id
      &&bootstrap.instance_id===summary.instance_id);
    const asarSha256=await fileHash(appPath),lastPhysical=await readProcess(pg.pid);
    if(lastPhysical?.state!=='PRESENT'||lastPhysical.pid!==physical.pid||lastPhysical.created_100ns!==physical.created_100ns
      ||!samePath(lastPhysical.executable,physical.executable))fail();
    // Re-read after expensive image hashing, so Owner/status replacement cannot
    // authorize a relaunch using a mixed snapshot.
    if(!ownerBytes.equals(await bytes(ownerFile,16384))
      ||statusPin(status)!==statusPin(JSON.parse(await bytes(owner.runtime_identity_file,128*1024))))fail();
    if(ready&&readSummary()!==summary)fail();
    return Object.freeze({schema:'metaengine.browser.runtime-recovery-binding.v1',package_version:pkg.version,
      owner_sha256:hash(ownerBytes),asar_sha256:asarSha256,bundle_sha256:binding.bundle_sha256,
      bundle_manifest_sha256:binding.bundle_manifest_sha256,pg_identity_sha256:hash(JSON.stringify(pgIdentity)),
      normal_bootstrap_ready:ready,host:ready?{pid:summary.pid,instance_id:summary.instance_id,launch_nonce:generation.launch_nonce}:null});
  };
}
