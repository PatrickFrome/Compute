param(
  [Parameter(Mandatory=$true)][string]$FixtureId,
  [Parameter(Mandatory=$true)][ValidateSet('Observe','Capture','Restore')][string]$Mode,
  [string]$ExpectedSnapshotSha256,
  [string]$ExpectedPreimageSha256,
  [switch]$FailAfterRegistry
)
# Native, disposable G1 falsifier. No live install/profile/Owner/PG write path.
# All writable paths and the HKCU key are derived from a fresh fixture UUID.
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
function SaveJournal($Value) {
  $tmp=Join-Path $base ('journal-'+[guid]::NewGuid().ToString('N')+'.tmp')
  Exclusive $tmp (JsonBytes $Value)
  if([IO.File]::Exists($journal)){[IO.File]::Replace($tmp,$journal,[NullString]::Value)}
  else {[IO.File]::Move($tmp,$journal)}
}
function RegistryBytes {
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey,$false)
  if($null -eq $key){Refuse 'key_missing'}
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
  foreach($d in @($base,$current)){Physical $d $true}
  $registry=RegistryBytes
  $start=ReadBytes $startLink;$desktop=ReadBytes $desktopLink
  $hashes=[ordered]@{registry_sha256=(Digest $registry);start_menu_sha256=(Digest $start);desktop_sha256=(Digest $desktop)}
  return @{registry=$registry;start=$start;desktop=$desktop;hashes=$hashes;digest=(Digest (JsonBytes $hashes))}
}
function Receipt([string]$State) {
  return [ordered]@{schema=$schema;state=$State;classification='DISPOSABLE_WINDOWS_STAGING';
    production_authorized=$false;owner_mutated=$false;guardian_mutated=$false;postgres_mutated=$false;
    live_install_mutated=$false;automatic_retry_allowed=$false;authority_effect=$false}
}
try {
  if($env:OS -ne 'Windows_NT' -or $FixtureId -cnotmatch '^[a-f0-9]{32}$'){Refuse 'scope_invalid'}
  $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $base=Join-Path $temp ('metaengine-qa-nsis-effects-'+$FixtureId)
  $subkey='Software\METAENGINE\QA\NSIS-Effects-Restore\'+$FixtureId
  $current=Join-Path $base 'current'
  $startLink=Join-Path $current 'start-menu.lnk'
  $desktopLink=Join-Path $current 'desktop.lnk'
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
    [void][IO.Directory]::CreateDirectory($snapshot)
    Exclusive (Join-Path $snapshot 'registry.json') $before.registry
    Exclusive (Join-Path $snapshot 'start-menu.lnk') $before.start
    Exclusive (Join-Path $snapshot 'desktop.lnk') $before.desktop
    $manifest=[ordered]@{schema=$schema;fixture_id=$FixtureId;
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
    if($m.schema -cne $schema -or $m.fixture_id -cne $FixtureId){Refuse 'snapshot_binding_invalid'}
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
    SaveJournal $record
    if((CurrentState).digest -cne $now.digest){Refuse 'preimage_changed'}
    $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey,$true)
    if($null -eq $key){Refuse 'key_missing'}
    $phase='MUTATION_STARTED'
    $record.state='RESTORING_REGISTRY';SaveJournal $record
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
      Physical $current $true
      $tmp=Join-Path $current ([guid]::NewGuid().ToString('N')+'.tmp')
      Exclusive $tmp $entry.bytes
      Physical $entry.file $false
      [IO.File]::Replace($tmp,$entry.file,[NullString]::Value)
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
