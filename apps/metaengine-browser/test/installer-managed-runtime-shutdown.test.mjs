import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../build/installer-shutdown.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const harness = `param([string]$Scenario,[string]$Root,[string]$ActualScript,[string]$Evidence,[string]$RuntimeRelativePath)
$script:Now = [DateTime]::Parse('2026-10-08T00:00:00Z').ToUniversalTime()
$script:Sleeps = 0; $script:Signals = 0; $script:Killed = @()
$target = Join-Path $Root 'METAENGINE Browser Test.exe'
$runtimeRoot = Join-Path $Root 'resources\\client-state-runtime'
$script:BrowserRows = @([pscustomobject]@{ ProcessId=1001; ExecutablePath=$target })
$script:RuntimeRows = @([pscustomobject]@{ ProcessId=1002; ExecutablePath=(Join-Path $runtimeRoot $RuntimeRelativePath) })
if ($Scenario -in @('runtime-orphan','foreign-runtime')) { $script:BrowserRows = @() }
if ($Scenario -eq 'foreign-runtime') { $script:RuntimeRows[0].ExecutablePath = Join-Path $Root 'foreign\\node.exe' }
function Get-CimInstance {
  [CmdletBinding()] param([string]$ClassName,[string]$Filter)
  if ($Scenario -eq 'inventory-error') { throw 'fixture inventory error' }
  return @(($script:BrowserRows + $script:RuntimeRows) | Where-Object {
    $name = [IO.Path]::GetFileName($_.ExecutablePath)
    $Filter.IndexOf("Name = '$name'",[StringComparison]::OrdinalIgnoreCase) -ge 0
  })
}
function Start-Process { param($FilePath,$ArgumentList,$WindowStyle); $script:Signals += 1 }
function Stop-Process {
  [CmdletBinding()] param([int]$Id,[switch]$Force)
  $script:Killed += $Id
  $script:BrowserRows = @()
}
function Get-Date { return $script:Now }
function Start-Sleep {
  param([int]$Milliseconds)
  $script:Sleeps += 1; $script:Now = $script:Now.AddSeconds(60)
  if ($Scenario -eq 'graceful-managed') { $script:BrowserRows = @(); $script:RuntimeRows = @() }
}
$env:USERPROFILE = Join-Path $Root 'profile'
$exitCode = 0
try { & $ActualScript -InstalledExe $target; $exitCode = $LASTEXITCODE }
finally { [pscustomobject]@{ sleeps=$script:Sleeps; signals=$script:Signals; killed=@($script:Killed) } | ConvertTo-Json -Compress | Set-Content -LiteralPath $Evidence -Encoding UTF8 }
exit $exitCode
`;

async function run(t, scenario, { managed = true, executable = true, runtimeRelativePath = 'runtime/node/node.exe' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-installer-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (executable) await writeFile(path.join(root, 'METAENGINE Browser Test.exe'), 'inert fixture');
  if (managed) await mkdir(path.join(root, 'resources/client-state-runtime'), { recursive: true });
  const wrapper = path.join(root, 'harness.ps1');
  const evidenceFile = path.join(root, 'evidence.json');
  await writeFile(wrapper, harness.replaceAll('$script:', '$global:InstallerFixture'));
  let result;
  try {
    result = { code: 0, ...await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
      '-Scenario', scenario, '-Root', root, '-ActualScript', script, '-Evidence', evidenceFile,
      '-RuntimeRelativePath', runtimeRelativePath], { windowsHide: true, timeout: 10000 }) };
  } catch (error) { result = error; }
  const bytes = await readFile(evidenceFile, 'utf8').catch(() => {
    throw new Error('installer fixture did not emit evidence: ' + String(result.stderr || result.stdout || result));
  });
  const evidence = JSON.parse(bytes.replace(/^\uFEFF/, ''));
  return { result, evidence };
}

test('managed installer waits for Browser and all pinned runtime processes to finish gracefully', windows, async t => {
  const { result, evidence } = await run(t, 'graceful-managed');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(evidence.signals, 1);
  assert.equal(evidence.sleeps, 1);
  assert.deepEqual(evidence.killed, []);
});

test('managed installer allows the full bounded cleanup budget and never force-kills a stuck primary', windows, async t => {
  const { result, evidence } = await run(t, 'stuck-managed');
  assert.equal(result.code, 23, result.stderr);
  assert.match(result.stderr, /managed_cleanup_unconfirmed/);
  assert.equal(evidence.sleeps, 4, 'managed default covers 240 seconds despite legacy 12-second grace');
  assert.deepEqual(evidence.killed, []);
});

test('Browser absence does not authorize replacement while its exact packaged Node host remains', windows, async t => {
  const { result, evidence } = await run(t, 'runtime-orphan');
  assert.equal(result.code, 23, result.stderr);
  assert.equal(evidence.sleeps, 4);
  assert.deepEqual(evidence.killed, []);
});

test('missing Browser executable does not hide an owned runtime process from the installer', windows, async t => {
  const { result, evidence } = await run(t, 'runtime-orphan', { executable: false });
  assert.equal(result.code, 23, result.stderr);
  assert.equal(evidence.signals, 0);
  assert.deepEqual(evidence.killed, []);
});

test('every pinned Deno and PostgreSQL executable blocks replacement until it exits', windows, async t => {
  for (const runtimeRelativePath of ['runtime/deno/deno.exe', ...['postgres', 'psql', 'pg_ctl', 'initdb', 'pg_config']
    .map(name => `runtime/postgresql/bin/${name}.exe`)]) {
    const { result, evidence } = await run(t, 'runtime-orphan', { runtimeRelativePath });
    assert.equal(result.code, 23, runtimeRelativePath + ': ' + result.stderr);
    assert.deepEqual(evidence.killed, [], runtimeRelativePath);
  }
});

test('unrelated Node paths do not block a proven empty managed installation', windows, async t => {
  const { result, evidence } = await run(t, 'foreign-runtime');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(evidence.signals, 0);
  assert.equal(evidence.sleeps, 0);
  assert.deepEqual(evidence.killed, []);
});

test('legacy installations retain their bounded exact-Browser-path migration fallback', windows, async t => {
  const { result, evidence } = await run(t, 'legacy-stuck', { managed: false });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(evidence.killed, [1001]);
  assert.equal(evidence.sleeps, 2);
});

test('failed process inventory cannot be mistaken for confirmed process absence', windows, async t => {
  const { result, evidence } = await run(t, 'inventory-error');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /process_inventory_unavailable/);
  assert.equal(evidence.signals, 0);
  assert.deepEqual(evidence.killed, []);
});
