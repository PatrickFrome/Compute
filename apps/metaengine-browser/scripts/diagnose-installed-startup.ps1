param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\Programs\METAENGINE Browser Test",
  [string]$UserData = "$env:APPDATA\@metaengine\browser-shell"
)

$ErrorActionPreference = 'Stop'

function File-Probe([string]$Path) {
  if (-not (Test-Path $Path)) { return @{ path=$Path; exists=$false } }
  $item = Get-Item $Path -Force
  if ($item.PSIsContainer) {
    return @{ path=$Path; exists=$true; kind='DIRECTORY'; length=$null; last_write_utc=$item.LastWriteTimeUtc.ToString('o') }
  }
  $hash = $null
  try { $hash = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant() } catch {}
  return @{
    path=$Path
    exists=$true
    kind='FILE'
    length=$item.Length
    last_write_utc=$item.LastWriteTimeUtc.ToString('o')
    sha256=$hash
  }
}

$exe = Join-Path $InstallRoot 'METAENGINE Browser Test.exe'
$journal = Join-Path $UserData 'metaengine-browser-startup-journal-v1.json'
$sentinel = Join-Path $UserData 'metaengine-browser-sentinel-v1.json'
$sentinelHeartbeat = "$sentinel.worker-heartbeat-v1.json"
$fleet = Join-Path $UserData 'metaengine-fleet-state-v1.json'
$fleetTemp = "$fleet.tmp"

$processRows = @()
try {
  $processRows = @(Get-CimInstance Win32_Process -Filter "Name='METAENGINE Browser Test.exe'" | ForEach-Object {
    @{
      pid = [int]$_.ProcessId
      parent_pid = [int]$_.ParentProcessId
      executable_path = [string]$_.ExecutablePath
      command_line_sha256 = if ($_.CommandLine) {
        $bytes = [Text.Encoding]::UTF8.GetBytes([string]$_.CommandLine)
        $sha = [Security.Cryptography.SHA256]::Create()
        try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
      } else { $null }
    }
  })
} catch {}

$journalSummary = $null
if (Test-Path $journal -PathType Leaf) {
  try {
    $j = Get-Content $journal -Raw | ConvertFrom-Json
    $events = @($j.events | Where-Object { $_.boot_id -eq $j.current_boot_id })
    $last = $events | Select-Object -Last 1
    $journalSummary = @{
      schema = [string]$j.schema
      current_version = [string]$j.current_version
      current_pid = [int]$j.current_pid
      current_boot_id = [string]$j.current_boot_id
      last_sequence = [int64]$j.last_sequence
      last_state = if ($last) { [string]$last.state } else { $null }
      last_reason = if ($last) { [string]$last.reason } else { $null }
      states = @($events | ForEach-Object { [string]$_.state })
      errors = @($events | Where-Object { $_.error } | ForEach-Object {
        @{ state=[string]$_.state; name=[string]$_.error.name; code=[string]$_.error.code; message=[string]$_.error.message }
      })
    }
  } catch {
    $journalSummary = @{ parse_error = [string]$_.Exception.Message }
  }
}

$applicationErrors = @()
try {
  $start = (Get-Date).AddDays(-1)
  $applicationErrors = @(Get-WinEvent -FilterHashtable @{ LogName='Application'; StartTime=$start; Level=2 } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'METAENGINE Browser Test' -or $_.Message -match 'electron' } |
    Select-Object -First 12 |
    ForEach-Object { @{ id=$_.Id; provider=$_.ProviderName; time=$_.TimeCreated.ToUniversalTime().ToString('o'); message_sha256=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$_.Message)))).Replace('-','').ToLowerInvariant() } })
} catch {}

$result = @{
  schema = 'metaengine.browser.installed-startup-diagnostics.v1'
  collected_at = (Get-Date).ToUniversalTime().ToString('o')
  install_root = $InstallRoot
  user_data = $UserData
  executable = File-Probe $exe
  startup_journal = File-Probe $journal
  startup_journal_summary = $journalSummary
  sentinel_state = File-Probe $sentinel
  sentinel_worker_heartbeat = File-Probe $sentinelHeartbeat
  fleet_state = File-Probe $fleet
  fleet_temp_path = File-Probe $fleetTemp
  matching_browser_processes = $processRows
  recent_application_error_metadata = $applicationErrors
  secret_values_collected = $false
  file_contents_collected = $false
  command_line_contents_collected = $false
  authority_effect = $false
}

$result | ConvertTo-Json -Depth 10
