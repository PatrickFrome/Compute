import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const builder = JSON.parse(fs.readFileSync(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
const bootstrap = fs.readFileSync(new URL('../scripts/bootstrap-install-and-launch.ps1', import.meta.url), 'utf8');

test('manual Windows installer stays assisted and offers Browser run after finish', () => {
  assert.equal(builder?.nsis?.oneClick, false);
  assert.equal(builder?.nsis?.perMachine, false);
  assert.equal(builder?.nsis?.runAfterFinish, true);
  assert.equal(builder?.nsis?.allowToChangeInstallationDirectory, false);
});

test('bootstrap installs silently then proves one exact packaged normal launch', () => {
  assert.match(bootstrap, /Start-Process -FilePath \$InstallerPath -ArgumentList ['"]\/S['"] -PassThru -Wait/);
  assert.match(bootstrap, /Start-Process -FilePath \$InstalledExePath -PassThru/);
  assert.match(bootstrap, /silent_install_then_exact_normal_launch = \$true/);
  assert.match(bootstrap, /bootstrap_normal_browser_exited_early/);
  assert.match(bootstrap, /PRIMARY_WINDOW_STABLE/);
  assert.match(bootstrap, /bootstrap_runtime_import_evidence_missing/);
});
