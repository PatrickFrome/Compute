<#
.SYNOPSIS
Read-only observation of prerequisites for a completely clean-machine test.
.DESCRIPTION
Invoke the fixed Windows OS WindowsPowerShell\v1.0\powershell.exe with
-NoProfile -NonInteractive -File <this-script>. Requires x64 Windows PowerShell
5.1 Desktop and .NET Framework 4. Uses only OS/.NET/CIM command discovery; never
invokes any discovered application, alias or function. Emits one JSON document
to stdout; creates no files, directories, credentials or services.

Scope is CURRENT_USER_AND_FIXED_MACHINE_ROOTS. It does not inspect every user
profile or authenticate a fresh OS image. A PRECONDITION_CANDIDATE observation
is not clean-install qualification, readiness, installer eligibility or a trust
root. Full qualification needs an independently authenticated fresh VM baseline
and all-user coverage. Existing infrastructure is only observed; its presence
never permits removal or modification and does not forbid installer coexistence.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:PSModuleAutoLoadingPreference = 'None'

function Observe-PathPresence([string]$Target) {
  try {
    if ([string]::IsNullOrWhiteSpace($Target) -or $Target -notmatch '^[A-Za-z]:\\' -or $Target -match '[\x00-\x1f]') { return 'UNKNOWN' }
    $full = [IO.Path]::GetFullPath($Target)
    $cursor = [IO.Path]::GetPathRoot($full)
    foreach ($part in $full.Substring($cursor.Length).Split('\')) {
      if (-not $part) { continue }
      $cursor = [IO.Path]::Combine($cursor, $part)
      $attributes = [IO.File]::GetAttributes($cursor)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return 'UNKNOWN' }
      if ($cursor -ine $full -and ($attributes -band [IO.FileAttributes]::Directory) -eq 0) { return 'UNKNOWN' }
    }
    return 'PRESENT'
  } catch {
    $failure = $_.Exception
    while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
    if ($failure -is [IO.FileNotFoundException] -or $failure -is [IO.DirectoryNotFoundException]) { return 'ABSENT' }
    return 'UNKNOWN'
  }
}

function Observe-RegistryKey($Base, [string]$Key) {
  $opened = $null
  try {
    $opened = $Base.OpenSubKey($Key, $false)
    if ($null -eq $opened) { return 'ABSENT' }
    return 'PRESENT'
  } catch { return 'UNKNOWN' }
  finally { if ($null -ne $opened) { $opened.Dispose() } }
}

