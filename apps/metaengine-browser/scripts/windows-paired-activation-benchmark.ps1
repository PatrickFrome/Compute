param(
  [Parameter(Mandatory = $true)][string]$BaselineInstaller,
  [Parameter(Mandatory = $true)][string]$CandidateInstaller,
  [Parameter(Mandatory = $true)][string]$BaselineSourceHead,
  [Parameter(Mandatory = $true)][string]$CandidateSourceHead,
  [Parameter(Mandatory = $true)][string]$RunnerTemp,
  [Parameter(Mandatory = $true)][string]$EvidencePath,
  [int]$ActivationCount = 64,
  [int]$ConcurrentBurstSize = 8
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]$env:GITHUB_ACTIONS -ne 'true' -or [string]$env:CI -ne 'true') { throw 'paired_activation_benchmark_ci_only' }
if (-not $env:RUNNER_TEMP) { throw 'paired_activation_benchmark_runner_temp_missing' }

$runnerTempFull = [IO.Path]::GetFullPath($RunnerTemp)
$officialRunnerTemp = [IO.Path]::GetFullPath([string]$env:RUNNER_TEMP)
if (-not $runnerTempFull.StartsWith($officialRunnerTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'paired_activation_benchmark_runner_temp_outside_ci_root' }
foreach ($path in @($BaselineInstaller, $CandidateInstaller)) {
  if (-not (Test-Path $path -PathType Leaf)) { throw "paired_activation_installer_missing:$path" }
}
foreach ($head in @($BaselineSourceHead, $CandidateSourceHead)) {
  if ($head -notmatch '^[0-9a-fA-F]{40}$') { throw 'paired_activation_source_head_invalid' }
}
if ($BaselineSourceHead -eq $CandidateSourceHead) { throw 'paired_activation_distinct_sources_required' }
if ($ActivationCount -lt 16 -or $ActivationCount -gt 96) { throw 'paired_activation_count_invalid' }
if ($ConcurrentBurstSize -lt 0 -or $ConcurrentBurstSize -gt 16) { throw 'paired_activation_burst_invalid' }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$soakScript = Join-Path $scriptRoot 'windows-autonomous-session-soak.ps1'
if (-not (Test-Path $soakScript -PathType Leaf)) { throw 'paired_activation_soak_harness_missing' }

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\METAENGINE Browser Test'
$appRelative = 'METAENGINE Browser Test.exe'
$workspace = Join-Path $runnerTempFull 'paired-activation-benchmark'
$baselineSnapshot = Join-Path $workspace 'baseline-app'
$candidateSnapshot = Join-Path $workspace 'candidate-app'
New-Item -ItemType Directory -Path $workspace -Force | Out-Null

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Stop-BenchmarkBrowser {
  Get-Process -Name 'METAENGINE Browser Test' -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
  }
  Start-Sleep -Milliseconds 250
}

function Install-And-Snapshot([string]$Installer, [string]$SnapshotRoot) {
  Stop-BenchmarkBrowser
  $install = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait
  if ($install.ExitCode -ne 0) { throw "paired_activation_installer_exit_$($install.ExitCode)" }
  $installedApp = Join-Path $installRoot $appRelative
  if (-not (Test-Path $installedApp -PathType Leaf)) { throw 'paired_activation_installed_app_missing' }
  Remove-Item $SnapshotRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $SnapshotRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $installRoot '*') -Destination $SnapshotRoot -Recurse -Force
  $snapshotApp = Join-Path $SnapshotRoot $appRelative
  if (-not (Test-Path $snapshotApp -PathType Leaf)) { throw 'paired_activation_snapshot_app_missing' }
  return $snapshotApp
}

function Read-VersionProbe([string]$AppPath, [string]$Label) {
  Stop-BenchmarkBrowser
  $probeRoot = Join-Path $workspace "probe-$Label"
  New-Item -ItemType Directory -Path $probeRoot -Force | Out-Null
  $out = Join-Path $probeRoot 'stdout.txt'
  $err = Join-Path $probeRoot 'stderr.txt'
  $proc = Start-Process -FilePath $AppPath -ArgumentList '--metaengine-version-probe' -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $proc.Handle
  if (-not $proc.WaitForExit(15000)) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    throw "paired_activation_version_probe_timeout:$Label"
  }
  if ($proc.ExitCode -ne 0) { throw "paired_activation_version_probe_exit:$Label:$($proc.ExitCode)" }
  $line = Get-Content $out | Where-Object { $_.Trim() } | Select-Object -Last 1
  if (-not $line) { throw "paired_activation_version_probe_output_missing:$Label" }
  $row = $line | ConvertFrom-Json
  if ($row.schema -ne 'metaengine.browser.version-probe.v1' -or -not [string]$row.version) { throw "paired_activation_version_probe_invalid:$Label" }
  return [string]$row.version
}

