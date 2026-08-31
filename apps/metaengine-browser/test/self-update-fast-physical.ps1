$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-LastJsonLine([string]$Path, [int]$TimeoutSeconds = 15) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-Path $Path) {
      $lines = @(Get-Content $Path -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })
      for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        try { return ($lines[$i] | ConvertFrom-Json -ErrorAction Stop) } catch {}
      }
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $deadline)
  throw "parseable_json_timeout:$Path"
}

function Wait-ExitOrThrow($Process, [int]$TimeoutMs, [string]$Label, [string]$ErrPath) {
  $null = $Process.Handle
  if (-not $Process.WaitForExit($TimeoutMs)) {
    try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
    Get-Content $ErrPath -ErrorAction SilentlyContinue
    throw "${Label}_timeout"
  }
  if ($Process.ExitCode -ne 0) {
    Get-Content $ErrPath -ErrorAction SilentlyContinue
    throw "${Label}_exit_$($Process.ExitCode)"
  }
}

$root = (Get-Location).Path
$temp = $env:RUNNER_TEMP
if (-not $temp) { throw 'runner_temp_required' }

# Resolve the newest published release with the exact same trust resolver used by runtime.
$baselineJson = Join-Path $temp 'baseline-release.json'
$resolveScript = @'
import fs from 'node:fs';
import { resolveTrustedMetaengineDevRelease } from './src/trusted-dev-release-resolver.mjs';
const row = await resolveTrustedMetaengineDevRelease({ currentVersion: '0.6.3-dev.0.1' });
if (!row || row.authority_effect !== false) throw new Error('published_baseline_resolution_failed');
fs.writeFileSync(process.env.BASELINE_JSON, JSON.stringify(row));
'@
$env:BASELINE_JSON = $baselineJson
node --input-type=module -e $resolveScript
$baselineRelease = Get-Content $baselineJson -Raw | ConvertFrom-Json
$baseline = [string]$baselineRelease.version
if ($baseline -notmatch '^0\.6\.3-dev\.[0-9]+\.1$') { throw "baseline_version_invalid:$baseline" }
$baselineUrl = ([string]$baselineRelease.feed_url) + ([string]$baselineRelease.installer_name)
$baselineInstaller = Join-Path $temp 'baseline-setup.exe'
Invoke-WebRequest -UseBasicParsing -Uri $baselineUrl -OutFile $baselineInstaller
$baselineDigest = (Get-FileHash $baselineInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($baselineDigest -ne [string]$baselineRelease.installer_sha256) { throw 'baseline_installer_digest_mismatch' }
$baseline | Set-Content (Join-Path $temp 'baseline-version.txt')
$baselineDigest | Set-Content (Join-Path $temp 'baseline-sha256.txt')

# Install the already-proven baseline and seal a real profile continuity marker.
$install = Start-Process -FilePath $baselineInstaller -ArgumentList '/S' -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "baseline_installer_exit_$($install.ExitCode)" }
$app = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test\METAENGINE Browser Test.exe'
if (-not (Test-Path $app)) { throw "baseline_browser_missing:$app" }
$app | Set-Content (Join-Path $temp 'installed-app-path.txt')

$probeOut = Join-Path $temp 'baseline-version-probe.out'
$probeErr = Join-Path $temp 'baseline-version-probe.err'
$p = Start-Process -FilePath $app -ArgumentList '--metaengine-version-probe' -PassThru -RedirectStandardOutput $probeOut -RedirectStandardError $probeErr
Wait-ExitOrThrow $p 15000 'baseline_version_probe' $probeErr
$versionRow = Read-LastJsonLine $probeOut
if ([string]$versionRow.version -ne $baseline -or $versionRow.primary_instance -ne $true) { throw 'baseline_version_probe_invalid' }

