'use strict';
// Packaging byte readback only. These manifests never grant runtime authority.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('guardian_staged_regular_file_required');
  return fs.readFileSync(file);
}
const json = file => JSON.parse(read(file));
function same(a, b, reason) { if (a !== b) throw new Error(`guardian_staged_${reason}`); }
function binary(file, sha, size) {
  const bytes = read(file);
  same(digest(bytes), sha, 'binary_digest_mismatch');
  same(bytes.length, size, 'binary_size_mismatch');
}
function cryptoBinding(binding, sourceHead) {
  same(binding?.contract, 'metaengine.guardian.static-crypto-link-input.v1', 'crypto_required');
  same(binding.build_source_head, sourceHead, 'crypto_source_mismatch');
  for (const key of ['producer_proof_sha256', 'source_lock_sha256', 'verifier_source_sha256',
    'public_header_sha256', 'libcrypto_sha256', 'verifier_archive_sha256']) {
    if (!/^[0-9a-f]{64}$/.test(binding[key])) throw new Error(`guardian_staged_crypto_digest:${key}`);
  }
  return binding;
}
function compareBinding(actual, expected, head) {
  cryptoBinding(actual, head);
  for (const key of Object.keys(expected)) same(actual[key], expected[key], 'crypto_build_mismatch');
}
function verifyStagedGuardianPeerRuntime({ directory, sourceHead, binding }) {
  const manifest = json(path.join(directory, 'guardian-peer-native-staging-manifest.json'));
  same(manifest.source_head, sourceHead, 'peer_source_mismatch');
  same(manifest.schema, 'metaengine.browser-guardian.peer-native-staging-manifest.v1', 'peer_schema');
  same(manifest.unlinked_test_build, false, 'unlinked_peer');
  same(manifest.name, 'guardian-connected-peer.node', 'peer_name');
  same(manifest.napi_version, 9, 'peer_napi');
  compareBinding(manifest.static_crypto, binding, sourceHead);
  binary(path.join(directory, manifest.name), manifest.sha256, manifest.bytes);
  return manifest;
}
function verifyStagedGuardianRuntime({ directory, sourceHead, packageVersion }) {
  const staging = path.join(directory, 'guardian');
  const manifestPath = path.join(staging, 'guardian-native-manifest.json');
  const manifest = json(manifestPath);
  same(manifest.schema, 'metaengine.browser.guardian-native-staging-manifest.v1', 'service_schema');
  same(manifest.source_head, sourceHead, 'service_source_mismatch');
  same(manifest.package_version, packageVersion, 'service_version_mismatch');
  same(manifest.unlinked_test_build, false, 'unlinked_service');
  const binding = cryptoBinding(manifest.static_crypto, sourceHead);
  same(manifest.binaries.length, 2, 'binary_count');
  const hashes = {};
  for (const name of ['METAENGINEBrowserGuardian.exe', 'METAENGINEBrowserGuardianConfigure.exe']) {
    const rows = manifest.binaries.filter(row => row.name === name);
    same(rows.length, 1, 'binary_names');
    binary(path.join(staging, name), rows[0].sha256, rows[0].size);
    hashes[name] = rows[0].sha256;
  }
  verifyStagedGuardianPeerRuntime({ directory: path.join(directory, 'guardian-peer'), sourceHead, binding });
  const bootstrapDirectory = path.join(directory, 'guardian-bootstrap');
  const bootstrap = json(path.join(bootstrapDirectory, 'guardian-machine-bootstrap-binding.json'));
  same(bootstrap.schema, 'metaengine.browser-guardian.machine-bootstrap-binding.v1', 'bootstrap_schema');
  same(bootstrap.source_head, sourceHead, 'bootstrap_source');
  same(bootstrap.package_version, packageVersion, 'bootstrap_version');
  same(bootstrap.unlinked_test_build, false, 'unlinked_bootstrap');
  compareBinding(bootstrap.static_crypto, binding, sourceHead);
  same(bootstrap.guardian_manifest_sha256, digest(read(manifestPath)), 'bootstrap_manifest');
  same(bootstrap.service_sha256, hashes['METAENGINEBrowserGuardian.exe'], 'bootstrap_service');
  same(bootstrap.configurator_sha256, hashes['METAENGINEBrowserGuardianConfigure.exe'], 'bootstrap_configurator');
  same(bootstrap.bootstrap_name, `METAENGINE-Guardian-Bootstrap-${packageVersion}-x64.exe`, 'bootstrap_name');
  binary(path.join(bootstrapDirectory, bootstrap.bootstrap_name), bootstrap.bootstrap_sha256, bootstrap.bootstrap_size);
  return { binding, bootstrap };
}
module.exports = { verifyStagedGuardianPeerRuntime, verifyStagedGuardianRuntime };