function Invoke-Sample([string]$Side, [int]$Round, [string]$AppPath, [string]$SourceHead, [string]$PackageVersion, [string]$InstallerSha256) {
  $label = "$Side-$Round"
  $sampleRoot = Join-Path $workspace $label
  $profileRoot = Join-Path $sampleRoot 'appdata'
  New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
  $proofPath = Join-Path $sampleRoot 'proof.json'
  [ordered]@{
    schema='metaengine.browser.paired-activation-sample.v1'
    side=$Side
    round=$Round
    source_head=$SourceHead.ToLowerInvariant()
    package_version=$PackageVersion
    installer_sha256=$InstallerSha256
    paired_same_runner=$true
    authority_effect=$false
  } | ConvertTo-Json -Depth 4 | Set-Content $proofPath -Encoding utf8

  $priorAppData = $env:APPDATA
  try {
    $env:APPDATA = $profileRoot
    $soakArgs = @{
      AppPath=$AppPath
      ProofPath=$proofPath
      RunnerTemp=$sampleRoot
      ActivationCount=$ActivationCount
      ConcurrentBurstSize=$ConcurrentBurstSize
      PostActivationHoldSeconds=5
      ActivationP95BudgetMs=1000
      MaxWorkingSetGrowthBytes=67108864
      MaxHandleGrowth=24
    }
    & $soakScript @soakArgs
  } finally {
    $env:APPDATA = $priorAppData
    Stop-BenchmarkBrowser
  }

  $proof = Get-Content $proofPath -Raw | ConvertFrom-Json
  if ([int]$proof.activation_latency_sample_count -ne $ActivationCount) { throw "paired_activation_sample_count_invalid:$label" }
  if (@($proof.activation_latency_samples_ms).Count -ne $ActivationCount) { throw "paired_activation_raw_samples_missing:$label" }
  if ([string]$proof.source_head -ne $SourceHead.ToLowerInvariant()) { throw "paired_activation_source_binding_drift:$label" }
  return $proof
}

function Get-Distribution([double[]]$Samples) {
  if ($Samples.Count -lt 1) { throw 'paired_activation_distribution_empty' }
  $sorted = @($Samples | Sort-Object)
  $p50i = [Math]::Max(0, [Math]::Min($sorted.Count - 1, [Math]::Ceiling($sorted.Count * 0.50) - 1))
  $p90i = [Math]::Max(0, [Math]::Min($sorted.Count - 1, [Math]::Ceiling($sorted.Count * 0.90) - 1))
  $p95i = [Math]::Max(0, [Math]::Min($sorted.Count - 1, [Math]::Ceiling($sorted.Count * 0.95) - 1))
  $p99i = [Math]::Max(0, [Math]::Min($sorted.Count - 1, [Math]::Ceiling($sorted.Count * 0.99) - 1))
  return [ordered]@{
    sample_count=$sorted.Count
    min_ms=[Math]::Round([double]$sorted[0],2)
    p50_ms=[Math]::Round([double]$sorted[$p50i],2)
    p90_ms=[Math]::Round([double]$sorted[$p90i],2)
    p95_ms=[Math]::Round([double]$sorted[$p95i],2)
    p99_ms=[Math]::Round([double]$sorted[$p99i],2)
    max_ms=[Math]::Round([double]$sorted[$sorted.Count - 1],2)
    mean_ms=[Math]::Round([double](($Samples | Measure-Object -Average).Average),2)
  }
}

if (Get-Service -Name 'METAENGINEBrowserGuardian' -ErrorAction SilentlyContinue) { throw 'paired_activation_guardian_service_preexists' }

$baselineInstallerSha = Get-Sha256 $BaselineInstaller
$candidateInstallerSha = Get-Sha256 $CandidateInstaller

# Install each immutable subject once, snapshot the complete installed app, then
# benchmark ABBA from the snapshots. This avoids downgrade/reinstall effects while
# controlling same-runner temporal drift.
$baselineApp = Install-And-Snapshot $BaselineInstaller $baselineSnapshot
$baselineVersion = Read-VersionProbe $baselineApp 'baseline'
$candidateApp = Install-And-Snapshot $CandidateInstaller $candidateSnapshot
$candidateVersion = Read-VersionProbe $candidateApp 'candidate'