$env:METAENGINE_PROFILE_PROBE_WRITE = '1'
$profileOut = Join-Path $temp 'baseline-profile-probe.out'
$profileErr = Join-Path $temp 'baseline-profile-probe.err'
$profile = Start-Process -FilePath $app -ArgumentList '--metaengine-profile-probe' -PassThru -RedirectStandardOutput $profileOut -RedirectStandardError $profileErr
Wait-ExitOrThrow $profile 15000 'baseline_profile_probe' $profileErr
Remove-Item Env:METAENGINE_PROFILE_PROBE_WRITE -ErrorAction SilentlyContinue
$profileRow = Read-LastJsonLine $profileOut
if ($profileRow.marker_present -ne $true -or -not $profileRow.user_data_path) { throw 'baseline_profile_probe_invalid' }
[string]$profileRow.user_data_path | Set-Content (Join-Path $temp 'baseline-user-data-path.txt')

# Build exactly one new target. Preserve a permanent floor above the newest locally deployed pre-release,
# then use UTC or published-baseline+1 thereafter so every verified release remains monotonic.
$baselineBuild = [Int64](($baseline -split '\.')[3].Replace('dev','').TrimStart('-'))
$timestampBuild = [Int64]([DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
$deployedBuildFloor = [Int64]20260831143001
$buildId = [Math]::Max($timestampBuild, [Math]::Max($baselineBuild + 1, $deployedBuildFloor)).ToString()
$target = "0.6.3-dev.$buildId.1"
if ([Int64]$buildId -le $baselineBuild) { throw "target_version_not_monotonic:${buildId}:${baselineBuild}" }
npm pkg set version=$target
Remove-Item dist-test -Recurse -Force -ErrorAction SilentlyContinue
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx --yes electron-builder@26.15.7 --win nsis --x64 --config electron-builder.test.json --publish never
$installer = Get-ChildItem dist-test -Filter "METAENGINE-Browser-Test-Setup-$target-x64.exe" -File | Select-Object -First 1
$blockmap = Get-ChildItem dist-test -Filter "METAENGINE-Browser-Test-Setup-$target-x64.exe.blockmap" -File | Select-Object -First 1
if (-not $installer) { throw 'target_installer_missing' }
if (-not $blockmap) { throw 'target_blockmap_missing' }

$feed = Join-Path $temp 'self-update-feed'
Remove-Item $feed -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $feed | Out-Null
Copy-Item $installer.FullName (Join-Path $feed $installer.Name)
Copy-Item $blockmap.FullName (Join-Path $feed $blockmap.Name)
$sha512Provider = [System.Security.Cryptography.SHA512]::Create()
try { $sha512 = [Convert]::ToBase64String($sha512Provider.ComputeHash([System.IO.File]::ReadAllBytes($installer.FullName))) }
finally { $sha512Provider.Dispose() }
$releaseDate = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$devYmlPath = Join-Path $feed 'dev.yml'
$devYmlLines = @(
  "version: $target",
  'files:',
  "  - url: $($installer.Name)",
  "    sha512: $sha512",
  "    size: $($installer.Length)",
  "path: $($installer.Name)",
  "sha512: $sha512",
  "releaseDate: '$releaseDate'",
  'stagingPercentage: 100'
)
[System.IO.File]::WriteAllLines($devYmlPath, $devYmlLines, [System.Text.UTF8Encoding]::new($false))
$devBytes = [System.IO.File]::ReadAllBytes($devYmlPath)
if ($devBytes.Length -ge 3 -and $devBytes[0] -eq 0xEF -and $devBytes[1] -eq 0xBB -and $devBytes[2] -eq 0xBF) { throw 'target_dev_yml_utf8_bom_present' }
$target | Set-Content (Join-Path $temp 'target-version.txt')
$installer.FullName | Set-Content (Join-Path $temp 'target-installer-path.txt')
$blockmap.FullName | Set-Content (Join-Path $temp 'target-blockmap-path.txt')
$devYmlPath | Set-Content (Join-Path $temp 'target-dev-yml-path.txt')
(Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant() | Set-Content (Join-Path $temp 'target-sha256.txt')

# Run one real updater transaction from the published baseline into the one-built target.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop()
$env:METAENGINE_UPDATE_FEED_ROOT = $feed
$env:METAENGINE_UPDATE_FEED_PORT = "$port"
$env:METAENGINE_UPDATE_FEED_READY = Join-Path $temp 'self-update-feed.ready'
$env:GITHUB_ACTIONS = 'true'
$env:METAENGINE_SELF_UPDATE_TEST_MODE = '1'
$env:METAENGINE_DISABLE_CRASH_SENTINEL = '1'
Remove-Item $env:METAENGINE_UPDATE_FEED_READY -Force -ErrorAction SilentlyContinue
$server = $null
try {
  $server = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'test/self-update-feed-server.cjs' -WorkingDirectory $root -PassThru -RedirectStandardOutput (Join-Path $temp 'self-update-feed.out') -RedirectStandardError (Join-Path $temp 'self-update-feed.err')
  $null = $server.Handle
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path $env:METAENGINE_UPDATE_FEED_READY) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $env:METAENGINE_UPDATE_FEED_READY)) { throw 'self_update_feed_not_ready' }

  $userData = (Get-Content (Join-Path $temp 'baseline-user-data-path.txt')).Trim()
  $preInstallPath = Join-Path $userData 'metaengine-self-update-pre-install-receipt-v1.json'
  $successorPath = Join-Path $userData 'metaengine-self-update-successor-receipt-v1.json'
  Remove-Item $preInstallPath,$successorPath -Force -ErrorAction SilentlyContinue
  $env:METAENGINE_SELF_UPDATE_TEST_FEED_URL = "http://127.0.0.1:$port/"
  $env:METAENGINE_SELF_UPDATE_SMOKE_TRACE = Join-Path $temp 'self-update-smoke.jsonl'
  Remove-Item $env:METAENGINE_SELF_UPDATE_SMOKE_TRACE -Force -ErrorAction SilentlyContinue

  $smokeOut = Join-Path $temp 'self-update-smoke.out'; $smokeErr = Join-Path $temp 'self-update-smoke.err'
  $source = Start-Process -FilePath $app -ArgumentList '--metaengine-self-update-smoke' -PassThru -RedirectStandardOutput $smokeOut -RedirectStandardError $smokeErr
  $sourcePid = $source.Id
  Wait-ExitOrThrow $source 150000 'self_update_source' $smokeErr

  $traceDeadline = (Get-Date).AddSeconds(10)
  $verified = $false; $feedActive = $false; $handoffPrepared = $false
  do {
    $rows = @()
    if (Test-Path $env:METAENGINE_SELF_UPDATE_SMOKE_TRACE) {
      try { $rows = @(Get-Content $env:METAENGINE_SELF_UPDATE_SMOKE_TRACE | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json }) } catch { $rows = @() }
    }
    $verified = [bool]($rows | Where-Object { ($_.PSObject.Properties.Name -contains 'metadata_verified') -and $_.metadata_verified -eq $true -and ($_.PSObject.Properties.Name -contains 'available_version') -and [string]$_.available_version -eq $target })
    $feedActive = [bool]($rows | Where-Object { ($_.PSObject.Properties.Name -contains 'ci_test_feed_active') -and $_.ci_test_feed_active -eq $true })
    $handoffPrepared = [bool]($rows | Where-Object { ($_.PSObject.Properties.Name -contains 'label') -and $_.label -eq 'INSTALLER_HANDOFF_PREPARED' -and ($_.PSObject.Properties.Name -contains 'singleton_lock_released') -and $_.singleton_lock_released -eq $true })
    if ($verified -and $feedActive -and $handoffPrepared) { break }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $traceDeadline)
  if (-not $verified) { throw 'self_update_verified_target_not_observed' }
  if (-not $feedActive) { throw 'self_update_ci_feed_not_active' }
  if (-not $handoffPrepared) { throw 'self_update_installer_handoff_not_observed' }
  if (-not (Test-Path $preInstallPath)) { throw 'self_update_pre_install_receipt_missing' }

  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Path $successorPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
  if (-not (Test-Path $successorPath)) { throw 'self_update_durable_successor_receipt_missing' }
  $successor = Get-Content $successorPath -Raw | ConvertFrom-Json
  if ($successor.schema -ne 'metaengine.self-update.successor-receipt.v1') { throw 'successor_schema_invalid' }
  if ([string]$successor.version -ne $target -or $successor.primary_instance -ne $true) { throw 'successor_target_binding_invalid' }
  if ([string]$successor.app_id -ne 'com.metaengine.browser.test' -or [string]$successor.successor_startup -ne 'PROBE_ONLY') { throw 'successor_identity_invalid' }
  if ($successor.authority_effect -ne $false) { throw 'successor_authority_invalid' }
  $preInstallSha = (Get-FileHash $preInstallPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([string]$successor.pre_install_receipt_sha256 -ne $preInstallSha) { throw 'successor_receipt_digest_mismatch' }
  Copy-Item $preInstallPath (Join-Path $temp 'self-update-pre-install-receipt.json')
  Copy-Item $successorPath (Join-Path $temp 'self-update-successor-receipt.json')
  @(
    "source_pid=$sourcePid", "baseline_version=$baseline", "target_version=$target", "successor_pid=$($successor.pid)",
    "pre_install_receipt_sha256=$preInstallSha", 'metadata_verified=PASS', 'restart_state_durable=PASS',
    'durable_successor_binding=PASS', 'forced_relaunch=PASS', 'published_baseline_reused=PASS', 'target_build_count=1'
  ) | Set-Content (Join-Path $temp 'self-update-e2e-proof.txt')
} finally {
  if ($server -and -not $server.HasExited) { try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {} }
}

