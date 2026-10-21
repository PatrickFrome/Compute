// Explicit operator-only entry for the fixed local Test installation. The
// shared native codec retains its disposable default and accepts no live path
// from an agent/renderer. Snapshots stay inside the private upgrade state.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertOperatorRecoveryPaths} from './qa-operator-install-recovery.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../src/private-windows-storage-acl.mjs';

const exec=promisify(execFile),SHA=/^[a-f0-9]{64}$/;
const fail=x=>{throw Error('qa_operator_nsis_'+x);};
export async function verifyOperatorNsisSnapshot({snapshot_directory,snapshot_sha256},expectedVersion){
  const hash=b=>createHash('sha256').update(b).digest('hex');
  const read=async name=>{
    const file=path.join(snapshot_directory,'snapshot',name),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<1||stat.size>262144)fail('snapshot_file_invalid');
    return fs.readFile(file);
  };
  const bytes=await read('manifest.json');if(hash(bytes)!==snapshot_sha256)fail('snapshot_digest_mismatch');
  const m=JSON.parse(bytes);
  if(m.schema!=='metaengine.operator.qa-nsis-effects.v1'||m.operator_version!==expectedVersion)fail('snapshot_binding_invalid');
  for(const [name,key] of [['registry.json','registry_sha256'],['start-menu.lnk','start_menu_sha256'],['desktop.lnk','desktop_sha256']]){
    if(!SHA.test(m[key]||'')||hash(await read(name))!==m[key])fail('snapshot_content_changed');
  }
  return true;
}
export function assertOperatorNsisReceipt(value,mode){
  const state={Capture:'SNAPSHOT_VERIFIED',Observe:'OBSERVED',Restore:'RESTORED_EXTERNAL_EFFECTS_VERIFIED'}[mode];
  if(value?.schema!=='metaengine.operator.qa-nsis-effects.v1'||value.state!==state
    ||value.classification!=='OPERATOR_LOCAL_QA'||value.production_authorized!==false
    ||value.owner_mutated!==false||value.guardian_mutated!==false||value.postgres_mutated!==false
    ||value.automatic_retry_allowed!==false||value.authority_effect!==false
    ||!SHA.test(value.external_effects_sha256||'')
    ||(mode!=='Observe'&&!SHA.test(value.snapshot_sha256||'')))fail('receipt_unverified');
  return value;
}
export async function operatorNsisEffects({mode,stateDirectory,expectedVersion,expectedSnapshotSha256,expectedPreimageSha256}){
  if(process.platform!=='win32'||!['Capture','Observe','Restore'].includes(mode)
    ||!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(expectedVersion||''))fail('arguments_invalid');
  const installedRoot=path.join(process.env.LOCALAPPDATA||'','Programs','METAENGINE Browser Test');
  assertOperatorRecoveryPaths({installedRoot,stateDirectory,
    snapshotRoot:path.join(stateDirectory,'predecessor-image-snapshot','image')});
  if((await verifyOwnerOnlyWindowsStorage(stateDirectory,{operation:'VERIFY_DIRECTORY'})).owner_dacl_verified!==true)fail('private_acl_unverified');
  const directory=path.join(stateDirectory,'predecessor-nsis');
  if(mode==='Capture'){
    await fs.mkdir(directory,{recursive:false,mode:0o700});
    if((await protectOwnerOnlyWindowsDirectory(directory)).owner_dacl_verified!==true)fail('private_acl_unverified');
  }
  if((await verifyOwnerOnlyWindowsStorage(directory,{operation:'VERIFY_DIRECTORY'})).owner_dacl_verified!==true)fail('private_acl_unverified');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',
    fileURLToPath(new URL('./qa-disposable-nsis-effects.ps1',import.meta.url)),
    '-OperatorSnapshotDirectory',directory,'-OperatorExpectedVersion',expectedVersion,'-Mode',mode];
  if(mode==='Restore'){
    if(![expectedSnapshotSha256,expectedPreimageSha256].every(x=>SHA.test(x||'')))fail('digest_required');
    args.push('-ExpectedSnapshotSha256',expectedSnapshotSha256,'-ExpectedPreimageSha256',expectedPreimageSha256);
  }
  let raw;
  try{
    const pending=exec('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',args,
      {shell:false,windowsHide:true,timeout:90000,maxBuffer:8192,
        env:{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'}});
    pending.child.stdin?.end();raw=(await pending).stdout;
  }catch{fail('native_operation_unconfirmed_requires_readback');}
  let value;try{value=JSON.parse(raw.trim());}catch{fail('native_json_invalid');}
  assertOperatorNsisReceipt(value,mode);
  if(mode==='Restore'&&(value.snapshot_sha256!==expectedSnapshotSha256
    ||value.preimage_sha256!==expectedPreimageSha256))fail('receipt_binding_changed');
  return Object.freeze({...value,snapshot_directory:directory});
}
