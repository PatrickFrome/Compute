# Legacy hosted enrollment qualification only. This policy cannot establish
# own-PG17 Owner custody or make a quota failure into qualification evidence.
function Get-InstalledQualificationRequestTimeoutSeconds {
  param(
    [Parameter(Mandatory = $true)][DateTime]$Deadline,
    [DateTime]$NowUtc = [DateTime]::UtcNow
  )
  $remainingSeconds = ($Deadline.ToUniversalTime() - $NowUtc.ToUniversalTime()).TotalSeconds
  # WinPS 5.1 DNS resolution may take 15 seconds even for a shorter TimeoutSec.
  # Do not start a new request inside that final reserve.
  if ($remainingSeconds -le 15) { throw 'installed_qualification_oidc_deadline_exhausted' }
  return 10
}

function Get-InstalledQualificationRetryDelaySeconds {
  param(
    [Parameter(Mandatory = $true)][int]$Status,
    [Parameter(Mandatory = $true)][int]$TransientAttempts,
    [Parameter(Mandatory = $true)][DateTime]$Deadline,
    [DateTime]$NowUtc = [DateTime]::UtcNow
  )
  if ($Status -eq 402) { throw 'installed_qualification_oidc_blocked:HOSTED_QUALIFIER_QUOTA_402' }
  if (@(429, 500, 502, 503, 504) -notcontains $Status) {
    throw "installed_qualification_oidc_failed:non_transient_status_$Status"
  }
  if ($TransientAttempts -lt 1 -or $TransientAttempts -ge 10) {
    throw "installed_qualification_oidc_failed:transient_status_${Status}_after_${TransientAttempts}_attempts"
  }
  $delaySeconds = [Math]::Min(15 * $TransientAttempts, 20)
  $remainingSeconds = ($Deadline.ToUniversalTime() - $NowUtc.ToUniversalTime()).TotalSeconds
  if ($delaySeconds + 15 -ge $remainingSeconds) {
    throw 'installed_qualification_oidc_deadline_exhausted'
  }
  return [int]$delaySeconds
}

function New-InstalledQualificationHttpTransport {
  param([Parameter(Mandatory = $true)][ValidateRange(1, 10)][int]$TimeoutSeconds)
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $client = $null
  try {
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $client.MaxResponseContentBufferSize = 65536
    return [pscustomobject]@{
      Client = $client
      Handler = $handler
      CompletionOption = [System.Net.Http.HttpCompletionOption]::ResponseContentRead
    }
  } catch {
    if ($client) { $client.Dispose() } else { $handler.Dispose() }
    throw
  }
}

function Invoke-InstalledQualificationHttpRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Body,
    [Parameter(Mandatory = $true)][string]$Bearer,
    [Parameter(Mandatory = $true)][DateTime]$Deadline
  )
  $target = [Uri]$Uri
  if ($target.Scheme -ne 'https' -or $target.UserInfo -or $target.Fragment) {
    throw 'installed_qualification_oidc_uri_invalid'
  }
  if ($Bearer -notmatch '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') {
    throw 'installed_qualification_oidc_token_invalid'
  }
  $timeoutSeconds = Get-InstalledQualificationRequestTimeoutSeconds -Deadline $Deadline
  # Load a framework assembly, not dynamically compiled code. ResponseContentRead
  # includes the body in the request deadline; buffering has a separate byte cap.
  $handler = $null
  $client = $null
  $request = $null
  $response = $null
  try {
    $transport = New-InstalledQualificationHttpTransport -TimeoutSeconds $timeoutSeconds
    $handler = $transport.Handler
    $client = $transport.Client
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $target)
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Bearer)
    $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, 'application/json')
    $pending = $client.SendAsync($request, $transport.CompletionOption)
    if (-not $pending.Wait($timeoutSeconds * 1000)) {
      throw 'installed_qualification_oidc_request_timeout'
    }
    $response = $pending.GetAwaiter().GetResult()
    if ([DateTime]::UtcNow -ge $Deadline) { throw 'installed_qualification_oidc_deadline_exhausted' }
    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Content = [string]$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
  } finally {
    if ($response) { $response.Dispose() }
    if ($request) { $request.Dispose() }
    if ($client) { $client.Dispose() }
    if ($handler) { $handler.Dispose() }
  }
}
