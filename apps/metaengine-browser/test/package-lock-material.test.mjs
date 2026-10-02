import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPackageLockMaterial,
  npmVersionInvocation,
} from '../scripts/package-lock-material.mjs';

function withFixture({ packageJson, packageLock }, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-lock-material-'));
  try {
    const packageJsonPath = path.join(root, 'package.json');
    const packageLockPath = path.join(root, 'package-lock.json');
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n', 'utf8');
    return fn({ root, packageJsonPath, packageLockPath });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function basePackage() {
  return {
    name: '@metaengine/browser-shell',
    version: '0.7.0-dev.36980000001.1',
    dependencies: {
      'electron-updater': '6.8.9',
      'socket.io-client': '4.8.1',
    },
    devDependencies: {
      electron: '44.0.0',
    },
  };
}

function baseLock() {
  return {
    name: '@metaengine/browser-shell',
    version: '0.7.0-dev.36980000001.1',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: '@metaengine/browser-shell',
        version: '0.7.0-dev.36980000001.1',
        dependencies: {
          'electron-updater': '6.8.9',
          'socket.io-client': '4.8.1',
        },
        devDependencies: {
          electron: '44.0.0',
        },
      },
      'node_modules/electron': {
        version: '44.0.0',
        resolved: 'https://registry.npmjs.org/electron/-/electron-44.0.0.tgz',
        integrity: 'sha512-test-electron',
        dev: true,
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
      'node_modules/optional-win-only': {
        version: '1.0.0',
        optional: true,
        os: ['win32'],
      },
    },
  };
}

test('valid lockfile becomes zero-authority frozen dependency material', () => {
  withFixture({ packageJson: basePackage(), packageLock: baseLock() }, ({ packageJsonPath, packageLockPath }) => {
    const proof = createPackageLockMaterial({
      packageJsonPath,
      packageLockPath,
      nodeVersion: 'v24.21.0',
      npmVersion: '11.19.0',
    });
    assert.equal(proof.schema, 'metaengine.browser.package-lock-material.v1');
    assert.equal(proof.package_name, '@metaengine/browser-shell');
    assert.equal(proof.package_version, '0.7.0-dev.36980000001.1');
    assert.equal(proof.lockfile_version, 3);
    assert.match(proof.package_lock_sha256, /^[a-f0-9]{64}$/);
    assert.ok(proof.package_lock_bytes > 0);
    assert.equal(proof.dependency_count, 2);
    assert.equal(proof.dev_dependency_count, 1);
    assert.equal(proof.optional_dependency_count, 0);
    assert.equal(proof.peer_dependency_count, 0);
    assert.equal(proof.package_entry_count, 4);
    assert.equal(proof.integrity_entry_count, 3);
    assert.equal(proof.resolved_entry_count, 3);
    assert.equal(proof.optional_entry_count, 1);
    assert.equal(proof.platform_restricted_entry_count, 1);
    assert.equal(proof.node_version, 'v24.21.0');
    assert.equal(proof.npm_version, '11.19.0');
    assert.equal(proof.authority_effect, false);
  });
});

test('lockfile digest binds exact bytes rather than parsed semantic content', () => {
  const packageJson = basePackage();
  const packageLock = baseLock();
  let first;
  withFixture({ packageJson, packageLock }, ({ packageJsonPath, packageLockPath }) => {
    first = createPackageLockMaterial({ packageJsonPath, packageLockPath });
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-lock-byte-drift-'));
  try {
    const packageJsonPath = path.join(root, 'package.json');
    const packageLockPath = path.join(root, 'package-lock.json');
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
    fs.writeFileSync(packageLockPath, JSON.stringify(packageLock) + '\n', 'utf8');
    const second = createPackageLockMaterial({ packageJsonPath, packageLockPath });
    assert.notEqual(second.package_lock_sha256, first.package_lock_sha256);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('package identity mismatch fails closed', () => {
  const lock = baseLock();
  lock.packages[''].version = '0.7.0-dev.1.1';
  withFixture({ packageJson: basePackage(), packageLock: lock }, ({ packageJsonPath, packageLockPath }) => {
    assert.throws(
      () => createPackageLockMaterial({ packageJsonPath, packageLockPath }),
      /package_lock_root_version_mismatch/,
    );
  });
});

test('direct dependency spec drift fails closed before install', () => {
  const lock = baseLock();
  lock.packages[''].dependencies['socket.io-client'] = '4.8.0';
  withFixture({ packageJson: basePackage(), packageLock: lock }, ({ packageJsonPath, packageLockPath }) => {
    assert.throws(
      () => createPackageLockMaterial({ packageJsonPath, packageLockPath }),
      /package_lock_dependencies_mismatch/,
    );
  });
});

test('dev dependency spec drift fails closed before install', () => {
  const lock = baseLock();
  lock.packages[''].devDependencies.electron = '43.0.0';
  withFixture({ packageJson: basePackage(), packageLock: lock }, ({ packageJsonPath, packageLockPath }) => {
    assert.throws(
      () => createPackageLockMaterial({ packageJsonPath, packageLockPath }),
      /package_lock_devDependencies_mismatch/,
    );
  });
});

test('lockfile v1 or unsupported future schema is refused', () => {
  for (const lockfileVersion of [1, 4]) {
    const lock = baseLock();
    lock.lockfileVersion = lockfileVersion;
    withFixture({ packageJson: basePackage(), packageLock: lock }, ({ packageJsonPath, packageLockPath }) => {
      assert.throws(
        () => createPackageLockMaterial({ packageJsonPath, packageLockPath }),
        /package_lock_lockfile_version_invalid/,
      );
    });
  }
});

test('platform and optional entries are observed but not required as installed material', () => {
  withFixture({ packageJson: basePackage(), packageLock: baseLock() }, ({ packageJsonPath, packageLockPath }) => {
    const proof = createPackageLockMaterial({ packageJsonPath, packageLockPath });
    assert.equal(proof.optional_entry_count, 1);
    assert.equal(proof.platform_restricted_entry_count, 1);
    assert.equal(proof.authority_effect, false);
  });
});

test('missing lockfile and invalid lockfile root fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-lock-missing-'));
  try {
    const packageJsonPath = path.join(root, 'package.json');
    fs.writeFileSync(packageJsonPath, JSON.stringify(basePackage()), 'utf8');
    assert.throws(
      () => createPackageLockMaterial({
        packageJsonPath,
        packageLockPath: path.join(root, 'package-lock.json'),
      }),
      /package_lock_missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const lock = baseLock();
  delete lock.packages[''];
  withFixture({ packageJson: basePackage(), packageLock: lock }, ({ packageJsonPath, packageLockPath }) => {
    assert.throws(
      () => createPackageLockMaterial({ packageJsonPath, packageLockPath }),
      /package_lock_root_entry_missing/,
    );
  });
});


test('top-level lock identity drift fails closed', () => {
  const lock = baseLock();
  lock.version = '0.7.0-dev.1.1';
  withFixture({ packageJson: basePackage(), packageLock: lock }, ({ packageJsonPath, packageLockPath }) => {
    assert.throws(
      () => createPackageLockMaterial({ packageJsonPath, packageLockPath }),
      /package_lock_top_level_version_mismatch/,
    );
  });
});

test('npm version probe uses cmd.exe on Windows and direct npm elsewhere', () => {
  const win = npmVersionInvocation({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
  });
  assert.equal(win.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(win.args, ['/d', '/s', '/c', 'npm.cmd', '--version']);

  const linux = npmVersionInvocation({ platform: 'linux', env: {} });
  assert.equal(linux.command, 'npm');
  assert.deepEqual(linux.args, ['--version']);
});


test('package-lock checkout bytes are normalized to LF across Windows and Linux', () => {
  const attributes = fs.readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
  assert.match(attributes, /^package-lock\.json text eol=lf$/m);
});
