import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { npmInvocation } from '../scripts/dependency-resolution-digest.mjs';

const require = createRequire(import.meta.url);
const {
  BUILD_IDENTITY_SCHEMA,
  DEPENDENCY_RESOLUTION_SCHEMA,
  canonicalJson,
  createBuildIdentity,
  sha256String,
  validateBuildIdentity,
  validateDependencyResolutionProof,
} = require('../scripts/build-identity.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function dependencyProof() {
  const payload = {
    schema: DEPENDENCY_RESOLUTION_SCHEMA,
    root_name: '@metaengine/browser-shell',
    root_version: '0.7.0-dev.1.1',
    node_version: 'v24.21.0',
    npm_version: '11.19.0',
    dependency_count: 2,
    tree: {
      name: '@metaengine/browser-shell',
      version: '0.7.0-dev.1.1',
      dependencies: {
        'electron-updater': {
          name: 'electron-updater',
          version: '6.8.9',
          dependencies: {},
        },
        'socket.io-client': {
          name: 'socket.io-client',
          version: '4.8.1',
          dependencies: {},
        },
      },
    },
  };
  return {
    ...payload,
    dependency_resolution_sha256: sha256String(canonicalJson(payload)),
    authority_effect: false,
  };
}

function identity(overrides = {}) {
  return createBuildIdentity({
    repository: 'PatrickFrome/Compute',
    repository_id: '1341371143',
    source_head: 'a'.repeat(40),
    workflow: 'browser-windows-package-smoke.yml',
    run_id: '36970000001',
    run_attempt: 1,
    package_version: '0.7.0-dev.36970000001.1',
    platform: 'win32',
    arch: 'x64',
    builder_config_sha256: 'b'.repeat(64),
    dependency_resolution_sha256: dependencyProof().dependency_resolution_sha256,
    electron_builder_version: '26.15.7',
    node_version: 'v24.21.0',
    ...overrides,
  });
}

