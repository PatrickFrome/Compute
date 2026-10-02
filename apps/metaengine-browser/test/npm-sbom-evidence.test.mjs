import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createNpmSbomEvidence } from '../scripts/npm-sbom-evidence.mjs';

const VERSION = '0.7.0-dev.36991000001.1';
const NAME = '@metaengine/browser-shell';
const LOCK_SHA = 'a'.repeat(64);
const DEP_SHA = 'b'.repeat(64);
const SOURCE = 'c'.repeat(40);

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-sbom-evidence-'));
}

function component({
  ref,
  name,
  version,
  type = 'library',
  purl = null,
  scope = 'required',
} = {}) {
  const out = {
    'bom-ref': ref,
    type,
    name,
    version,
    scope,
  };
  if (purl) out.purl = purl;
  return out;
}

function sbom({
  serial = 'urn:uuid:11111111-1111-4111-8111-111111111111',
  timestamp = '2026-10-02T00:00:00.000Z',
  depVersion = '26.15.7',
} = {}) {
  return {
    '$schema': 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serial,
    version: 1,
    metadata: {
      timestamp,
      component: component({
        ref: `pkg:npm/%40metaengine/browser-shell@${VERSION}`,
        name: NAME,
        version: VERSION,
        type: 'application',
        purl: `pkg:npm/%40metaengine/browser-shell@${VERSION}`,
      }),
    },
    components: [
      component({
        ref: `pkg:npm/electron-builder@${depVersion}`,
        name: 'electron-builder',
        version: depVersion,
        purl: `pkg:npm/electron-builder@${depVersion}`,
        scope: 'excluded',
      }),
      component({
        ref: 'pkg:npm/electron-updater@6.8.9',
        name: 'electron-updater',
        version: '6.8.9',
        purl: 'pkg:npm/electron-updater@6.8.9',
      }),
    ],
    dependencies: [
      {
        ref: `pkg:npm/%40metaengine/browser-shell@${VERSION}`,
        dependsOn: [
          'pkg:npm/electron-updater@6.8.9',
          `pkg:npm/electron-builder@${depVersion}`,
        ],
      },
      { ref: 'pkg:npm/electron-updater@6.8.9', dependsOn: [] },
      { ref: `pkg:npm/electron-builder@${depVersion}`, dependsOn: [] },
    ],
  };
}

function fixture({
  sbomValue = sbom(),
  packageVersion = VERSION,
  lockVersion = VERSION,
  dependencyVersion = VERSION,
  lockNpm = '11.19.0',
  dependencyNpm = '11.19.0',
} = {}) {
  const root = temp();
  const files = {
    root,
    sbom: path.join(root, 'browser.cdx.json'),
    packageJson: path.join(root, 'package.json'),
    lockMaterial: path.join(root, 'package-lock-material.json'),
    dependency: path.join(root, 'dependency-resolution.json'),
  };
  fs.writeFileSync(files.sbom, JSON.stringify(sbomValue, null, 2) + '\n');
  fs.writeFileSync(files.packageJson, JSON.stringify({ name: NAME, version: packageVersion }, null, 2) + '\n');
  fs.writeFileSync(files.lockMaterial, JSON.stringify({
    schema: 'metaengine.browser.package-lock-material.v1',
    package_name: NAME,
    package_version: lockVersion,
    package_lock_sha256: LOCK_SHA,
    npm_version: lockNpm,
    authority_effect: false,
  }, null, 2) + '\n');
  fs.writeFileSync(files.dependency, JSON.stringify({
    schema: 'metaengine.browser.dependency-resolution.v1',
    root_name: NAME,
    root_version: dependencyVersion,
    node_version: 'v24.21.0',
    npm_version: dependencyNpm,
    dependency_count: 2,
    dependency_resolution_sha256: DEP_SHA,
    authority_effect: false,
  }, null, 2) + '\n');
  return files;
}

function evidence(files, sourceHead = SOURCE) {
  return createNpmSbomEvidence({
    sbomPath: files.sbom,
    packageJsonPath: files.packageJson,
    packageLockMaterialPath: files.lockMaterial,
    dependencyResolutionPath: files.dependency,
    sourceHead,
  });
}

