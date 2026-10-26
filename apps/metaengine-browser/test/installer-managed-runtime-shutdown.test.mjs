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
const harness = `param([string]$Scenario,[string]$Root,[string]$ActualScript,[string]$Evidence,[string]$RuntimeRelativePath,[string]$ProfileRoot,[switch]$RequireFreshInstall)
$script:Now = [DateTime]::Parse('2026-10-08T00:00:00Z').ToUniversalTime()
$script:Sleeps = 0; $script:Signals = 0; $script:Killed = @(); $script:Removed = @(); $script:PidReads = 0; $script:RegistryReads = 0
$target = Join-Path $Root 'METAENGINE Browser Test.exe'
$runtimeRoot = Join-Path $Root 'resources\\client-state-runtime'
$script:BrowserRows = @([pscustomobject]@{ Name='METAENGINE Browser Test.exe'; ProcessId=1001; ExecutablePath=$target })
$script:RuntimeRows = @([pscustomobject]@{ Name=[IO.Path]::GetFileName($RuntimeRelativePath); ProcessId=1002; ExecutablePath=(Join-Path $runtimeRoot $RuntimeRelativePath) })
if ($Scenario -in @('runtime-orphan','foreign-runtime','runtime-path-unknown')) { $script:BrowserRows = @() }
if ($Scenario -eq 'foreign-runtime') { $script:RuntimeRows[0].ExecutablePath = Join-Path $Root 'foreign\\node.exe' }
if ($Scenario -in @('empty','stale-lock','pid-unknown','fresh-empty','registered','registry-error','existing-stopped')) { $script:BrowserRows = @(); $script:RuntimeRows = @() }
if ($Scenario -eq 'browser-path-unknown') { $script:BrowserRows[0].ExecutablePath = $null }
if ($Scenario -eq 'runtime-path-unknown') { $script:RuntimeRows[0].ExecutablePath = $null }
function Get-Process { $script:PidReads += 1; throw 'fixture pid absent or inaccessible' }
function Remove-Item { param($LiteralPath,[switch]$Force,$ErrorAction); $script:Removed += $LiteralPath; throw 'fixture removal forbidden' }
function Get-CimInstance {
  [CmdletBinding()] param([string]$ClassName,[string]$Filter)
  if ($Scenario -eq 'inventory-error') { throw 'fixture inventory error' }
  return @(($script:BrowserRows + $script:RuntimeRows) | Where-Object {
    $name = $_.Name
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
$env:USERPROFILE = $ProfileRoot
$global:InstallerFixtureRegistryScenario = $Scenario
function Open-FixtureRegistryBase {
  param($hive,$view)
  $script:RegistryReads += 1
  if ($global:InstallerFixtureRegistryScenario -eq 'registry-error') { throw 'inert registry access denied' }
  $base = New-Object PSObject
  $base | Add-Member ScriptMethod Dispose { }
  $base | Add-Member ScriptMethod OpenSubKey {
    param($keyName,$write)
    if ($write -ne $false) { throw 'fixture registry write forbidden' }
    if ($global:InstallerFixtureRegistryScenario -ne 'registered') { return $null }
    $key = New-Object PSObject
    $key | Add-Member ScriptMethod Dispose { }
    return $key
  }
  return $base
}
$exitCode = 0
try {
  if ($RequireFreshInstall) {
    $code = [IO.File]::ReadAllText($ActualScript)
    $native = '[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)'
    if (-not $code.Contains($native)) { throw 'fixture registry facade missing' }
    $code = $code.Replace($native, '(Open-FixtureRegistryBase $hive $view)')
    if ($code.Contains('::OpenBaseKey')) { throw 'fixture native registry read forbidden' }
    & ([scriptblock]::Create($code)) -InstalledExe $target -RequireFreshInstall -InstallRegistryKey 'Software\\fixture-install' -UninstallRegistryKey 'Software\\fixture-uninstall'
  } else { & $ActualScript -InstalledExe $target }
  $exitCode = $LASTEXITCODE
}
finally { [pscustomobject]@{ sleeps=$script:Sleeps; signals=$script:Signals; killed=@($script:Killed); removed=@($script:Removed); pid_reads=$script:PidReads; registry_reads=$script:RegistryReads } | ConvertTo-Json -Compress | Set-Content -LiteralPath $Evidence -Encoding UTF8 }
exit $exitCode
`;