# Successor version, profile continuity and singleton.
$targetProbeOut = Join-Path $temp 'target-version-probe.out'; $targetProbeErr = Join-Path $temp 'target-version-probe.err'
$targetProbe = Start-Process -FilePath $app -ArgumentList '--metaengine-version-probe' -PassThru -RedirectStandardOutput $targetProbeOut -RedirectStandardError $targetProbeErr
Wait-ExitOrThrow $targetProbe 15000 'target_version_probe' $targetProbeErr
$targetVersionRow = Read-LastJsonLine $targetProbeOut
if ([string]$targetVersionRow.version -ne $target) { throw 'target_version_probe_mismatch' }

$targetProfileOut = Join-Path $temp 'target-profile-probe.out'; $targetProfileErr = Join-Path $temp 'target-profile-probe.err'
$targetProfile = Start-Process -FilePath $app -ArgumentList '--metaengine-profile-probe' -PassThru -RedirectStandardOutput $targetProfileOut -RedirectStandardError $targetProfileErr
Wait-ExitOrThrow $targetProfile 15000 'target_profile_probe' $targetProfileErr
$targetProfileRow = Read-LastJsonLine $targetProfileOut
$baselinePath = (Get-Content (Join-Path $temp 'baseline-user-data-path.txt')).Trim()
if ($targetProfileRow.marker_present -ne $true -or [string]$targetProfileRow.user_data_path -ne $baselinePath) { throw 'profile_continuity_invalid' }
$folders = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Directory | Where-Object { $_.Name -eq 'METAENGINE Browser Test' })
if ($folders.Count -ne 1) { throw "in_place_install_directory_count_invalid:$($folders.Count)" }
Add-Content (Join-Path $temp 'self-update-e2e-proof.txt') 'target_version_probe=PASS'
Add-Content (Join-Path $temp 'self-update-e2e-proof.txt') 'real_user_data_continuity=PASS'
Add-Content (Join-Path $temp 'self-update-e2e-proof.txt') 'in_place_install_directory=PASS'

