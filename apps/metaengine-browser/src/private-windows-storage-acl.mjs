import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const done = 'METAENGINE_OWNER_DACL_VERIFIED';
// Cold WinPS/.NET startup on Windows CI can exceed 15 seconds before the
// first phase marker. Keep one bounded attempt; expiry still denies private
// storage use, and the phase markers identify where that attempt stopped.
const aclTimeoutMs = 120000;
const fail = code => { throw new Error('private_windows_storage_'+code); };
const absolute = value => typeof value === 'string' && path.isAbsolute(value)
  && value.length < 2048 && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);

// Fixed script; user-provided paths never become PowerShell code.
const aclScript = "$ErrorActionPreference='Stop'\nWrite-Output 'ACL_PHASE_SCRIPT_STARTED'\n$p=$env:METAENGINE_PRIVATE_ACL_TARGET\n$operation=$env:METAENGINE_PRIVATE_ACL_ACTION\nif([string]::IsNullOrEmpty($p) -or $p.StartsWith('\\\\') -or $operation -notin @('PROTECT_DIRECTORY','VERIFY_FILE','VERIFY_DIRECTORY')){throw 'arguments_invalid'}\nWrite-Output 'ACL_PHASE_GET_ITEM'\n$item=Get-Item -LiteralPath $p -Force -ErrorAction Stop\nif(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'alias_forbidden'}\nif(($operation -ne 'VERIFY_FILE') -ne $item.PSIsContainer){throw 'file_type_invalid'}\n$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$allowed=@($me,'S-1-5-18','S-1-5-32-544')|Select-Object -Unique\nif($operation -eq 'PROTECT_DIRECTORY'){\n  Write-Output 'ACL_PHASE_GET_ACL'\n  $acl=Get-Acl -LiteralPath $p -ErrorAction Stop\n  $acl.SetAccessRuleProtection($true,$false)\n  foreach($rule in @($acl.Access)){if(-not $rule.IsInherited){[void]$acl.RemoveAccessRuleSpecific($rule)}}\n  foreach($identity in $allowed){\n    $sid=[System.Security.Principal.SecurityIdentifier]::new($identity)\n    $flags=[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit\n    $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$flags,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)\n    [void]$acl.AddAccessRule($rule)\n  }\n  Write-Output 'ACL_PHASE_SET_ACL'\n  Set-Acl -LiteralPath $p -AclObject $acl -ErrorAction Stop\n}\nWrite-Output 'ACL_PHASE_READBACK'\n$final=Get-Acl -LiteralPath $p -ErrorAction Stop\nif($operation -eq 'PROTECT_DIRECTORY' -and -not $final.AreAccessRulesProtected){throw 'inheritance_not_disabled'}\n$rules=@($final.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))\nif($rules.Count -lt $allowed.Count){throw 'missing_required_aces'}\nforeach($rule in $rules){\n  if($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow){throw 'deny_or_unknown_ace'}\n  if($rule.IdentityReference.Value -notin $allowed){throw 'unapproved_grant'}\n  if(($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl){throw 'insufficient_rights'}\n}\nforeach($id in $allowed){\n  if(-not @($rules | Where-Object {$_.IdentityReference.Value -eq $id}).Count){throw 'required_ace_missing'}\n}\nWrite-Output 'ACL_PHASE_COMPLETED'\nWrite-Output 'METAENGINE_OWNER_DACL_VERIFIED'";

export async function verifyOwnerOnlyWindowsStorage(target,{
  operation='VERIFY_FILE',platform=process.platform,run=exec,env=process.env,
}={}){
  if(platform!=='win32' || !absolute(target)
    || !['PROTECT_DIRECTORY','VERIFY_FILE','VERIFY_DIRECTORY'].includes(operation))
    fail('arguments_invalid');
  const root=String(env.SystemRoot || env.SYSTEMROOT || '');
  if(!/^[A-Za-z]:\\Windows$/i.test(root))fail('windows_root_unverified');
  const exe=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  // Windows PowerShell auto-loads Get-Acl/Set-Acl from the trusted OS
  // Security module. Stripping PSModulePath/TEMP can stall module discovery
  // indefinitely on a clean CI image. Pin modules to SystemRoot, not the
  // caller's PATH or arbitrary per-user modules.
  const requiredSystemKeys=['PATH','PATHEXT','COMSPEC','APPDATA','LOCALAPPDATA',
    'HOMEDRIVE','HOMEPATH','USERPROFILE','TEMP','TMP','ProgramFiles','ProgramData'];
  const safeEnvironment=Object.fromEntries(requiredSystemKeys
    .filter(key=>typeof env[key]==='string' && env[key].length<8192)
    .map(key=>[key,env[key]]));
  const vars={...safeEnvironment,SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
    // Override any user-provided PSModulePath with trusted OS modules.
    PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'),
    TEMP:typeof env.TEMP==='string'?env.TEMP:path.win32.join(root,'Temp'),
    TMP:typeof env.TMP==='string'?env.TMP:path.win32.join(root,'Temp'),
    USERPROFILE:typeof env.USERPROFILE==='string'?env.USERPROFILE:root,
    METAENGINE_PRIVATE_ACL_TARGET:target,METAENGINE_PRIVATE_ACL_ACTION:operation};
  const safePhase = output=>{
    const stages=String(output||'').match(/ACL_PHASE_(?:SCRIPT_STARTED|GET_ITEM|GET_ACL|SET_ACL|READBACK|COMPLETED)/g);
    return String(stages?.at(-1)||'ACL_PHASE_NOT_STARTED').replace('ACL_PHASE_','').toLowerCase();
  };
  let stdout;
  try{
    ({stdout}=await run(exe,['-NoLogo','-NoProfile','-NonInteractive',
      '-EncodedCommand',Buffer.from(aclScript,'utf16le').toString('base64')],{
      env:vars,shell:false,windowsHide:true,timeout:aclTimeoutMs,maxBuffer:8192}));
  }catch(error){
    // Only predetermined phase IDs can reach error metadata. Raw stderr and
    // stdout may contain user profile paths, credentials or private PGDATA.
    if(error?.code==='ETIMEDOUT'||(error?.killed&&!error?.code))
      fail('powershell_timeout_'+safePhase(error?.stdout));
    if(error?.code==='ENOENT')fail('powershell_missing');
    fail('acl_not_confirmed_'+safePhase(error?.stdout));
  }
  if(String(stdout||'').trim().split(/\r?\n/).at(-1)!==done)
    fail('acl_not_confirmed_'+safePhase(stdout));
  const st=await fs.lstat(target).catch(()=>null);
  if(!st||st.isSymbolicLink()||(operation==='VERIFY_FILE'?!st.isFile():!st.isDirectory()))
    fail('physical_object_changed');
  return Object.freeze({owner_dacl_verified:true,operation});
}

export async function protectOwnerOnlyWindowsDirectory(target,options={}){
  return verifyOwnerOnlyWindowsStorage(target,{...options,operation:'PROTECT_DIRECTORY'});
}
