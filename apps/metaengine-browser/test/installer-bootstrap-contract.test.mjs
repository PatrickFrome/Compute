import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const builder = JSON.parse(fs.readFileSync(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
const bootstrap = fs.readFileSync(new URL('../scripts/bootstrap-install-and-launch.ps1', import.meta.url), 'utf8');

test('manual Windows installer is one-click and must run Browser after finish', () => {
  assert.equal(builder?.nsis?.oneClick, true);
  assert.equal(builder?.nsis?.perMachine, false);
  assert.equal(builder?.nsis?.runAfterFinish, true);
  assert.equal(builder?.nsis?.allowToChangeInstallationDirectory, false);
});

test('bootstrap physical proof cannot manufacture the normal Browser launch', () => {
  assert.match(bootstrap, /Start-Process -FilePath \$InstallerPath -PassThru -Wait/);
  assert.doesNotMatch(bootstrap, /Start-Process -FilePath \$InstallerPath -ArgumentList ['"]\/S['"]/);
  assert.match(bootstrap, /bootstrap_installer_spawned_visible_browser_timeout/);
  assert.match(bootstrap, /installer_launched_process_observed = \$true/);
  assert.match(bootstrap, /manual_post_install_start_process = \$false/);
  assert.match(bootstrap, /bootstrap_startup_journal_pid_drift/);
  assert.doesNotMatch(bootstrap, /bootstrap-normal-ui/);
});