$firstOut = Join-Path $temp 'singleton-first.out'; $firstErr = Join-Path $temp 'singleton-first.err'
$first = Start-Process -FilePath $app -ArgumentList '--metaengine-single-instance-probe' -PassThru -RedirectStandardOutput $firstOut -RedirectStandardError $firstErr
$null = $first.Handle
$firstRow = Read-LastJsonLine $firstOut 10
$first.Refresh()
if ($first.HasExited -or $firstRow.primary_instance -ne $true) { throw 'singleton_primary_probe_invalid' }
$secondOut = Join-Path $temp 'singleton-second.out'; $secondErr = Join-Path $temp 'singleton-second.err'
$second = Start-Process -FilePath $app -ArgumentList '--metaengine-single-instance-probe' -PassThru -RedirectStandardOutput $secondOut -RedirectStandardError $secondErr
Wait-ExitOrThrow $second 5000 'singleton_secondary' $secondErr
$first.Refresh()
if ($first.HasExited) { throw 'singleton_secondary_displaced_primary' }
try { Stop-Process -Id $first.Id -Force -ErrorAction SilentlyContinue } catch {}
Add-Content (Join-Path $temp 'self-update-e2e-proof.txt') 'physical_singleton=PASS'

# Stage exact target bytes; publisher must never rebuild them.
$evidence = Join-Path $root 'self-update-fast-evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
foreach ($file in @('baseline-version.txt','target-version.txt','baseline-sha256.txt','target-sha256.txt','baseline-user-data-path.txt','baseline-version-probe.out','baseline-profile-probe.out','target-version-probe.out','target-profile-probe.out','self-update-smoke.jsonl','self-update-smoke.out','self-update-smoke.err','self-update-pre-install-receipt.json','self-update-successor-receipt.json','self-update-e2e-proof.txt','singleton-first.out','singleton-second.out','self-update-feed.out','self-update-feed.err')) {
  $sourcePath = Join-Path $temp $file
  if (Test-Path $sourcePath) { Copy-Item $sourcePath $evidence }
}
$head = (git rev-parse HEAD).Trim()
$head | Set-Content (Join-Path $evidence 'git-head.txt')
$targetInstaller = Get-Item ((Get-Content (Join-Path $temp 'target-installer-path.txt')).Trim())
$targetBlockmap = Get-Item ((Get-Content (Join-Path $temp 'target-blockmap-path.txt')).Trim())
$targetDevYml = Get-Item ((Get-Content (Join-Path $temp 'target-dev-yml-path.txt')).Trim())
$expectedTargetSha = (Get-Content (Join-Path $temp 'target-sha256.txt')).Trim()
$actualTargetSha = (Get-FileHash $targetInstaller.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualTargetSha -ne $expectedTargetSha) { throw 'verified_target_digest_changed_before_staging' }
Copy-Item $targetInstaller.FullName $evidence
Copy-Item $targetBlockmap.FullName $evidence
Copy-Item $targetDevYml.FullName (Join-Path $evidence 'dev.yml')
$manifest = [ordered]@{
  schema = 'metaengine.browser.self-update-e2e-manifest.v2'
  version = $target
  git_sha = $head
  run_id = [string]$env:GITHUB_RUN_ID
  run_attempt = [string]$env:GITHUB_RUN_ATTEMPT
  installer_name = $targetInstaller.Name
  installer_sha256 = $actualTargetSha
  blockmap_name = $targetBlockmap.Name
  update_channel = 'dev'
  update_metadata = 'dev.yml'
  physical_n_to_n_plus_1 = $true
  durable_successor_binding = $true
  forced_successor = $true
  profile_continuity = $true
  single_install_directory = $true
  physical_singleton = $true
  development_channel = $true
  published_baseline_reused = $true
  target_build_count = 1
  production_safe = $false
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $evidence 'verified-self-update-manifest.json'), $manifest + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "FAST_SELF_UPDATE_PASS baseline=$baseline target=$target source=$head"