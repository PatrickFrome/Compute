import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const windows = process.platform === 'win32';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const script = new URL('../scripts/bootstrap-install-and-launch.ps1', import.meta.url);

async function bootstrapFixture(t, { failure = '', digestMismatch = false, timeout = 7, receiptPatch = '' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-bounded-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = path.join(root, 'candidate.exe');
  const installed = path.join(root, 'installed.exe');
  const proof = path.join(root, 'proof.json');
  const calls = path.join(root, 'bounded-call.json');
  const launches = path.join(root, 'normal-launches.txt');
  await fs.copyFile(script, path.join(root, 'bootstrap-install-and-launch.ps1'));
  const bytes = Buffer.from('inert test fixture, never executed');
  await fs.writeFile(installer, bytes);
  await fs.writeFile(installed, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(root, 'install-package-bounded.ps1'), `
param([string]$InstallerPath,[string]$ExpectedSha256,[int]$TimeoutSeconds)
[ordered]@{ path=$InstallerPath; digest=$ExpectedSha256; timeout=$TimeoutSeconds } |
  ConvertTo-Json | Set-Content -LiteralPath ${quote(calls)} -Encoding utf8
${failure ? `throw ${quote(failure)}` : ''}
$receipt = [ordered]@{
  schema='metaengine.browser.bounded-package-install.v1'
  installer_sha256=$ExpectedSha256
  installer_pid=812
  installer_exit_code=0
  timeout_seconds=$TimeoutSeconds
  process_tree_scoped_job=$true
  descendant_cleanup_on_job_close=$true
  installed_payload_qualification_required=$true
  authority_effect=$false
}
${receiptPatch}
$receipt | ConvertTo-Json -Compress
`);
  await fs.writeFile(path.join(root, 'invoke.ps1'), `
$ErrorActionPreference = 'Stop'
$global:BootstrapProcessReads = 0
function Get-Process {
  param($ErrorAction)
  $global:BootstrapProcessReads++
  if ($global:BootstrapProcessReads -gt 1) {
    [pscustomobject]@{ Path=${quote(installed)}; MainWindowHandle=1 }
  }
}
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError, $WindowStyle)
  $FilePath | Add-Content -LiteralPath ${quote(launches)}
  $process = [pscustomobject]@{ Handle=1; Id=913; HasExited=$false }
  $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
  return $process
}
& ${quote(path.join(root, 'bootstrap-install-and-launch.ps1'))} -InstallerPath ${quote(installer)} -ExpectedInstallerSha256 ${quote(digestMismatch ? '0'.repeat(64) : digest.toUpperCase())} -ExpectedVersion '0.7.0-dev.1107139874561.1' -InstalledExePath ${quote(installed)} -ProofPath ${quote(proof)} -InstallTimeoutSeconds ${timeout}
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'invoke.ps1')], { encoding: 'utf8', timeout: 45_000, windowsHide: true });
  assert.ifError(result.error);
  const readJson = async file => {
    try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const readLaunches = async () => {
    try { return (await fs.readFile(launches, 'utf8')).trim().split(/\r?\n/).filter(Boolean); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { result, digest, installer, installed, proof: await readJson(proof),
    calls: await readJson(calls), launches: await readLaunches() };
}

test('bootstrap passes exact normalized digest and deadline to bounded install before one normal launch',
  { skip: !windows }, async t => {
    const f = await bootstrapFixture(t);
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.deepEqual(f.calls, { path: f.installer, digest: f.digest, timeout: 7 });
    assert.deepEqual(f.launches, [f.installed]);
    assert.equal(f.proof.install_exit_code, 0);
    assert.equal(f.proof.installer_pid, 812);
    assert.equal(f.proof.installer_timeout_seconds, 7);
    assert.equal(f.proof.installer_process_tree_scoped_job, true);
    assert.equal(f.proof.browser_visible, true);
    assert.equal(f.proof.automatic_retry_allowed, false);
  });

test('bootstrap rejects digest mismatch before installer or GUI launch', { skip: !windows }, async t => {
  const f = await bootstrapFixture(t, { digestMismatch: true });
  assert.notEqual(f.result.status, 0);
  assert.match(f.result.stderr, /bootstrap_installer_sha256_mismatch/);
  assert.equal(f.calls, null);
  assert.equal(f.proof, null);
  assert.deepEqual(f.launches, []);
});

test('bootstrap retains timeout uncertainty without rollback claim, retry or GUI launch',
  { skip: !windows }, async t => {
    const f = await bootstrapFixture(t, { failure: 'package_installer_timeout' });
    assert.notEqual(f.result.status, 0);
    assert.match(f.result.stderr, /package_installer_timeout/);
    assert.equal(f.proof.state, 'EFFECT_UNKNOWN');
    assert.equal(f.proof.reason, 'package_installer_timeout');
    assert.equal(f.proof.installer_sha256, f.digest);
    assert.equal(f.proof.installer_effect_attempted, true);
    assert.equal(f.proof.installed_payload_qualification_required, true);
    assert.equal(f.proof.automatic_retry_allowed, false);
    assert.equal(f.proof.rollback_confirmed, false);
    assert.equal(f.proof.automatic_browser_launch_performed, false);
    assert.deepEqual(f.launches, []);
  });

test('bootstrap refuses an unbound bounded-installer receipt before launching GUI',
  { skip: !windows }, async t => {
    const f = await bootstrapFixture(t, { receiptPatch: "$receipt.installer_sha256 = 'f' * 64" });
    assert.notEqual(f.result.status, 0);
    assert.equal(f.proof.state, 'EFFECT_UNKNOWN');
    assert.equal(f.proof.reason, 'bootstrap_bounded_installer_receipt_invalid');
    assert.deepEqual(f.launches, []);
  });

test('bootstrap rejects out-of-range install deadline before any effect', { skip: !windows }, async t => {
  const f = await bootstrapFixture(t, { timeout: 601 });
  assert.notEqual(f.result.status, 0);
  assert.equal(f.calls, null);
  assert.equal(f.proof, null);
  assert.deepEqual(f.launches, []);
});
