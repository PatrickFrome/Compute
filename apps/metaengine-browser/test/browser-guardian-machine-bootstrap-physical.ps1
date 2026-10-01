param(
  [Parameter(Mandatory=$true)][string]$BootstrapDir,
  [Parameter(Mandatory=$true)][string]$StagingDir,
  [Parameter(Mandatory=$true)][string]$ExpectedSourceHead,
  [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$binding = Get-Content (Join-Path $BootstrapDir 'guardian-machine-bootstrap-binding.json') -Raw | ConvertFrom-Json
$exe = Join-Path $BootstrapDir ([string]$binding.bootstrap_name)
if ($binding.source_head -ne $ExpectedSourceHead -or (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $binding.bootstrap_sha256) { throw 'bootstrap_exact_source_bytes_unproven' }
$name = 'METAENGINEBrowserGuardian'
if (Get-Service $name -ErrorAction SilentlyContinue) { throw 'bootstrap_fixture_service_preexists' }
$root = Join-Path $env:ProgramFiles 'METAENGINE\Guardian'
$dataRoot = Join-Path $env:ProgramData 'METAENGINE\Guardian'
if ((Test-Path $root) -or (Test-Path $dataRoot)) { throw 'bootstrap_fixture_root_preexists' }
$scratch = Join-Path $env:RUNNER_TEMP 'guardian-bootstrap-physical'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
function Invoke-Bootstrap([string]$path, [string]$argument, [string]$label) {
  $out = Join-Path $scratch ($label + '.out')
  $err = Join-Path $scratch ($label + '.err')
  $process = Start-Process -FilePath $path -ArgumentList $argument -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if (-not $process.WaitForExit(20000)) { throw "bootstrap_physical_deadline:$label" }
  $line = Get-Content $out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1
  if (-not $line) { throw "bootstrap_physical_receipt_missing:$label" }
  return @{ exit=$process.ExitCode; row=($line | ConvertFrom-Json) }
}
try {
  $invalid = Invoke-Bootstrap $exe '--service-binary=C:\arbitrary.exe' 'invalid'
  if ($invalid.exit -eq 0 -or $invalid.row.state -ne 'NO_EFFECT_PROVEN' -or (Get-Service $name -ErrorAction SilentlyContinue)) { throw 'bootstrap_arbitrary_input_fence_failed' }
  $first = Invoke-Bootstrap $exe '--install' 'first'
  if ($first.exit -ne 0 -or $first.row.state -ne 'READY' -or $first.row.authority_effect -ne $true) { throw "bootstrap_first_install_unproven:$($first.row.reason)" }
  $service = Get-CimInstance Win32_Service -Filter "Name='$name'"
  $slot = Join-Path $root ('slots\' + [string]$binding.slot_id)
  $serviceExe = Join-Path $slot 'METAENGINEBrowserGuardian.exe'
  if ($service.State -ne 'Running' -or $service.StartMode -ne 'Auto' -or $service.StartName -notmatch '^(LocalSystem|NT AUTHORITY\\SYSTEM)$' `
      -or $service.PathName -ne ('"' + $serviceExe + '"') `
      -or (Get-FileHash $serviceExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $binding.service_sha256) { throw 'bootstrap_independent_scm_readback_failed' }
  foreach ($path in @($root,$slot,$serviceExe,$dataRoot)) {
    $acl = Get-Acl $path
    foreach ($rule in @($acl.Access)) {
      $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      if ($sid -notin @('S-1-5-18','S-1-5-32-544') -and $rule.AccessControlType -eq 'Allow' `
          -and (([int]$rule.FileSystemRights -band 0xD0156) -ne 0)) { throw "bootstrap_low_privilege_write:$path" }
    }
  }
  $intentHash = (Get-FileHash (Join-Path $root 'bootstrap.intent') -Algorithm SHA256).Hash
  $second = Invoke-Bootstrap $exe '--install' 'second'
  $after = Get-CimInstance Win32_Service -Filter "Name='$name'"
  if ($second.exit -ne 0 -or $second.row.state -ne 'READY' -or $second.row.authority_effect -ne $false `
      -or $after.ProcessId -ne $service.ProcessId `
      -or (Get-FileHash (Join-Path $root 'bootstrap.intent') -Algorithm SHA256).Hash -ne $intentHash) { throw 'bootstrap_repeat_must_only_observe' }
  # Mutate an embedded manifest byte without changing the executable/PE layout.
  $raw = [System.IO.File]::ReadAllBytes($exe)
  $needle = [System.Text.Encoding]::UTF8.GetBytes('metaengine.browser.guardian-native-staging-manifest.v1')
  $offset = -1
  for ($i=0; $i -le $raw.Length-$needle.Length; $i++) {
    if ($raw[$i] -ne $needle[0]) { continue }
    $match=$true
    for ($j=1; $j -lt $needle.Length; $j++) { if ($raw[$i+$j] -ne $needle[$j]) { $match=$false;break } }
    if ($match) { $offset=$i;break }
  }
  if ($offset -lt 0) { throw 'bootstrap_embedded_manifest_not_found' }
  $raw[$offset] = $raw[$offset] -bxor 1
  $tamperedPath = Join-Path $scratch 'tampered-bootstrap.exe'
  [System.IO.File]::WriteAllBytes($tamperedPath,$raw)
  $tampered = Invoke-Bootstrap $tamperedPath '--install' 'tampered'
  if ($tampered.exit -eq 0 -or $tampered.row.reason -ne 'EMBEDDED_ASSET_DIGEST_MISMATCH' -or $tampered.row.authority_effect -ne $false) { throw 'bootstrap_embedded_tamper_fence_failed' }
  # A stopped exact service with durable intent cannot be restarted by replay.
  Stop-Service $name
  $stopped = Invoke-Bootstrap $exe '--install' 'stopped'
  if ($stopped.exit -eq 0 -or $stopped.row.state -ne 'HOLD' -or (Get-Service $name).Status -ne 'Stopped') { throw 'bootstrap_stopped_service_blind_replay' }
  [ordered]@{
    schema='metaengine.browser-guardian.machine-bootstrap-physical-proof.v1'
    source_head=$ExpectedSourceHead
    bootstrap_sha256=[string]$binding.bootstrap_sha256
    service_sha256=[string]$binding.service_sha256
    slot_id=[string]$binding.slot_id
    exact_machine_copy_verified=$true
    scm_running_readback_verified=$true
    programdata_owner_store_root_secure=$true
    low_privilege_write_forbidden=$true
    repeat_observation_only=$true
    arbitrary_path_rejected=$true
    embedded_tamper_rejected=$true
    stopped_service_replay_held=$true
    owner_enrollment_executed=$false
    installer_dispatch_executed=$false
    user_machine_qualified=$false
    automatic_retry_allowed=$false
  } | ConvertTo-Json -Depth 4 | Set-Content $EvidencePath -Encoding utf8
} finally {
  # Cleanup is limited to the service and roots whose absence this fixture proved.
  Stop-Service $name -ErrorAction SilentlyContinue
  & sc.exe delete $name | Out-Null
  for ($i=0; $i -lt 40 -and (Get-Service $name -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 100 }
  Remove-Item $root,$dataRoot -Recurse -Force -ErrorAction SilentlyContinue
}
