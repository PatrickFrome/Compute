import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { writeProvenance, verifyInstaller } from '../scripts/installer-provenance.mjs';

const require = createRequire(import.meta.url);
const {
  canonicalJson,
  createBuildIdentityV3,
  sha256String,
} = require('../scripts/build-identity.cjs');
const {
  createPackageLockMaterial,
} = require('../scripts/package-lock-material.cjs');

const HEAD = 'd'.repeat(40);
const PACKAGE_VERSION = '0.7.0-dev.36980000001.1';
const INSTALLER_NAME = `METAENGINE-Browser-Test-Setup-${PACKAGE_VERSION}-x64.exe`;

function workspace() {
  return mkdtempSync(join(tmpdir(), 'me2-prov-v3-'));
}

function createFixture(dir) {
  const installerPath = join(dir, INSTALLER_NAME);
  const blockmapPath = `${installerPath}.blockmap`;
  const configPath = join(dir, 'electron-builder.test.json');
  const dependencyPath = join(dir, 'dependency-resolution.json');
  const packageJsonPath = join(dir, 'package.json');
  const packageLockPath = join(dir, 'package-lock.json');
  const packageLockMaterialPath = join(dir, 'package-lock-material.json');
  const buildIdentityPath = join(dir, 'build-identity.json');
  const provenancePath = join(dir, 'installer-provenance.json');

  writeFileSync(installerPath, randomBytes(4096));
  writeFileSync(blockmapPath, randomBytes(96));
  writeFileSync(configPath, '{"appId":"me2.test","buildIdentity":true}');

  const packageJson = {
    name: '@metaengine/browser-shell',
    version: PACKAGE_VERSION,
    dependencies: {
      'electron-updater': '6.8.9',
      'socket.io-client': '4.8.1',
    },
    devDependencies: {
      electron: '44.0.0',
    },
  };
  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: packageJson.dependencies,
        devDependencies: packageJson.devDependencies,
      },
      'node_modules/electron-updater': {
        version: '6.8.9',
        resolved: 'https://registry.npmjs.org/electron-updater/-/electron-updater-6.8.9.tgz',
        integrity: 'sha512-test-updater',
      },
      'node_modules/socket.io-client': {
        version: '4.8.1',
        resolved: 'https://registry.npmjs.org/socket.io-client/-/socket.io-client-4.8.1.tgz',
        integrity: 'sha512-test-socket',
      },
      'node_modules/electron': {
        version: '44.0.0',
        resolved: 'https://registry.npmjs.org/electron/-/electron-44.0.0.tgz',
        integrity: 'sha512-test-electron',
        dev: true,
      },
    },
  };
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');

  const material = createPackageLockMaterial({
    packageJsonPath,
    packageLockPath,
    nodeVersion: process.version,
    npmVersion: '11.19.0',
  });
  writeFileSync(packageLockMaterialPath, JSON.stringify(material, null, 2) + '\n');

  const dependencyPayload = {
    schema: 'metaengine.browser.dependency-resolution.v1',
    root_name: packageJson.name,
    root_version: PACKAGE_VERSION,
    node_version: process.version,
    npm_version: '11.19.0',
    dependency_count: 2,
    tree: {
      name: packageJson.name,
      version: PACKAGE_VERSION,
      dependencies: {
        'electron-updater': { name: 'electron-updater', version: '6.8.9', dependencies: {} },
        'socket.io-client': { name: 'socket.io-client', version: '4.8.1', dependencies: {} },
      },
    },
  };
  const dependency = {
    ...dependencyPayload,
    dependency_resolution_sha256: sha256String(canonicalJson(dependencyPayload)),
    authority_effect: false,
  };
  writeFileSync(dependencyPath, JSON.stringify(dependency, null, 2) + '\n');

  const identity = createBuildIdentityV3({
    repository: 'PatrickFrome/Compute',
    repository_id: '1341371143',
    source_head: HEAD,
    workflow: 'browser-windows-package-smoke.yml',
    run_id: '434343',
    run_attempt: 1,
    package_version: PACKAGE_VERSION,
    platform: 'win32',
    arch: 'x64',
    builder_config_sha256: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
    dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    package_lock_sha256: material.package_lock_sha256,
    npm_version: material.npm_version,
    electron_builder_version: '26.15.7',
    node_version: process.version,
  });
  writeFileSync(buildIdentityPath, JSON.stringify(identity, null, 2) + '\n');

  return {
    installerPath,
    blockmapPath,
    configPath,
    dependencyPath,
    packageJsonPath,
    packageLockPath,
    packageLockMaterialPath,
    buildIdentityPath,
    provenancePath,
    dependency,
    material,
    identity,
  };
}

