$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Get-Location).Path
$evidence = Join-Path $root 'self-update-fast-evidence'
$temp = $env:RUNNER_TEMP
$maxDiagnosticBytes = 1MB
$maxFailureText = 8192
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

# Never reuse another attempt's profile binding or failure projection.
if ($temp -and (Test-Path -LiteralPath $temp -PathType Container)) {
  foreach ($name in @('self-update-failure-context.json', 'self-update-failure-readback.json')) {
    Remove-Item -LiteralPath (Join-Path $temp $name) -Force -ErrorAction SilentlyContinue
  }
}


function Limit-Text([object]$value, [int]$limit = $maxFailureText) {
  if ($null -eq $value) { return $null }
  $text = [string]$value
  if ($text.Length -le $limit) { return $text }
  return $text.Substring(0, $limit) + '...[TRUNCATED]'
}

function Copy-BoundedDiagnostic([string]$source, [string]$destination, [string]$name) {
  $item = Get-Item $source -ErrorAction Stop
  if ([int64]$item.Length -le [int64]$maxDiagnosticBytes) {
    Copy-Item $source $destination -Force -ErrorAction Stop
    return
  }

  $metadata = [ordered]@{
    schema = 'metaengine.browser.self-update-diagnostic-oversize.v1'
    name = $name
    source_bytes = [int64]$item.Length
    retained_bytes_limit = [int64]$maxDiagnosticBytes
    full_copy_retained = $false
    authority_effect = $false
  }
  [System.IO.File]::WriteAllText(
    ($destination + '.oversize.json'),
    (($metadata | ConvertTo-Json -Compress) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )

  if ($name -match '\.(?:txt|out|err|jsonl)$') {
    $stream = [System.IO.File]::Open($source, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $retain = [int][Math]::Min([int64]$maxDiagnosticBytes, [int64]$stream.Length)
      [void]$stream.Seek(-[int64]$retain, [System.IO.SeekOrigin]::End)
      $buffer = [byte[]]::new($retain)
      $offset = 0
      while ($offset -lt $retain) {
        $read = $stream.Read($buffer, $offset, $retain - $offset)
        if ($read -le 0) { break }
        $offset += $read
      }
      if ($offset -gt 0) {
        if ($offset -ne $retain) { $buffer = $buffer[0..($offset - 1)] }
        [System.IO.File]::WriteAllBytes(($destination + '.tail'), $buffer)
      }
    } finally {
      $stream.Dispose()
    }
  }
}

function Write-FailureReadback {
  $fallback = [ordered]@{
    schema = 'metaengine.browser.self-update-failure-readback.v1'
    classification = 'CAPTURE_UNAVAILABLE'
    capture_only = $true
    verification_succeeded = $false
    installation_outcome_proven = $false
    automatic_retry_allowed = $false
    authority_effect = $false
  }
  $row = $fallback
  $process = $null
  try {
    $contextPath = Join-Path $temp 'self-update-failure-context.json'
    if (-not (Test-Path -LiteralPath $contextPath -PathType Leaf)) { throw 'context_unavailable' }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command node -ErrorAction Stop).Source
    $readerPath = Join-Path $root 'test/self-update-failure-readback.mjs'
    $start.Arguments = '"' + $readerPath + '" --context "' + $contextPath + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'capture_unavailable' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(15000)) {
      # This handle belongs only to our diagnostic reader, never the installer.
      try { $process.Kill() } catch {}
      [void]$process.WaitForExit(5000)
      throw 'capture_timeout'
    }
    $raw = $stdout.GetAwaiter().GetResult()
    [void]$stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0 -or [Text.Encoding]::UTF8.GetByteCount($raw) -gt 16384) { throw 'capture_invalid' }
    $candidate = $raw | ConvertFrom-Json -ErrorAction Stop
    if ($candidate.schema -ne 'metaengine.browser.self-update-failure-readback.v1' -or
      $candidate.capture_only -ne $true -or $candidate.verification_succeeded -ne $false -or
      $candidate.installation_outcome_proven -ne $false -or $candidate.automatic_retry_allowed -ne $false -or
      $candidate.authority_effect -ne $false) { throw 'capture_invalid' }
    $row = $candidate
  } catch { $row = $fallback }
  finally { if ($null -ne $process) { try { $process.Dispose() } catch {} } }
  try {
    $json = $row | ConvertTo-Json -Depth 8 -Compress
    [System.IO.File]::WriteAllText(
      (Join-Path $temp 'self-update-failure-readback.json'),
      ($json + "`n"), [System.Text.UTF8Encoding]::new($false))
    Write-Host $json
  } catch { # Preserve the original physical failure even if diagnostics cannot be saved.
  }
}