$order = @(
  @{side='baseline';round=1;app=$baselineApp;head=$BaselineSourceHead;version=$baselineVersion;sha=$baselineInstallerSha},
  @{side='candidate';round=1;app=$candidateApp;head=$CandidateSourceHead;version=$candidateVersion;sha=$candidateInstallerSha},
  @{side='candidate';round=2;app=$candidateApp;head=$CandidateSourceHead;version=$candidateVersion;sha=$candidateInstallerSha},
  @{side='baseline';round=2;app=$baselineApp;head=$BaselineSourceHead;version=$baselineVersion;sha=$baselineInstallerSha}
)

$proofs = New-Object 'System.Collections.Generic.List[object]'
foreach ($item in $order) {
  $proofs.Add((Invoke-Sample $item.side $item.round $item.app $item.head $item.version $item.sha))
}

$baselineSamples = @($proofs | Where-Object { $_.side -eq 'baseline' } | ForEach-Object { @($_.activation_latency_samples_ms) } | ForEach-Object { [double]$_ })
$candidateSamples = @($proofs | Where-Object { $_.side -eq 'candidate' } | ForEach-Object { @($_.activation_latency_samples_ms) } | ForEach-Object { [double]$_ })
$baselineStats = Get-Distribution $baselineSamples
$candidateStats = Get-Distribution $candidateSamples
$deltaP95 = [double]$candidateStats.p95_ms - [double]$baselineStats.p95_ms
$deltaMean = [double]$candidateStats.mean_ms - [double]$baselineStats.mean_ms
$deltaP95Percent = if ([double]$baselineStats.p95_ms -gt 0) { ($deltaP95 / [double]$baselineStats.p95_ms) * 100.0 } else { 0.0 }
$deltaMeanPercent = if ([double]$baselineStats.mean_ms -gt 0) { ($deltaMean / [double]$baselineStats.mean_ms) * 100.0 } else { 0.0 }

$first = $proofs[0]
$runner = [ordered]@{
  runner_os=[string]$first.measurement_runner_os
  runner_arch=[string]$first.measurement_runner_arch
  image_os=[string]$first.measurement_image_os
  image_version=[string]$first.measurement_image_version
  processor_identifier=[string]$first.measurement_processor_identifier
  processor_count=[int]$first.measurement_processor_count
}
foreach ($proof in $proofs) {
  $same = ([string]$proof.measurement_runner_os -eq $runner.runner_os -and [string]$proof.measurement_runner_arch -eq $runner.runner_arch -and [string]$proof.measurement_image_os -eq $runner.image_os -and [string]$proof.measurement_image_version -eq $runner.image_version -and [string]$proof.measurement_processor_identifier -eq $runner.processor_identifier -and [int]$proof.measurement_processor_count -eq $runner.processor_count)
  if (-not $same) { throw 'paired_activation_runner_fingerprint_drift' }
}

$evidence = [ordered]@{
  schema='metaengine.browser.paired-activation-benchmark.v1'
  measurement_boundary='SECONDARY_PROCESS_LAUNCH_TO_VALID_DURABLE_ACK_EXIT'
  order=@('baseline-1','candidate-1','candidate-2','baseline-2')
  same_runner=$true
  runner=$runner
  baseline=[ordered]@{source_head=$BaselineSourceHead.ToLowerInvariant();package_version=$baselineVersion;installer_sha256=$baselineInstallerSha;distribution=$baselineStats}
  candidate=[ordered]@{source_head=$CandidateSourceHead.ToLowerInvariant();package_version=$candidateVersion;installer_sha256=$candidateInstallerSha;distribution=$candidateStats}
  delta=[ordered]@{
    candidate_minus_baseline_p95_ms=[Math]::Round($deltaP95,2)
    candidate_minus_baseline_p95_percent=[Math]::Round($deltaP95Percent,2)
    candidate_minus_baseline_mean_ms=[Math]::Round($deltaMean,2)
    candidate_minus_baseline_mean_percent=[Math]::Round($deltaMeanPercent,2)
  }
  activation_count_per_block=$ActivationCount
  concurrent_burst_size_per_block=$ConcurrentBurstSize
  samples_per_side=$baselineSamples.Count
  promotion_authorized=$false
  automatic_retry_allowed=$false
  authority_effect=$false
}
$evidence | ConvertTo-Json -Depth 8 | Set-Content $EvidencePath -Encoding utf8
Write-Output ($evidence | ConvertTo-Json -Compress -Depth 8)
