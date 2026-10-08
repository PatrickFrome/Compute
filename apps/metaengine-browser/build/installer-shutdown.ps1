param(
  [Parameter(Mandatory = $true)]
  [string]$InstalledExe,
  [int]$GraceSeconds = 12,
  [int]$ForceSeconds = 8,
  [int]$ManagedGraceSeconds = 240
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($GraceSeconds -lt 1 -or $GraceSeconds -gt 30) { throw 'installer_shutdown_grace_seconds_invalid' }
if ($ForceSeconds -lt 1 -or $ForceSeconds -gt 30) { throw 'installer_shutdown_force_seconds_invalid' }
if ($ManagedGraceSeconds -lt 240 -or $ManagedGraceSeconds -gt 300) { throw 'installer_shutdown_managed_grace_seconds_invalid' }

$target = [System.IO.Path]::GetFullPath($InstalledExe)
$targetName = [System.IO.Path]::GetFileName($target)
$managedRuntimeRoot = Join-Path ([System.IO.Path]::GetDirectoryName($target)) 'resources\client-state-runtime'
# Resource presence marks the managed generation even if its manifest is corrupt.
# An uncertain package identity must never enable the legacy forced-kill path.
$managedPackage = Test-Path -LiteralPath $managedRuntimeRoot
$managedExecutablePaths = @(
  (Join-Path $managedRuntimeRoot 'runtime\node\node.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\deno\deno.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\postgres.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\psql.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\pg_ctl.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\initdb.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\pg_config.exe')
)

function Get-ExactTargetProcesses {
  $escapedName = $targetName.Replace("'", "''")
  try { $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$escapedName'" -ErrorAction Stop) }
  catch { throw 'installer_shutdown_process_inventory_unavailable' }
  return @($rows | Where-Object {
    $candidate = [string]$_.ExecutablePath
    if (-not $candidate) { return $false }
    try {
      return [System.StringComparer]::OrdinalIgnoreCase.Equals(
        [System.IO.Path]::GetFullPath($candidate),
        $target
      )
    } catch {
      return $false
    }
  })
}

function Get-ExactInstallationProcesses {
  $browser = @(Get-ExactTargetProcesses)
  if (-not $managedPackage) { return $browser }
  $names = @($managedExecutablePaths | ForEach-Object { [System.IO.Path]::GetFileName($_) } | Select-Object -Unique)
  $filter = ($names | ForEach-Object { "Name = '$($_.Replace("'", "''"))'" }) -join ' OR '
  try { $rows = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop) }
  catch { throw 'installer_shutdown_process_inventory_unavailable' }
  $runtime = @($rows | Where-Object {
    $candidate = [string]$_.ExecutablePath
    if (-not $candidate) { return $false }
    try { $candidate = [System.IO.Path]::GetFullPath($candidate) } catch { return $false }
    foreach ($exact in $managedExecutablePaths) {
      if ([System.StringComparer]::OrdinalIgnoreCase.Equals($candidate, $exact)) { return $true }
    }
    return $false
  })
  return @($browser + $runtime)
}

function Test-ProcessAlive([int]$ProcessId) {
  if ($ProcessId -le 0) { return $false }
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    return $null -ne $process
  } catch {
    return $false
  }
}

function Remove-DeadComputeDaemonState {
  # The Browser Compute runtime owns this canonical PID lock. Reclaim artifacts only
  # when the lock is well-formed and its recorded owner is proven dead. A live owner
  # may belong to an independently started Compute service and is never terminated or
  # modified by the Browser installer.
  $stateRoot = Join-Path $env:USERPROFILE '.metaengine\a2-compute-browser'
  $lockPath = Join-Path $stateRoot 'a2-daemon.lock'
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return }

  $lock = $null
  try { $lock = Get-Content -LiteralPath $lockPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { return }
  $ownerPid = 0
  try { $ownerPid = [int]$lock.pid } catch { return }
  if ($ownerPid -le 0 -or (Test-ProcessAlive $ownerPid)) { return }

  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $stateRoot 'control-token') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $env:USERPROFILE '.a2\compute-bridge.json') -Force -ErrorAction SilentlyContinue
}

$existing = @(Get-ExactInstallationProcesses)
if ($existing.Count -eq 0) {
  Remove-DeadComputeDaemonState
  exit 0
}

# New Browser builds understand this local installer-only signal. The primary
# stops HostResilience/Sentinel first and then performs a planned app.quit().
# Older installed builds safely ignore the flag; the bounded exact-path fallback
# below is the one-time migration path for those versions.
try {
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    Start-Process -FilePath $target -ArgumentList '--metaengine-installer-shutdown' -WindowStyle Hidden | Out-Null
  }
} catch {
  # A launch failure does not authorize a broad process kill. Continue only with
  # exact ExecutablePath identities already bound to this installation.
}

$graceDeadline = (Get-Date).ToUniversalTime().AddSeconds($GraceSeconds)
if ($managedPackage) { $graceDeadline = (Get-Date).ToUniversalTime().AddSeconds($ManagedGraceSeconds) }
do {
  if (@(Get-ExactInstallationProcesses).Count -eq 0) {
    Remove-DeadComputeDaemonState
    exit 0
  }
  Start-Sleep -Milliseconds 200
} while ((Get-Date).ToUniversalTime() -lt $graceDeadline)

# The managed primary waits for its provider preflight and child cleanup before
# it quits. Browser disappearance alone cannot prove Node/Deno/Postgres stopped.
# Preserve live processes and abort before file replacement if cleanup is unclear.
if ($managedPackage) {
  [Console]::Error.WriteLine('installer_shutdown_managed_cleanup_unconfirmed')
  exit 23
}

# Migration fallback for legacy resident builds: terminate only processes whose
# Win32_Process.ExecutablePath exactly equals the installed Browser executable.
# Re-enumerate until stable because the legacy Sentinel can briefly relaunch its
# parent after an unexpected death. Never use image-name-wide taskkill.
$forceDeadline = (Get-Date).ToUniversalTime().AddSeconds($ForceSeconds)
do {
  $rows = @(Get-ExactTargetProcesses)
  if ($rows.Count -eq 0) {
    Remove-DeadComputeDaemonState
    exit 0
  }
  foreach ($row in $rows) {
    try { Stop-Process -Id ([int]$row.ProcessId) -Force -ErrorAction Stop } catch {}
  }
  Start-Sleep -Milliseconds 250
} while ((Get-Date).ToUniversalTime() -lt $forceDeadline)

$remaining = @(Get-ExactTargetProcesses)
if ($remaining.Count -ne 0) {
  [Console]::Error.WriteLine("installer_shutdown_exact_path_processes_remain:$($remaining.Count)")
  exit 23
}

Remove-DeadComputeDaemonState
exit 0
