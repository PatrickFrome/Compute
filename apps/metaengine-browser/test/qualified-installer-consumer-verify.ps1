$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:RUNNER_TEMP) { throw 'runner_temp_required' }
$fixture = Join-Path $env:RUNNER_TEMP ('qualified-consumer-verify-' + [guid]::NewGuid().ToString('N'))
$head = (git rev-parse HEAD).Trim()
$helper = Join-Path (Get-Location) 'scripts/qualified-installer-consumer.ps1'
New-Item -ItemType Directory -Force -Path $fixture | Out-Null
try {
  $installer = Join-Path $fixture 'METAENGINE-Browser-Test-Setup-0.7.0-dev.424242.1-x64.exe'
  $blockmap = $installer + '.blockmap'
  $config = Join-Path $fixture 'electron-builder.test.json'
  $provenance = Join-Path $fixture 'installer-provenance.json'
  $bindingPath = Join-Path $fixture 'consumer-binding.json'
  # Test bytes have no executable payload and are never launched.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes('read-only fixture installer')
  [System.IO.File]::WriteAllBytes($installer, $bytes)
  [System.IO.File]::WriteAllText($blockmap, 'fixture blockmap')
  [System.IO.File]::WriteAllText($config, '{"appId":"consumer.verify.fixture"}')
  & node './scripts/installer-provenance.mjs' 'write' '--installer' $installer '--out' $provenance `
    '--source-head' $head '--workflow' 'browser-windows-package-smoke.yml' `
    '--run-id' '424242' '--run-number' '42' '--run-attempt' '2' `
    '--package-version' '0.7.0-dev.424242.1' '--blockmap' $blockmap '--config' $config | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'fixture_provenance_write_failed' }
  $record = Get-Content $provenance -Raw | ConvertFrom-Json
  $binding = [ordered]@{
    schema = 'metaengine.browser.qualified-installer-consumer-binding.v1'
    source_head = $head
    installer_path = $installer
    installer_sha256 = [string]$record.installer_sha256
    provenance_path = $provenance
    producer_run_id = 424242
    producer_run_number = 42
    producer_run_attempt = 2
  }
  $binding | ConvertTo-Json | Set-Content $bindingPath -Encoding utf8
  & $helper -Mode Verify -ExpectedHead $head -BindingPath $bindingPath -ConfigPath $config | Out-Null
  $acquired = Get-Content (Join-Path $fixture 'acquired.json') -Raw | ConvertFrom-Json
  if ([string]$acquired.package_version -ne '0.7.0-dev.424242.1' -or [string]$acquired.blockmap_path -ne $blockmap) {
    throw 'fixture_verified_target_projection_invalid'
  }

  function Require-Refusal([string[]]$ExpectedCodes) {
    try {
      & $helper -Mode Verify -ExpectedHead $head -BindingPath $bindingPath -ConfigPath $config | Out-Null
      throw 'fixture_tampering_was_accepted'
    } catch {
      $matched = $false
      foreach ($code in $ExpectedCodes) {
        if ($_.Exception.Message -match [regex]::Escape($code)) { $matched = $true }
      }
      if (-not $matched) { throw }
    }
  }

  [System.IO.File]::WriteAllText($installer, 'tampered installer')
  Require-Refusal @('qualified_installer_reverify_failed', 'size_mismatch', 'sha_mismatch')
  [System.IO.File]::WriteAllBytes($installer, $bytes)
  $binding.producer_run_attempt = 3
  $binding | ConvertTo-Json | Set-Content $bindingPath -Encoding utf8
  Require-Refusal @('qualified_installer_reverify_failed', 'producer_run_attempt_mismatch')
  $binding.producer_run_attempt = 2
  $binding.installer_sha256 = ('0' * 64)
  $binding | ConvertTo-Json | Set-Content $bindingPath -Encoding utf8
  Require-Refusal 'qualified_installer_reverify_binding_drift'
  Write-Output '{"schema":"metaengine.browser.qualified-consumer-verify-smoke.v1","valid_binding_verified":true,"installer_tampering_rejected":true,"attempt_drift_rejected":true,"binding_digest_drift_rejected":true,"installer_executed":false}'
} finally {
  Remove-Item $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
