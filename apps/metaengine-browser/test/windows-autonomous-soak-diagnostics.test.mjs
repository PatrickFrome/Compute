import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const powershell = process.env.POWERSHELL_EXE || (process.platform === 'win32' ? 'powershell.exe' : null);
const scriptPath = fileURLToPath(new URL('../scripts/windows-autonomous-session-soak.ps1', import.meta.url));
const source = await fs.readFile(scriptPath, 'utf8');
const loadActualFunctions = `$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($env:SOAK_SCRIPT_UNDER_TEST, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'soak_test_source_parse_failed' }
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($definition.Extent.Text))
}
`;

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise(resolve => server.close(resolve));
}

async function runPowerShell(program, env = {}) {
  const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', loadActualFunctions + program], {
    env: { ...process.env, ...env, SOAK_SCRIPT_UNDER_TEST: scriptPath, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost' },
    timeout: 20000, maxBuffer: 65536, windowsHide: true,
  });
  return JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
}

async function actualSourceProbe(port) {
  // Load the actual script's functions through the PowerShell parser. The main
  // program is never evaluated: these HTTP fixtures cannot install/start Browser.
  return runPowerShell(`$ports = Resolve-SoakLaunchPorts
$endpoint = Resolve-SoakUiEndpoint -Port $ports.ui
$http = Invoke-SoakUiProbe -Endpoint $endpoint
@{ ready=($http.outcome -eq 'READY'); http=$http } | ConvertTo-Json -Depth 4 -Compress`, {
    ME2_UI_PORT: String(port), ME2_UI_HEALTH_URL: `http://127.0.0.1:${port}/`,
    ME2_UI_GATEWAY_PORT: '', ME2_REST_PORT: '',
  });
}

test('real soak probe uses the allocated non-default UI port', { skip: !powershell }, async t => {
  const server = http.createServer((_req, res) => res.end('installed UI readiness'));
  const port = await listen(server);
  t.after(() => close(server));
  assert.notEqual(port, 3000);
  assert.equal((await actualSourceProbe(port)).ready, true);
});

test('an unrelated healthy default port cannot qualify the allocated UI port', { skip: !powershell }, async t => {
  const decoy = http.createServer((_req, res) => res.end('unrelated service'));
  try { await listen(decoy, 3000); }
  catch (error) {
    if (error.code === 'EADDRINUSE') return t.skip('default port already in use; never touch an unrelated listener');
    throw error;
  }
  t.after(() => close(decoy));
  const reservation = net.createServer();
  const unavailablePort = await listen(reservation);
  await close(reservation);
  assert.equal((await actualSourceProbe(unavailablePort)).ready, false);
});

