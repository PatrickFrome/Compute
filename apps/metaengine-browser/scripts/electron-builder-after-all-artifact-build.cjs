'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  loadDependencyResolutionProof,
  sha256File,
  validateBuildIdentity,
} = require('./build-identity.cjs');

const TRUST_ROOT_SCHEMA = 'metaengine.emergency-maintenance-trust-root.v1';
const BUILD_SHA_RE = /^[0-9a-f]{40}$/;

function exactGitHead(repoRoot) {
  const head = String(execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) || '').trim().toLowerCase();
  if (!BUILD_SHA_RE.test(head)) throw new Error('packaged_emergency_trust_root_git_head_invalid');
  return head;
}

function assertPackagedGuardianBootstrapBinding(binding, { expectedHead, packageVersion, resourcesDir }) {
  if (!binding || binding.schema !== 'metaengine.browser-guardian.machine-bootstrap-binding.v1') {
    throw new Error('packaged_guardian_bootstrap_binding_missing');
  }
  const head = String(binding.source_head || '').trim().toLowerCase();
  const version = String(binding.package_version || '').trim();
  const name = String(binding.bootstrap_name || '');
  const digest = String(binding.bootstrap_sha256 || '').trim().toLowerCase();
  const size = Number(binding.bootstrap_size);
  if (head !== expectedHead) throw new Error('packaged_guardian_bootstrap_source_head_mismatch');
  if (version !== packageVersion) throw new Error('packaged_guardian_bootstrap_version_mismatch');
  if (name !== `METAENGINE-Guardian-Bootstrap-${version}-x64.exe`) throw new Error('packaged_guardian_bootstrap_name_invalid');
  if (!/^[0-9a-f]{64}$/.test(digest) || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error('packaged_guardian_bootstrap_identity_invalid');
  }
  if (binding.embedded_assets_only !== true
      || binding.explicit_elevated_install_required !== true
      || binding.automatic_retry_allowed !== false
      || binding.authority_effect !== false) {
    throw new Error('packaged_guardian_bootstrap_contract_invalid');
  }
  const bootstrapPath = path.join(resourcesDir, 'guardian-bootstrap', name);
  if (!fs.existsSync(bootstrapPath) || !fs.statSync(bootstrapPath).isFile()) {
    throw new Error('packaged_guardian_bootstrap_executable_missing');
  }
  const actual = fs.readFileSync(bootstrapPath);
  if (actual.length !== size || crypto.createHash('sha256').update(actual).digest('hex') !== digest) {
    throw new Error('packaged_guardian_bootstrap_bytes_mismatch');
  }
  return { name, digest, size };
}

