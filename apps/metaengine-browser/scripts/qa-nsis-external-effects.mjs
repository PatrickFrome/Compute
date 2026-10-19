#!/usr/bin/env node
// Read-only Windows NSIS HKCU uninstall-entry + Start Menu and Desktop links.
// Never exports raw registry strings, user profile paths or shortcuts.
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const NSIS_EFFECTS_SCHEMA='metaengine.browser.qa-nsis-external-effects.v2';
const SHA=/^[a-f0-9]{64}$/;
const VERSION=/^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const fail=code=>{throw new Error('qa_nsis_effects_'+code);};
const script=String.raw`$ErrorActionPreference='Stop'
$version=$env:METAENGINE_QA_NSIS_EXPECTED_VERSION
$install=Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test'
$app=Join-Path $install 'METAENGINE Browser Test.exe'
$uninstall=Join-Path $install 'Uninstall METAENGINE Browser Test.exe'
$shortcut=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\METAENGINE Browser Test.lnk'
$desktopRoot=[Environment]::GetFolderPath('Desktop')
if(-not [IO.Path]::IsPathRooted($desktopRoot)){throw 'desktop_location_unknown'}
$desktopShortcut=Join-Path $desktopRoot 'METAENGINE Browser Test.lnk'
$root='Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Sha([string]$s) {
  $b=[System.Text.Encoding]::UTF8.GetBytes($s)
  $h=[System.Security.Cryptography.SHA256]::Create()
  try {return [BitConverter]::ToString($h.ComputeHash($b)).Replace('-','').ToLowerInvariant()}
  finally {$h.Dispose()}
}
try {
  $found=@(Get-ChildItem -LiteralPath $root -ErrorAction Stop | ForEach-Object {
    $p=Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop
    if([string]$p.DisplayName -like 'METAENGINE Browser Test *'){
      [pscustomobject]@{key=$_.PSChildName;data=$p}
    }
  })
  if($found.Count -ne 1){throw 'uninstall_entry_count_invalid'}
  $entry=$found[0];$data=$entry.data
  if([string]$data.DisplayName -cne ('METAENGINE Browser Test '+$version) -or
     [string]$data.DisplayVersion -cne $version){throw 'uninstall_version_mismatch'}
  $values=@('DisplayName','DisplayVersion','UninstallString','QuietUninstallString','DisplayIcon','Publisher','InstallLocation')
  $fields=@($entry.key)
  foreach($k in $values){
    $value=[string]$data.$k
    if($value.Length -gt 2048){throw 'uninstall_registry_value_oversized'}
    $fields+=($k+':'+$value.Length+':'+$value)
  }
  $uninstallString=[string]$data.UninstallString
  if($uninstallString -notlike ('*'+[IO.Path]::GetFileName($uninstall)+'*')){throw 'uninstall_command_unbound'}
  if(-not (Test-Path -LiteralPath $app -PathType Leaf) -or
     -not (Test-Path -LiteralPath $uninstall -PathType Leaf)){throw 'installed_executables_missing'}
  function Read-Shortcut([string]$file) {
    $item=Get-Item -LiteralPath $file -Force -ErrorAction Stop
    if($item.PSIsContainer -or $item.Length -lt 1 -or $item.Length -gt 262144 -or
       ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'shortcut_not_physical'}
    $w=New-Object -ComObject WScript.Shell
    $link=$null
    try {$link=$w.CreateShortcut($file);$target=[string]$link.TargetPath}
    finally {
      if($null -ne $link){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($link)}
      if($null -ne $w){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)}
    }
    if(-not [string]::Equals([IO.Path]::GetFullPath($target),[IO.Path]::GetFullPath($app),
      [StringComparison]::OrdinalIgnoreCase)){throw 'shortcut_target_mismatch'}
    $stream=[IO.File]::OpenRead($file)
    try {
      $h=[Security.Cryptography.SHA256]::Create()
      try {return [BitConverter]::ToString($h.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
      finally {$h.Dispose()}
    }finally {$stream.Dispose()}
  }
  $linkDigest=Read-Shortcut $shortcut
  $desktopDigest=Read-Shortcut $desktopShortcut
  [pscustomobject]@{schema='metaengine.browser.qa-nsis-external-effects.v2';state='OBSERVED';
    version=$version;registry_entry_count=1;shortcut_count=2;shortcut_target_bound=$true;desktop_shortcut_target_bound=$true;
    uninstaller_present=$true;registry_sha256=(Sha ($fields -join [char]0));
    shortcut_sha256=$linkDigest;desktop_shortcut_sha256=$desktopDigest;mutation=$false;authority_effect=$false} | ConvertTo-Json -Compress
}catch {
  [pscustomobject]@{schema='metaengine.browser.qa-nsis-external-effects.v2';
    state='BLOCKED';reason='nsis_external_effects_unverified';mutation=$false;authority_effect=$false} | ConvertTo-Json -Compress
  exit 3
}`;

export function assertNsisEffectsObserved(value,version){
  if(!VERSION.test(version||'')||value?.schema!==NSIS_EFFECTS_SCHEMA
    ||value.state!=='OBSERVED'||value.version!==version
    ||value.registry_entry_count!==1||value.shortcut_count!==2
    ||value.shortcut_target_bound!==true||value.desktop_shortcut_target_bound!==true||value.uninstaller_present!==true
    ||!SHA.test(value.registry_sha256||'')||!SHA.test(value.shortcut_sha256||'')||!SHA.test(value.desktop_shortcut_sha256||'')
    ||value.mutation!==false||value.authority_effect!==false)
    fail('observation_unverified');
  return true;
}
export function assertNsisEffectsRestored(expected,actual){
  if(!expected||!actual)fail('restored_effects_unknown');
  assertNsisEffectsObserved(expected,expected.version);
  assertNsisEffectsObserved(actual,expected.version);
  if(expected.registry_sha256!==actual.registry_sha256
    ||expected.shortcut_sha256!==actual.shortcut_sha256
    ||expected.desktop_shortcut_sha256!==actual.desktop_shortcut_sha256
    ||expected.uninstaller_present!==actual.uninstaller_present)
    fail('external_effects_not_restored');
  return true;
}
export async function observeWindowsNsisEffects({
  expectedVersion,platform=process.platform,env=process.env,run=exec
}={}){
  if(platform!=='win32'||!VERSION.test(expectedVersion||'')
    ||typeof env.SystemRoot!=='string'||!/^\w:\\Windows$/i.test(env.SystemRoot)
    ||!path.win32.isAbsolute(env.APPDATA||'')||!path.win32.isAbsolute(env.LOCALAPPDATA||''))
    fail('windows_environment_unverified');
  const ps=path.win32.join(env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const args=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script,'utf16le').toString('base64')];
  const vars={SystemRoot:env.SystemRoot,SYSTEMROOT:env.SystemRoot,WINDIR:env.SystemRoot,
    APPDATA:env.APPDATA,LOCALAPPDATA:env.LOCALAPPDATA,
    PSModulePath:path.win32.join(env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules'),
    METAENGINE_QA_NSIS_EXPECTED_VERSION:expectedVersion};
  let stdout;
  try{
    const pending=run(ps,args,{env:vars,windowsHide:true,shell:false,timeout:90000,maxBuffer:4096});
    pending.child?.stdin?.end();({stdout}=await pending);
  }
  catch{fail('native_readback_unverified');}
  let value;
  try{value=JSON.parse(stdout.trim());}catch{fail('native_json_invalid');}
  assertNsisEffectsObserved(value,expectedVersion);
  return Object.freeze(value);
}
