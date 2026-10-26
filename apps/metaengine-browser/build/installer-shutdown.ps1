param(
  [Parameter(Mandatory = $true)]
  [string]$InstalledExe,
  [switch]$RequireFreshInstall,
  [string]$InstallRegistryKey = '',
  [string]$UninstallRegistryKey = '',
  [string]$UninstallRegistryKey2 = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$target = [System.IO.Path]::GetFullPath($InstalledExe)
$targetName = [System.IO.Path]::GetFileName($target)
$managedRuntimeRoot = Join-Path ([System.IO.Path]::GetDirectoryName($target)) 'resources\client-state-runtime'
# Query expected runtime paths even when package resources are missing/corrupt.
$managedExecutablePaths = @(
  (Join-Path $managedRuntimeRoot 'runtime\node\node.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\deno\deno.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\postgres.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\psql.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\pg_ctl.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\initdb.exe'),
  (Join-Path $managedRuntimeRoot 'runtime\postgresql\bin\pg_config.exe')
)

# Existing installers can execute their bundled OLD uninstaller after this
# hook. Its shutdown/credential effects are not authenticated by an empty process
# list. The install path is therefore fresh-only until a reviewed migration exists.
function Test-ExactRegistryKeyPresent($hive, $view, [string]$keyName) {
  $base = $null
  $key = $null
  try {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    $key = $base.OpenSubKey($keyName, $false)
    return $null -ne $key
  } catch {
    throw 'installer_transition_registry_presence_unknown'
  } finally {
    if ($null -ne $key) { $key.Dispose() }
    if ($null -ne $base) { $base.Dispose() }
  }
}

if ($RequireFreshInstall) {
  if (-not $InstallRegistryKey -or -not $UninstallRegistryKey) { throw 'installer_transition_registry_identity_missing' }
  $registryKeys = @($InstallRegistryKey, $UninstallRegistryKey, $UninstallRegistryKey2 | Where-Object { $_ } | Select-Object -Unique)
  foreach ($keyName in $registryKeys) {
    if (-not $keyName.StartsWith('Software\', [StringComparison]::OrdinalIgnoreCase) -or $keyName.Contains(':') -or $keyName.Contains('..')) {
      throw 'installer_transition_registry_identity_invalid'
    }
  }
  $installationRoot = [System.IO.Path]::GetDirectoryName($target)
  if (Test-Path -LiteralPath $installationRoot) {
    if (-not (Test-Path -LiteralPath $installationRoot -PathType Container)) { throw 'installer_transition_existing_installation_unqualified' }
    if (@(Get-ChildItem -LiteralPath $installationRoot -Force -ErrorAction Stop | Select-Object -First 1).Count -ne 0) {
      [Console]::Error.WriteLine('installer_transition_existing_installation_unqualified')
      exit 23
    }
  }
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
      foreach ($keyName in $registryKeys) {
        if (Test-ExactRegistryKeyPresent $hive $view $keyName) {
          [Console]::Error.WriteLine('installer_transition_existing_registration_unqualified')
          exit 23
        }
      }
    }
  }
}

function Get-ExactTargetProcesses {
  $escapedName = $targetName.Replace("'", "''")
  try { $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$escapedName'" -ErrorAction Stop) }
  catch { throw 'installer_shutdown_process_inventory_unavailable' }
  return @($rows | Where-Object {
    $candidate = [string]$_.ExecutablePath
    if (-not $candidate -or -not [System.IO.Path]::IsPathRooted($candidate)) {
      throw 'installer_shutdown_process_identity_unknown'
    }
    try {
      return [System.StringComparer]::OrdinalIgnoreCase.Equals(
        [System.IO.Path]::GetFullPath($candidate),
        $target
      )
    } catch {
      throw 'installer_shutdown_process_identity_unknown'
    }
  })
}

function Get-ExactInstallationProcesses {
  $browser = @(Get-ExactTargetProcesses)
  $names = @($managedExecutablePaths | ForEach-Object { [System.IO.Path]::GetFileName($_) } | Select-Object -Unique)
  $filter = ($names | ForEach-Object { "Name = '$($_.Replace("'", "''"))'" }) -join ' OR '
  try { $rows = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop) }
  catch { throw 'installer_shutdown_process_inventory_unavailable' }
  $runtime = @($rows | Where-Object {
    $candidate = [string]$_.ExecutablePath
    if (-not $candidate -or -not [System.IO.Path]::IsPathRooted($candidate)) {
      throw 'installer_shutdown_process_identity_unknown'
    }
    try { $candidate = [System.IO.Path]::GetFullPath($candidate) }
    catch { throw 'installer_shutdown_process_identity_unknown' }
    foreach ($exact in $managedExecutablePaths) {
      if ([System.StringComparer]::OrdinalIgnoreCase.Equals($candidate, $exact)) { return $true }
    }
    return $false
  })
  return @($browser + $runtime)
}

# The installer owns installation processes, not canonical user state. A stale
# daemon PID cannot prove custody of separately published authentication or bridge
# artifacts. Leave all profile/daemon state to its actual runtime owner.

# This is only a read-only installation-file gate, not a worker-tree drain
# receipt. The current installed generation may implement the old unsafe forced
# exit handler. No authenticated shutdown-protocol contract exists in this
# installer, so invoking that handler and trusting disappearance is forbidden.
# A separately controlled ordinary quit and independent runtime drain readback
# must precede replacement. Unclear process identity is HOLD, never absence.
$existing = @(Get-ExactInstallationProcesses)
if ($existing.Count -ne 0) {
  [Console]::Error.WriteLine('installer_shutdown_controlled_quit_required')
  exit 23
}
exit 0