test('dependency resolver invokes npm through cmd.exe on Windows and directly elsewhere', () => {
  const windows = npmInvocation(['ls', '--all', '--json'], {
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  });
  assert.equal(windows.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(windows.args, ['/d', '/s', '/c', 'npm.cmd', 'ls', '--all', '--json']);

  const linux = npmInvocation(['--version'], { platform: 'linux', env: {} });
  assert.equal(linux.command, 'npm');
  assert.deepEqual(linux.args, ['--version']);
});

test('build identity v2 is deterministic and invocation-bound', () => {
  const a = identity();
  const b = identity();
  assert.equal(a.schema, BUILD_IDENTITY_SCHEMA);
  assert.equal(a.build_identity_sha256, b.build_identity_sha256);
  assert.match(a.build_identity_sha256, /^[a-f0-9]{64}$/);
  assert.equal(a.authority_effect, false);

  assert.notEqual(identity({ source_head: 'c'.repeat(40) }).build_identity_sha256, a.build_identity_sha256);
  assert.notEqual(identity({ run_id: '36970000002' }).build_identity_sha256, a.build_identity_sha256);
  assert.notEqual(identity({ run_attempt: 2 }).build_identity_sha256, a.build_identity_sha256);
  assert.notEqual(identity({ builder_config_sha256: 'd'.repeat(64) }).build_identity_sha256, a.build_identity_sha256);
  assert.notEqual(identity({ dependency_resolution_sha256: 'e'.repeat(64) }).build_identity_sha256, a.build_identity_sha256);
});

test('build identity validation fails closed on digest or exact binding drift', () => {
  const exact = identity();
  assert.equal(validateBuildIdentity(exact, {
    repository: 'PatrickFrome/Compute',
    repository_id: '1341371143',
    source_head: 'a'.repeat(40),
    run_id: '36970000001',
    run_attempt: 1,
  }).build_identity_sha256, exact.build_identity_sha256);

  assert.throws(
    () => validateBuildIdentity({ ...exact, build_identity_sha256: '0'.repeat(64) }),
    /build_identity_digest_invalid/,
  );
  assert.throws(
    () => validateBuildIdentity(exact, { source_head: 'f'.repeat(40) }),
    /build_identity_source_head_mismatch/,
  );
  assert.throws(
    () => createBuildIdentity({ ...exact, run_id: 'not-a-run-id' }),
    /build_identity_run_id_invalid/,
  );
});

test('dependency resolution proof is canonical and tamper-evident', () => {
  const proof = dependencyProof();
  const exact = validateDependencyResolutionProof(proof);
  assert.equal(exact.dependency_resolution_sha256, proof.dependency_resolution_sha256);
  assert.equal(exact.dependency_count, 2);
  assert.throws(
    () => validateDependencyResolutionProof({
      ...proof,
      tree: {
        ...proof.tree,
        dependencies: {
          ...proof.tree.dependencies,
          'electron-updater': {
            ...proof.tree.dependencies['electron-updater'],
            version: '6.9.0',
          },
        },
      },
    }),
    /dependency_resolution_digest_invalid/,
  );
});

test('dependency resolution rejects internally contradictory metadata even with a recomputed digest', () => {
  const proof = dependencyProof();
  const countPayload = {
    schema: proof.schema,
    root_name: proof.root_name,
    root_version: proof.root_version,
    node_version: proof.node_version,
    npm_version: proof.npm_version,
    dependency_count: 3,
    tree: proof.tree,
  };
  assert.throws(
    () => validateDependencyResolutionProof({
      ...countPayload,
      dependency_resolution_sha256: sha256String(canonicalJson(countPayload)),
      authority_effect: false,
    }),
    /dependency_resolution_count_mismatch/,
  );

  const rootPayload = {
    ...countPayload,
    dependency_count: 2,
    root_version: '9.9.9',
  };
  assert.throws(
    () => validateDependencyResolutionProof({
      ...rootPayload,
      dependency_resolution_sha256: sha256String(canonicalJson(rootPayload)),
      authority_effect: false,
    }),
    /dependency_resolution_root_tree_mismatch/,
  );
});

test('packaging hooks and Package Smoke bind the same build identity evidence', () => {
  const before = read('scripts/electron-builder-before-pack.cjs');
  const after = read('scripts/electron-builder-after-all-artifact-build.cjs');
  const provenance = read('scripts/installer-provenance.mjs');
  const consumer = read('scripts/qualified-installer-consumer.ps1');
  const workflow = read('../../.github/workflows/browser-windows-package-smoke.yml');

  assert.match(before, /createBuildIdentity/);
  assert.match(before, /metaengineBuildIdentity/);
  assert.match(before, /ME2_DEPENDENCY_RESOLUTION_PATH/);
  assert.match(before, /build-identity\.json/);

  assert.match(after, /validateBuildIdentity/);
  assert.match(after, /packaged-build-identity-proof\.json/);
  assert.match(after, /metaengineBuildIdentity/);

  assert.match(provenance, /installer-provenance\.v2/);
  assert.match(provenance, /build_identity_verified/);
  assert.match(provenance, /dependency_resolution_verified/);

  assert.match(consumer, /installer-provenance\.v2/);
  assert.match(consumer, /build_identity_verified/);
  assert.match(consumer, /dependency_resolution_verified/);

  assert.match(workflow, /dependency-resolution-digest\.mjs/);
  assert.match(workflow, /Compute expected Build Identity V2 before packaging/);
  assert.match(workflow, /build-identity-cli\.mjs/);
  assert.match(workflow, /expected-build-identity\.json/);
  assert.match(workflow, /build_identity_independent_readback_mismatch/);
  assert.match(workflow, /ME2_BUILD_WORKFLOW: browser-windows-package-smoke\.yml/);
  assert.match(workflow, /--build-identity \$buildIdentityPath/);
  assert.match(workflow, /build-identity\.json/);
  assert.match(workflow, /dependency-resolution\.json/);

  assert.match(consumer, /build_identity_sha256/);
  assert.match(consumer, /dependency_resolution_sha256/);
  assert.match(consumer, /producer_terminal_success/);
});