async function run(t, scenario, { managed = true, executable = true, runtimeRelativePath = 'runtime/node/node.exe', fresh = false, missingTarget = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-installer-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installationRoot=path.join(root,'installation');
  if(!missingTarget)await mkdir(installationRoot);
  if (executable) await writeFile(path.join(installationRoot, 'METAENGINE Browser Test.exe'), 'inert fixture');
  if (managed) await mkdir(path.join(installationRoot, 'resources/client-state-runtime'), { recursive: true });
  const privateRoot = path.join(root, 'profile');
  const files = [path.join(privateRoot, '.metaengine/a2-compute-browser/a2-daemon.lock'),
    path.join(privateRoot, '.metaengine/a2-compute-browser/control-token'), path.join(privateRoot, '.a2/compute-bridge.json')];
  const preimages = [JSON.stringify({pid: 987654, nonce: 'stale-unrelated-daemon'}), 'new-owner-token', 'new-owner-bridge'];
  for (let i=0;i<files.length;i++) { await mkdir(path.dirname(files[i]), {recursive:true}); await writeFile(files[i], preimages[i]); }
  const wrapper = path.join(root, 'harness.ps1');
  const evidenceFile = path.join(root, 'evidence.json');
  await writeFile(wrapper, harness.replaceAll('$script:', '$global:InstallerFixture'));
  let result;
  try {
    result = { code: 0, ...await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
      '-Scenario', scenario, '-Root', installationRoot, '-ActualScript', script, '-Evidence', evidenceFile,
      '-RuntimeRelativePath', runtimeRelativePath, '-ProfileRoot', privateRoot, ...(fresh ? ['-RequireFreshInstall'] : [])], { windowsHide: true, timeout: 10000 }) };
  } catch (error) { result = error; }
  const bytes = await readFile(evidenceFile, 'utf8').catch(() => {
    throw new Error('installer fixture did not emit evidence: ' + String(result.stderr || result.stdout || result));
  });
  const evidence = JSON.parse(bytes.replace(/^\uFEFF/, ''));
  for (let i=0;i<files.length;i++) assert.equal(await readFile(files[i], 'utf8'), preimages[i], 'private user artifact changed');
  assert.deepEqual(evidence.removed, []);
  assert.equal(evidence.pid_reads, 0);
  return { result, evidence };
}

test('managed and unknown protocols are held before signaling or killing a live primary', windows, async t => {
  for (const managed of [true, false]) {
    const { result, evidence } = await run(t, 'legacy-or-unknown-protocol', { managed });
    assert.equal(result.code, 23, result.stderr);
    assert.match(result.stderr, /controlled_quit_required/);
    assert.equal(evidence.signals, 0);
    assert.equal(evidence.sleeps, 0);
    assert.deepEqual(evidence.killed, []);
  }
});

test('Browser absence does not authorize replacement while its exact packaged Node host remains', windows, async t => {
  const { result, evidence } = await run(t, 'runtime-orphan');
  assert.equal(result.code, 23, result.stderr);
  assert.equal(evidence.sleeps, 0);
  assert.equal(evidence.signals, 0);
  assert.deepEqual(evidence.killed, []);
});

test('missing Browser executable does not hide an owned runtime process from the installer', windows, async t => {
  for (const managed of [true, false]) {
    const { result, evidence } = await run(t, 'runtime-orphan', { executable: false, managed });
    assert.equal(result.code, 23, result.stderr);
    assert.equal(evidence.signals, 0);
    assert.deepEqual(evidence.killed, []);
  }
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

test('empty installation preserves stale or unknown daemon custody and separately published credentials', windows, async t => {
  for (const scenario of ['empty', 'stale-lock', 'pid-unknown']) {
    const { result, evidence } = await run(t, scenario);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(evidence.signals, 0);
    assert.deepEqual(evidence.killed, []);
  }
});

test('missing executable identity is UNKNOWN rather than an empty installation', windows, async t => {
  for (const scenario of ['browser-path-unknown', 'runtime-path-unknown']) {
    const { result, evidence } = await run(t, scenario);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /process_identity_unknown/);
    assert.equal(evidence.signals, 0);
    assert.deepEqual(evidence.killed, []);
  }
});

test('failed process inventory cannot be mistaken for confirmed process absence', windows, async t => {
  const { result, evidence } = await run(t, 'inventory-error');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /process_inventory_unavailable/);
  assert.equal(evidence.signals, 0);
  assert.deepEqual(evidence.killed, []);
});


test('fresh-only installer rejects an existing stopped image before any old uninstaller could run', windows, async t => {
  const {result,evidence}=await run(t,'existing-stopped',{fresh:true});
  assert.equal(result.code,23);assert.match(result.stderr,/existing_installation_unqualified/);
  assert.equal(evidence.signals,0);assert.equal(evidence.registry_reads,0);
});

test('fresh-only gate distinguishes absent installation from existing registration and registry UNKNOWN', windows, async t => {
  for(const scenario of ['fresh-empty','registered','registry-error'])for(const missingTarget of [false,true]){
    const {result,evidence}=await run(t,scenario,{fresh:true,managed:false,executable:false,missingTarget});
    if(scenario==='fresh-empty'){assert.equal(result.code,0,result.stderr);assert.equal(evidence.registry_reads,8);}
    else {assert.notEqual(result.code,0);assert.match(result.stderr,scenario==='registered'?/existing_registration_unqualified/:/registry_presence_unknown/);}
    assert.equal(evidence.signals,0);assert.deepEqual(evidence.killed,[]);
  }
});