function writeOptions(f) {
  return {
    installer: f.installerPath,
    out: f.provenancePath,
    'source-head': HEAD,
    workflow: 'browser-windows-package-smoke.yml',
    'run-id': '434343',
    'run-number': '3144',
    'run-attempt': '1',
    'package-version': PACKAGE_VERSION,
    config: f.configPath,
    blockmap: f.blockmapPath,
    'build-identity': f.buildIdentityPath,
    'dependency-resolution': f.dependencyPath,
    'package-lock-material': f.packageLockMaterialPath,
    'package-json': f.packageJsonPath,
    'package-lock': f.packageLockPath,
  };
}

test('installer provenance v3 binds installer, installed tree, lockfile bytes, and npm toolchain', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    const written = await writeProvenance(writeOptions(f));
    assert.equal(written.schema, 'metaengine.browser.installer-provenance.v3');
    assert.equal(written.build_identity_sha256, f.identity.build_identity_sha256);
    assert.equal(written.dependency_resolution_sha256, f.dependency.dependency_resolution_sha256);
    assert.equal(written.package_lock_sha256, f.material.package_lock_sha256);
    assert.equal(written.npm_version, '11.19.0');

    const acquired = await verifyInstaller({
      dir,
      'expect-head': HEAD,
      'expect-run-id': '434343',
      'expect-run-number': '3144',
      'expect-run-attempt': '1',
      'expect-workflow': 'browser-windows-package-smoke.yml',
      config: f.configPath,
    });
    assert.equal(acquired.provenance_schema, 'metaengine.browser.installer-provenance.v3');
    assert.equal(acquired.build_identity_sha256, f.identity.build_identity_sha256);
    assert.equal(acquired.dependency_resolution_sha256, f.dependency.dependency_resolution_sha256);
    assert.equal(acquired.package_lock_sha256, f.material.package_lock_sha256);
    assert.equal(acquired.npm_version, '11.19.0');
    assert.equal(acquired.build_identity_verified, true);
    assert.equal(acquired.dependency_resolution_verified, true);
    assert.equal(acquired.package_lock_verified, true);
    assert.equal(acquired.blockmap_verified, true);
    assert.equal(acquired.config_verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer provenance v3 rejects package-lock byte tampering even when JSON remains valid', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    await writeProvenance(writeOptions(f));
    const parsed = JSON.parse(readFileSync(f.packageLockPath, 'utf8'));
    writeFileSync(f.packageLockPath, JSON.stringify(parsed) + '\n');

    await assert.rejects(
      () => verifyInstaller({ dir, 'expect-head': HEAD, config: f.configPath }),
      (error) => error?.code === 'package_lock_material_invalid',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer provenance v3 rejects npm toolchain drift inside the lock material proof', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    await writeProvenance(writeOptions(f));
    const material = JSON.parse(readFileSync(f.packageLockMaterialPath, 'utf8'));
    material.npm_version = '11.20.0';
    writeFileSync(f.packageLockMaterialPath, JSON.stringify(material, null, 2) + '\n');

    await assert.rejects(
      () => verifyInstaller({ dir, 'expect-head': HEAD, config: f.configPath }),
      (error) => ['package_lock_material_invalid', 'package_lock_material_binding_mismatch'].includes(error?.code),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
