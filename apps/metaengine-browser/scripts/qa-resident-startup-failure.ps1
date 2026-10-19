param(
  [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ParentPid,
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$ProfilePath,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][ValidateSet('LEGACY_BEFORE_INSTALL','SUCCESSOR_AFTER_INSTALL')][string]$Phase,
  [string]$StdoutPath,
  [string]$StderrPath,
  [Nullable[int]]$ExitCode=$null
)
# Disposable CI failure readback only; never writes a profile, launches Browser
# or accepts a missing worker. Raw profile and process strings stay on stdin.
$ErrorActionPreference='Stop'
$readStates=@{}
function Read-DiagnosticText([string]$File,[string]$Key,[int]$Maximum) {
  try {
    if(-not $File -or -not [IO.Path]::IsPathRooted($File) -or $File.StartsWith('\\')){
      $readStates[$Key]='MISSING';return $null
    }
    $item=Get-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
    if(-not $item){$readStates[$Key]='MISSING';return $null}
    if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
      $readStates[$Key]='NOT_REGULAR';return $null
    }
    if($item.Length -gt $Maximum){$readStates[$Key]='OVERSIZED';return $null}
    $stream=[IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
      if($stream.Length -gt $Maximum){$readStates[$Key]='OVERSIZED';return $null}
      $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true)
      try {
        $buffer=New-Object char[] ($Maximum+1)
        $count=$reader.ReadBlock($buffer,0,$Maximum+1)
        if($count -gt $Maximum){$readStates[$Key]='OVERSIZED';return $null}
        $text=[string]::new($buffer,0,$count)
      }finally{$reader.Dispose()}
    }finally{$stream.Dispose()}
    $readStates[$Key]='READ';return $text
  }catch{$readStates[$Key]='READ_FAILED';return $null}
}
try {
  if(-not [IO.Path]::IsPathRooted($ProfilePath) -or $ProfilePath.StartsWith('\\') -or
     -not [IO.Path]::IsPathRooted($Executable) -or $Executable.StartsWith('\\')){
    throw 'diagnostic_path_invalid'
  }
  $journal=Read-DiagnosticText (Join-Path $ProfilePath 'metaengine-browser-startup-journal-v1.json') 'journal' 262144
  $sentinelPath=Join-Path $ProfilePath 'metaengine-browser-sentinel-v1.json'
  $state=Read-DiagnosticText $sentinelPath 'sentinel' 32768
  $heartbeat=Read-DiagnosticText ($sentinelPath+'.worker-heartbeat-v1.json') 'heartbeat' 32768
  $standardOut=Read-DiagnosticText $StdoutPath 'stdout' 65536
  $standardError=Read-DiagnosticText $StderrPath 'stderr' 65536
  $present=$null
  try{$present=(@(Get-CimInstance Win32_Process -Filter "ProcessId = $ParentPid" -ErrorAction Stop).Count -eq 1)}catch{}
  $worker=$null
  try {
    $parsed=$state | ConvertFrom-Json -ErrorAction Stop
    $workerPid=[long]$parsed.worker_pid
    if($workerPid -gt 0 -and $workerPid -le 2147483647){
      $rows=@(Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction Stop)
      if($rows.Count -eq 1){
        $worker=[ordered]@{ProcessId=[int]$rows[0].ProcessId;ParentProcessId=[int]$rows[0].ParentProcessId;
          ExecutablePath=[string]$rows[0].ExecutablePath;CommandLine=[string]$rows[0].CommandLine}
      }
    }
  }catch{}
  $inputValue=[ordered]@{
    phase=$Phase;parentPid=$ParentPid;version=$ExpectedVersion;executable=$Executable;
    journalText=$journal;sentinelText=$state;heartbeatText=$heartbeat;
    stdout=$standardOut;stderr=$standardError;parentAlive=$present;exitCode=$ExitCode;
    workerProcess=$worker;readStates=$readStates
  }
  # The serializer emits only reviewed fixed fields; neither raw command lines
  # nor a model/page/profile string can cross the diagnostic output boundary.
  ($inputValue | ConvertTo-Json -Depth 12 -Compress) |
    & node (Join-Path $PSScriptRoot 'qa-resident-sentinel-readback.mjs') --startup-failure-readback
  if($LASTEXITCODE -ne 0){throw 'diagnostic_serializer_failed'}
}catch {
  [ordered]@{schema='metaengine.browser.qa-resident-startup-failure.v1';
    state='CAPTURE_UNAVAILABLE';failure_phase=$Phase;expected_parent_pid=$ParentPid;
    capture_only=$true;verification_succeeded=$false;automatic_retry_allowed=$false;
    production_authorized=$false;authority_effect=$false} | ConvertTo-Json -Compress
}
