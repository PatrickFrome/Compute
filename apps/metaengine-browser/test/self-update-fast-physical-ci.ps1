$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Get-Location).Path
$evidence = Join-Path $root 'self-update-fast-evidence'
$temp = $env:RUNNER_TEMP
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

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
    run_id = [string]$env:GITHUB_RUN_ID
    run_attempt = [string]$env:GITHUB_RUN_ATTEMPT
    exception_type = if ($_.Exception) { $_.Exception.GetType().FullName } else { $null }
    exception_message = if ($_.Exception) { [string]$_.Exception.Message } else { [string]$_ }
    fully_qualified_error_id = [string]$_.FullyQualifiedErrorId
    category = [string]$_.CategoryInfo.Category
    script_stack_trace = [string]$_.ScriptStackTrace
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
        try { Copy-Item $source (Join-Path $evidence $name) -Force -ErrorAction Stop } catch {}
      }
    }
  }
}
