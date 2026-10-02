import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { verifyInstaller, writeProvenance } from '../scripts/installer-provenance.mjs';

const require = createRequire(import.meta.url);
const {
  canonicalJson,
  createBuildIdentity,
  sha256String,
} = require('../scripts/build-identity.cjs');

const HEAD = 'a'.repeat(40);
const PACKAGE_VERSION = '0.8.3';
const INSTALLER_NAME = `METAENGINE-Browser-Test-Setup-${PACKAGE_VERSION}-x64.exe`;

function workspace() {
  return mkdtempSync(join(tmpdir(), 'me2-prov-v2-'));
}

function createFixture(dir) {
  const installerPath = join(dir, INSTALLER_NAME);
  const blockmapPath = `${installerPath}.blockmap`;
  const configPath = join(dir, 'electron-builder.test.json');
  const dependencyPath = join(dir, 'dependency-resolution.json');
  const buildIdentityPath = join(dir, 'build-identity.json');
  const provenancePath = join(dir, 'installer-provenance.json');
  writeFileSync(installerPath, randomBytes(4096));
  writeFileSync(blockmapPath, randomBytes(96));
  writeFileSync(configPath, '{"appId":"me2.test","buildIdentity":true}');

  const dependencyPayload = {
    schema: 'metaengine.browser.dependency-resolution.v1',
    root_name: '@metaengine/browser-shell',
    root_version: PACKAGE_VERSION,
    node_version: process.version,
    npm_version: '11.19.0',
    dependency_count: 2,
    tree: {
      name: '@metaengine/browser-shell',
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
  writeFileSync(dependencyPath, JSON.stringify(dependency, null, 2));

  const identity = createBuildIdentity({
    repository: 'PatrickFrome/Compute',
    repository_id: '1341371143',
    source_head: HEAD,
    workflow: 'browser-windows-package-smoke.yml',
    run_id: '424242',
    run_attempt: 2,
    package_version: PACKAGE_VERSION,
    platform: 'win32',
    arch: 'x64',
    builder_config_sha256: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
    dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    electron_builder_version: '26.15.7',
    node_version: process.version,
  });
  writeFileSync(buildIdentityPath, JSON.stringify(identity, null, 2));
  return { installerPath, blockmapPath, configPath, dependencyPath, buildIdentityPath, provenancePath, dependency, identity };
}

test('installer provenance v2 binds build identity and dependency resolution end to end', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    const written = await writeProvenance({
      installer: f.installerPath,
      out: f.provenancePath,
      'source-head': HEAD,
      workflow: 'browser-windows-package-smoke.yml',
      'run-id': '424242',
      'run-number': '3128',
      'run-attempt': '2',
      'package-version': PACKAGE_VERSION,
      config: f.configPath,
      blockmap: f.blockmapPath,
      'build-identity': f.buildIdentityPath,
      'dependency-resolution': f.dependencyPath,
    });
    assert.equal(written.schema, 'metaengine.browser.installer-provenance.v2');
    assert.equal(written.build_identity_sha256, f.identity.build_identity_sha256);
    assert.equal(written.dependency_resolution_sha256, f.dependency.dependency_resolution_sha256);

    const acquired = await verifyInstaller({
      dir,
      'expect-head': HEAD,
      'expect-run-id': '424242',
      'expect-run-number': '3128',
      'expect-run-attempt': '2',
      'expect-workflow': 'browser-windows-package-smoke.yml',
      config: f.configPath,
    });
    assert.equal(acquired.provenance_schema, 'metaengine.browser.installer-provenance.v2');
    assert.equal(acquired.build_identity_sha256, f.identity.build_identity_sha256);
    assert.equal(acquired.dependency_resolution_sha256, f.dependency.dependency_resolution_sha256);
    assert.equal(acquired.build_identity_verified, true);
    assert.equal(acquired.dependency_resolution_verified, true);
    assert.equal(acquired.blockmap_verified, true);
    assert.equal(acquired.config_verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('installer provenance v2 rejects zero run attempt instead of defaulting it', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    await writeProvenance({
      installer: f.installerPath, out: f.provenancePath, 'source-head': HEAD,
      workflow: 'browser-windows-package-smoke.yml', 'run-id': '424242', 'run-number': '3128',
      'run-attempt': '2', 'package-version': PACKAGE_VERSION, config: f.configPath, blockmap: f.blockmapPath,
      'build-identity': f.buildIdentityPath, 'dependency-resolution': f.dependencyPath,
    });
    const provenance = JSON.parse(readFileSync(f.provenancePath, 'utf8'));
    provenance.run_attempt = 0;
    writeFileSync(f.provenancePath, JSON.stringify(provenance, null, 2));
    await assert.rejects(
      () => verifyInstaller({ dir, 'expect-head': HEAD, config: f.configPath }),
      (error) => error?.code === 'provenance_build_identity_invalid',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer provenance v2 rejects external build-identity tamper', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    await writeProvenance({
      installer: f.installerPath, out: f.provenancePath, 'source-head': HEAD,
      workflow: 'browser-windows-package-smoke.yml', 'run-id': '424242', 'run-number': '3128',
      'run-attempt': '2', 'package-version': PACKAGE_VERSION, config: f.configPath, blockmap: f.blockmapPath,
      'build-identity': f.buildIdentityPath, 'dependency-resolution': f.dependencyPath,
    });
    writeFileSync(f.buildIdentityPath, JSON.stringify({ ...f.identity, build_identity_sha256: '0'.repeat(64) }));
    await assert.rejects(
      () => verifyInstaller({ dir, 'expect-head': HEAD, config: f.configPath }),
      (error) => error?.code === 'build_identity_external_invalid',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installer provenance v2 rejects dependency-resolution tamper', async () => {
  const dir = workspace();
  try {
    const f = createFixture(dir);
    await writeProvenance({
      installer: f.installerPath, out: f.provenancePath, 'source-head': HEAD,
      workflow: 'browser-windows-package-smoke.yml', 'run-id': '424242', 'run-number': '3128',
      'run-attempt': '2', 'package-version': PACKAGE_VERSION, config: f.configPath, blockmap: f.blockmapPath,
      'build-identity': f.buildIdentityPath, 'dependency-resolution': f.dependencyPath,
    });
    writeFileSync(f.dependencyPath, JSON.stringify({ ...f.dependency, dependency_resolution_sha256: '1'.repeat(64) }));
    await assert.rejects(
      () => verifyInstaller({ dir, 'expect-head': HEAD, config: f.configPath }),
      (error) => error?.code === 'build_identity_external_invalid',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