test('HTTP rejection remains unqualified and retains only bounded status', { skip: !powershell }, async t => {
  const secret = 'PRIVATE_RESPONSE_BODY_NOT_DIAGNOSTICS';
  const server = http.createServer((_req, res) => { res.statusCode = 503; res.end(secret); });
  const port = await listen(server);
  t.after(() => close(server));
  const result = await actualSourceProbe(port);
  assert.equal(result.ready, false);
  assert.deepEqual(result.http, { status: 503, outcome: 'HTTP_REJECTED' });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('endpoint contract rejects invalid ports, cross-port URLs and non-loopback URLs before probing', { skip: !powershell }, async () => {
  const result = await runPowerShell(`$codes = @()
foreach ($value in @('0', '65536', '1e3', '-1', '3000/private', 'PRIVATE_ENDPOINT')) {
  try { $null = Resolve-SoakLaunchPorts -UiPort $value; $codes += 'unexpected_success' }
  catch { $codes += Get-SoakFailureCode $_ }
}
foreach ($value in @('http://127.0.0.1:3000/', 'https://127.0.0.1:43123/', 'http://localhost:43123/', 'http://owner:PRIVATE_CREDENTIAL@127.0.0.1:43123/', 'http://127.0.0.1:43123/?token=PRIVATE_CREDENTIAL')) {
  try { $null = Resolve-SoakUiEndpoint -Port 43123 -HealthUrl $value; $codes += 'unexpected_success' }
  catch { $codes += Get-SoakFailureCode $_ }
}
$defaults = Resolve-SoakLaunchPorts -UiPort '' -GatewayPort '' -DaemonPort ''
@{ codes=$codes; defaults=$defaults; endpoint=(Resolve-SoakUiEndpoint -Port $defaults.ui -HealthUrl '') } | ConvertTo-Json -Depth 5 -Compress`);
  assert.deepEqual(result.codes, [...Array(6).fill('launch_ports_invalid'), ...Array(5).fill('ui_endpoint_contract_invalid')]);
  assert.deepEqual(result.defaults, { ui: 3000, gateway: 8137, daemon: 3041 });
  assert.equal(result.endpoint, 'http://127.0.0.1:3000/');
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

async function diagnosticDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-soak-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { SOAK_TEST_DIAGNOSTIC: path.join(directory, 'soak-diagnostics.json') };
}

test('first readiness failure survives a later cleanup failure and is persisted before shutdown', { skip: !powershell }, async t => {
  const env = await diagnosticDirectory(t);
  const result = await runPowerShell(`$d = New-SoakDiagnostics
$d.phase = 'ME2_READINESS'
$clock = [Diagnostics.Stopwatch]::StartNew()
Write-SoakDiagnosticCheckpoint -Diagnostics $d -Path $env:SOAK_TEST_DIAGNOSTIC -Clock $clock
$primaryFailure = $null
$beforeCleanup = $null
$reported = $null
try {
  try { throw 'soak_me2_runtime_not_settled:PRIVATE_RUNTIME_ENDPOINT' }
  catch {
    $primaryFailure = $_
    Set-SoakDiagnosticFailure -Diagnostics $d -Failure $_
    Write-SoakDiagnosticCheckpoint -Diagnostics $d -Path $env:SOAK_TEST_DIAGNOSTIC -Clock $clock
    $beforeCleanup = Get-Content $env:SOAK_TEST_DIAGNOSTIC -Raw | ConvertFrom-Json
    throw
  } finally {
    Invoke-SoakCleanup -Diagnostics $d -Path $env:SOAK_TEST_DIAGNOSTIC -PrimaryFailure $primaryFailure -Passed $false -Clock $clock -Cleanup {
      throw 'soak_shutdown_primary_timeout:PRIVATE_OWNER_PATH'
    }
  }
} catch { $reported = Get-SoakFailureCode $_ }
@{ reported=$reported; before=$beforeCleanup; terminal=(Get-Content $env:SOAK_TEST_DIAGNOSTIC -Raw | ConvertFrom-Json) } | ConvertTo-Json -Depth 9 -Compress`, env);
  assert.equal(result.reported, 'me2_runtime_not_settled');
  assert.equal(result.before.state, 'FAILED');
  assert.equal(result.before.phase, 'ME2_READINESS');
  assert.equal(result.before.cleanup_failure, null);
  assert.deepEqual(result.terminal.first_failure, { code: 'me2_runtime_not_settled', phase: 'ME2_READINESS' });
  assert.deepEqual(result.terminal.cleanup_failure, { code: 'shutdown_primary_timeout', phase: 'SHUTDOWN' });
  assert.equal(result.terminal.state, 'FAILED');
  assert.equal(result.terminal.qualification_proven, false);
  assert.ok(result.terminal.sequence > result.before.sequence);
  assert.ok(result.terminal.elapsed_ms >= result.before.elapsed_ms);
  const persisted = await fs.readFile(env.SOAK_TEST_DIAGNOSTIC, 'utf8');
  assert.ok(Buffer.byteLength(persisted) < 16384);
  assert.equal(persisted.includes('PRIVATE_'), false);
});

test('cleanup-only failure is terminal and successful cleanup remains diagnostic-only', { skip: !powershell }, async t => {
  const env = await diagnosticDirectory(t);
  const result = await runPowerShell(`$failed = New-SoakDiagnostics
$reported = $null
try {
  Invoke-SoakCleanup -Diagnostics $failed -Path $env:SOAK_TEST_DIAGNOSTIC -PrimaryFailure $null -Passed $true -Cleanup { throw 'soak_shutdown_signal_failed:PRIVATE' }
} catch { $reported = Get-SoakFailureCode $_ }
$failureFile = Get-Content $env:SOAK_TEST_DIAGNOSTIC -Raw | ConvertFrom-Json
$success = New-SoakDiagnostics
Invoke-SoakCleanup -Diagnostics $success -Path $env:SOAK_TEST_DIAGNOSTIC -PrimaryFailure $null -Passed $true -Cleanup {}
@{ reported=$reported; failed=$failureFile; successful=(Get-Content $env:SOAK_TEST_DIAGNOSTIC -Raw | ConvertFrom-Json) } | ConvertTo-Json -Depth 8 -Compress`, env);
  assert.equal(result.reported, 'shutdown_signal_failed');
  assert.equal(result.failed.state, 'FAILED');
  assert.equal(result.failed.first_failure.code, 'shutdown_signal_failed');
  assert.equal(result.failed.cleanup_failure.code, 'shutdown_signal_failed');
  assert.equal(result.successful.state, 'PASSED');
  assert.equal(result.successful.phase, 'COMPLETE');
  assert.equal(result.successful.qualification_proven, false);
  assert.equal(result.successful.diagnostic_only, true);
  assert.equal(result.successful.automatic_retry_allowed, false);
});

test('process observation errors cannot prevent persisting the first failure', { skip: !powershell }, async t => {
  const env = await diagnosticDirectory(t);
  const result = await runPowerShell(`$d = New-SoakDiagnostics
$d.phase = 'PRIMARY_WINDOW_READINESS'
$d.process.pid = 123
Set-SoakDiagnosticFailure -Diagnostics $d -Failure 'soak_normal_ui_not_stable_visible:PRIVATE_PATH'
$inaccessible = New-Object psobject
$inaccessible | Add-Member -MemberType ScriptMethod -Name Refresh -Value { throw 'PRIVATE_PROCESS_EXCEPTION' }
Write-SoakDiagnosticCheckpoint -Diagnostics $d -Path $env:SOAK_TEST_DIAGNOSTIC -Process $inaccessible
Get-Content $env:SOAK_TEST_DIAGNOSTIC -Raw`, env);
  assert.equal(result.first_failure.code, 'normal_ui_not_stable_visible');
  assert.deepEqual(result.process, { pid: 123, exited: null, exit_code: null });
  assert.equal(result.sequence, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('finite ME2 failure pairs strip secrets and recognize actual stderr failure rows', { skip: !powershell }, async () => {
  const result = await runPowerShell(`$rows = @(
  [pscustomobject]@{ schema='metaengine.browser.me2.ui-host.v1'; event='UI_INITIAL_READINESS_FAILED'; error='PRIVATE_OWNER_URL'; dir='PRIVATE_PATH' },
  [pscustomobject]@{ schema='metaengine.browser.me2-r97-installed-ui.v1'; state='ME2_R97_UI_CONTRACT_INCOMPLETE'; error='PRIVATE_DOM' },
  [pscustomobject]@{ schema='metaengine.browser.me2.ui-host.v1'; event='DAEMON_LAUNCH_NOT_FOUND'; error='PRIVATE_WRONG_PAIR' },
  [pscustomobject]@{ schema='PRIVATE_SCHEMA'; event='SPAWN_ERROR' },
  [pscustomobject]@{ unrelated='PRIVATE_VALUE' }
)
@{ projections=@($rows | ForEach-Object { $projection=Get-SoakMe2Failure $_; if ($null -eq $projection) { 'IGNORED' } else { $projection } }); unknown_code=(Get-SoakFailureCode 'PRIVATE_EXCEPTION'); suffix_code=(Get-SoakFailureCode 'soak_secondary_exit:1:PRIVATE_OUTPUT') } | ConvertTo-Json -Depth 6 -Compress`);
  assert.deepEqual(result.projections, [
    { schema: 'metaengine.browser.me2.ui-host.v1', event: 'UI_INITIAL_READINESS_FAILED' },
    { schema: 'metaengine.browser.me2-r97-installed-ui.v1', event: 'ME2_R97_UI_CONTRACT_INCOMPLETE' },
    'IGNORED', 'IGNORED', 'IGNORED',
  ]);
  assert.equal(result.unknown_code, 'other_failure');
  assert.equal(result.suffix_code, 'secondary_exit');
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  assert.match(source, /foreach \(\$streamFile in @\(\$normalOut, \$normalErr\)\)/);
});

test('activation ACK admission requires exact primary, UUID and safe positive sequence', { skip: !powershell }, async () => {
  const result = await runPowerShell(`$ack = [pscustomobject]@{ schema='metaengine.browser.secondary-launch.v1'; state='PRIMARY_UI_ACTIVATION_ACKNOWLEDGED'; second_browser_runtime_started=$false; authority_effect=$false; launch_id='00000000-0000-4000-8000-000000000001'; event_sequence=23; primary_pid=123 }
$checks = @(Test-SoakActivationAck -Ack $ack -PrimaryPid 123)
$checks += Test-SoakActivationAck -Ack $ack -PrimaryPid 456
$ack.launch_id='PRIVATE_INVALID_NONCE'; $checks += Test-SoakActivationAck -Ack $ack -PrimaryPid 123
$ack.launch_id='00000000-0000-4000-8000-000000000001'
foreach ($sequence in @(0, -1, 1.5, 9007199254740992)) { $ack.event_sequence=$sequence; $checks += Test-SoakActivationAck -Ack $ack -PrimaryPid 123 }
$checks += Test-SoakActivationAck -Ack ([pscustomobject]@{}) -PrimaryPid 123
@{checks=$checks} | ConvertTo-Json -Compress`);
  assert.deepEqual(result.checks, [true, false, false, false, false, false, false, false]);
});

test('harness preserves deadline values, basic parsing, distinct failure evidence and confirmed receipts', () => {
  assert.match(source, /Invoke-WebRequest -UseBasicParsing -Uri \$Endpoint -Method Get -TimeoutSec 2/);
  assert.match(source, /\$uiHealthEndpoint = Resolve-SoakUiEndpoint -Port \$diagnostics\.ports\.ui/);
  assert.match(source, /Invoke-SoakUiProbe -Endpoint \$uiHealthEndpoint/);
  assert.doesNotMatch(source, /Invoke-WebRequest[^\r\n]+127\.0\.0\.1:3000/);
  for (const seconds of [55, 15, 35, 45, 12]) assert.match(source, new RegExp(`AddSeconds\\(${seconds}\\)`));
  for (const milliseconds of [15000, 18000, 50000, 60000]) assert.match(source, new RegExp(`WaitForExit\\(${milliseconds}\\)`));
  assert.match(source, /\$primaryFailure = \$_[\s\S]*Set-SoakDiagnosticFailure[\s\S]*\n\s*throw\s*\n\s*} finally/);
  assert.match(source, /Invoke-SoakCleanup -PrimaryFailure \$primaryFailure/);
  assert.match(source, /activation_receipts -NotePropertyValue @\(\$activationReceipts\.ToArray\(\)\)/);
  assert.match(source, /soak_activation_ack_sequence_drift[\s\S]*\$activationReceipts\.Add\([\s\S]*kind='SEQUENTIAL'/);
  assert.match(source, /soak_burst_activation_ack_sequence_drift[\s\S]*\$activationReceipts\.Add\([\s\S]*kind='BURST'/);
  for (const timer of ['activationStarted', 'burstWatch']) {
    const start = source.indexOf(`$${timer} = [Diagnostics.Stopwatch]::StartNew()`);
    const stop = source.indexOf(`$${timer}.Stop()`, start);
    assert.ok(start >= 0 && stop > start);
    assert.doesNotMatch(source.slice(start, stop), /Write-SoakDiagnosticCheckpoint/,
      'diagnostic persistence must stay outside the existing activation latency window');
  }
});
