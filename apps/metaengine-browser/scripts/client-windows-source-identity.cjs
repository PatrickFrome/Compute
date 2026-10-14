'use strict';

// Source-only admission guard for the ONE Windows NSIS installer produced by
// Browser Windows Package Smoke. This is not a signature verifier or release gate.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateBuildIdentityV3,
  validateDependencyResolutionProof,
} = require('./build-identity.cjs');

const SHA256 = /^[0-9a-f]{64}$/;
const PINNED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SCHEMA = 'metaengine.client.windows-single-installer-source-proof.v1';
function fail(code) { throw new Error(`client_windows_${code}`); }

function assertWindowsSourceIdentity({ manifest, identity, dependency, installerPath,
  expectedInstallerSha256, expectedInstallerBytes } = {}) {
  // A signed assertion supplied by the candidate itself is never proof.
  const build = validateBuildIdentityV3(identity);
  const installed = validateDependencyResolutionProof(dependency);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest_invalid');
  const name = String(manifest.name || '');
  const version = String(manifest.version || '');
  if (name !== '@metaengine/browser-shell') fail('manifest_name_mismatch');
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(version)) fail('manifest_version_invalid');
  if (version !== build.package_version) fail('manifest_version_mismatch');
  if (build.platform !== 'win32' || build.arch !== 'x64'
      || build.workflow !== 'browser-windows-package-smoke.yml'
      || build.repository !== 'PatrickFrome/Compute') fail('build_target_mismatch');
  if (installed.root_name !== name || installed.root_version !== version
      || installed.tree.name !== name || installed.tree.version !== version) fail('dependency_root_mismatch');
  if (installed.dependency_resolution_sha256 !== build.dependency_resolution_sha256) fail('dependency_digest_mismatch');
  if (installed.node_version !== build.node_version || installed.npm_version !== build.npm_version) {
    fail('dependency_toolchain_mismatch');
  }

  const direct = new Map();
  // Only runtime direct dependencies are required here. Toolchain/dev closure is
  // independently pinned by Build Identity V3 + npm ci in Package Smoke.
  for (const key of ['dependencies']) {
    const entries = manifest[key];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) fail(`${key}_invalid`);
    for (const [depName, requested] of Object.entries(entries)) {
      if (direct.has(depName)) fail('dependency_duplicate');
      if (typeof requested !== 'string' || !PINNED_VERSION.test(requested)) fail('dependency_not_exact_pinned');
      direct.set(depName, requested);
    }
  }
  if (direct.size < 1 || direct.size > 128) fail('dependency_count_invalid');
  for (const [depName, expectedVersion] of direct) {
    const installedDependency = installed.tree.dependencies[depName];
    if (!installedDependency || typeof installedDependency !== 'object') fail('direct_dependency_missing');
    if (installedDependency.version !== expectedVersion) fail('direct_dependency_version_mismatch');
  }

  if (!installerPath || typeof installerPath !== 'string') fail('installer_path_missing');
  const expectedName = `METAENGINE-Browser-Test-Setup-${version}-x64.exe`;
  if (path.basename(installerPath) !== expectedName) fail('installer_name_mismatch');
  const parent = path.dirname(path.resolve(installerPath));
  const matching = fs.readdirSync(parent).filter((item) =>
    /^METAENGINE-Browser-Test-Setup-.*-x64\.exe$/i.test(item));
  if (matching.length !== 1 || matching[0] !== expectedName) fail('installer_cardinality_invalid');
  const file = fs.lstatSync(installerPath);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.size < 1) fail('installer_file_invalid');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
  if (!SHA256.test(expectedInstallerSha256 || '') || sha !== expectedInstallerSha256) fail('installer_digest_mismatch');
  if (!Number.isSafeInteger(expectedInstallerBytes) || expectedInstallerBytes !== file.size) fail('installer_size_mismatch');
  return Object.freeze({
    schema: SCHEMA,
    source_head: build.source_head,
    package_version: version,
    installer_name: expectedName,
    installer_sha256: sha,
    installer_bytes: file.size,
    dependency_resolution_sha256: installed.dependency_resolution_sha256,
    direct_dependencies_verified: direct.size,
    source_identity_verified: true,
    signed_attestation_verified: false, // requires separate independent Sigstore verifier
    installed_runtime_verified: false,
    promotion_authorized: false,
    authority_effect: false,
  });
}

function assertUnsignedCandidateProvenance(provenance) {
  if (!provenance || provenance.signed !== false || provenance.promotion_authorized !== false) {
    fail('untrusted_signature_or_promotion_claim');
  }
  return true;
}

module.exports = Object.freeze({ assertWindowsSourceIdentity, assertUnsignedCandidateProvenance });
