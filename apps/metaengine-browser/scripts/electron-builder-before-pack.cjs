'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildDevOSSourceSnapshot } = require('./devos-source-snapshot-builder.cjs');

module.exports = async function metaengineGuardianNativeBeforePack(context) {
  if (!context || context.electronPlatformName !== 'win32') return;
  if (process.platform !== 'win32') {
    throw new Error('guardian_native_staging_windows_toolchain_required');
  }

  const appRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(appRoot, '../..');
  await buildDevOSSourceSnapshot({
    repoRoot,
    outputDir: path.join(appRoot, 'devos-source-snapshot'),
    repository: process.env.GITHUB_REPOSITORY || 'PatrickFrome/Compute',
    head: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF || null,
  });
  const buildScript = path.join(__dirname, 'build-guardian-native-staging.ps1');
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';

  const result = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', buildScript],
    { cwd: appRoot, stdio: 'inherit', windowsHide: true },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`guardian_native_staging_build_failed:${result.status}`);
  }
};