function assertPackagedTrustRoot(metadata, expectedHead) {
  if (!metadata || metadata.schema !== TRUST_ROOT_SCHEMA) {
    throw new Error('packaged_emergency_trust_root_missing');
  }
  const buildSha = String(metadata.build_sha || '').trim().toLowerCase();
  if (buildSha !== expectedHead) throw new Error('packaged_emergency_trust_root_build_sha_mismatch');
  const pem = String(metadata.ed25519_public_key_pem || '');
  if (!pem || /PRIVATE KEY/.test(pem)) throw new Error('packaged_emergency_trust_root_public_key_invalid');
  let key;
  try {
    key = crypto.createPublicKey(pem);
  } catch {
    throw new Error('packaged_emergency_trust_root_public_key_invalid');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('packaged_emergency_trust_root_public_key_not_ed25519');
  const der = key.export({ type: 'spki', format: 'der' });
  const actual = crypto.createHash('sha256').update(der).digest('hex');
  if (String(metadata.public_key_spki_sha256 || '').trim().toLowerCase() !== actual) {
    throw new Error('packaged_emergency_trust_root_public_key_fingerprint_mismatch');
  }
  return actual;
}

function assertPackagedBuildIdentity(metadata, { appRoot, expectedHead, packageVersion }) {
  const dependencyProofPath = String(process.env.ME2_DEPENDENCY_RESOLUTION_PATH || '').trim();
  if (!dependencyProofPath) throw new Error('packaged_build_identity_dependency_resolution_path_missing');
  const dependency = loadDependencyResolutionProof(dependencyProofPath);
  const configPath = path.join(appRoot, 'electron-builder.test.json');
  const exact = validateBuildIdentity(metadata, {
    repository: process.env.GITHUB_REPOSITORY,
    repository_id: process.env.GITHUB_REPOSITORY_ID,
    source_head: expectedHead,
    workflow: process.env.ME2_BUILD_WORKFLOW,
    run_id: process.env.GITHUB_RUN_ID,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT,
    package_version: packageVersion,
    platform: 'win32',
    arch: process.env.ME2_BUILD_ARCH || 'x64',
    builder_config_sha256: sha256File(configPath),
    dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    electron_builder_version: process.env.ME2_ELECTRON_BUILDER_VERSION,
    node_version: process.version,
  });
  const proof = Object.freeze({
    schema: 'metaengine.browser.packaged-build-identity-proof.v1',
    source_head: expectedHead,
    package_version: packageVersion,
    build_identity_sha256: exact.build_identity_sha256,
    dependency_resolution_sha256: exact.dependency_resolution_sha256,
    builder_config_sha256: exact.builder_config_sha256,
    repository: exact.repository,
    repository_id: exact.repository_id,
    workflow: exact.workflow,
    run_id: exact.run_id,
    run_attempt: exact.run_attempt,
    platform: exact.platform,
    arch: exact.arch,
    electron_builder_version: exact.electron_builder_version,
    node_version: exact.node_version,
    authority_effect: false,
  });
  const runnerTemp = String(process.env.RUNNER_TEMP || '').trim();
  if (runnerTemp) {
    fs.writeFileSync(
      path.join(runnerTemp, 'packaged-build-identity-proof.json'),
      `${JSON.stringify(proof, null, 2)}\n`,
      'utf8',
    );
  }
  return proof;
}

module.exports = async function verifyPackagedEmergencyTrustRoot(buildResult) {
  if (process.platform !== 'win32') return [];
  const appRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(appRoot, '../..');
  const outDir = path.resolve(String(buildResult?.outDir || path.join(appRoot, 'dist-test')));
  const appOutDir = path.join(outDir, 'win-unpacked');
  const resourcesDir = path.join(appOutDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const unpackedAppDir = path.join(resourcesDir, 'app');
  const executable = path.join(appOutDir, 'METAENGINE Browser Test.exe');

  if (!fs.existsSync(asarPath) || !fs.statSync(asarPath).isFile()) {
    throw new Error('packaged_app_asar_missing');
  }
  if (fs.existsSync(unpackedAppDir)) {
    throw new Error('packaged_unpacked_app_fallback_present');
  }
  if (!fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error('packaged_browser_executable_missing');
  }

  const asar = await import('@electron/asar');
  const packageJson = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
  const expectedHead = exactGitHead(repoRoot);
  const fingerprint = assertPackagedTrustRoot(packageJson.metaengineEmergencyTrustRoot, expectedHead);
  const packageVersion = String(packageJson.version || '');
  const bootstrap = assertPackagedGuardianBootstrapBinding(packageJson.metaengineGuardianBootstrapBinding, {
    expectedHead,
    packageVersion,
    resourcesDir,
  });
  const buildIdentity = assertPackagedBuildIdentity(packageJson.metaengineBuildIdentity, {
    appRoot,
    expectedHead,
    packageVersion,
  });

  const fuses = await import('@electron/fuses');
  const wire = await fuses.getCurrentFuseWire(executable);
  const integrityIndex = fuses.FuseV1Options.EnableEmbeddedAsarIntegrityValidation;
  const asarOnlyIndex = fuses.FuseV1Options.OnlyLoadAppFromAsar;
  if (wire[integrityIndex] !== 49) throw new Error('packaged_asar_integrity_fuse_not_enabled');
  if (wire[asarOnlyIndex] !== 49) throw new Error('packaged_asar_only_fuse_not_enabled');

  console.log(JSON.stringify({
    schema: 'metaengine.browser.packaged-emergency-trust-root-proof.v1',
    source_head: expectedHead,
    public_key_spki_sha256: fingerprint,
    app_asar_present: true,
    unpacked_app_fallback_present: false,
    embedded_asar_integrity_validation: true,
    only_load_app_from_asar: true,
    private_signing_key_packaged: false,
    guardian_bootstrap_protected_binding_present: true,
    guardian_bootstrap_name: bootstrap.name,
    guardian_bootstrap_sha256: bootstrap.digest,
    guardian_bootstrap_size: bootstrap.size,
    build_identity_sha256: buildIdentity.build_identity_sha256,
    dependency_resolution_sha256: buildIdentity.dependency_resolution_sha256,
    builder_config_sha256: buildIdentity.builder_config_sha256,
    build_identity_run_id: buildIdentity.run_id,
    build_identity_run_attempt: buildIdentity.run_attempt,
    authority_effect: false,
  }));
  return [];
};

module.exports.assertPackagedTrustRoot = assertPackagedTrustRoot;
module.exports.assertPackagedGuardianBootstrapBinding = assertPackagedGuardianBootstrapBinding;
module.exports.assertPackagedBuildIdentity = assertPackagedBuildIdentity;