test('CycloneDX npm SBOM becomes zero-authority evidence bound to lock and installed tree', () => {
  const files = fixture();
  try {
    const proof = evidence(files);
    assert.equal(proof.schema, 'metaengine.browser.npm-sbom-evidence.v1');
    assert.equal(proof.source_head, SOURCE);
    assert.equal(proof.package_name, NAME);
    assert.equal(proof.package_version, VERSION);
    assert.equal(proof.bom_format, 'CycloneDX');
    assert.equal(proof.spec_version, '1.5');
    assert.match(proof.raw_sbom_sha256, /^[a-f0-9]{64}$/);
    assert.match(proof.semantic_inventory_sha256, /^[a-f0-9]{64}$/);
    assert.equal(proof.component_count, 2);
    assert.equal(proof.dependency_node_count, 3);
    assert.equal(proof.dependency_relation_count, 2);
    assert.equal(proof.package_lock_sha256, LOCK_SHA);
    assert.equal(proof.dependency_resolution_sha256, DEP_SHA);
    assert.equal(proof.npm_version, '11.19.0');
    assert.equal(proof.serial_number_present, true);
    assert.equal(proof.metadata_timestamp_present, true);
    assert.equal(proof.authority_effect, false);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('volatile SBOM timestamp and serial change raw bytes but not semantic inventory digest', () => {
  const first = fixture({
    sbomValue: sbom({
      serial: 'urn:uuid:11111111-1111-4111-8111-111111111111',
      timestamp: '2026-10-02T00:00:00.000Z',
    }),
  });
  const second = fixture({
    sbomValue: sbom({
      serial: 'urn:uuid:22222222-2222-4222-8222-222222222222',
      timestamp: '2026-10-02T00:01:00.000Z',
    }),
  });
  try {
    const a = evidence(first);
    const b = evidence(second);
    assert.notEqual(a.raw_sbom_sha256, b.raw_sbom_sha256);
    assert.equal(a.semantic_inventory_sha256, b.semantic_inventory_sha256);
  } finally {
    fs.rmSync(first.root, { recursive: true, force: true });
    fs.rmSync(second.root, { recursive: true, force: true });
  }
});

test('component identity drift changes semantic inventory digest', () => {
  const first = fixture({ sbomValue: sbom({ depVersion: '26.15.7' }) });
  const second = fixture({ sbomValue: sbom({ depVersion: '26.15.8' }) });
  try {
    assert.notEqual(evidence(first).semantic_inventory_sha256, evidence(second).semantic_inventory_sha256);
  } finally {
    fs.rmSync(first.root, { recursive: true, force: true });
    fs.rmSync(second.root, { recursive: true, force: true });
  }
});

test('root package version mismatch fails closed', () => {
  const files = fixture({ packageVersion: '0.7.0-dev.1.1' });
  try {
    assert.throws(() => evidence(files), /npm_sbom_root_version_binding_mismatch|npm_sbom_metadata_root_version_mismatch/);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('lock and installed dependency material must bind to the same package version', () => {
  const lockDrift = fixture({ lockVersion: '0.7.0-dev.1.1' });
  const depDrift = fixture({ dependencyVersion: '0.7.0-dev.2.1' });
  try {
    assert.throws(() => evidence(lockDrift), /npm_sbom_root_version_binding_mismatch/);
    assert.throws(() => evidence(depDrift), /npm_sbom_root_version_binding_mismatch/);
  } finally {
    fs.rmSync(lockDrift.root, { recursive: true, force: true });
    fs.rmSync(depDrift.root, { recursive: true, force: true });
  }
});

test('npm toolchain disagreement between lock and installed tree fails closed', () => {
  const files = fixture({ dependencyNpm: '11.20.0' });
  try {
    assert.throws(() => evidence(files), /npm_sbom_npm_version_binding_mismatch/);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('non-CycloneDX or non-application root is refused', () => {
  const invalidFormat = sbom();
  invalidFormat.bomFormat = 'SPDX';
  const invalidRoot = sbom();
  invalidRoot.metadata.component.type = 'library';
  const a = fixture({ sbomValue: invalidFormat });
  const b = fixture({ sbomValue: invalidRoot });
  try {
    assert.throws(() => evidence(a), /npm_sbom_format_invalid/);
    assert.throws(() => evidence(b), /npm_sbom_metadata_root_type_invalid/);
  } finally {
    fs.rmSync(a.root, { recursive: true, force: true });
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test('source head must be exact SHA when supplied', () => {
  const files = fixture();
  try {
    assert.throws(() => evidence(files, 'abc'), /npm_sbom_source_head_invalid/);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('raw SBOM digest is exact bytes', () => {
  const files = fixture();
  try {
    const proof = evidence(files);
    const expected = crypto.createHash('sha256').update(fs.readFileSync(files.sbom)).digest('hex');
    assert.equal(proof.raw_sbom_sha256, expected);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});


test('npm scoped root group/name encoding binds to scoped package identity', () => {
  const value = sbom();
  value.metadata.component.group = '@metaengine';
  value.metadata.component.name = 'browser-shell';
  const files = fixture({ sbomValue: value });
  try {
    const proof = evidence(files);
    assert.equal(proof.package_name, NAME);
    assert.equal(proof.component_count, 2);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});
