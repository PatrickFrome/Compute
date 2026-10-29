import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
const execute=promisify(execFile);
const fail=reason=>{throw Error('native_coding_selector_move_'+reason);};
const absolute=value=>typeof value==='string'&&value.length<2048&&/^[A-Za-z]:\\/.test(value)
 &&!/[\x00-\x1f]/.test(value)&&!value.slice(2).includes(':')&&path.win32.normalize(value)===value;
const script=`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
try {
 [System.IO.File]::Move($env:METAENGINE_SELECTOR_SOURCE,$env:METAENGINE_SELECTOR_DESTINATION)
 [Console]::Out.WriteLine('METAENGINE_SELECTOR_PUBLISHED')
} catch [System.IO.IOException] {
 if ([System.IO.File]::Exists($env:METAENGINE_SELECTOR_DESTINATION)) {
  [Console]::Out.WriteLine('METAENGINE_SELECTOR_EXISTS')
 } else { [Environment]::Exit(1) }
}`;
// Existing native setup only. Both names are fixed-purpose, same-directory and
// verified by the caller. File.Move without overwrite removes the staging name
// atomically: a crash cannot leave the final selector with a second hard link.
export async function publishNativeSeedSelectorWindows(source,destination,{requestContext,platform=process.platform,run=execute,env=process.env}={}){
 assertNativeCodingHostRequestOpen(requestContext);
 if(platform!=='win32')fail('windows_required');
 if(!absolute(source)||!absolute(destination)||path.win32.dirname(source).toLowerCase()!==path.win32.dirname(destination).toLowerCase()
  ||!/^\.native-seed-selector-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(path.win32.basename(source))
  ||path.win32.basename(destination)!=='native-coding-seed-operator-v1.json'||typeof run!=='function')fail('paths_invalid');
 const systemRoot=env.SystemRoot||env.SYSTEMROOT;
 if(typeof systemRoot!=='string'||!/^[A-Za-z]:\\Windows$/i.test(systemRoot))fail('system_root_unverified');
 const timeout=requestContext?.deadlineAt===undefined?30000:Math.min(30000,requestContext.deadlineAt-Date.now());
 assertNativeCodingHostRequestOpen(requestContext);
 let result;
 try{result=await run(path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
  ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
  {shell:false,windowsHide:true,timeout,maxBuffer:4096,signal:requestContext?.signal,
   env:{SystemRoot:systemRoot,WINDIR:systemRoot,METAENGINE_SELECTOR_SOURCE:source,METAENGINE_SELECTOR_DESTINATION:destination}});
 }catch{assertNativeCodingHostRequestOpen(requestContext);fail('native_operation_unconfirmed');}
 assertNativeCodingHostRequestOpen(requestContext);
 const marker=String(result?.stdout||'').trim();
 if(marker==='METAENGINE_SELECTOR_PUBLISHED')return true;
 if(marker==='METAENGINE_SELECTOR_EXISTS')return false;
 fail('native_result_unconfirmed');
}
