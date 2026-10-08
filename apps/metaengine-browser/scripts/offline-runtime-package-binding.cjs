'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BINDING_SCHEMA = 'metaengine.browser.client-state-runtime-binding.v1';
const PROOF_SCHEMA = 'metaengine.browser.packaged-client-state-runtime-proof.v1';
const MANIFEST_FILE = 'offline-runtime-bundle.json';
const VERIFIER_FILE = 'infra/client-state-runtime/offline-runtime-bundle.mjs';
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

function manifestBytes(bundleDirectory) {
  const target = path.join(bundleDirectory, MANIFEST_FILE);
  const info = fs.lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8 * 1024 * 1024) {
    fail('client_state_runtime_manifest_file_invalid');
  }
  return fs.readFileSync(target);
}

function checkoutVerifierBytes(repoRoot) {
  const target = path.join(repoRoot, VERIFIER_FILE);
  const info = fs.lstatSync(target);
  const actual = fs.realpathSync(target);
  const expected = path.resolve(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024
    || (process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) fail('client_state_runtime_verifier_file_invalid');
  return fs.readFileSync(target);
}

async function verifiedBundle(bundleDirectory, expectedBundleDigest, verifierBytes) {
  const before = manifestBytes(bundleDirectory);
  // The verifier is builtin-only. A data URL permits build Node to execute the
  // protected ASAR's bytes without falling back to the mutable source checkout.
  const verifier = await import('data:text/javascript;base64,' + verifierBytes.toString('base64'));
  const result = await verifier.verifyOfflineRuntimeBundle({ bundleDirectory, expectedBundleDigest });
  const after = manifestBytes(bundleDirectory);
  if (!before.equals(after)) fail('client_state_runtime_manifest_changed_during_verification');
  return { manifest: result.manifest, manifestSha256: sha256(after) };
}

function sourceMetadata(manifest) {
  return Object.fromEntries(['source_bundle_sha256', 'reviewed_startup_source_sha256',
    'reviewed_startup_files_sha256', 'resource_inventory_sha256'].map(key => [key, manifest[key]]));
}

function assertBinding(binding, { expectedHead, packageVersion }) {
  if (!binding || binding.schema !== BINDING_SCHEMA || binding.schema_version !== 1) fail('packaged_client_state_runtime_binding_missing');
  if (!SHA40.test(expectedHead || '') || binding.source_head_sha !== expectedHead) fail('packaged_client_state_runtime_source_head_mismatch');
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(packageVersion || '') || binding.package_version !== packageVersion) fail('packaged_client_state_runtime_version_mismatch');
  if (binding.bundle_manifest_relative_path !== MANIFEST_FILE || binding.runtime_verifier_relative_path !== VERIFIER_FILE
    || !Number.isSafeInteger(binding.resource_file_count) || binding.resource_file_count < 1 || binding.resource_file_count > 10000
    || !Number.isSafeInteger(binding.resource_size_bytes) || binding.resource_size_bytes < 1 || binding.resource_size_bytes > 2 ** 31
    || binding.authority_effect !== false) fail('packaged_client_state_runtime_binding_contract_invalid');
  for (const key of ['bundle_sha256', 'bundle_manifest_sha256', 'source_bundle_sha256',
    'reviewed_startup_source_sha256', 'reviewed_startup_files_sha256', 'resource_inventory_sha256', 'runtime_verifier_sha256']) {
    if (!SHA256.test(binding[key] || '')) fail('packaged_client_state_runtime_binding_digest_invalid');
  }
  return binding;
}

async function buildOfflineRuntimeBinding({ bundleDirectory, repoRoot, sourceHead, packageVersion }) {
  if (!SHA40.test(sourceHead || '')) fail('client_state_runtime_source_head_invalid');
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(packageVersion || '')) fail('client_state_runtime_package_version_invalid');
  const verifierBytes = checkoutVerifierBytes(repoRoot);
  const initial = JSON.parse(manifestBytes(bundleDirectory).toString('utf8'));
  const { manifest, manifestSha256 } = await verifiedBundle(bundleDirectory, initial.bundle_sha256, verifierBytes);
  // Bind staged source/dependency bytes to this checkout before sealing the external resources in ASAR.
  const source = JSON.parse(fs.readFileSync(path.join(bundleDirectory, 'source/runtime-source-bundle.json'), 'utf8'));
  for (const record of source.files) {
    const target = path.resolve(repoRoot, record.path);
    const relative = path.relative(repoRoot, target);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) fail('client_state_runtime_checkout_path_invalid');
    const info = fs.lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('client_state_runtime_checkout_file_invalid');
    const bytes = fs.readFileSync(target);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) fail('client_state_runtime_checkout_bytes_mismatch');
  }
  return Object.freeze({ schema: BINDING_SCHEMA, schema_version: 1, source_head_sha: sourceHead,
    package_version: packageVersion, bundle_manifest_relative_path: MANIFEST_FILE,
    bundle_sha256: manifest.bundle_sha256, bundle_manifest_sha256: manifestSha256,
    runtime_verifier_relative_path: VERIFIER_FILE, runtime_verifier_sha256: sha256(verifierBytes),
    resource_file_count: manifest.files.length, resource_size_bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    ...sourceMetadata(manifest), authority_effect: false });
}

async function assertPackagedOfflineRuntimeBinding(binding, { expectedHead, packageVersion, resourcesDir, verifierBytes }) {
  assertBinding(binding, { expectedHead, packageVersion });
  if (!Buffer.isBuffer(verifierBytes) || verifierBytes.length < 1 || verifierBytes.length > 1024 * 1024
    || sha256(verifierBytes) !== binding.runtime_verifier_sha256) fail('packaged_client_state_runtime_verifier_bytes_mismatch');
  const bundleDirectory = path.join(resourcesDir, 'client-state-runtime');
  const { manifest, manifestSha256 } = await verifiedBundle(bundleDirectory, binding.bundle_sha256, verifierBytes);
  if (manifestSha256 !== binding.bundle_manifest_sha256) fail('packaged_client_state_runtime_manifest_bytes_mismatch');
  const resourceSizeBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  if (manifest.files.length !== binding.resource_file_count || resourceSizeBytes !== binding.resource_size_bytes) fail('packaged_client_state_runtime_resource_inventory_mismatch');
  for (const [key, value] of Object.entries(sourceMetadata(manifest))) {
    if (binding[key] !== value) fail('packaged_client_state_runtime_source_binding_mismatch');
  }
  return Object.freeze({ schema: PROOF_SCHEMA, source_head: expectedHead, package_version: packageVersion,
    bundle_sha256: binding.bundle_sha256, bundle_manifest_sha256: manifestSha256,
    runtime_verifier_relative_path: VERIFIER_FILE, runtime_verifier_sha256: binding.runtime_verifier_sha256,
    ...sourceMetadata(manifest), resource_file_count: manifest.files.length,
    resource_size_bytes: resourceSizeBytes,
    protected_asar_binding_present: true, packaged_resources_verified: true,
    publisher_provenance_verified: false, installed_client_qualified: false,
    authority_effect: false });
}

module.exports = { BINDING_SCHEMA, PROOF_SCHEMA, VERIFIER_FILE, buildOfflineRuntimeBinding, assertPackagedOfflineRuntimeBinding };
