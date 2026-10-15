// W58: real, read-only NTFS DACL and file identity witness in the existing Host.
// No restore/dump/installer, mutable ACL, user path over IPC, or receipt trust.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyOwnerOnlyWindowsStorage} from './private-windows-storage-acl.mjs';

const run=promisify(execFile);
const SCHEMA='metaengine.client-backup-acl-native-w58.v1';
const unknown=(reason,diagnostic_phase='NONE')=>Object.freeze({schema:SCHEMA,state:'UNKNOWN',reason,
  // Bounded phase identifiers only. Never serialize OS errors, stderr, paths or ACL SDDL.
  diagnostic_phase,native_acl_verified:false,installed_owner_proven:false,backup_verified:false,
  upgrade_authorized:false,automatic_retry_allowed:false,authority_effect:false});
const safePhase=(e)=>{
  const phase=String(e?.stdout||'').match(/W72_ACL_PHASE_(?:START|ROOT|FILE|ACL|COMPLETE)/g)?.at(-1);
  if(phase)return phase.slice('W72_ACL_PHASE_'.length);
  const m=String(e?.message||'').match(/^private_windows_storage_([a-z_]+)$/);
  if(m)return 'STORAGE_'+m[1].slice(0,40).toUpperCase();
  if(e?.code==='ETIMEDOUT')return 'CHILD_TIMEOUT';
  if(e?.code==='ENOENT')return 'CHILD_NOT_FOUND';
  if(e?.message==='PHYSICAL_ALIAS')return 'PHYSICAL_ALIAS';
  if(e?.message==='REPARSE_ANCESTOR')return 'REPARSE_ANCESTOR';
  if(e?.message==='OWNER_FENCE_UNKNOWN')return 'OWNER_FENCE_UNKNOWN';
  return 'UNCLASSIFIED';
};
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>path.win32.normalize(x).toLowerCase();
const local=x=>typeof x==='string'&&x.length<2048&&/^[A-Za-z]:\\[^\\]/.test(x)
  &&!/[\x00-\x1f]/.test(x)&&!x.includes('/')
  &&!x.split('\\').slice(1).some(part=>part==='.'||part==='..'
    ||part.endsWith('.')||part.endsWith(' ')||part.includes(':'));
const same=(a,b)=>canonical(a)===canonical(b);
const fingerprint=st=>[st.dev,st.ino,st.nlink,st.size,st.birthtimeNs,st.mtimeNs].map(String).join('/');
const stable=(a,b)=>a.ino>0n&&a.nlink===1n&&b.nlink===1n&&fingerprint(a)===fingerprint(b);
function ownerFence(owner) {
  // A callback is Host-only, never request payload. This validates continuity
  // shape, NOT W52 native Owner attestation or a caller-supplied verified flag.
  if(!owner||owner.schema!=='metaengine.host.owner-incarnation.v1'
    ||owner.source!=='LOCAL_HOST_OWNER'||owner.authority_effect!==false
    ||!Number.isSafeInteger(owner.pid)||owner.pid<=0
    ||!Number.isSafeInteger(owner.generation)||owner.generation<1
    ||typeof owner.created_at!=='string'||!Number.isFinite(Date.parse(owner.created_at))
    ||!['owner_id','device_id','process_incarnation_id'].every(k=>
      typeof owner[k]==='string'&&/^[A-Za-z0-9_.:-]{8,128}$/.test(owner[k])))
    throw Error('OWNER_FENCE_UNKNOWN');
  return JSON.stringify([owner.owner_id,owner.device_id,owner.generation,
    owner.pid,new Date(owner.created_at).toISOString(),owner.process_incarnation_id]);
}

