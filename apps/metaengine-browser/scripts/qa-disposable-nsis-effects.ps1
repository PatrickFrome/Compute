param(
  [Parameter(ParameterSetName='Disposable',Mandatory=$true)][string]$FixtureId,
  [Parameter(ParameterSetName='Operator',Mandatory=$true)][string]$OperatorSnapshotDirectory,
  [Parameter(ParameterSetName='Operator',Mandatory=$true)][string]$OperatorExpectedVersion,
  [Parameter(Mandatory=$true)][ValidateSet('Observe','Capture','Restore')][string]$Mode,
  [string]$ExpectedSnapshotSha256,
  [string]$ExpectedPreimageSha256,
  [switch]$FailAfterRegistry
)
# Shared native codec. Default scope is the disposable G1 falsifier. The explicit
# Operator parameter set targets ONLY the installed Test app's fixed HKCU entry
# and its two known links; no Owner, Guardian, PG or arbitrary target is writable.
$ErrorActionPreference='Stop'
$phase='BEFORE_MUTATION'
$schema='metaengine.browser.qa-disposable-nsis-effects.v1'
$record=$null
function Refuse([string]$Reason) { throw ('nsis_fixture_'+$Reason) }
function Digest([byte[]]$Bytes) {
  $h=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($h.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant() }
  finally { $h.Dispose() }
}
function JsonBytes($Value) {
  return ,([Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress)))
}
function Physical([string]$Path,[bool]$Directory) {
  $p=[IO.Path]::GetFullPath($Path)
  $cursor=$p
  while($cursor) {
    $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse 'reparse_forbidden' }
    if($cursor -eq $p -and $item.PSIsContainer -ne $Directory) { Refuse 'object_kind_invalid' }
    $parent=[IO.Directory]::GetParent($cursor)
    if($null -eq $parent){break};$cursor=$parent.FullName
  }
}
function ReadBytes([string]$File) {
  Physical $File $false
  $f=[IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    if($f.Length -lt 1 -or $f.Length -gt 262144){Refuse 'file_size_invalid'}
    $bytes=New-Object byte[] ([int]$f.Length)
    $offset=0
    while($offset -lt $bytes.Length) {
      $n=$f.Read($bytes,$offset,$bytes.Length-$offset)
      if($n -le 0){Refuse 'file_read_incomplete'};$offset+=$n
    }
    return ,$bytes
  } finally { $f.Dispose() }
}
function Exclusive([string]$File,[byte[]]$Bytes) {
  $f=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$f.Write($Bytes,0,$Bytes.Length);$f.Flush($true)} finally {$f.Dispose()}
}
function SaveJournal($Value,[switch]$First) {
  if($First){Exclusive $journal (JsonBytes $Value);return}
  $tmp=Join-Path $base ('journal-'+[guid]::NewGuid().ToString('N')+'.tmp')
  Exclusive $tmp (JsonBytes $Value)
  if([IO.File]::Exists($journal)){[IO.File]::Replace($tmp,$journal,[NullString]::Value)}
  else {[IO.File]::Move($tmp,$journal)}
}
function RegistryBytes {
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey,$false)
  if($null -eq $key){if($operator){return ,(JsonBytes @())};Refuse 'key_missing'}
  try {
    if($key.SubKeyCount -ne 0){Refuse 'subkeys_not_snapshotted'}
    [string[]]$names=$key.GetValueNames()
    if($names.Length -lt 1 -or $names.Length -gt 64){Refuse 'value_count_invalid'}
    [Array]::Sort($names,[StringComparer]::Ordinal)
    $rows=@(foreach($name in $names){
      if($name.Length -gt 128){Refuse 'value_name_invalid'}
      $kind=$key.GetValueKind($name).ToString()
      $v=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      switch($kind) {
        {$_ -in 'String','ExpandString'} {if($v.Length -gt 2048){Refuse 'string_oversized'};$data=[string]$v;break}
        {$_ -in 'DWord','QWord'} {$data=$v.ToString([Globalization.CultureInfo]::InvariantCulture);break}
        'MultiString' {if($v.Count -gt 64 -or @($v | Where-Object {$_.Length -gt 2048}).Count){Refuse 'multi_string_oversized'};$data=@($v);break}
        {$_ -in 'Binary','None'} {if($v.Length -gt 65536){Refuse 'binary_oversized'};$data=[Convert]::ToBase64String($v);break}
        default {Refuse 'value_kind_unknown'}
      }
      [ordered]@{name=$name;kind=$kind;data=$data}
    })
    return ,(JsonBytes $rows)
  } finally {$key.Dispose()}
}
function CurrentState {
  Physical $base $true
  if(-not $operator){Physical $current $true}
  $registry=RegistryBytes
  $start=$null;$desktop=$null
  if(-not $operator -or [IO.File]::Exists($startLink)){$start=ReadBytes $startLink}
  if(-not $operator -or [IO.File]::Exists($desktopLink)){$desktop=ReadBytes $desktopLink}
  $startHash='ABSENT';$desktopHash='ABSENT'
  if($null -ne $start){$startHash=Digest $start};if($null -ne $desktop){$desktopHash=Digest $desktop}
  $hashes=[ordered]@{registry_sha256=(Digest $registry);start_menu_sha256=$startHash;desktop_sha256=$desktopHash}
  return @{registry=$registry;start=$start;desktop=$desktop;hashes=$hashes;digest=(Digest (JsonBytes $hashes))}
}
function Receipt([string]$State) {
  $classification='DISPOSABLE_WINDOWS_STAGING';if($operator){$classification='OPERATOR_LOCAL_QA'}
  return [ordered]@{schema=$schema;state=$State;classification=$classification;
    production_authorized=$false;owner_mutated=$false;guardian_mutated=$false;postgres_mutated=$false;
    live_install_mutated=($operator -and $phase -ne 'BEFORE_MUTATION');automatic_retry_allowed=$false;authority_effect=$false}
}
try {
  $operator=$PSCmdlet.ParameterSetName -ceq 'Operator'
  if($env:OS -ne 'Windows_NT'){Refuse 'scope_invalid'}
  if($operator){
    $schema='metaengine.operator.qa-nsis-effects.v1'
    $base=[IO.Path]::GetFullPath($OperatorSnapshotDirectory)
    $state=Split-Path -Parent $base
    $expectedParent=Join-Path $env:LOCALAPPDATA 'METAENGINE'
    if(-not [IO.Path]::IsPathRooted($OperatorSnapshotDirectory) -or
      (Split-Path -Leaf $base) -cne 'predecessor-nsis' -or
      (Split-Path -Leaf $state) -cnotmatch '^client-state-qa-upgrade-[a-f0-9-]{36}$' -or
      -not [string]::Equals((Split-Path -Parent $state),$expectedParent,[StringComparison]::OrdinalIgnoreCase) -or
      $OperatorExpectedVersion -cnotmatch '^\d+\.\d+\.\d+-dev\.\d+\.1$' -or $FailAfterRegistry){Refuse 'scope_invalid'}
    $current=Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test'
    $subkey='Software\Microsoft\Windows\CurrentVersion\Uninstall\c32f3891-2b9e-5a4a-bd4f-5173b65b39bb'
    $startLink=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\METAENGINE Browser Test.lnk'
    $desktopLink=Join-Path ([Environment]::GetFolderPath('Desktop')) 'METAENGINE Browser Test.lnk'
    Physical (Split-Path -Parent $startLink) $true;Physical (Split-Path -Parent $desktopLink) $true
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey,$false)
    if($null -ne $key){
      try {
        $display=[string]$key.GetValue('DisplayName')
        if($display -notlike 'METAENGINE Browser Test *'){Refuse 'operator_target_unbound'}
        if($Mode -eq 'Capture' -and ($display -cne ('METAENGINE Browser Test '+$OperatorExpectedVersion) -or
          [string]$key.GetValue('DisplayVersion') -cne $OperatorExpectedVersion)){Refuse 'operator_version_mismatch'}
      }finally{$key.Dispose()}
    }elseif($Mode -eq 'Capture'){Refuse 'key_missing'}
  }else{
    if($FixtureId -cnotmatch '^[a-f0-9]{32}$'){Refuse 'scope_invalid'}
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $base=Join-Path $temp ('metaengine-qa-nsis-effects-'+$FixtureId)
    $subkey='Software\METAENGINE\QA\NSIS-Effects-Restore\'+$FixtureId
    $current=Join-Path $base 'current'
    $startLink=Join-Path $current 'start-menu.lnk'
    $desktopLink=Join-Path $current 'desktop.lnk'
  }
  $snapshot=Join-Path $base 'snapshot'
  $journal=Join-Path $base 'restore-journal.json'
  Physical $base $true
  if($Mode -ne 'Restore' -and $FailAfterRegistry){Refuse 'failure_injection_mode_invalid'}
  if($Mode -eq 'Observe'){
    $now=CurrentState
    $out=Receipt 'OBSERVED';$out.external_effects_sha256=$now.digest
  } elseif($Mode -eq 'Capture'){
    if(Test-Path -LiteralPath $snapshot){Refuse 'snapshot_exists_requires_readback'}
    $before=CurrentState
    if($operator -and ($null -eq $before.start -or $null -eq $before.desktop)){Refuse 'operator_shortcuts_missing'}
    [void][IO.Directory]::CreateDirectory($snapshot)
    Exclusive (Join-Path $snapshot 'registry.json') $before.registry
    Exclusive (Join-Path $snapshot 'start-menu.lnk') $before.start
    Exclusive (Join-Path $snapshot 'desktop.lnk') $before.desktop
    $manifest=[ordered]@{schema=$schema;fixture_id=$FixtureId;operator_version=$OperatorExpectedVersion;
      registry_sha256=$before.hashes.registry_sha256;start_menu_sha256=$before.hashes.start_menu_sha256;
      desktop_sha256=$before.hashes.desktop_sha256;external_effects_sha256=$before.digest}
    Exclusive (Join-Path $snapshot 'manifest.json') (JsonBytes $manifest)
    foreach($p in @(@{file='registry.json';hash=$before.hashes.registry_sha256},
                      @{file='start-menu.lnk';hash=$before.hashes.start_menu_sha256},
                      @{file='desktop.lnk';hash=$before.hashes.desktop_sha256})){
      if((Digest (ReadBytes (Join-Path $snapshot $p.file))) -cne $p.hash){Refuse 'snapshot_copy_unverified'}
    }
    $after=CurrentState
    if($after.digest -cne $before.digest){Refuse 'capture_preimage_changed'}
    $out=Receipt 'SNAPSHOT_VERIFIED'
    $out.snapshot_sha256=Digest (ReadBytes (Join-Path $snapshot 'manifest.json'))
    $out.external_effects_sha256=$before.digest
  } else {
    if($ExpectedSnapshotSha256 -cnotmatch '^[a-f0-9]{64}$' -or
       $ExpectedPreimageSha256 -cnotmatch '^[a-f0-9]{64}$'){Refuse 'expected_digest_required'}
    if(Test-Path -LiteralPath $journal){Refuse 'existing_attempt_requires_readback'}
    Physical $snapshot $true
    $manifestBytes=ReadBytes (Join-Path $snapshot 'manifest.json')
    if((Digest $manifestBytes) -cne $ExpectedSnapshotSha256){Refuse 'snapshot_digest_mismatch'}
    $m=[Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
    if($m.schema -cne $schema -or $m.fixture_id -cne $FixtureId -or
      ($operator -and $m.operator_version -cne $OperatorExpectedVersion)){Refuse 'snapshot_binding_invalid'}
    $backup=ReadBytes (Join-Path $snapshot 'registry.json')
    $start=ReadBytes (Join-Path $snapshot 'start-menu.lnk')
    $desktop=ReadBytes (Join-Path $snapshot 'desktop.lnk')
    if((Digest $backup) -cne $m.registry_sha256 -or (Digest $start) -cne $m.start_menu_sha256 -or
       (Digest $desktop) -cne $m.desktop_sha256){Refuse 'snapshot_content_changed'}
    $decoded=[Text.Encoding]::UTF8.GetString($backup) | ConvertFrom-Json
    $rows=@($decoded)
    if($rows.Count -lt 1 -or $rows.Count -gt 64){Refuse 'snapshot_values_invalid'}
    $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    # Decode and type-check every value before the first registry deletion.
    $restoreRows=@(foreach($row in $rows){
      if($row.name -isnot [string] -or $row.name.Length -gt 128 -or -not $names.Add($row.name) -or
         $row.kind -cnotin @('String','ExpandString','DWord','QWord','MultiString','Binary','None')){
        Refuse 'snapshot_values_invalid'
      }
      $kind=[Microsoft.Win32.RegistryValueKind][Enum]::Parse([Microsoft.Win32.RegistryValueKind],$row.kind)
      switch($row.kind){
        'DWord' {$value=[int]::Parse($row.data,[Globalization.CultureInfo]::InvariantCulture);break}
        'QWord' {$value=[long]::Parse($row.data,[Globalization.CultureInfo]::InvariantCulture);break}
        'MultiString' {
          if(@($row.data).Count -gt 64 -or @($row.data | Where-Object {$_ -isnot [string] -or $_.Length -gt 2048}).Count){Refuse 'snapshot_values_invalid'}
          $value=[string[]]@($row.data);break
        }
        {$_ -in 'Binary','None'} {
          $value=[Convert]::FromBase64String($row.data)
          if($value.Length -gt 65536){Refuse 'snapshot_values_invalid'};break
        }
        {$_ -in 'String','ExpandString'} {
          if($row.data -isnot [string] -or $row.data.Length -gt 2048){Refuse 'snapshot_values_invalid'}
          $value=[string]$row.data;break
        }
      }
      [pscustomobject]@{name=$row.name;value=$value;kind=$kind}
    })
    $expectedHashes=[ordered]@{registry_sha256=$m.registry_sha256;start_menu_sha256=$m.start_menu_sha256;desktop_sha256=$m.desktop_sha256}
    if((Digest (JsonBytes $expectedHashes)) -cne $m.external_effects_sha256){Refuse 'snapshot_binding_invalid'}
    # Backups are accepted only through the exact externally pinned manifest.
    $now=CurrentState
    if($now.digest -cne $ExpectedPreimageSha256){Refuse 'preimage_changed'}
    $record=Receipt 'PREPARED';$record.preimage_sha256=$now.digest
    $record.snapshot_sha256=$ExpectedSnapshotSha256
    SaveJournal $record -First
    if((CurrentState).digest -cne $now.digest){Refuse 'preimage_changed'}
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey,$true)
    $phase='MUTATION_STARTED'
    if($operator){$record.live_install_mutated=$true}
    $record.state='RESTORING_REGISTRY';SaveJournal $record
    if($null -eq $key){if($operator){$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($subkey)}else{Refuse 'key_missing'}}
    try {
      foreach($name in $key.GetValueNames()){$key.DeleteValue($name,$true)}
      foreach($row in $restoreRows){
        $key.SetValue([string]$row.name,$row.value,$row.kind)
      }
      $key.Flush()
    } finally {$key.Dispose()}
    if((Digest (RegistryBytes)) -cne $m.registry_sha256){Refuse 'registry_readback_mismatch'}
    $record.state='REGISTRY_RESTORED_LINKS_PENDING';SaveJournal $record
    if($FailAfterRegistry){Refuse 'injected_after_registry'}
    foreach($entry in @(@{file=$startLink;bytes=$start},@{file=$desktopLink;bytes=$desktop})){
      $linkParent=Split-Path -Parent $entry.file;Physical $linkParent $true
      $tmp=Join-Path $linkParent ([guid]::NewGuid().ToString('N')+'.tmp')
      Exclusive $tmp $entry.bytes
      if([IO.File]::Exists($entry.file)){Physical $entry.file $false;[IO.File]::Replace($tmp,$entry.file,[NullString]::Value)}
      elseif($operator){[IO.File]::Move($tmp,$entry.file)}else{Refuse 'shortcut_missing'}
    }
    $restored=CurrentState
    if($restored.digest -cne $m.external_effects_sha256){Refuse 'restored_effects_mismatch'}
    $record.state='RESTORED_EXTERNAL_EFFECTS_VERIFIED'
    $record.external_effects_sha256=$restored.digest
    SaveJournal $record
    $out=$record
  }
  $out | ConvertTo-Json -Depth 6 -Compress
} catch {
  $reason='nsis_fixture_native_operation_failed'
  if($_.Exception.Message -cmatch '^nsis_fixture_[a-z_]+$'){$reason=$_.Exception.Message}
  $state='BLOCKED_REQUIRES_READBACK'
  if($phase -ne 'BEFORE_MUTATION'){
    $state='EFFECT_UNKNOWN_REQUIRES_READBACK'
    if($record){$record.state=$state;try{SaveJournal $record}catch{}}
  }
  $out=Receipt $state;$out.reason=$reason
  $out.failure_line=$_.InvocationInfo.ScriptLineNumber
  $out.native_exception_type=$_.Exception.GetType().Name
  $out | ConvertTo-Json -Depth 6 -Compress
  exit 1
}
