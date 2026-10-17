import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const policy = fileURLToPath(new URL('../scripts/installed-qualification-http-policy.ps1', import.meta.url));
const workflow = await readFile(new URL('../../../.github/workflows/browser-windows-installed-chat-qualification.yml', import.meta.url), 'utf8');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function runWinPs(source) {
  const entry = '[Console]::InputEncoding = [Text.Encoding]::UTF8; & ([scriptblock]::Create([Console]::In.ReadToEnd()))';
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(entry, 'utf16le').toString('base64')], {
    input: source, encoding: 'utf8', timeout: 20000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('WinPS policy stops quota failures and bounds retries by both attempts and remaining time', {
  skip: process.platform !== 'win32',
}, () => {
  const source = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. '${policy.replaceAll("'", "''")}'
$now = [DateTime]::Parse('2026-10-18T00:00:00Z').ToUniversalTime()
$deadline = $now.AddSeconds(180)
$checks = 0
function Expect-Error([scriptblock]$Action, [string]$Message) {
  try { & $Action; throw 'expected_policy_refusal' } catch {
    if ($_.Exception.Message -ne $Message) { throw }
  }
}
if ((Get-InstalledQualificationRequestTimeoutSeconds -Deadline $deadline -NowUtc $now) -ne 10) { throw 'request_not_bounded' }; $checks++
foreach ($remaining in @(15, 1, 0, -1)) {
  Expect-Error { Get-InstalledQualificationRequestTimeoutSeconds -Deadline $now.AddSeconds($remaining) -NowUtc $now } 'installed_qualification_oidc_deadline_exhausted'; $checks++
}
Expect-Error { Get-InstalledQualificationRetryDelaySeconds -Status 402 -TransientAttempts 1 -Deadline $deadline -NowUtc $now } 'installed_qualification_oidc_blocked:HOSTED_QUALIFIER_QUOTA_402'; $checks++
foreach ($status in @(429, 500, 502, 503, 504)) {
  if ((Get-InstalledQualificationRetryDelaySeconds -Status $status -TransientAttempts 1 -Deadline $deadline -NowUtc $now) -ne 15) { throw 'first_backoff_invalid' }; $checks++
  if ((Get-InstalledQualificationRetryDelaySeconds -Status $status -TransientAttempts 9 -Deadline $deadline -NowUtc $now) -ne 20) { throw 'capped_backoff_invalid' }; $checks++
  Expect-Error { Get-InstalledQualificationRetryDelaySeconds -Status $status -TransientAttempts 10 -Deadline $deadline -NowUtc $now } ('installed_qualification_oidc_failed:transient_status_' + $status + '_after_10_attempts'); $checks++
}
foreach ($status in @(200, 202, 400, 401, 403, -1)) {
  Expect-Error { Get-InstalledQualificationRetryDelaySeconds -Status $status -TransientAttempts 1 -Deadline $deadline -NowUtc $now } "installed_qualification_oidc_failed:non_transient_status_$status"; $checks++
}
foreach ($remaining in @(35, 34, 1, -1)) {
  Expect-Error { Get-InstalledQualificationRetryDelaySeconds -Status 503 -TransientAttempts 2 -Deadline $now.AddSeconds($remaining) -NowUtc $now } 'installed_qualification_oidc_deadline_exhausted'; $checks++
}
Expect-Error { Invoke-InstalledQualificationHttpRequest -Uri 'http://127.0.0.1/' -Body '{}' -Bearer 'fixture' -Deadline ([DateTime]::UtcNow.AddSeconds(180)) } 'installed_qualification_oidc_uri_invalid'; $checks++
Expect-Error { Invoke-InstalledQualificationHttpRequest -Uri 'https://127.0.0.1/' -Body '{}' -Bearer ("invalid" + [char]13 + [char]10 + 'header') -Deadline ([DateTime]::UtcNow.AddSeconds(180)) } 'installed_qualification_oidc_token_invalid'; $checks++
# Exercise actual WinPS transport construction/disposal without sending a request.
$transport = New-InstalledQualificationHttpTransport -TimeoutSeconds 10
try {
  if ($transport.Client.Timeout.TotalSeconds -ne 10) { throw 'http_timeout_invalid' }; $checks++
  if ($transport.Client.MaxResponseContentBufferSize -ne 65536) { throw 'http_body_unbounded' }; $checks++
  if ($transport.Handler.AllowAutoRedirect -ne $false) { throw 'bearer_redirect_allowed' }; $checks++
  if ($transport.CompletionOption -ne [System.Net.Http.HttpCompletionOption]::ResponseContentRead) { throw 'body_outside_request_deadline' }; $checks++
} finally { $transport.Client.Dispose(); $transport.Handler.Dispose() }
@{ checks = $checks; network_requests = 0 } | ConvertTo-Json -Compress
`;
  const receipt = JSON.parse(runWinPs(source));
  assert.equal(receipt.checks, 37);
  assert.equal(receipt.network_requests, 0);
});

test('the complete installed qualification step parses in Windows PowerShell 5.1', {
  skip: process.platform !== 'win32',
}, () => {
  const step = workflow.slice(workflow.indexOf('- name: Install exact installer and prove clean-genesis persistent ChatGPT preconnect'));
  const body = step.match(/        run: \|\r?\n([\s\S]*?)(?=\r?\n      - name:)/)?.[1];
  assert.ok(body, 'physical qualification step must exist');
  const script = body.split(/\r?\n/).map((line) => line.replace(/^ {10}/, '')).join('\n');
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  assert.equal(runWinPs(`
$errors = $null; $tokens = $null
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$null = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw ($errors[0].Message) }
Write-Output 'PARSE_OK'
`), 'PARSE_OK');
});

test('legacy qualification uses finite request timeouts and refuses late or quota responses', () => {
  assert.match(workflow, /\. \.\\scripts\\installed-qualification-http-policy\.ps1/);
  assert.match(workflow, /Invoke-InstalledQualificationHttpRequest[\s\S]*?-Deadline \$deadline/);
  assert.match(workflow, /-TimeoutSec 10/);
  assert.match(workflow, /Get-InstalledQualificationRetryDelaySeconds[^\n]*-Deadline \$deadline/);
  assert.match(workflow, /if \(\[DateTime\]::UtcNow -ge \$deadline\) \{ throw 'installed_qualification_oidc_deadline_exhausted' \}/);
  assert.match(workflow, /elseif \(\$qualificationStatus -eq 402\) \{\s*throw 'installed_qualification_oidc_blocked:HOSTED_QUALIFIER_QUOTA_402'/);
  assert.doesNotMatch(workflow, /@\(402, 429/);
});

test('legacy hosted IO bounds the complete body, avoids bearer redirects and preserves HTTP status', async () => {
  const source = await readFile(policy, 'utf8');
  assert.match(source, /New-InstalledQualificationHttpTransport -TimeoutSeconds \$timeoutSeconds/);
  assert.match(source, /SendAsync\(\$request, \$transport\.CompletionOption\)/);
  assert.match(source, /\$pending\.Wait\(\$timeoutSeconds \* 1000\)/);
  assert.match(source, /StatusCode = \[int\]\$response\.StatusCode/);
  assert.match(source, /\$client\.Dispose\(\)/);
});