function Observe-RegistryMatches($Base, [string]$Key, [bool]$Uninstall) {
  $opened = $null
  try {
    $opened = $Base.OpenSubKey($Key, $false)
    if ($null -eq $opened) { return 'ABSENT' }
    if (-not $Uninstall) {
      foreach ($name in $opened.GetValueNames()) {
        # Do not print registry values: startup command lines can contain secrets.
        $value = [string]$opened.GetValue($name, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($name -match '(?i)METAENGINE|PostgreSQL' -or $value -match '(?i)METAENGINE|PostgreSQL') { return 'PRESENT' }
      }
    } else {
      foreach ($name in $opened.GetSubKeyNames()) {
        $child = $null
        try {
          $child = $opened.OpenSubKey($name, $false)
          if ($null -eq $child) { return 'UNKNOWN' }
          foreach ($field in @('DisplayName', 'Publisher', 'InstallLocation')) {
            $value = [string]$child.GetValue($field, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if ($value -match '(?i)METAENGINE|PostgreSQL') { return 'PRESENT' }
          }
        } finally { if ($null -ne $child) { $child.Dispose() } }
      }
    }
    return 'ABSENT'
  } catch { return 'UNKNOWN' }
  finally { if ($null -ne $opened) { $opened.Dispose() } }
}

$services = @()
$registrations = @()
$paths = @()
$tools = @()
$reasons = @()
$runnerMarkers = @()
$runnerStatus = 'UNKNOWN'
$supported = $false
try {
  $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot', [EnvironmentVariableTarget]::Machine)
  $fixedPowerShell = [IO.Path]::Combine($systemRoot, 'System32\WindowsPowerShell\v1.0\powershell.exe')
  $supported = $args.Count -eq 0 -and [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT `
    -and [Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess `
    -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1 `
    -and $PSVersionTable.PSEdition -eq 'Desktop' -and [Environment]::Version.Major -eq 4 `
    -and [IO.Path]::Combine($PSHOME, 'powershell.exe') -ieq $fixedPowerShell
} catch { $supported = $false }

# Do not resolve even OS-named modules through inherited PSModulePath. No
# profiles are allowed, and both module origins must be the fixed OS manifests.
$osModulesReady = $false
if ($supported) {
  try {
    foreach ($moduleName in @('Microsoft.PowerShell.Utility', 'CimCmdlets')) {
      $moduleDirectory = [IO.Path]::Combine($PSHOME, ('Modules\' + $moduleName))
      $manifest = [IO.Path]::Combine($moduleDirectory, ($moduleName + '.psd1'))
      if ((Observe-PathPresence $manifest) -ne 'PRESENT') { throw 'os_module_unavailable' }
      $loaded = @(Microsoft.PowerShell.Core\Import-Module -Name $manifest -Force -PassThru -ErrorAction Stop)
      if ($loaded.Count -ne 1 -or $loaded[0].Path -ine $manifest -or $loaded[0].ModuleBase -ine $moduleDirectory) { throw 'os_module_origin_unverified' }
      $names = if ($moduleName -eq 'CimCmdlets') { @('Get-CimInstance') } else { @('ConvertTo-Json', 'Select-Object') }
      foreach ($commandName in $names) {
        $command = Microsoft.PowerShell.Core\Get-Command -Name ($moduleName + '\' + $commandName) -ListImported -ErrorAction Stop
        if ($command.Module.Path -ine $manifest -or $command.Module.ModuleBase -ine $moduleDirectory) { throw 'os_command_origin_unverified' }
      }
    }
    $osModulesReady = $true
  } catch { $osModulesReady = $false }
}
if (-not $osModulesReady) {
  # Incomplete inventory is UNKNOWN. Empty arrays in this refusal are never
  # absence evidence. Serialize only fixed literals without any module lookup.
  [Console]::Out.WriteLine('{"schema":"metaengine.qa.clean-machine-prerequisites-observation.v1","scope":"OBSERVATION_ONLY","inventory_scope":"CURRENT_USER_AND_FIXED_MACHINE_ROOTS","machine_baseline_authenticated":false,"platform":"win32","observed_at":"' + [DateTime]::UtcNow.ToString('o') + '","state":"BLOCKED","authority_effect":false,"clean_install_qualified":false,"runtime_ready":false,"services":[],"registrations":[],"paths":[],"global_tools":[],"runner":{"status":"UNKNOWN","markers":[]},"reasons":["UNSUPPORTED_WINDOWS_HOST","INVENTORY_UNKNOWN","GLOBAL_TOOL_UNKNOWN","RUNNER_UNKNOWN"]}')
  return
}

$serviceTargets = @(
  @{ id = 'guardian_service'; name = 'METAENGINEBrowserGuardian' },
  @{ id = 'metaengine_services'; name = 'METAENGINE*' },
  @{ id = 'postgresql_services'; name = 'PostgreSQL*' }
)
$serviceRows = @()
$serviceQueryComplete = $false
$processRows = @()
$processQueryComplete = $false
if ($supported) {
  try { $serviceRows = @(CimCmdlets\Get-CimInstance -ClassName Win32_Service -ErrorAction Stop); $serviceQueryComplete = $serviceRows.Count -gt 0 } catch { }
  try {
    $processRows = @(CimCmdlets\Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $self = @($processRows | Microsoft.PowerShell.Core\Where-Object { $_.ProcessId -eq $PID })
    if ($self.Count -ne 1 -or $self[0].ExecutablePath -ine $fixedPowerShell `
      -or $self[0].CommandLine -notmatch '(?i)(?:^|\s)-NoProfile(?:\s|$)' `
      -or $self[0].CommandLine -notmatch '(?i)(?:^|\s)-NonInteractive(?:\s|$)') { $supported = $false }
    $processQueryComplete = $true
  } catch { }
}
foreach ($target in $serviceTargets) {
  $status = 'UNKNOWN'
  if ($supported -and $serviceQueryComplete) {
    $matches = @($serviceRows | Microsoft.PowerShell.Core\Where-Object {
      if ($target.id -eq 'guardian_service') { $_.Name -eq 'METAENGINEBrowserGuardian' }
      elseif ($target.id -eq 'metaengine_services') { $_.Name -like 'METAENGINE*' -or $_.DisplayName -match '(?i)METAENGINE' -or $_.PathName -match '(?i)METAENGINE' }
      else { $_.Name -like 'PostgreSQL*' -or $_.DisplayName -match '(?i)PostgreSQL' -or $_.PathName -match '(?i)PostgreSQL|\b(?:postgres|pg_ctl)\.exe\b' }
    })
    $status = if ($matches.Count) { 'PRESENT' } else { 'ABSENT' }
  }
  $services += [ordered]@{ id = $target.id; name = $target.name; status = $status }
}

# Both registry views are inspected independently, even on a 64-bit observer.
$guid = 'c32f3891-2b9e-5a4a-bd4f-5173b65b39bb'
$registryTargets = @(
  @{ id = 'browser_install'; key = ('Software\' + $guid); scan = '' },
  @{ id = 'browser_uninstall'; key = ('Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $guid); scan = '' },
  @{ id = 'metaengine_vendor'; key = 'Software\METAENGINE'; scan = '' },
  @{ id = 'postgresql_vendor'; key = 'Software\PostgreSQL'; scan = '' },
  @{ id = 'postgresql_development_group'; key = 'Software\PostgreSQL Global Development Group'; scan = '' },
  @{ id = 'product_uninstall_entries'; key = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'; scan = 'uninstall' },
  @{ id = 'product_startup_entries'; key = 'Software\Microsoft\Windows\CurrentVersion\Run'; scan = 'startup' }
)
foreach ($hive in @('CurrentUser', 'LocalMachine')) {
  foreach ($view in @('Registry64', 'Registry32')) {
    $base = $null
    if ($supported) {
      try { $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::$hive, [Microsoft.Win32.RegistryView]::$view) } catch { }
    }
    try {
      foreach ($target in $registryTargets) {
        $status = 'UNKNOWN'
        if ($null -ne $base) {
          if ($target.scan) { $status = Observe-RegistryMatches $base $target.key ($target.scan -eq 'uninstall') }
          else { $status = Observe-RegistryKey $base $target.key }
        }
        $registrations += [ordered]@{ id = ($hive + '_' + $view + '_' + $target.id); status = $status }
      }
    } finally { if ($null -ne $base) { $base.Dispose() } }
  }
}

$roots = @{}
foreach ($folder in @('ApplicationData', 'LocalApplicationData', 'CommonApplicationData', 'ProgramFiles', 'ProgramFilesX86', 'UserProfile', 'DesktopDirectory', 'StartMenu', 'CommonStartMenu', 'CommonDesktopDirectory')) {
  $roots[$folder] = ''
  if ($supported) { try { $roots[$folder] = [Environment]::GetFolderPath([Environment+SpecialFolder]::$folder, [Environment+SpecialFolderOption]::DoNotVerify) } catch { } }
}
# Mismatched inherited roots must not hide the product's actual owner profile.
foreach ($pair in @(@('ApplicationData', 'APPDATA'), @('LocalApplicationData', 'LOCALAPPDATA'), @('UserProfile', 'USERPROFILE'))) {
  if ($roots[$pair[0]] -ine [Environment]::GetEnvironmentVariable($pair[1])) { $roots[$pair[0]] = '' }
}
$pathTargets = @(
  @('machine_program_files_metaengine', 'ProgramFiles', 'METAENGINE'),
  @('machine_program_files_x86_metaengine', 'ProgramFilesX86', 'METAENGINE'),
  @('machine_program_data_metaengine', 'CommonApplicationData', 'METAENGINE'),
  @('machine_program_files_postgresql', 'ProgramFiles', 'PostgreSQL'),
  @('machine_program_files_x86_postgresql', 'ProgramFilesX86', 'PostgreSQL'),
  @('machine_program_data_postgresql', 'CommonApplicationData', 'PostgreSQL'),
  @('user_local_metaengine', 'LocalApplicationData', 'METAENGINE'),
  @('user_roaming_metaengine', 'ApplicationData', '@metaengine'),
  @('user_browser_install', 'LocalApplicationData', 'Programs\METAENGINE Browser Test'),
  @('user_legacy_browser_install', 'LocalApplicationData', 'Programs\METAENGINE Browser'),
  @('machine_browser_install', 'ProgramFiles', 'METAENGINE Browser Test'),
  @('machine_x86_browser_install', 'ProgramFilesX86', 'METAENGINE Browser Test'),
  @('user_bridge_state', 'UserProfile', '.metaengine'),
  @('user_bridge_config', 'UserProfile', '.a2\compute-bridge.json'),
  @('user_start_menu_shortcut', 'StartMenu', 'Programs\METAENGINE Browser Test.lnk'),
  @('machine_start_menu_shortcut', 'CommonStartMenu', 'Programs\METAENGINE Browser Test.lnk'),
  @('user_desktop_shortcut', 'DesktopDirectory', 'METAENGINE Browser Test.lnk'),
  @('machine_desktop_shortcut', 'CommonDesktopDirectory', 'METAENGINE Browser Test.lnk')
)
foreach ($target in $pathTargets) {
  $status = 'UNKNOWN'
  if ($roots[$target[1]]) { $status = Observe-PathPresence ([IO.Path]::Combine($roots[$target[1]], $target[2])) }
  $paths += [ordered]@{ id = $target[0]; status = $status }
}

$pathDiscoveryUnknown = -not $supported
if ($supported) {
  $searchPath = [Environment]::GetEnvironmentVariable('PATH')
  if ([string]::IsNullOrWhiteSpace($searchPath)) { $pathDiscoveryUnknown = $true }
  else {
    foreach ($directory in $searchPath.Split(';')) {
      $presence = Observe-PathPresence $directory
      if ($presence -eq 'UNKNOWN') { $pathDiscoveryUnknown = $true; continue }
      if ($presence -eq 'PRESENT') {
        $listing = $null
        try { $listing = [IO.Directory]::EnumerateFileSystemEntries($directory).GetEnumerator(); $null = $listing.MoveNext() }
        catch { $pathDiscoveryUnknown = $true }
        finally { if ($null -ne $listing) { $listing.Dispose() } }
      }
    }
  }
}
foreach ($tool in @('node', 'npm', 'npx', 'git', 'codex', 'bun', 'deno', 'psql', 'pg_ctl', 'initdb', 'postgres', 'pg_restore', 'pg_dump')) {
  $locations = @()
  $found = $false
  $unknown = $pathDiscoveryUnknown
  if ($supported) {
    foreach ($name in @($tool, ($tool + '.exe'), ($tool + '.cmd'), ($tool + '.bat'), ($tool + '.ps1'))) {
      try {
        $commands = @(Microsoft.PowerShell.Core\Get-Command -Name $name -All -ListImported -ErrorAction Stop)
        foreach ($command in $commands) {
          $found = $true
          # Alias/function bodies are never returned or invoked.
          if ($command.CommandType -in @('Application', 'ExternalScript') -and [IO.Path]::IsPathRooted($command.Source)) { $locations += [string]$command.Source }
        }
      } catch {
        if ($_.Exception -isnot [Management.Automation.CommandNotFoundException]) { $unknown = $true }
      }
    }
  }
  $status = if ($found) { 'PRESENT' } elseif ($unknown) { 'UNKNOWN' } else { 'ABSENT' }
  $tools += [ordered]@{ name = $tool; status = $status; locations = @($locations | Microsoft.PowerShell.Utility\Select-Object -Unique) }
}

if ($supported) {
  try {
    foreach ($name in @('CI', 'GITHUB_ACTIONS', 'GITHUB_WORKSPACE', 'RUNNER_ENVIRONMENT', 'RUNNER_NAME', 'GITLAB_CI', 'TF_BUILD', 'AGENT_ID', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL', 'TEAMCITY_VERSION', 'CODEBUILD_BUILD_ID', 'CODESPACES', 'CODESPACE_NAME', 'DEVCONTAINER', 'REMOTE_CONTAINERS', 'VSCODE_IPC_HOOK_CLI')) {
      if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) { $runnerMarkers += $name }
    }
    if ($processQueryComplete) {
      foreach ($name in @('Runner.Listener.exe', 'Runner.Worker.exe', 'Agent.Listener.exe', 'Agent.Worker.exe', 'gitlab-runner.exe', 'buildkite-agent.exe', 'jenkins.exe', 'Code.exe', 'Code - Insiders.exe', 'devenv.exe', 'node.exe', 'bun.exe', 'deno.exe')) {
        if (@($processRows | Microsoft.PowerShell.Core\Where-Object { $_.Name -ieq $name }).Count) { $runnerMarkers += ('PROCESS:' + $name) }
      }
    }
    $runnerStatus = if ($runnerMarkers.Count) { 'PRESENT' } elseif ($processQueryComplete) { 'ABSENT' } else { 'UNKNOWN' }
  } catch { $runnerStatus = 'UNKNOWN' }
}

if (-not $supported) { $reasons += 'UNSUPPORTED_WINDOWS_HOST' }
foreach ($row in @($services) + @($registrations) + @($paths)) {
  if ($row.status -eq 'PRESENT') { $reasons += 'INVENTORY_PRESENT' }
  if ($row.status -eq 'UNKNOWN') { $reasons += 'INVENTORY_UNKNOWN' }
}
foreach ($row in $tools) {
  if ($row.status -eq 'PRESENT') { $reasons += 'GLOBAL_TOOL_PRESENT' }
  if ($row.status -eq 'UNKNOWN') { $reasons += 'GLOBAL_TOOL_UNKNOWN' }
}
if ($runnerStatus -eq 'PRESENT') { $reasons += 'RUNNER_PRESENT' }
if ($runnerStatus -eq 'UNKNOWN') { $reasons += 'RUNNER_UNKNOWN' }
$reasons = @($reasons | Microsoft.PowerShell.Utility\Select-Object -Unique)
$observation = [ordered]@{
  schema = 'metaengine.qa.clean-machine-prerequisites-observation.v1'
  scope = 'OBSERVATION_ONLY'
  inventory_scope = 'CURRENT_USER_AND_FIXED_MACHINE_ROOTS'
  machine_baseline_authenticated = $false
  platform = 'win32'
  observed_at = [DateTime]::UtcNow.ToString('o')
  state = $(if ($reasons.Count) { 'BLOCKED' } else { 'PRECONDITION_CANDIDATE' })
  authority_effect = $false
  clean_install_qualified = $false
  runtime_ready = $false
  services = @($services)
  registrations = @($registrations)
  paths = @($paths)
  global_tools = @($tools)
  runner = [ordered]@{ status = $runnerStatus; markers = @($runnerMarkers) }
  reasons = @($reasons)
}
[Console]::Out.WriteLine((Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $observation -Depth 8 -Compress))
