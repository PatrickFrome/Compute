# GENERATED disposable CI only. This script can choose No, never grant consent.
# Every interaction is bound to exact process births, paths and native controls.
$ErrorActionPreference = 'Stop'
function Refuse([string]$reason) { throw $reason }
function ReadProcess([uint32]$id) {
  $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId=$id")
  if ($rows.Count -ne 1) { Refuse 'native_no_process_unavailable' }
  return $rows[0]
}
function Birth($process) { return $process.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString() }
function SamePath([string]$a, [string]$b) {
  return [IO.Path]::GetFullPath($a).Equals([IO.Path]::GetFullPath($b), [StringComparison]::OrdinalIgnoreCase)
}
try {
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:GITHUB_RUN_ID -notmatch '^[1-9][0-9]*$') { Refuse 'native_no_generated_ci_required' }
  $browserPid = [uint32]$env:METAENGINE_QA_BROWSER_PID
  $qualifierPid = [uint32]$env:METAENGINE_QA_QUALIFIER_PID
  $started = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$env:METAENGINE_QA_STARTED_MS).UtcDateTime
  $deadline = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$env:METAENGINE_QA_DEADLINE_MS).UtcDateTime
  $root = [IO.Path]::GetFullPath($env:METAENGINE_QA_FIXTURE_ROOT)
  $runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
  if (-not $root.StartsWith($runnerTemp+'\',[StringComparison]::OrdinalIgnoreCase)) { Refuse 'native_no_fixture_unbound' }
  $nonce = $env:METAENGINE_QA_FIXTURE_NONCE
  if ($nonce -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' -or -not [IO.Directory]::Exists($root)) { Refuse 'native_no_fixture_unbound' }
  $markerFile = Join-Path $root 'generated-first-run-fixture.json'
  $markerInfo = Get-Item -LiteralPath $markerFile -Force
  if ($markerInfo.PSIsContainer -or $markerInfo.Length -gt 4096 -or ($markerInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse 'native_no_fixture_unbound' }
  $marker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
  if ($marker.schema -cne 'metaengine.browser.generated-first-run-fixture.v1' -or $marker.nonce -cne $nonce) { Refuse 'native_no_fixture_unbound' }
  # No alias or user-provided profile can substitute for this generated namespace.
  $walk = Get-Item -LiteralPath $root -Force
  while ($null -ne $walk) {
    if (($walk.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse 'native_no_fixture_alias_forbidden' }
    $walk = $walk.Parent
  }
  $statePath = Join-Path $root 'Local\METAENGINE\client-first-run-v1\runtime'
  $ownerPath = Join-Path $root 'Roaming\@metaengine\browser-shell\metaengine-state-provider-v1.json'
  foreach ($target in @($statePath,$ownerPath)) {
    $currentPath=$root
    foreach ($part in $target.Substring($root.Length+1).Split('\')) {
      $currentPath=Join-Path $currentPath $part
      try { $item=Get-Item -LiteralPath $currentPath -Force -ErrorAction Stop }
      catch [System.Management.Automation.ItemNotFoundException] { break }
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse 'native_no_fixture_alias_forbidden' }
    }
  }
  $powershell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  # Retain handles so terminated process IDs cannot be recycled into a target.
  $browserHandle=[Diagnostics.Process]::GetProcessById([int]$browserPid); $null=$browserHandle.Handle
  $qualifierHandle=[Diagnostics.Process]::GetProcessById([int]$qualifierPid); $null=$qualifierHandle.Handle
  if ($browserHandle.HasExited -or $qualifierHandle.HasExited) { Refuse 'native_no_process_unavailable' }
  $browser = ReadProcess $browserPid
  $qualifier = ReadProcess $qualifierPid
  if ($browser.ParentProcessId -ne $qualifierPid -or -not (SamePath $browser.ExecutablePath $env:METAENGINE_QA_BROWSER_EXE) `
      -or -not (SamePath $qualifier.ExecutablePath $env:METAENGINE_QA_QUALIFIER_EXE) `
      -or $qualifier.CreationDate -gt $browser.CreationDate `
      -or $browser.CreationDate.ToUniversalTime() -lt $started.AddSeconds(-1) `
      -or $browser.CreationDate.ToUniversalTime() -gt [DateTime]::UtcNow) { Refuse 'native_no_browser_binding_invalid' }
  $browserBirth = Birth $browser
  $qualifierBirth = Birth $qualifier
  Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class MetaengineNegativeConsent {
  public delegate bool Visitor(IntPtr handle, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr root, Visitor visitor, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr handle);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr handle, int id);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr handle);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr handle);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern int GetClassNameW(IntPtr handle, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern int GetWindowTextW(IntPtr handle, StringBuilder text, int length);
  [DllImport("user32.dll", ExactSpelling=true, SetLastError=true)] static extern IntPtr SendMessageTimeoutW(IntPtr handle, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern IntPtr ReadTextMessage(IntPtr handle, uint message, UIntPtr capacity, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  static string ChildText(IntPtr h) { var text=new StringBuilder(8192); UIntPtr result;
    if(ReadTextMessage(h,0x000d,new UIntPtr((uint)text.Capacity),text,2,1000,out result)==IntPtr.Zero) return "";
    return text.ToString(); }
  static string Text(IntPtr h) { var text=new StringBuilder(8192); GetWindowTextW(h,text,text.Capacity); return text.ToString(); }
  static string Class(IntPtr h) { var text=new StringBuilder(128); GetClassNameW(h,text,text.Capacity); return text.ToString(); }
  static bool Owner(IntPtr h,uint wanted) { uint pid; GetWindowThreadProcessId(h,out pid); return pid==wanted; }
  static bool Bound(IntPtr h,uint pid,string state,string owner) {
    if (!Owner(h,pid)||!IsWindowVisible(h)||Class(h)!="#32770"||Text(h)!="METAENGINE \u2014 confirm private database creation") return false;
    var no=GetDlgItem(h,7); var yes=GetDlgItem(h,6);
    if(no==IntPtr.Zero||yes==IntPtr.Zero||GetParent(no)!=h||GetParent(yes)!=h||!Owner(no,pid)||!Owner(yes,pid)||GetDlgCtrlID(no)!=7||Class(no)!="Button"
      ||!IsWindowVisible(no)||!IsWindowEnabled(no)||ChildText(no).Replace("&","")!="No"
      ||GetDlgCtrlID(yes)!=6||Class(yes)!="Button"||ChildText(yes).Replace("&","")!="Yes") return false;
    UIntPtr value;
    if(SendMessageTimeoutW(h,0x0400,IntPtr.Zero,IntPtr.Zero,2,1000,out value)==IntPtr.Zero) return false;
    var def=value.ToUInt64(); if((def&0xffff)!=7||((def>>16)&0xffff)!=0x534b) return false;
    var body=new StringBuilder();
    EnumChildWindows(h,(child,data)=>{if(Class(child)=="Static") body.Append(ChildText(child)).Append('\n'); return true;},IntPtr.Zero);
    var content=body.ToString();
    return content.Contains("Create a NEW private METAENGINE PostgreSQL 17 database")&&content.Contains(state)&&content.Contains(owner);
  }
  public static long[] Find(uint pid,string state,string owner) {
    var rows=new List<long>();
    EnumWindows((h,data)=>{if(Bound(h,pid,state,owner))rows.Add(h.ToInt64());return true;},IntPtr.Zero);
    return rows.ToArray();
  }
  public static bool Decline(long handle,uint pid,string state,string owner,long deadlineTicks) {
    var h=new IntPtr(handle); if(DateTime.UtcNow.Ticks>=deadlineTicks||!Bound(h,pid,state,owner)) return false;
    if(DateTime.UtcNow.Ticks>=deadlineTicks) return false;
    var no=GetDlgItem(h,7); UIntPtr ignored;
    // No keyboard, foreground/global title search, Yes control or arbitrary message.
    return SendMessageTimeoutW(no,0x00f5,IntPtr.Zero,IntPtr.Zero,2,2000,out ignored)!=IntPtr.Zero;
  }
}
'@
  while ([DateTime]::UtcNow -lt $deadline) {
    $current = ReadProcess $browserPid
    $currentQualifier = ReadProcess $qualifierPid
    if ((Birth $current) -cne $browserBirth -or $current.ParentProcessId -ne $qualifierPid `
        -or -not (SamePath $current.ExecutablePath $env:METAENGINE_QA_BROWSER_EXE) `
        -or (Birth $currentQualifier) -cne $qualifierBirth) { Refuse 'native_no_process_binding_changed' }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$browserPid" | Where-Object {
      $_.ExecutablePath -and (SamePath $_.ExecutablePath $powershell) -and $_.CreationDate -ge $browser.CreationDate
    })
    $matches = @()
    foreach ($child in $children) {
      foreach ($handle in [MetaengineNegativeConsent]::Find([uint32]$child.ProcessId,$statePath,$ownerPath)) {
        $matches += @{process=$child;handle=$handle;birth=(Birth $child)}
      }
    }
    if ($matches.Count -gt 1) { Refuse 'native_no_dialog_ambiguous' }
    if ($matches.Count -eq 1) {
      $match=$matches[0]
      $consentHandle=[Diagnostics.Process]::GetProcessById([int]$match.process.ProcessId); $null=$consentHandle.Handle
      if ($browserHandle.HasExited -or $qualifierHandle.HasExited -or $consentHandle.HasExited) { Refuse 'native_no_process_unavailable' }
      $child=ReadProcess ([uint32]$match.process.ProcessId); $current=ReadProcess $browserPid; $currentQualifier=ReadProcess $qualifierPid
      if ((Birth $current) -cne $browserBirth -or $current.ParentProcessId -ne $qualifierPid `
          -or -not (SamePath $current.ExecutablePath $env:METAENGINE_QA_BROWSER_EXE) `
          -or (Birth $currentQualifier) -cne $qualifierBirth -or -not (SamePath $currentQualifier.ExecutablePath $env:METAENGINE_QA_QUALIFIER_EXE) `
          -or (Birth $child) -cne $match.birth `
          -or $child.ParentProcessId -ne $browserPid -or -not (SamePath $child.ExecutablePath $powershell)) { Refuse 'native_no_process_binding_changed' }
      if ([DateTime]::UtcNow -ge $deadline) { Refuse 'native_no_dialog_timeout' }
      if (-not [MetaengineNegativeConsent]::Decline([long]$match.handle,[uint32]$child.ProcessId,$statePath,$ownerPath,$deadline.Ticks)) { Refuse 'native_no_control_unconfirmed' }
      @{schema='metaengine.browser.native-consent-denial-interaction.v1';browser_pid=$browserPid;browser_birth=$browserBirth;
        consent_pid=[uint32]$child.ProcessId;consent_birth=$match.birth;native_control_id=7;native_no_activated=$true;
        exact_process_tree_bound=$true;generated_fixture_bound=$true;authority_effect=$false} | ConvertTo-Json -Compress
      exit 0
    }
    Start-Sleep -Milliseconds 200
  }
  Refuse 'native_no_dialog_timeout'
} catch {
  $reason=[string]$_.Exception.Message
  if ($reason -notmatch '^native_no_[a-z_]+$') { $reason='native_no_readback_unavailable' }
  @{schema='metaengine.browser.native-consent-denial-hold.v1';reason=$reason;native_no_activated=$false;authority_effect=$false} | ConvertTo-Json -Compress
  exit 1
}
