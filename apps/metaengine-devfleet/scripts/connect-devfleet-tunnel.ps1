# METAENGINE DevFleet private MCP tunnel, first-run foreground connection.
# Execute on the authorized Windows desktop, never paste API keys into ChatGPT.
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^tunnel_[A-Za-z0-9_-]{12,128}$')]
  [string]$TunnelId
)
$ErrorActionPreference='Stop'
$toolRoot=Join-Path $env:LOCALAPPDATA 'METAENGINE-DevFleet-MCP'
$client=Join-Path $toolRoot 'bin-v0.0.15\tunnel-client.exe'
$bridge=Join-Path $PSScriptRoot 'devfleet-mcp-stdio.mjs'
if(!(Test-Path -LiteralPath $client)) { throw 'Verified tunnel-client binary is not installed' }
if(!(Test-Path -LiteralPath $bridge)) { throw 'DevFleet MCP bridge is missing' }
$node=(Get-Command node -ErrorAction Stop).Source
$rpcFile=Join-Path $env:APPDATA 'METAENGINE DevFleet\operator-rpc.json'
if(!(Test-Path -LiteralPath $rpcFile)){throw 'Installed DevFleet RPC manifest missing: open DevFleet first'}
$command='"'+$node+'" "'+$bridge+'"'
# The API key is requested only in the LOCAL Windows terminal.
# We do not persist the key in this script, repository or tool arguments.
$secure=Read-Host 'Enter OpenAI Platform Tunnels Read+Use runtime API key (local terminal only)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:CONTROL_PLANE_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr);$secure.Dispose() }
try {
  & $client init --sample sample_mcp_stdio_local --profile metaengine-devfleet --tunnel-id $TunnelId --mcp-command $command
  if($LASTEXITCODE -ne 0){throw 'tunnel_profile_init_failed'}
  & $client doctor --profile metaengine-devfleet --explain
  if($LASTEXITCODE -ne 0){throw 'tunnel_doctor_failed'}
  Write-Host 'Starting private DevFleet MCP tunnel. Keep this console running for ChatGPT access.'
  & $client run --profile metaengine-devfleet
  if($LASTEXITCODE -ne 0){throw 'tunnel_run_failed'}
} finally {
  Remove-Item Env:\CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
}
