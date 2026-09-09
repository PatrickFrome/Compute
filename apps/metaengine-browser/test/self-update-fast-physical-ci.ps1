$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Get-Location).Path
$evidence = Join-Path $root 'self-update-fast-evidence'
$temp = $env:RUNNER_TEMP
$maxDiagnosticBytes = 1MB
$maxFailureText = 8192
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

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
  'self-update-e2e-proof.txt'
)

try {
  & (Join-Path $PSScriptRoot 'self-update-fast-physical.ps1')
  'PASS' | Set-Content (Join-Path $evidence 'physical-script-status.txt')
} catch {
  'FAIL' | Set-Content (Join-Path $evidence 'physical-script-status.txt')
  $failure = [ordered]@{
    schema = 'metaengine.browser.self-update-physical-ci-failure.v1'
    git_sha = $head
    run_id = Limit-Text $env:GITHUB_RUN_ID 128
    run_attempt = Limit-Text $env:GITHUB_RUN_ATTEMPT 32
    exception_type = if ($_.Exception) { Limit-Text $_.Exception.GetType().FullName } else { $null }
    exception_message = if ($_.Exception) { Limit-Text $_.Exception.Message } else { Limit-Text $_ }
    fully_qualified_error_id = Limit-Text $_.FullyQualifiedErrorId
    category = Limit-Text $_.CategoryInfo.Category 256
    script_stack_trace = Limit-Text $_.ScriptStackTrace
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
