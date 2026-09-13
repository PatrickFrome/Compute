param(
  [Parameter(Mandatory = $true)]
  [string]$InstalledExe,
  [int]$GraceSeconds = 12,
  [int]$ForceSeconds = 8
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($GraceSeconds -lt 1 -or $GraceSeconds -gt 30) { throw 'installer_shutdown_grace_seconds_invalid' }
if ($ForceSeconds -lt 1 -or $ForceSeconds -gt 30) { throw 'installer_shutdown_force_seconds_invalid' }

$target = [System.IO.Path]::GetFullPath($InstalledExe)
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { exit 0 }
$targetName = [System.IO.Path]::GetFileName($target)

function Get-ExactTargetProcesses {
  $escapedName = $targetName.Replace("'", "''")
  $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$escapedName'" -ErrorAction SilentlyContinue)
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

$existing = @(Get-ExactTargetProcesses)
if ($existing.Count -eq 0) { exit 0 }

# New Browser builds understand this local installer-only signal. The primary
# stops HostResilience/Sentinel first and then performs a planned app.quit().
# Older installed builds safely ignore the flag; the bounded exact-path fallback
# below is the one-time migration path for those versions.
try {
  Start-Process -FilePath $target -ArgumentList '--metaengine-installer-shutdown' -WindowStyle Hidden | Out-Null
} catch {
  # A launch failure does not authorize a broad process kill. Continue only with
  # exact ExecutablePath identities already bound to this installation.
}

$graceDeadline = [DateTime]::UtcNow.AddSeconds($GraceSeconds)
do {
  if (@(Get-ExactTargetProcesses).Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $graceDeadline)

# Migration fallback for legacy resident builds: terminate only processes whose
# Win32_Process.ExecutablePath exactly equals the installed Browser executable.
# Re-enumerate until stable because the legacy Sentinel can briefly relaunch its
# parent after an unexpected death. Never use image-name-wide taskkill.
$forceDeadline = [DateTime]::UtcNow.AddSeconds($ForceSeconds)
do {
  $rows = @(Get-ExactTargetProcesses)
  if ($rows.Count -eq 0) { exit 0 }
  foreach ($row in $rows) {
    try { Stop-Process -Id ([int]$row.ProcessId) -Force -ErrorAction Stop } catch {}
  }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $forceDeadline)

$remaining = @(Get-ExactTargetProcesses)
if ($remaining.Count -ne 0) {
  Write-Error "installer_shutdown_exact_path_processes_remain:$($remaining.Count)"
  exit 23
}

exit 0
