import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixedWindowsNativeReadEnvironment} from './windows-native-read-environment.mjs';
const run=promisify(execFile);
const fail=code=>{throw new Error(`native_coding_observer_${code}`);};

// Fixed native inventory. The managed Process handle pins the kernel process
// while CIM supplies its token owner SID; no caller code/path is interpolated.
export async function readNativeCodingWindowsProcess(pid,{exec=run,platform=process.platform,signal}={}) {
  if(signal?.aborted)fail('request_cancelled');
  if(platform!=='win32'||!Number.isSafeInteger(pid)||pid<1||pid>0x7fffffff)fail('native_pid_invalid');
  const script=`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Microsoft.PowerShell.Core\\Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
Microsoft.PowerShell.Core\\Import-Module -Name 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\CimCmdlets\\CimCmdlets.psd1' -ErrorAction Stop
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
      {windowsHide:true,shell:false,timeout:15000,maxBuffer:16384,signal,env:{...fixedWindowsNativeReadEnvironment(),METAENGINE_NATIVE_CODING_PID:String(pid)}});
    pending.child?.stdin?.end();output=(await pending).stdout;
  }catch{if(signal?.aborted)fail('request_cancelled');fail('native_process_unavailable');}
  if(signal?.aborted)fail('request_cancelled');
  let value;try{value=JSON.parse(output.trim());}catch{fail('native_process_invalid');}
  if(value.pid!==pid||!/^S-1-\d+(?:-\d+)+$/.test(value.user_sid||'')||!/^[1-9]\d{16,18}$/.test(value.birth_100ns||''))fail('native_process_invalid');
  const created_at=new Date(value.created_at).toISOString();
  if((BigInt(value.birth_100ns)-116444736000000000n)/10000n!==BigInt(Date.parse(created_at)))fail('native_birth_mismatch');
  const exe=Buffer.from(value.exe_b64||'','base64');
  if(exe.toString('base64')!==value.exe_b64||!exe.length||exe.length>4096)fail('native_image_invalid');
  return Object.freeze({pid,created_at,process_incarnation_id:`pid:${pid}:created_100ns:${value.birth_100ns}`,
    exe_path:new TextDecoder('utf8',{fatal:true}).decode(exe),user_sid:value.user_sid});
}
