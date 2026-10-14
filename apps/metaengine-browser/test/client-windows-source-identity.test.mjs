import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assertWindowsSourceIdentity, assertUnsignedCandidateProvenance } = require('../scripts/client-windows-source-identity.cjs');
const { canonicalJson, sha256String, createBuildIdentityV3 } = require('../scripts/build-identity.cjs');
const VERSION = '0.7.0-dev.123456789.1';
const SHA = 'a'.repeat(40);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'metaengine-w24-'));
  const installerPath = join(dir, `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`);
  const bytes = Buffer.from('MZ-METAENGINE-fixed-source-test-fixture');
  writeFileSync(installerPath, bytes);
  const manifest = {
    name: '@metaengine/browser-shell',
    version: VERSION,
    dependencies: { 'electron-updater': '6.8.9', 'socket.io-client': '4.8.1' },
    devDependencies: { electron: '44.0.0' },
  };
  const payload = {
    schema: 'metaengine.browser.dependency-resolution.v1',
    root_name: manifest.name,
    root_version: VERSION,
    node_version: process.version,
    npm_version: '11.9.0',
    dependency_count: 2,
    tree: {
      name: manifest.name, version: VERSION,
      dependencies: {
        'electron-updater': { name: 'electron-updater', version: '6.8.9', dependencies: {} },
        'socket.io-client': { name: 'socket.io-client', version: '4.8.1', dependencies: {} },
      },
    },
  };
  const dependency = {
    ...payload,
    dependency_resolution_sha256: sha256String(canonicalJson(payload)),
    authority_effect: false,
  };
  const identity = createBuildIdentityV3({
    repository: 'PatrickFrome/Compute', repository_id: '1341371143',
    source_head: SHA, workflow: 'browser-windows-package-smoke.yml',
    run_id: '123456', run_attempt: 1, package_version: VERSION,
    platform: 'win32', arch: 'x64',
    builder_config_sha256: 'b'.repeat(64),
    dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    package_lock_sha256: 'c'.repeat(64),
    npm_version: '11.9.0', bun_version: '1.3.3',
    me2_ui_bun_lock_sha256: 'd'.repeat(64),
    electron_builder_version: '26.15.7', node_version: process.version,
  });
  const input = {
    manifest, dependency, identity, installerPath,
    expectedInstallerSha256: digest(bytes), expectedInstallerBytes: bytes.length,
  };
  return { dir, input };
}

