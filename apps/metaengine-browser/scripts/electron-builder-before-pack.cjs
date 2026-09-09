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
  const ciHead = String(process.env.GITHUB_SHA || '').trim().toLowerCase();
  if (ciHead && (!BUILD_SHA_RE.test(ciHead) || ciHead !== head)) {
    throw new Error('emergency_trust_root_ci_head_mismatch');
  }
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
}

module.exports = metaengineGuardianNativeBeforePack;
module.exports.buildEmergencyTrustRootMetadata = buildEmergencyTrustRootMetadata;
