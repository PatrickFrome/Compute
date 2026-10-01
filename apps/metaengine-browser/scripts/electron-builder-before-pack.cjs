'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildDevOSSourceSnapshot } = require('./devos-source-snapshot-builder.cjs');

const TRUST_ROOT_SCHEMA = 'metaengine.emergency-maintenance-trust-root.v1';
const BUILD_SHA_RE = /^[0-9a-f]{40}$/;

function exactGitHead(repoRoot) {
  let head;
  try {
    head = String(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) || '').trim().toLowerCase();
  } catch {
    throw new Error('emergency_trust_root_git_head_unavailable');
  }
  if (!BUILD_SHA_RE.test(head)) throw new Error('emergency_trust_root_git_head_invalid');
  return head;
}

function pinnedEd25519PublicKey(appRoot) {
  const keyPath = path.join(appRoot, 'build', 'emergency-maintenance-public-key.pem');
  let text;
  try {
    text = fs.readFileSync(keyPath, 'utf8');
  } catch {
    throw new Error('emergency_trust_root_public_key_unavailable');
  }
  if (!text || /PRIVATE KEY/.test(text)) throw new Error('emergency_trust_root_public_key_invalid');
  let key;
  try {
    key = crypto.createPublicKey(text);
  } catch {
    throw new Error('emergency_trust_root_public_key_invalid');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('emergency_trust_root_public_key_not_ed25519');
  const der = key.export({ type: 'spki', format: 'der' });
  return {
    pem: key.export({ type: 'spki', format: 'pem' }).toString(),
    fingerprint: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

function buildEmergencyTrustRootMetadata({ appRoot, repoRoot }) {
  const publicKey = pinnedEd25519PublicKey(appRoot);
  return Object.freeze({
    schema: TRUST_ROOT_SCHEMA,
    build_sha: exactGitHead(repoRoot),
    ed25519_public_key_pem: publicKey.pem,
    public_key_spki_sha256: publicKey.fingerprint,
  });
}

function validateGuardianBootstrapBinding(binding, { sourceHead, packageVersion } = {}) {
  if (!binding || binding.schema !== 'metaengine.browser-guardian.machine-bootstrap-binding.v1') {
    throw new Error('guardian_bootstrap_binding_schema_invalid');
  }
  const head = String(binding.source_head || '').trim().toLowerCase();
  const version = String(binding.package_version || '').trim();
  const name = String(binding.bootstrap_name || '');
  const sha256 = String(binding.bootstrap_sha256 || '').trim().toLowerCase();
  const size = Number(binding.bootstrap_size);
  if (!BUILD_SHA_RE.test(head) || head !== String(sourceHead || '').trim().toLowerCase()) {
    throw new Error('guardian_bootstrap_binding_source_head_mismatch');
  }
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(version) || version !== String(packageVersion || '')) {
    throw new Error('guardian_bootstrap_binding_package_version_mismatch');
  }
  if (name !== `METAENGINE-Guardian-Bootstrap-${version}-x64.exe`) {
    throw new Error('guardian_bootstrap_binding_name_invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size < 64 * 1024 || size > 32 * 1024 * 1024) {
    throw new Error('guardian_bootstrap_binding_bytes_invalid');
  }
  for (const field of ['guardian_manifest_sha256', 'service_sha256', 'configurator_sha256']) {
    if (!/^[0-9a-f]{64}$/.test(String(binding[field] || '').trim().toLowerCase())) {
      throw new Error(`guardian_bootstrap_binding_${field}_invalid`);
    }
  }
  if (!/^[0-9a-f]{16}-[0-9a-f]{16}$/.test(String(binding.slot_id || '').trim().toLowerCase())
      || binding.embedded_assets_only !== true
      || binding.explicit_elevated_install_required !== true
      || binding.automatic_retry_allowed !== false
      || binding.authority_effect !== false) {
    throw new Error('guardian_bootstrap_binding_contract_invalid');
  }
  return Object.freeze({
    ...binding,
    source_head: head,
    package_version: version,
    bootstrap_name: name,
    bootstrap_sha256: sha256,
    bootstrap_size: size,
  });
}

async function metaengineGuardianNativeBeforePack(context) {
  if (!context || context.electronPlatformName !== 'win32') return;
  if (process.platform !== 'win32') {
    throw new Error('guardian_native_staging_windows_toolchain_required');
  }

  const appRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(appRoot, '../..');
  const trustRoot = buildEmergencyTrustRootMetadata({ appRoot, repoRoot });
  const priorMetadata = context.packager?.config?.extraMetadata;
  if (!context.packager?.config) throw new Error('emergency_trust_root_packager_config_unavailable');
  context.packager.config.extraMetadata = {
    ...(priorMetadata && typeof priorMetadata === 'object' ? priorMetadata : {}),
    metaengineEmergencyTrustRoot: trustRoot,
  };

  await buildDevOSSourceSnapshot({
    repoRoot,
    outputDir: path.join(appRoot, 'devos-source-snapshot'),
    repository: process.env.GITHUB_REPOSITORY || 'PatrickFrome/Compute',
    head: trustRoot.build_sha,
    ref: process.env.GITHUB_REF || null,
  });
  const buildScript = path.join(__dirname, 'build-guardian-native-staging.ps1');
  const daemonBuildScript = path.join(__dirname, 'build-me2-daemon-staging.ps1');
  const powershell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';

  const result = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', buildScript],
    { cwd: appRoot, stdio: 'inherit', windowsHide: true },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`guardian_native_staging_build_failed:${result.status}`);
  }

  const bootstrapResult = spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'build-guardian-machine-bootstrap.ps1'),
    '-StagingDir', path.join(appRoot, 'native-dist/guardian'),
    '-OutputDir', path.join(appRoot, 'native-dist/guardian-bootstrap'),
  ], { cwd: appRoot, stdio: 'inherit', windowsHide: true });
  if (bootstrapResult.error) throw bootstrapResult.error;
  if (bootstrapResult.status !== 0) throw new Error(`guardian_machine_bootstrap_build_failed:${bootstrapResult.status}`);

  const packageVersion = String(require(path.join(appRoot, 'package.json')).version || '');
  const bootstrapBindingPath = path.join(appRoot, 'native-dist', 'guardian-bootstrap', 'guardian-machine-bootstrap-binding.json');
  let bootstrapBinding;
  try {
    bootstrapBinding = validateGuardianBootstrapBinding(
      JSON.parse(fs.readFileSync(bootstrapBindingPath, 'utf8')),
      { sourceHead: trustRoot.build_sha, packageVersion },
    );
  } catch (error) {
    throw new Error(`guardian_machine_bootstrap_binding_invalid:${String(error?.message || error)}`);
  }
  context.packager.config.extraMetadata = {
    ...(context.packager.config.extraMetadata || {}),
    metaengineGuardianBootstrapBinding: bootstrapBinding,
  };

  const daemonResult = spawnSync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', daemonBuildScript, '-ExpectedSourceHead', trustRoot.build_sha],
    { cwd: appRoot, stdio: 'inherit', windowsHide: true },
  );
  if (daemonResult.error) throw daemonResult.error;
  if (daemonResult.status !== 0) {
    throw new Error(`me2_daemon_staging_build_failed:${daemonResult.status}`);
  }
}

module.exports = metaengineGuardianNativeBeforePack;
module.exports.buildEmergencyTrustRootMetadata = buildEmergencyTrustRootMetadata;
module.exports.validateGuardianBootstrapBinding = validateGuardianBootstrapBinding;