$head = (git rev-parse HEAD).Trim()
$head | Set-Content (Join-Path $evidence 'diagnostic-git-head.txt')
'RUNNING' | Set-Content (Join-Path $evidence 'physical-script-status.txt')

$diagnosticFiles = @(
  'baseline-version.txt',
  'baseline-sha256.txt',
  'baseline-version-probe.out',
  'baseline-version-probe.err',
  'baseline-profile-probe.out',
  'baseline-profile-probe.err',
  'target-version.txt',
  'target-sha256.txt',
  'target-version-probe.out',
  'target-version-probe.err',
  'target-profile-probe.out',
  'target-profile-probe.err',
  'self-update-smoke.jsonl',
  'self-update-smoke.out',
  'self-update-smoke.err',
  'self-update-feed.out',
  'self-update-feed.err',
  'self-update-pre-install-receipt.json',
  'self-update-successor-receipt.json',
  'self-update-e2e-proof.txt',
  'self-update-failure-readback.json'
)

try {
  $physicalScript = Join-Path $PSScriptRoot 'self-update-fast-physical.ps1'
  if ($env:ME2_REQUIRE_QUALIFIED_INSTALLER -eq '1') {
    $physicalScript = Join-Path $temp 'self-update-fast-physical-qualified.ps1'
    if (-not (Test-Path $physicalScript -PathType Leaf)) { throw 'qualified_self_update_rehearsal_missing' }
  }
  & $physicalScript
  'PASS' | Set-Content (Join-Path $evidence 'physical-script-status.txt')
} catch {
  $physicalFailure = $_
  Write-FailureReadback
  'FAIL' | Set-Content (Join-Path $evidence 'physical-script-status.txt')
  $failure = [ordered]@{
    schema = 'metaengine.browser.self-update-physical-ci-failure.v1'
    git_sha = $head
    run_id = Limit-Text $env:GITHUB_RUN_ID 128
    run_attempt = Limit-Text $env:GITHUB_RUN_ATTEMPT 32
    exception_type = if ($physicalFailure.Exception) { Limit-Text $physicalFailure.Exception.GetType().FullName } else { $null }
    exception_message = if ($physicalFailure.Exception) { Limit-Text $physicalFailure.Exception.Message } else { Limit-Text $physicalFailure }
    fully_qualified_error_id = Limit-Text $physicalFailure.FullyQualifiedErrorId
    category = Limit-Text $physicalFailure.CategoryInfo.Category 256
    script_stack_trace = Limit-Text $physicalFailure.ScriptStackTrace
    diagnostic_file_count_limit = $diagnosticFiles.Count
    diagnostic_bytes_per_file_limit = [int64]$maxDiagnosticBytes
    authority_effect = $false
    automatic_retry_allowed = $false
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $evidence 'self-update-diagnostic-failure.json'),
    (($failure | ConvertTo-Json -Depth 4) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  throw
} finally {
  if ($temp -and (Test-Path $temp -PathType Container)) {
    foreach ($name in $diagnosticFiles) {
      $source = Join-Path $temp $name
      if (Test-Path $source -PathType Leaf) {
        try { Copy-BoundedDiagnostic $source (Join-Path $evidence $name) $name } catch {}
      }
    }
  }
}
