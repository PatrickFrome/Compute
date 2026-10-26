param(
  [Parameter(Mandatory=$true)][ValidateSet('Observe','Retire')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$StateDirectory,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [string]$ExpectedDigest,
  [string]$FixtureId
)
# Manual forward migration, never called by the installer or Browser. Atomic
# custody precedes removal of exact old NSIS registrations. The old uninstaller
# is never invoked. A partial/unknown effect keeps its attempt file and gate.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$guid='c32f3891-2b9e-5a4a-bd4f-5173b65b39bb'
$install=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test'))
$state=[IO.Path]::GetFullPath($StateDirectory)
if($ExpectedVersion -notmatch '^\d+\.\d+\.\d+-dev\.\d+\.1$'){throw 'forward_registration_version_invalid'}
$fixture= -not [string]::IsNullOrEmpty($FixtureId)
if($fixture){
  if($FixtureId -notmatch '^[a-f0-9]{32}$'){throw 'forward_registration_fixture_invalid'}
  if(-not $state.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)){throw 'forward_registration_fixture_scope_invalid'}
  $parents=@(('Software\METAENGINE\ForwardInstallFixture\'+$FixtureId+'\Install'),('Software\METAENGINE\ForwardInstallFixture\'+$FixtureId+'\Uninstall'))
}else{
  $parent=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'METAENGINE'))
  if([IO.Path]::GetDirectoryName($state) -ine $parent -or [IO.Path]::GetFileName($state) -notmatch '^client-state-qa-upgrade-[a-f0-9-]{36}$'){throw 'forward_registration_state_scope_invalid'}
  $parents=@('Software','Software\Microsoft\Windows\CurrentVersion\Uninstall')
}
if(-not (Test-Path -LiteralPath $state -PathType Container)){throw 'forward_registration_state_absent'}
$cursor=$state
while($cursor){
  if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'forward_registration_reparse_forbidden'}
  $p=[IO.Directory]::GetParent($cursor);if($null -eq $p){break};$cursor=$p.FullName
}
function Bytes($v){return ,([Text.UTF8Encoding]::new($false).GetBytes(($v|ConvertTo-Json -Depth 15 -Compress)))}
function Sha([byte[]]$b){$h=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($h.ComputeHash($b)).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Exclusive([string]$file,[byte[]]$b){$h=[IO.File]::Open($file,'CreateNew','Write','None');try{$h.Write($b,0,$b.Length);$h.Flush($true)}finally{$h.Dispose()}}
function ReadValues($base,[string]$keyName){
  $k=$base.OpenSubKey($keyName,$false);if($null -eq $k){throw 'forward_registration_key_absent'}
  try{
    if($k.SubKeyCount -ne 0){throw 'forward_registration_subkeys_present'}
    [string[]]$names=$k.GetValueNames();[Array]::Sort($names,[StringComparer]::Ordinal)
    if($names.Count -lt 1 -or $names.Count -gt 64){throw 'forward_registration_value_count'}
    return ,@(foreach($n in $names){
      $kind=$k.GetValueKind($n).ToString();$v=$k.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if($kind -notin @('String','ExpandString','DWord','QWord') -or $n.Length -gt 128 -or ([string]$v).Length -gt 4096){throw 'forward_registration_value_invalid'}
      [ordered]@{name=$n;kind=$kind;data=[string]$v}
    })
  }finally{$k.Dispose()}
}
$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
try{
  if(-not $fixture){
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
      $lm=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,$view)
      try{foreach($p in $parents){$k=$lm.OpenSubKey(($p+'\'+$guid));if($null -ne $k){$k.Dispose();throw 'forward_registration_machine_install_present'}}}finally{$lm.Dispose()}
    }
  }
  $rows=@(foreach($p in $parents){[ordered]@{key=($p+'\'+$guid);values=(ReadValues $base ($p+'\'+$guid))}})
  $location=@($rows[0].values|Where-Object name -eq 'InstallLocation')
  $version=@($rows[1].values|Where-Object name -eq 'DisplayVersion')
  $display=@($rows[1].values|Where-Object name -eq 'DisplayName')
  $uninstall=@($rows[1].values|Where-Object name -eq 'UninstallString')
  $expectedUninstall='"'+(Join-Path $install 'Uninstall METAENGINE Browser Test.exe')+'" /currentuser'
  if($location.Count -ne 1 -or $location[0].data -ine $install -or $version.Count -ne 1 -or $version[0].data -cne $ExpectedVersion -or $display.Count -ne 1 -or $display[0].data -cne ('METAENGINE Browser Test '+$ExpectedVersion) -or $uninstall.Count -ne 1 -or $uninstall[0].data -cne $expectedUninstall){throw 'forward_registration_identity_mismatch'}
  $payload=Bytes $rows;$digest=Sha $payload
  if($Mode -eq 'Observe'){
    [ordered]@{schema='metaengine.operator.forward-registration.v1';state='OBSERVED';digest=$digest;key_count=2;mutation=$false}|ConvertTo-Json -Compress
    exit 0
  }
  if($ExpectedDigest -notmatch '^[a-f0-9]{64}$' -or $ExpectedDigest -cne $digest){throw 'forward_registration_preimage_changed'}
  $attempt=Join-Path $state 'registration-retirement-attempt.json'
  Exclusive $attempt (Bytes ([ordered]@{state='EFFECT_PENDING';digest=$digest;automatic_retry_allowed=$false;keys=$rows}))
  Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class MetaengineForwardRegistry {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] public static extern int RegRenameKey(IntPtr key,string subkey,string name);
}
'@
  for($i=0;$i -lt $parents.Count;$i++){
    $parent=$base.OpenSubKey($parents[$i],$true);if($null -eq $parent){throw 'forward_registration_parent_absent'}
    try{
      if((Sha (Bytes (ReadValues $parent $guid))) -cne (Sha (Bytes $rows[$i].values))){throw 'forward_registration_changed_before_custody'}
      $custody='metaengine-retired-'+[guid]::NewGuid().ToString('N')
      Exclusive (Join-Path $state ('registration-custody-'+$i+'.json')) (Bytes ([ordered]@{parent=$parents[$i];name=$custody;digest=$digest}))
      $rc=[MetaengineForwardRegistry]::RegRenameKey($parent.Handle.DangerousGetHandle(),$guid,$custody)
      if($rc -ne 0){throw ('forward_registration_custody_unknown_'+$rc)}
      $captured=ReadValues $parent $custody
      if((Sha (Bytes $captured)) -cne (Sha (Bytes $rows[$i].values))){throw 'forward_registration_captured_preimage_changed'}
      # Preserve the exact captured values durably before removing this private
      # retired name from Windows' uninstall enumeration.
      Exclusive (Join-Path $state ('registration-captured-'+$i+'.json')) (Bytes $captured)
      if((Sha (Bytes (ReadValues $parent $custody))) -cne (Sha (Bytes $captured))){throw 'forward_registration_custody_changed'}
      $parent.DeleteSubKey($custody,$true)
      $old=$parent.OpenSubKey($guid);if($null -ne $old){$old.Dispose();throw 'forward_registration_canonical_reappeared'}
    }finally{$parent.Dispose()}
  }
  $receipt=[ordered]@{schema='metaengine.operator.forward-registration.v1';state='RETIRED_VERIFIED';digest=$digest;key_count=2;old_uninstaller_executed=$false;automatic_retry_allowed=$false;authority_effect=$false}
  Exclusive (Join-Path $state 'registration-retirement-completed.json') (Bytes $receipt)
  $receipt|ConvertTo-Json -Compress
}finally{$base.Dispose()}
