import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveMe2DaemonLaunch } from '../src/me2/me2-daemon-host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '../..');

test('packaged standalone daemon is preferred and needs no external Bun', () => {
  const resourcesPath = path.join(path.sep, 'installed', 'resources');
  const packagedExe = path.join(resourcesPath, 'me2-daemon', 'me2-daemon.exe');
  const sourceIndex = path.join(resourcesPath, 'me2-daemon', 'index.ts');
  const existing = new Set([packagedExe, sourceIndex]);
  const launch = resolveMe2DaemonLaunch({
    resourcesPath,
    cwd: path.join(path.sep, 'irrelevant'),
    env: {},
    exists: (candidate) => existing.has(candidate),
  });
  assert.deepEqual(launch, {
    dir: path.join(resourcesPath, 'me2-daemon'),
    bin: packagedExe,
    args: [],
    mode: 'PACKAGED_STANDALONE',
  });
});

test('source checkout remains an explicit Bun fallback only', () => {
  const cwd = path.join(path.sep, 'repo', 'apps', 'metaengine-browser');
  const sourceDir = path.join(cwd, '..', 'me2-daemon');
  const sourceIndex = path.join(sourceDir, 'index.ts');
  const launch = resolveMe2DaemonLaunch({
    resourcesPath: '',
    cwd,
    env: { ME2_DAEMON_BIN: 'bun-custom' },
    exists: (candidate) => candidate === sourceIndex,
  });
  assert.equal(launch.mode, 'SOURCE_BUN');
  assert.equal(launch.bin, 'bun-custom');
  assert.deepEqual(launch.args, ['index.ts']);
});

test('R85 daemon staging script is parse-safe around PowerShell colon interpolation', async () => {
  const staging = await fs.readFile(path.join(appRoot, 'scripts', 'build-me2-daemon-staging.ps1'), 'utf8');
  assert.doesNotMatch(staging, /\\$[A-Za-z_][A-Za-z0-9_]*:/, 'PowerShell variables before colon must use ${name} delimiting');
  assert.match(staging, /me2_daemon_source_head_mismatch:\\$\\{sourceHead\\}:\\$\\{ExpectedSourceHead\\}/);
  assert.match(staging, /me2_daemon_version_drift:\\$\\{packageVersion\\}:\\$\\{runtimeVersion\\}/);
});

test('R85 package contract aligns daemon version and preserves one scheduler owner', async () => {
  const daemonPackage = JSON.parse(await fs.readFile(path.join(repoRoot, 'apps', 'me2-daemon', 'package.json'), 'utf8'));
  const store = await fs.readFile(path.join(repoRoot, 'apps', 'me2-daemon', 'store.ts'), 'utf8');
  const runtimeVersion = store.match(/export\s+const\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1] || null;
  assert.equal(daemonPackage.version, runtimeVersion);
  assert.equal(runtimeVersion, '0.57.1');

  const builder = JSON.parse(await fs.readFile(path.join(appRoot, 'electron-builder.test.json'), 'utf8'));
  assert.ok(builder.extraResources.some((row) => row.from === 'me2-daemon-dist' && row.to === 'me2-daemon'));

  const beforePack = await fs.readFile(path.join(appRoot, 'scripts', 'electron-builder-before-pack.cjs'), 'utf8');
  assert.match(beforePack, /build-me2-daemon-staging\.ps1/);
  assert.match(beforePack, /me2_daemon_staging_build_failed/);

  const host = await fs.readFile(path.join(appRoot, 'src', 'me2', 'me2-daemon-host.mjs'), 'utf8');
  assert.match(host, /ME2_BOOT_MODE:\s*process\.env\.ME2_DAEMON_BOOT_MODE \|\| 'probe'/);
  assert.match(host, /mode:\s*'PACKAGED_STANDALONE'/);

  const integration = await fs.readFile(path.join(appRoot, 'src', 'me2', 'me2-integration-entry.mjs'), 'utf8');
  assert.match(integration, /startMe2DaemonHost\(\{ dataDir:/);
  assert.match(integration, /stopMe2DaemonHost\(\{ killChild: true \}\)/);
});
