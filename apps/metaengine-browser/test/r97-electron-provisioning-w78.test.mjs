import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkR97ElectronInputs, verifyR97ElectronBinary, PIN } from '../scripts/qualify-r97-electron-w78.mjs';

async function fixture(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'w78-r97-electron-')));
  const bin = path.join(root, 'node_modules', 'electron');
  const app = { devDependencies: { electron: PIN.version } };
  const lock = { lockfileVersion: 3, packages: {
    '': { devDependencies: { electron: PIN.version } },
    'node_modules/electron': { version: PIN.version, resolved: PIN.resolved, integrity: PIN.integrity },
    'node_modules/@electron/get': { integrity: 'sha512-unit-fixture' },
  } };
  try {
    await mkdir(bin, { recursive: true });
    const save = async () => {
      await writeFile(path.join(root, 'package.json'), JSON.stringify(app));
      await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    };
    await save();
    await writeFile(path.join(bin, 'package.json'), JSON.stringify({ name:'electron', version:PIN.version }));
    await writeFile(path.join(bin, 'install.js'), '// unit fixture; never executed');
    await fn({ root, bin, app, lock, save });
  } finally {
    await rm(root, { recursive:true, force:true });
  }
}

test('W78 exact tarball integrity/installer is accepted, but missing exe is NOT a success', async () => {
  await fixture(async ({ root }) => {
    assert.equal((await checkR97ElectronInputs(root, {})).electron_version, PIN.version);
    await assert.rejects(verifyR97ElectronBinary(root, {}), /ENOENT/);
  });
});

test('W78 blocks unreviewed mirror, skip-download and path override', async () => {
  await fixture(async ({ root }) => {
    for (const key of ['ELECTRON_MIRROR','ELECTRON_CUSTOM_DIR','ELECTRON_SKIP_BINARY_DOWNLOAD','ELECTRON_OVERRIDE_DIST_PATH'])
      await assert.rejects(checkR97ElectronInputs(root, { [key]:'1' }), /w78_electron_override_forbidden/);
  });
});

test('W78 canonical generated root does not permit a caller path alias', async () => {
  await fixture(async ({ root }) => {
    const alias = path.join(root, 'linked-root');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(checkR97ElectronInputs(alias, {}), /w78_path_alias_forbidden/);
  });
});

test('W78 version, tarball origin, integrity and actual installed version cannot drift', async () => {
  await fixture(async ({ root, bin, app, lock, save }) => {
    app.devDependencies.electron = '^' + PIN.version; await save();
    await assert.rejects(checkR97ElectronInputs(root, {}), /w78_manifest_version_drift/);
    app.devDependencies.electron = PIN.version;
    lock.packages['node_modules/electron'].resolved = 'https://example.invalid/electron.tgz'; await save();
    await assert.rejects(checkR97ElectronInputs(root, {}), /w78_electron_registry_drift/);
    lock.packages['node_modules/electron'].resolved = PIN.resolved;
    lock.packages['node_modules/electron'].integrity = 'sha512-forged'; await save();
    await assert.rejects(checkR97ElectronInputs(root, {}), /w78_electron_integrity_drift/);
    lock.packages['node_modules/electron'].integrity = PIN.integrity; await save();
    await writeFile(path.join(bin, 'package.json'), JSON.stringify({ name:'electron', version:'43.0.0' }));
    await assert.rejects(checkR97ElectronInputs(root, {}), /w78_installed_version_drift/);
  });
});

test('W78 CI executes only the frozen Electron official installer after input check', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/client-wave10-w62-source-r97.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node \.\\node_modules\\electron\\install\.js/);
  assert.match(workflow, /qualify-r97-electron-w78\.mjs --check-inputs/);
  assert.match(workflow, /qualify-r97-electron-w78\.mjs --verify-binary/);
  assert.match(workflow, /work\/metaengine-client-wave12-w78-20261015/);
  assert.doesNotMatch(workflow, /dangerously-allow-all-scripts|approve --all|npx install-electron/);
});
