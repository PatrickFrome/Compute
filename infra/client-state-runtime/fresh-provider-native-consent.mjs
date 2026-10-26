import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
// This is a fresh, operation-local owner decision, not a durable credential or
// an argv authorization. Paths are data, never interpolated into program text.
const script=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
if(-not [Environment]::UserInteractive){throw 'interactive_owner_required'}
$parent=[System.Diagnostics.Process]::GetProcessById([int]$env:METAENGINE_CONSENT_PARENT_PID)
$self=[System.Diagnostics.Process]::GetCurrentProcess()
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
if($self.SessionId -eq 0 -or $parent.SessionId -ne $self.SessionId -or -not $identity.IsAuthenticated -or $identity.IsSystem){throw 'interactive_owner_required'}
$text="Create a NEW private METAENGINE PostgreSQL 17 database, application schema, Vault key and private credentials?"+[Environment]::NewLine+[Environment]::NewLine+"Protected database storage: "+$env:METAENGINE_CONSENT_STATE+[Environment]::NewLine+"Owner profile: "+$env:METAENGINE_CONSENT_OWNER+[Environment]::NewLine+[Environment]::NewLine+"Existing databases and device identities will not be replaced. For installed Browser setup, also register this Browser's protected device key as the FIRST local ADMIN using a signed request and private approval in this new database. Command-line schema setup alone does not register a device. ADMIN is not execution permission: Guardian verification, project admission and native execution permits remain separate. Interrupted setup requires review and will not be replayed automatically."
$result=[System.Windows.Forms.MessageBox]::Show($text,'METAENGINE — confirm private database creation',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Question,[System.Windows.Forms.MessageBoxDefaultButton]::Button2)
if($result -ne [System.Windows.Forms.DialogResult]::Yes){exit 2}
$parent.Refresh()
if($parent.HasExited -or $parent.SessionId -ne $self.SessionId){throw 'owner_process_changed'}
Write-Output 'METAENGINE_FRESH_NATIVE_OWNER_CONFIRMED'
`;
export async function confirmFreshProviderNativeConsent({stateDirectory,ownerFile}, {run=exec,env=process.env,platform=process.platform}={}) {
  // Same fixed OS installation rail as native owner producers: do not trust an
  // environment-selected executable. Nonstandard roots need a native resolver.
  const root='C:\\Windows';
  const declared=env.SystemRoot||env.SYSTEMROOT||'';
  if(platform!=='win32'||declared.toLowerCase()!==root.toLowerCase()
    ||[env.SystemRoot,env.SYSTEMROOT,env.WINDIR].some(value=>value!==undefined&&String(value).toLowerCase()!==root.toLowerCase())
    ||![stateDirectory,ownerFile].every(p=>typeof p==='string'&&path.isAbsolute(p)&&!/[\x00-\x1f]/.test(p)))throw Error('fresh_provider_native_consent_unavailable');
  const executable=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  let result;
  try {result=await run(executable,['-NoLogo','-NoProfile','-STA','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    env:{SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
      PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules'),
      METAENGINE_CONSENT_PARENT_PID:String(process.pid),METAENGINE_CONSENT_STATE:stateDirectory,METAENGINE_CONSENT_OWNER:ownerFile},
    cwd:path.win32.join(root,'System32'),shell:false,windowsHide:true,timeout:300000,maxBuffer:1024});
  }catch {throw Error('fresh_provider_native_consent_not_confirmed');}
  if(String(result.stdout).trim()!=='METAENGINE_FRESH_NATIVE_OWNER_CONFIRMED')throw Error('fresh_provider_native_consent_not_confirmed');
}
