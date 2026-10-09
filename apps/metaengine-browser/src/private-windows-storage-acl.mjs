import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const done = 'METAENGINE_OWNER_DACL_VERIFIED';
// The physical Windows CI failure was a killed child at 30,053 ms, before
// the first ACL receipt. Bound cold WinPS startup/readback independently of
// the ACL policy; a timeout still blocks every subsequent private copy.
const aclTimeoutMs = 120000;
const fail = code => { throw new Error('private_windows_storage_'+code); };
const absolute = value => typeof value === 'string' && path.isAbsolute(value)
  && value.length < 2048 && !/^(?:\\\\|\/\/)/.test(value) && !/[\x00-\x1f]/.test(value);

// Fixed script; user-provided paths never become PowerShell code.
const aclScript = "$ErrorActionPreference='Stop'\n$p=$env:METAENGINE_PRIVATE_ACL_TARGET\n$operation=$env:METAENGINE_PRIVATE_ACL_ACTION\nif([string]::IsNullOrEmpty($p) -or $p.StartsWith('\\\\') -or $operation -notin @('PROTECT_DIRECTORY','VERIFY_FILE','VERIFY_DIRECTORY')){throw 'arguments_invalid'}\n$item=Get-Item -LiteralPath $p -Force -ErrorAction Stop\nif(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'alias_forbidden'}\nif(($operation -ne 'VERIFY_FILE') -ne $item.PSIsContainer){throw 'file_type_invalid'}\n$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$allowed=@($me,'S-1-5-18','S-1-5-32-544')|Select-Object -Unique\nif($operation -eq 'PROTECT_DIRECTORY'){\n  $acl=Get-Acl -LiteralPath $p -ErrorAction Stop\n  $acl.SetAccessRuleProtection($true,$false)\n  foreach($rule in @($acl.Access)){if(-not $rule.IsInherited){[void]$acl.RemoveAccessRuleSpecific($rule)}}\n  foreach($identity in $allowed){\n    $sid=[System.Security.Principal.SecurityIdentifier]::new($identity)\n    $flags=[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit\n    $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$flags,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)\n    [void]$acl.AddAccessRule($rule)\n  }\n  Set-Acl -LiteralPath $p -AclObject $acl -ErrorAction Stop\n}\n$final=Get-Acl -LiteralPath $p -ErrorAction Stop\nif($operation -eq 'PROTECT_DIRECTORY' -and -not $final.AreAccessRulesProtected){throw 'inheritance_not_disabled'}\n$rules=@($final.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))\nif($rules.Count -lt $allowed.Count){throw 'missing_required_aces'}\nforeach($rule in $rules){\n  if($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow){throw 'deny_or_unknown_ace'}\n  if($rule.IdentityReference.Value -notin $allowed){throw 'unapproved_grant'}\n  if(($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl){throw 'insufficient_rights'}\n}\nforeach($id in $allowed){\n  if(-not @($rules | Where-Object {$_.IdentityReference.Value -eq $id}).Count){throw 'required_ace_missing'}\n}\nWrite-Output 'METAENGINE_OWNER_DACL_VERIFIED'";

export async function verifyOwnerOnlyWindowsStorage(target,{
  operation='VERIFY_FILE',platform=process.platform,run=exec,env=process.env,
}={}){
  if(platform!=='win32' || !absolute(target)
    || !['PROTECT_DIRECTORY','VERIFY_FILE','VERIFY_DIRECTORY'].includes(operation))
    fail('arguments_invalid');
  const root=String(env.SystemRoot || env.SYSTEMROOT || '');
  if(!/^[A-Za-z]:\\Windows$/i.test(root))fail('windows_root_unverified');
  const exe=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const vars={SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
    // Never resolve modules from an inherited, user-controlled PSModulePath.
    PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'),
    METAENGINE_PRIVATE_ACL_TARGET:target,METAENGINE_PRIVATE_ACL_ACTION:operation};
  // WinPS/.NET startup may need the owner's profile and writable TEMP on a
  // cold Windows runner. Pass only these filesystem locations; credentials,
  // tokens, loader options, arbitrary modules and PATH are not inherited.
  for(const key of ['USERPROFILE','TEMP','TMP','HOMEPATH']){
    const value=env[key];
    if(typeof value==='string' && value.length<2048 && !/[\x00-\x1f]/.test(value)
      && !/^(?:\\\\|\/\/)/.test(value)
      && (key==='HOMEPATH'?/^\\[^\\]/.test(value):path.win32.isAbsolute(value)))vars[key]=value;
  }
  if(typeof env.HOMEDRIVE==='string' && /^[A-Za-z]:$/.test(env.HOMEDRIVE))vars.HOMEDRIVE=env.HOMEDRIVE;
  let stdout;
  try{
    ({stdout}=await run(exe,['-NoLogo','-NoProfile','-NonInteractive',
      '-EncodedCommand',Buffer.from(aclScript,'utf16le').toString('base64')],{
      env:vars,shell:false,windowsHide:true,timeout:aclTimeoutMs,maxBuffer:8192}));
  }catch(error){
    // execFile reports its timeout as a killed SIGTERM child with no exit
    // code. Keep script/transport failures separate without exposing stderr.
    fail(error?.killed===true && error.signal==='SIGTERM' && error.code===null
      ? 'acl_timeout' : 'acl_script_failed');
  }
  if(String(stdout||'').trim()!==done)fail('acl_not_confirmed');
  const st=await fs.lstat(target).catch(()=>null);
  if(!st||st.isSymbolicLink()||(operation==='VERIFY_FILE'?!st.isFile():!st.isDirectory()))
    fail('physical_object_changed');
  return Object.freeze({owner_dacl_verified:true,operation});
}

export async function protectOwnerOnlyWindowsDirectory(target,options={}){
  return verifyOwnerOnlyWindowsStorage(target,{...options,operation:'PROTECT_DIRECTORY'});
}
