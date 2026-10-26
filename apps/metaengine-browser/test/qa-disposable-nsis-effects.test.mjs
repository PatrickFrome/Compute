import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const script=fileURLToPath(new URL('../scripts/qa-disposable-nsis-effects.ps1',import.meta.url));
const ps=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const prefix=['-NoLogo','-NoProfile','-NonInteractive'];
const desktopLocation=String.raw`$desktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop,[Environment+SpecialFolderOption]::DoNotVerify)
if([string]::IsNullOrWhiteSpace($desktop) -or -not [IO.Path]::IsPathRooted($desktop)){throw 'live_guard_desktop_path_unknown'}`;
const setup=String.raw`$ErrorActionPreference='Stop'
$id=$env:METAENGINE_NSIS_FIXTURE_ID
if($id -cnotmatch '^[a-f0-9]{32}$'){throw 'fixture_id_invalid'}
$base=Join-Path ([IO.Path]::GetTempPath()) ('metaengine-qa-nsis-effects-'+$id)
$keyPath='Software\METAENGINE\QA\NSIS-Effects-Restore\'+$id
$op=$env:METAENGINE_NSIS_FIXTURE_OPERATION
if($op -eq 'cleanup'){
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($keyPath,$false)
  exit 0
}
if($op -eq 'setup'){
  $current=Join-Path $base 'current'
  [void][IO.Directory]::CreateDirectory($current)
  [IO.File]::WriteAllText((Join-Path $base 'fixture.exe'),'inert bytes, never executed')
  $k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($keyPath)
  try {
    $k.SetValue('','default-value',[Microsoft.Win32.RegistryValueKind]::String)
    $k.SetValue('DisplayVersion','0.7.0-dev.1.1',[Microsoft.Win32.RegistryValueKind]::String)
    $k.SetValue('Publisher','QA only',[Microsoft.Win32.RegistryValueKind]::String)
    $k.SetValue('Expand','%TEMP%\fixture',[Microsoft.Win32.RegistryValueKind]::ExpandString)
    $k.SetValue('DWord',[int]-123,[Microsoft.Win32.RegistryValueKind]::DWord)
    $k.SetValue('QWord',[long]9007199254740993,[Microsoft.Win32.RegistryValueKind]::QWord)
    $k.SetValue('Binary',[byte[]]@(0,255,11,128),[Microsoft.Win32.RegistryValueKind]::Binary)
    $k.SetValue('Multi',[string[]]@('alpha','beta'),[Microsoft.Win32.RegistryValueKind]::MultiString)
    $k.SetValue('EmptyMulti',[string[]]@(),[Microsoft.Win32.RegistryValueKind]::MultiString)
    $k.Flush()
  }finally{$k.Dispose()}
  $w=New-Object -ComObject WScript.Shell
  try {foreach($name in @('start-menu.lnk','desktop.lnk')){
    $l=$w.CreateShortcut((Join-Path $current $name))
    $l.TargetPath=Join-Path $base 'fixture.exe';$l.Arguments='--fixture-baseline'
    $l.Description='predecessor';$l.Save()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($l)
  }}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)}
}elseif($op -eq 'mutate' -or $op -eq 'drift'){
  $k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keyPath,$true)
  try {
    $k.SetValue('DisplayVersion',$op,[Microsoft.Win32.RegistryValueKind]::String)
    $k.DeleteValue('Publisher',$false)
    $k.SetValue('SuccessorOnly','remove during restore',[Microsoft.Win32.RegistryValueKind]::String)
    $k.SetValue('DWord','kind changed',[Microsoft.Win32.RegistryValueKind]::String)
    $k.Flush()
  }finally{$k.Dispose()}
  $w=New-Object -ComObject WScript.Shell
  try {foreach($name in @('start-menu.lnk','desktop.lnk')){
    $l=$w.CreateShortcut((Join-Path (Join-Path $base 'current') $name))
    $l.Arguments='--fixture-successor';$l.Description=$op;$l.Save()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($l)
  }}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($w)}
}elseif($op -eq 'subkey'){
  $k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(($keyPath+'\uncaptured'))
  $k.Dispose()
}else{throw 'fixture_operation_invalid'}
`;
const liveGuard=String.raw`$ErrorActionPreference='Stop'
$items=@()
$root=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall',$false)
if($root){
  try {
    [string[]]$names=$root.GetSubKeyNames();[Array]::Sort($names,[StringComparer]::Ordinal)
    foreach($name in $names){
      $k=$root.OpenSubKey($name,$false)
      try {
        if([string]$k.GetValue('DisplayName','') -like 'METAENGINE Browser Test*'){
          [string[]]$values=$k.GetValueNames();[Array]::Sort($values,[StringComparer]::Ordinal)
          foreach($n in $values){
            $v=$k.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            $items+=[ordered]@{key=$name;name=$n;kind=$k.GetValueKind($n).ToString();value=$v}
          }
        }
      }finally{$k.Dispose()}
    }
  }finally{$root.Dispose()}
}
# A disposable profile need not have a physical Desktop directory. Ask Windows
# for its configured location without creating it or substituting a guessed path.
${desktopLocation}
foreach($file in @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\METAENGINE Browser Test.lnk'),
                  (Join-Path $desktop 'METAENGINE Browser Test.lnk'))){
  if([IO.File]::Exists($file)){$items+=[ordered]@{link_bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($file))}}
  else{$items+=[ordered]@{link_bytes='ABSENT'}}
}
$h=[Security.Cryptography.SHA256]::Create()
try {
  $bytes=[Text.Encoding]::UTF8.GetBytes(($items | ConvertTo-Json -Depth 8 -Compress))
  [BitConverter]::ToString($h.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
}finally{$h.Dispose()}
`;
async function liveFingerprint(){
  const pending=exec(ps,[...prefix,'-EncodedCommand',Buffer.from(liveGuard,'utf16le').toString('base64')],
    {windowsHide:true,shell:false,timeout:30000,maxBuffer:4096});
  pending.child.stdin?.end();
  const {stdout}=await pending;const hash=stdout.trim();
  assert.match(hash,/^[a-f0-9]{64}$/);return hash;
}
async function native(id,operation){
  const pending=exec(ps,[...prefix,'-EncodedCommand',Buffer.from(setup,'utf16le').toString('base64')],
    {env:{...process.env,METAENGINE_NSIS_FIXTURE_ID:id,METAENGINE_NSIS_FIXTURE_OPERATION:operation},
      windowsHide:true,shell:false,timeout:30000,maxBuffer:4096});
  pending.child.stdin?.end();await pending;
}
async function invoke(id,mode,options={}){
  const args=[...prefix,'-File',script,'-FixtureId',id,'-Mode',mode];
  if(options.snapshot)args.push('-ExpectedSnapshotSha256',options.snapshot);
  if(options.preimage)args.push('-ExpectedPreimageSha256',options.preimage);
  if(options.fail)args.push('-FailAfterRegistry');
  try{
    const pending=exec(ps,args,{windowsHide:true,shell:false,timeout:30000,maxBuffer:8192});
    pending.child.stdin?.end();const {stdout}=await pending;
    return {code:0,proof:JSON.parse(stdout.trim())};
  }catch(e){
    if(typeof e.code!=='number')throw e;
    return {code:e.code,proof:JSON.parse(e.stdout.trim())};
  }
}
async function fixture(t){
  const id=randomUUID().replaceAll('-','');
  const root=path.join(os.tmpdir(),'metaengine-qa-nsis-effects-'+id);
  await fs.mkdir(root);
  t.after(async()=>{try{await native(id,'cleanup');}finally{await fs.rm(root,{recursive:true,force:true});}});
  await native(id,'setup');
  return {id,root};
}
function inert(proof){
  for(const key of ['production_authorized','owner_mutated','guardian_mutated','postgres_mutated',
    'live_install_mutated','automatic_retry_allowed','authority_effect'])assert.equal(proof[key],false,key);
}
async function prepared(t){
  const f=await fixture(t);
  const capture=await invoke(f.id,'Capture');assert.equal(capture.code,0,JSON.stringify(capture));inert(capture.proof);
  await native(f.id,'mutate');
  const changed=await invoke(f.id,'Observe');assert.equal(changed.code,0);
  assert.notEqual(changed.proof.external_effects_sha256,capture.proof.external_effects_sha256);
  return {...f,capture:capture.proof,preimage:changed.proof.external_effects_sha256,
    options:{snapshot:capture.proof.snapshot_sha256,preimage:changed.proof.external_effects_sha256}};
}
test('Windows configured Desktop lookup is read-only when the profile has no physical Desktop',
  {skip:process.platform!=='win32',timeout:30000},async()=>{
  const command=String.raw`$ErrorActionPreference='Stop'
${desktopLocation}
$before=[IO.Directory]::Exists($desktop)
$ordinary=[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
${desktopLocation}
[ordered]@{rooted=[IO.Path]::IsPathRooted($desktop);existed_before=$before;exists_after=[IO.Directory]::Exists($desktop);ordinary_empty=[string]::IsNullOrEmpty($ordinary)}|ConvertTo-Json -Compress`;
  const pending=exec(ps,[...prefix,'-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],
    {windowsHide:true,shell:false,timeout:25000,maxBuffer:4096});
  pending.child.stdin?.end();
  const result=JSON.parse((await pending).stdout.trim());
  assert.equal(result.rooted,true);
  assert.equal(result.exists_after,result.existed_before,'lookup must never create a Desktop directory');
  if(!result.existed_before)assert.equal(result.ordinary_empty,true,'positive control: ordinary lookup cannot resolve an absent directory');
});
test('physical Windows NSIS external rollback on fresh private HKCU key and two real .lnk files',
  {skip:process.platform!=='win32'?'Windows native registry/COM proof unavailable (UNKNOWN)':false,timeout:180000},
  async t=>{
  const liveBefore=await liveFingerprint();
  t.after(async()=>assert.equal(await liveFingerprint(),liveBefore,'live uninstall entry and both shortcuts must remain unchanged'));
  await t.test('restore exact typed registry values and bytes of both shortcuts; reject replay',async t=>{
    const f=await prepared(t);
    const result=await invoke(f.id,'Restore',f.options);
    assert.equal(result.code,0,JSON.stringify(result));inert(result.proof);
    assert.equal(result.proof.state,'RESTORED_EXTERNAL_EFFECTS_VERIFIED');
    assert.equal(result.proof.external_effects_sha256,f.capture.external_effects_sha256);
    const after=(await invoke(f.id,'Observe')).proof.external_effects_sha256;
    assert.equal(after,f.capture.external_effects_sha256);
    const again=await invoke(f.id,'Restore',f.options);
    assert.equal(again.code,1);assert.equal(again.proof.reason,'nsis_fixture_existing_attempt_requires_readback');
    assert.equal((await invoke(f.id,'Observe')).proof.external_effects_sha256,after);
  });
  for(const file of ['registry.json','start-menu.lnk','desktop.lnk']){
    await t.test('tampered '+file+' blocks before changing current effects',async t=>{
      const f=await prepared(t);
      await fs.appendFile(path.join(f.root,'snapshot',file),'tampered');
      const result=await invoke(f.id,'Restore',f.options);
      assert.equal(result.code,1);inert(result.proof);
      assert.equal(result.proof.reason,'nsis_fixture_snapshot_content_changed');
      assert.equal((await invoke(f.id,'Observe')).proof.external_effects_sha256,f.preimage);
      await assert.rejects(fs.stat(path.join(f.root,'restore-journal.json')),{code:'ENOENT'});
    });
  }
  await t.test('concurrent preimage change blocks without undoing the other writer',async t=>{
    const f=await prepared(t);
    await native(f.id,'drift');
    const before=(await invoke(f.id,'Observe')).proof.external_effects_sha256;
    const result=await invoke(f.id,'Restore',f.options);
    assert.equal(result.code,1);assert.equal(result.proof.reason,'nsis_fixture_preimage_changed');
    assert.equal((await invoke(f.id,'Observe')).proof.external_effects_sha256,before);
    await assert.rejects(fs.stat(path.join(f.root,'restore-journal.json')),{code:'ENOENT'});
  });
  await t.test('failure between registry and shortcuts journals UNKNOWN and blocks replay',async t=>{
    const f=await prepared(t);
    const result=await invoke(f.id,'Restore',{...f.options,fail:true});
    assert.equal(result.code,1);inert(result.proof);
    assert.equal(result.proof.state,'EFFECT_UNKNOWN_REQUIRES_READBACK');
    const journal=JSON.parse(await fs.readFile(path.join(f.root,'restore-journal.json'),'utf8'));
    assert.equal(journal.state,'EFFECT_UNKNOWN_REQUIRES_READBACK');
    assert.equal(journal.automatic_retry_allowed,false);
    const partial=(await invoke(f.id,'Observe')).proof.external_effects_sha256;
    assert.notEqual(partial,f.preimage);assert.notEqual(partial,f.capture.external_effects_sha256);
    const again=await invoke(f.id,'Restore',f.options);
    assert.equal(again.code,1);assert.equal(again.proof.reason,'nsis_fixture_existing_attempt_requires_readback');
    assert.equal((await invoke(f.id,'Observe')).proof.external_effects_sha256,partial);
  });
  await t.test('uncaptured registry subkeys block snapshot creation',async t=>{
    const f=await fixture(t);await native(f.id,'subkey');
    const result=await invoke(f.id,'Capture');
    assert.equal(result.code,1);assert.equal(result.proof.reason,'nsis_fixture_subkeys_not_snapshotted');
    await assert.rejects(fs.stat(path.join(f.root,'snapshot')),{code:'ENOENT'});
  });
  await t.test('junction into another directory is refused before capture',async t=>{
    const f=await fixture(t);
    const current=path.join(f.root,'current'),original=path.join(f.root,'original');
    await fs.rename(current,original);await fs.symlink(original,current,'junction');
    const result=await invoke(f.id,'Capture');
    assert.equal(result.code,1);assert.equal(result.proof.reason,'nsis_fixture_reparse_forbidden');
    await assert.rejects(fs.stat(path.join(f.root,'snapshot')),{code:'ENOENT'});
  });
  await t.test('no caller-selected registry key, directory or live install scope',async()=>{
    const result=await invoke('../uninstall','Restore',{snapshot:'a'.repeat(64),preimage:'b'.repeat(64)});
    assert.equal(result.code,1);inert(result.proof);assert.equal(result.proof.reason,'nsis_fixture_scope_invalid');
  });
});