function withFixture(mutator, expectedError) {
  const { dir, input } = fixture();
  try {
    mutator(input, dir);
    assert.throws(() => assertWindowsSourceIdentity(input), expectedError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('W24 source proof binds one EXE, source SHA, version, direct runtime closure and digest without claiming a signature', () => {
  const { dir, input } = fixture();
  try {
    const proof = assertWindowsSourceIdentity(input);
    assert.equal(proof.source_head, SHA);
    assert.equal(proof.package_version, VERSION);
    assert.equal(proof.installer_sha256, input.expectedInstallerSha256);
    assert.equal(proof.direct_dependencies_verified, 2);
    assert.equal(proof.signed_attestation_verified, false);
    assert.equal(proof.installed_runtime_verified, false);
    assert.equal(proof.promotion_authorized, false);
    assert.equal(proof.authority_effect, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W24 missing installed direct production dependency fails closed even with rehashed installed proof', () => {
  withFixture((input) => {
    delete input.dependency.tree.dependencies['socket.io-client'];
    input.dependency.dependency_count = 1;
  }, /dependency_resolution_digest_invalid/);
});

test('W24 missing installed direct dependency with valid rehashed proof cannot pass source identity', () => {
  withFixture((input) => {
    const old = input.dependency;
    const tree = { ...old.tree, dependencies: { 'electron-updater': old.tree.dependencies['electron-updater'] } };
    const payload = { schema: old.schema, root_name: old.root_name, root_version: old.root_version,
      node_version: old.node_version, npm_version: old.npm_version, dependency_count: 1, tree };
    input.dependency = { ...payload, dependency_resolution_sha256: sha256String(canonicalJson(payload)), authority_effect: false };
    input.identity = createBuildIdentityV3({ ...input.identity, dependency_resolution_sha256: input.dependency.dependency_resolution_sha256 });
  }, /client_windows_direct_dependency_missing/);
});

test('W24 direct dependency version mismatch fails with consistent dependency digest and Build Identity', () => {
  withFixture((input) => {
    const old = input.dependency;
    const tree = { ...old.tree, dependencies: { ...old.tree.dependencies,
      'socket.io-client': { ...old.tree.dependencies['socket.io-client'], version: '4.8.0' } } };
    const payload = { schema: old.schema, root_name: old.root_name, root_version: old.root_version,
      node_version: old.node_version, npm_version: old.npm_version, dependency_count: 2, tree };
    input.dependency = { ...payload, dependency_resolution_sha256: sha256String(canonicalJson(payload)), authority_effect: false };
    input.identity = createBuildIdentityV3({ ...input.identity, dependency_resolution_sha256: input.dependency.dependency_resolution_sha256 });
  }, /client_windows_direct_dependency_version_mismatch/);
});

test('W24 incorrect committed manifest version cannot be masked by plausible evidence', () => {
  withFixture((input) => { input.manifest.version = '0.7.0-dev.654321.1'; }, /client_windows_manifest_version_mismatch/);
});

test('W24 wrong root version is not accepted', () => {
  withFixture((input) => { input.dependency.root_version = '0.7.0-dev.654321.1'; }, /dependency_resolution_root_tree_mismatch/);
});

test('W24 incorrect source identity digest is rejected', () => {
  withFixture((input) => { input.identity = { ...input.identity, source_head: 'c'.repeat(40) }; }, /build_identity_digest_invalid/);
});

test('W24 artifact byte tampering is rejected even if manifest and dependency hashes still pass', () => {
  withFixture((input) => { writeFileSync(input.installerPath, Buffer.from('MZ-tampered')); }, /client_windows_installer_digest_mismatch/);
});

test('W24 artifact-size mismatch is rejected independent of digest', () => {
  withFixture((input) => { input.expectedInstallerBytes += 1; }, /client_windows_installer_size_mismatch/);
});

test('W24 ambiguous two-installer output directory is rejected', () => {
  withFixture((input, dir) => {
    writeFileSync(join(dir, 'METAENGINE-Browser-Test-Setup-0.7.0-dev.999999.1-x64.exe'), 'MZ-other');
  }, /client_windows_installer_cardinality_invalid/);
});

test('W24 symlinked EXE cannot be used in place of a regular single installer', (t) => {
  const { dir, input } = fixture();
  try {
    const other = join(dir, 'payload.bin');
    writeFileSync(other, readFileSync(input.installerPath));
    rmSync(input.installerPath);
    try {
      symlinkSync(other, input.installerPath);
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
        t.skip('Windows runner has no unprivileged symlink permission');
        return;
      }
      throw error;
    }
    assert.throws(() => assertWindowsSourceIdentity(input), /client_windows_installer_file_invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('W24 direct runtime dependency versions must be exact, not ranged', () => {
  withFixture((input) => { input.manifest.dependencies['electron-updater'] = '^6.8.9'; }, /client_windows_dependency_not_exact_pinned/);
});

test('W24 untrusted signed/promotion-positive metadata is rejected; unsigned provenance is NOT signed proof', () => {
  assert.equal(assertUnsignedCandidateProvenance({ signed: false, promotion_authorized: false }), true);
  for (const metadata of [{ signed: true, promotion_authorized: false },
    { signed: false, promotion_authorized: true }, { promotion_authorized: false },
    { signed: 'true', promotion_authorized: false }]) {
    assert.throws(() => assertUnsignedCandidateProvenance(metadata), /client_windows_untrusted_signature_or_promotion_claim/);
  }
});