async function physical(target,type) {
  const st=await fs.lstat(target,{bigint:true});
  if(st.isSymbolicLink()||(type==='file'?!st.isFile():!st.isDirectory())
    ||!same(await fs.realpath(target),target))throw Error('PHYSICAL_ALIAS');
  return st;
}
async function ancestry(target) {
  let p=path.win32.parse(target).root;
  for(const segment of path.win32.relative(p,target).split('\\').filter(Boolean)) {
    p=path.win32.join(p,segment);
    if((await fs.lstat(p)).isSymbolicLink())throw Error('REPARSE_ANCESTOR');
  }
}
// Reads two native descriptors using the SAME SID policy as
// private-windows-storage-acl: current service SID, SYSTEM, Administrators.
// Rejects inherited grants even when the parent is otherwise allowed.
const powershell=`$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
Write-Output 'W72_ACL_PHASE_START'
$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($me,'S-1-5-18','S-1-5-32-544')|Select-Object -Unique
$required=@($me,'S-1-5-18')|Select-Object -Unique
$items=@()
# Explicit path/kind records avoid positional dependence. The historical nested arrays are valid in WinPS5.1.
$pairs=@(
  [pscustomobject]@{path=$env:METAENGINE_W58_ROOT;kind='DIRECTORY'},
  [pscustomobject]@{path=$env:METAENGINE_W58_FILE;kind='FILE'}
)
foreach($pair in $pairs){
  if($pair.kind -eq 'DIRECTORY'){Write-Output 'W72_ACL_PHASE_ROOT'}
  else{Write-Output 'W72_ACL_PHASE_FILE'}
  $i=Get-Item -LiteralPath $pair.path -Force
  if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'}
  if(($pair.kind -eq 'DIRECTORY') -ne $i.PSIsContainer){throw 'type'}
  $acl=Get-Acl -LiteralPath $pair.path
  Write-Output 'W72_ACL_PHASE_ACL'
  if(-not $acl.AreAccessRulesProtected){throw 'inheritance'}
  $sid=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if($sid -notin $allowed){throw 'owner'}
  $aces=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  foreach($ace in $aces){
    if($ace.IsInherited -or $ace.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){throw 'inherited_or_deny'}
    if($ace.IdentityReference.Value -notin $allowed){throw 'broad'}
    $rights=if($pair.kind -eq 'FILE' -and $ace.IdentityReference.Value -eq $me){
      [Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::WriteData
    }else{[Security.AccessControl.FileSystemRights]::FullControl}
    if(($ace.FileSystemRights -band $rights) -ne $rights){throw 'rights'}
  }
  foreach($req in $required){
    if(-not @($aces|Where-Object{$_.IdentityReference.Value -eq $req}).Count){throw 'required'}
  }
  $items+=@{owner_sid=$sid;sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}
}
if($items[0].owner_sid -ne $items[1].owner_sid){throw 'owner_changed'}
Write-Output 'W72_ACL_PHASE_COMPLETE'
@{service_sid=$me;root=$items[0];file=$items[1]}|ConvertTo-Json -Compress -Depth 4
`;
async function nativeAcl(root,file) {
  const win=process.env.SystemRoot||process.env.SYSTEMROOT||'';
  if(!/^[A-Za-z]:\\Windows$/i.test(win))throw Error('WIN_ROOT');
  const exe=path.win32.join(win,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const keys=['PATH','PATHEXT','COMSPEC','APPDATA','LOCALAPPDATA',
    'HOMEDRIVE','HOMEPATH','USERPROFILE','TEMP','TMP','ProgramFiles','ProgramData'];
  const env=Object.fromEntries(keys.filter(k=>typeof process.env[k]==='string'
    &&process.env[k].length<8192).map(k=>[k,process.env[k]]));
  Object.assign(env,{SystemRoot:win,SYSTEMROOT:win,WINDIR:win,
    PSModulePath:path.win32.join(win,'System32','WindowsPowerShell','v1.0','Modules'),
    METAENGINE_W58_ROOT:root,METAENGINE_W58_FILE:file});
  const {stdout}=await run(exe,['-NoProfile','-NonInteractive','-NoLogo','-EncodedCommand',
    Buffer.from(powershell,'utf16le').toString('base64')],{
    env,shell:false,windowsHide:true,timeout:120000,maxBuffer:8192});
  const data=JSON.parse(String(stdout).trim().split(/\r?\n/).at(-1));
  if(!/^S-1-\d+(?:-\d+)+$/.test(data?.service_sid||'')
    ||!/^S-1-\d+(?:-\d+)+$/.test(data?.root?.owner_sid||'')
    ||data.root.owner_sid!==data.file?.owner_sid
    ||![data.service_sid,'S-1-5-18','S-1-5-32-544'].includes(data.root.owner_sid)
    ||typeof data.root.sddl!=='string'||typeof data.file.sddl!=='string'
    ||data.root.sddl.length>2048||data.file.sddl.length>2048)
    throw Error('NATIVE_READBACK_INVALID');
  return {sid:data.root.owner_sid,service:data.service_sid,
    descriptor:hash(data.root.sddl+'\n'+data.file.sddl)};
}

// Only fixed Host paths. The optional callback is an adversarial race-test hook:
// it can change the observed object but cannot forge a positive descriptor.
export async function readClientBackupAclNativeW58({
  backupDirectory,archivePath,platform=process.platform,afterFirstRead=null,
  readOwnerIncarnation=null,
}={}) {
  if(platform!=='win32')return unknown('NATIVE_NTFS_UNSUPPORTED');
  if(!local(backupDirectory)||!local(archivePath)
    ||!same(archivePath,path.win32.join(backupDirectory,'postgresql-17-snapshot.dump')))
    return unknown('NATIVE_PATH_UNTRUSTED');
  try {
    if(readOwnerIncarnation!==null&&typeof readOwnerIncarnation!=='function')
      return unknown('OWNER_READER_UNTRUSTED');
    const owner0=readOwnerIncarnation?ownerFence(await readOwnerIncarnation()):null;
    await ancestry(archivePath);
    const root0=await physical(backupDirectory,'directory');
    const file0=await physical(archivePath,'file');
    // Never accept receipt.owner_dacl_verified or caller-supplied "verified".
    await verifyOwnerOnlyWindowsStorage(backupDirectory,{operation:'VERIFY_DIRECTORY'});
    await verifyOwnerOnlyWindowsStorage(archivePath,{operation:'VERIFY_PRIVATE_FILE'});
    const a=await nativeAcl(backupDirectory,archivePath);
    if(afterFirstRead)await afterFirstRead();
    const b=await nativeAcl(backupDirectory,archivePath);
    const root1=await physical(backupDirectory,'directory');
    const file1=await physical(archivePath,'file');
    await ancestry(archivePath);
    const owner1=readOwnerIncarnation?ownerFence(await readOwnerIncarnation()):null;
    if(owner0!==owner1)return unknown('OWNER_INCAR_CHANGED_DURING_ACL_READ');
    if(!stable(root0,root1)||!stable(file0,file1)
      ||a.sid!==b.sid||a.service!==b.service||a.descriptor!==b.descriptor)
      return unknown('NATIVE_ACL_OR_FILE_IDENTITY_CHANGED');
    return Object.freeze({schema:SCHEMA,state:'NATIVE_ACL_VERIFIED',
      reason:'INSTALLED_OWNER_PROOF_SEPARATELY_REQUIRED',
      native_acl_verified:true,owner_incarnation_continuity_only:owner0!==null,
      owner_sid:a.sid,service_sid:a.service,
      root_file_id_sha256:hash(fingerprint(root0)),archive_file_id_sha256:hash(fingerprint(file0)),
      native_dacl_sha256:a.descriptor,installed_owner_proven:false,backup_verified:false,
      upgrade_authorized:false,automatic_retry_allowed:false,authority_effect:false});
  }catch(error){return unknown('NATIVE_ACL_UNVERIFIED',safePhase(error));}
}
