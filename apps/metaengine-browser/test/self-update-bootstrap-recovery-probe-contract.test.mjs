import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '../scripts/self-update-bootstrap-recovery-probe.ps1');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('bootstrap recovery probe source contains no mutation, installer or Browser launch primitive', async () => {
  const raw = await fsp.readFile(scriptPath, 'utf8');
  for (const forbidden of [
    /Start-Process/i,
    /Stop-Process/i,
    /Remove-Item/i,
    /Set-Content/i,
    /Add-Content/i,
    /Out-File/i,
    /New-Item/i,
    /Set-ItemProperty/i,
    /New-ItemProperty/i,
    /Remove-ItemProperty/i,
    /Move-Item/i,
    /Copy-Item/i,
    /Invoke-WebRequest/i,
    /quitAndInstall/i,
  ]) {
    assert.equal(forbidden.test(raw), false, `forbidden bootstrap probe primitive: ${forbidden}`);
  }
  assert.match(raw, /Get-Content/);
  assert.match(raw, /Get-FileHash/);
  assert.match(raw, /FileVersionInfo/);
  assert.match(raw, /mutation_performed\s*=\s*\$false/);
  assert.match(raw, /process_launch_performed\s*=\s*\$false/);
  assert.match(raw, /installer_effect_attempted\s*=\s*\$false/);
  assert.match(raw, /journal_mutation_performed\s*=\s*\$false/);
  assert.match(raw, /automatic_retry_allowed\s*=\s*\$false/);
  assert.match(raw, /authority_effect\s*=\s*\$false/);
});

test('Windows bootstrap probe reads exact local evidence without changing any input byte', { skip: process.platform !== 'win32' }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-probe-'));
  try {
    const userData = path.join(root, 'user-data');
    await fsp.mkdir(userData, { recursive: true });
    const target = '0.6.6-dev.33774085931.1';
    const app = path.join(root, 'METAENGINE Browser Test.exe');
    await fsp.writeFile(app, Buffer.from('read-only-probe-fixture'));
    const appSha = digest(app);
    const rows = {
      'metaengine-self-update-transaction-v1.json': {
        schema: 'metaengine.self-update.transaction.v1', state: 'SUCCESSOR_BOOTED', source_version: '0.6.6-dev.4.1', target_version: target,
        automatic_retry_allowed: false, authority_effect: false,
      },
      'metaengine-self-update-pre-install-receipt-v1.json': {
        schema: 'metaengine.self-update.pre-install-receipt.v1', version: target, available_version: target,
        metadata_verified: true, restart_gate_safe: true, authority_effect: false,
      },
      'metaengine-self-update-successor-receipt-v1.json': {
        schema: 'metaengine.self-update.successor-receipt.v1', version: target, primary_instance: true,
        pre_install_receipt_sha256: 'b'.repeat(64), authority_effect: false,
      },
    };
    for (const [name, row] of Object.entries(rows)) {
      await fsp.writeFile(path.join(userData, name), `${JSON.stringify(row)}\n`, 'utf8');
    }
    const files = [app, ...Object.keys(rows).map((name) => path.join(userData, name))];
    const before = Object.fromEntries(files.map((file) => [file, digest(file)]));

    const result = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-UserDataPath', userData,
      '-InstalledExePath', app,
      '-ExpectedTargetVersion', target,
      '-ExpectedInstalledExeSha256', appSha,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1));
    assert.equal(output.schema, 'metaengine.self-update.bootstrap-probe.v1');
    assert.equal(output.transaction_read_state, 'READ');
    assert.equal(output.pre_install_receipt_read_state, 'READ');
    assert.equal(output.successor_receipt_read_state, 'READ');
    assert.equal(output.installed_executable.exists, true);
    assert.equal(output.installed_executable.sha256, appSha);
    assert.equal(output.installed_executable.hash_matches_expected, true);
    assert.equal(output.mutation_performed, false);
    assert.equal(output.process_launch_performed, false);
    assert.equal(output.installer_effect_attempted, false);
    assert.equal(output.journal_mutation_performed, false);
    assert.equal(output.automatic_retry_allowed, false);
    assert.equal(output.authority_effect, false);

    const after = Object.fromEntries(files.map((file) => [file, digest(file)]));
    assert.deepEqual(after, before);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
