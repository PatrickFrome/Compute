# METAENGINE DevFleet private MCP tunnel, foreground connection.
# Run locally on Windows. Never paste the runtime key into ChatGPT.
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^tunnel_[A-Za-z0-9_-]{12,128}$')]
  [string]$TunnelId
)
$ErrorActionPreference='Stop'
$toolRoot=Join-Path $env:LOCALAPPDATA 'METAENGINE-DevFleet-MCP'
$client=Join-Path $toolRoot 'bin-v0.0.15\tunnel-client.exe'
$bridge=Join-Path $PSScriptRoot 'devfleet-mcp-stdio.mjs'
if(!(Test-Path -LiteralPath $client)){throw 'verified_tunnel_client_missing'}
if(!(Test-Path -LiteralPath $bridge)){throw 'devfleet_mcp_bridge_missing'}
$node=(Get-Command node -ErrorAction Stop).Source
$rpcFile=Join-Path $env:APPDATA 'METAENGINE DevFleet\operator-rpc.json'
if(!(Test-Path -LiteralPath $rpcFile)){throw 'devfleet_rpc_manifest_missing'}

# The tunnel-client v0.0.15 stdio argv parser treats a backslash as an
# escape character, including inside double quotes. Windows paths passed
# with backslashes become C:Users... and fail the preflight executable check.
# Node.js on Windows accepts forward-slash paths; quote for embedded spaces.
$nodeArg=$node.Replace('\','/')
$bridgeArg=$bridge.Replace('\','/')
$command='"'+$nodeArg+'" "'+$bridgeArg+'"'

# Profile creation needs NO API key. First expose any failure with its
# original tunnel-client output, not just a generic PowerShell exception.
Write-Host 'Creating local DevFleet MCP profile (no API key needed)...'
$profilePath=Join-Path $env:APPDATA 'tunnel-client\metaengine-devfleet.yaml'
if(Test-Path -LiteralPath $profilePath){
  Write-Host 'Existing local profile found; refusing to overwrite it.'
  Write-Host 'Check that its tunnel ID matches before continuing.'
}else{
  & $client init --sample sample_mcp_stdio_local --profile metaengine-devfleet --tunnel-id $TunnelId --health-listen-addr '127.0.0.1:0' --mcp-command $command
  $initExit=$LASTEXITCODE
  if($initExit -ne 0){
    throw ('tunnel_profile_init_failed_exit_'+$initExit+'; review tunnel-client error printed above')
  }
}
Write-Host 'Local profile present. Verifying it before authentication...'
if(!(Test-Path -LiteralPath $profilePath)){throw 'tunnel_profile_missing_after_init'}
# Never print keys. Only report whether the requested tunnel ID is in profile.
$profileContent=Get-Content -LiteralPath $profilePath -Raw
if(!$profileContent.Contains($TunnelId)){throw 'existing_tunnel_profile_id_mismatch'}

# Request credentials only after a valid local profile has been created.
$secure=Read-Host 'Enter a NEW OpenAI Platform key with Tunnels Read+Use (locally only)' -AsSecureString
if(!$secure -or $secure.Length -lt 16){
  if($secure){$secure.Dispose()}
  throw 'runtime_key_empty_or_incomplete; create a new restricted key and paste it into the local PowerShell prompt'
}
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$env:CONTROL_PLANE_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$secure.Dispose()}
try{
  # doctor performs LOCAL checks only; it does not verify Read+Use or remotely
  # authenticate against the OpenAI Platform tunnel control plane.
  $doctorJson=(& $client doctor --profile metaengine-devfleet --json | Out-String)
  $doctorExit=$LASTEXITCODE
  try{$report=$doctorJson|ConvertFrom-Json -ErrorAction Stop}
  catch{throw 'doctor_invalid_json; run tunnel-client doctor --profile metaengine-devfleet --explain locally'}
  Write-Host ('Local doctor result: '+$report.result)
  foreach($check in @($report.checks | Where-Object {$_.status -eq 'FAIL'})){
    Write-Warning ('CHECK '+$check.id+' FAIL')
    # Never echo arbitrary diagnostics containing secrets; only the check ID.
  }
  if($doctorExit -ne 0){
    $ids=@($report.failed_checks) -join ','
    throw ('tunnel_doctor_failed: '+$ids+'; run tunnel-client doctor --profile metaengine-devfleet --explain locally')
  }
  Write-Host 'Local checks passed. Starting DevFleet private tunnel; leave this window open.'
  Write-Host 'Cloud tunnel authorization is evaluated only by the running daemon (401/403 may indicate a missing Read+Use role).'
  & $client run --profile metaengine-devfleet
  if($LASTEXITCODE -ne 0){throw 'tunnel_run_failed; inspect daemon output above (do not share secrets)'}
}finally{
  Remove-Item Env:\CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
