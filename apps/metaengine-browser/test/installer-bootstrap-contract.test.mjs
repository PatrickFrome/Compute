import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const builder = JSON.parse(fs.readFileSync(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
const bootstrap = fs.readFileSync(new URL('../scripts/bootstrap-install-and-launch.ps1', import.meta.url), 'utf8');
const boundedInstaller = fs.readFileSync(new URL('../scripts/install-package-bounded.ps1', import.meta.url), 'utf8');
const exactUpgradeBootstrap = fs.readFileSync(new URL('../scripts/verify-exact-upgrade-bootstrap.ps1', import.meta.url), 'utf8');

test('manual Windows installer stays assisted and offers Browser run after finish', () => {
  assert.equal(builder?.nsis?.oneClick, false);
  assert.equal(builder?.nsis?.perMachine, false);
  assert.equal(builder?.nsis?.runAfterFinish, true);
  assert.equal(builder?.nsis?.allowToChangeInstallationDirectory, false);
});

test('bootstrap installs silently then proves one exact packaged normal launch', () => {
  // The current bootstrap uses a fixed-binary SHA-pinned and bounded installer,
  // not a non-terminating direct Start-Process -Wait.
  assert.match(bootstrap, /\$boundedInstaller = Join-Path \$PSScriptRoot ['"]install-package-bounded\.ps1['"]/);
  assert.match(bootstrap, /& \$boundedInstaller -InstallerPath \$InstallerPath/);
  assert.match(bootstrap, /-ExpectedSha256 \$expectedInstallerHash -TimeoutSeconds \$InstallTimeoutSeconds/);
  assert.match(bootstrap, /\$install\.process_tree_scoped_job -ne \$true/);
  assert.match(bootstrap, /\$install\.descendant_cleanup_on_job_close -ne \$true/);
  assert.match(bootstrap, /state = 'EFFECT_UNKNOWN'/);
  assert.match(bootstrap, /automatic_retry_allowed = \$false/);
  assert.doesNotMatch(bootstrap, /Start-Process -FilePath \$InstallerPath -ArgumentList ['"]\/S['"]/);
  assert.match(boundedInstaller, /AssignProcessToJobObject/);
  assert.match(boundedInstaller, /KILL_ON_JOB_CLOSE/);
  assert.match(boundedInstaller, /TerminateJobObject\(job,124\)/);
  assert.match(boundedInstaller, /GetExitCodeProcess/);
  assert.match(bootstrap, /Start-Process -FilePath \$InstalledExePath -PassThru/);
  assert.match(bootstrap, /silent_install_then_exact_normal_launch = \$true/);
  assert.match(bootstrap, /bootstrap_normal_browser_exited_early/);
  assert.match(bootstrap, /PRIMARY_WINDOW_STABLE/);
  assert.match(bootstrap, /bootstrap_runtime_import_evidence_missing/);
});

test('exact upgrade qualification proves installed executable provenance, profile continuity, direct bootstrap, and exact-path drain', () => {
  assert.match(exactUpgradeBootstrap, /Get-FileHash -LiteralPath \$PackagedExePath -Algorithm SHA256/);
  assert.match(exactUpgradeBootstrap, /installed_executable_sha256_matches_packaged = \$true/);
  assert.match(exactUpgradeBootstrap, /--metaengine-profile-probe/);
  assert.match(exactUpgradeBootstrap, /profile_user_data_path_preserved = \$true/);
  assert.match(exactUpgradeBootstrap, /& \$BootstrapScriptPath/);
  assert.match(exactUpgradeBootstrap, /-PhysicalProof/);
  assert.match(exactUpgradeBootstrap, /runtime_import_verified/);
  assert.match(exactUpgradeBootstrap, /startup_stable_event_sequence/);
  assert.match(exactUpgradeBootstrap, /Get-CimInstance Win32_Process/);
  assert.match(exactUpgradeBootstrap, /OrdinalIgnoreCase\.Equals/);
  assert.match(exactUpgradeBootstrap, /Wait-ExactExecutableProcessesGone/);
  assert.match(exactUpgradeBootstrap, /planned_shutdown_exact_path_processes_drained = \$true/);
  assert.match(exactUpgradeBootstrap, /bootstrap_cleanup_exact_path_processes_drained = \$true/);
  assert.doesNotMatch(exactUpgradeBootstrap, /Stop-Process -Id \(\[int\]\$_.ProcessId\) -Force/);
  assert.match(exactUpgradeBootstrap, /bootstrap_cleanup_shutdown_verified = \$true/);
});
test('QA installer checks existing Owner pin before bounded installation or GUI startup', () => {
  const profileCheck = bootstrap.indexOf('bootstrap_owner_preinstall_resources_required');
  const bundleCheck = bootstrap.indexOf('owner-runtime-preinstall-compatibility.mjs');
  const install = bootstrap.indexOf("$boundedInstaller = Join-Path $PSScriptRoot 'install-package-bounded.ps1'");
  const launch = bootstrap.indexOf('Start-Process -FilePath $InstalledExePath -PassThru');
  assert.ok(profileCheck > 0 && bundleCheck > profileCheck && install > bundleCheck && launch > install);
  assert.match(bootstrap, /bootstrap_owner_preinstall_incompatible/);
  assert.match(bootstrap, /\$preflightResult\.owner_mutated -ne \$false/);
  assert.doesNotMatch(bootstrap.slice(profileCheck, install), /Set-Content|Remove-Item|Move-Item|Set-ItemProperty|Copy-Item/);
});