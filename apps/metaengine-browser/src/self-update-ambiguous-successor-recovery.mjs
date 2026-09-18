import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from './self-update-transaction-journal.mjs';

export const AMBIGUOUS_SUCCESSOR_RECOVERY_SCHEMA = 'metaengine.self-update.ambiguous-successor-recovery.v1';
export const QUARANTINED_SUCCESSOR_RECOVERY_SCHEMA = 'metaengine.self-update.quarantined-successor-recovery.v1';
const SHA256_RE = /^[0-9a-f]{64}$/;

function versionTuple(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map((part) => BigInt(part)) : null;
}

export function compareMetaengineDevVersions(left, right) {
  const a = versionTuple(left);
  const b = versionTuple(right);
  if (!a || !b) return null;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function held(reason, extra = {}) {
  return freeze({
    schema: AMBIGUOUS_SUCCESSOR_RECOVERY_SCHEMA,
    state: 'HELD',
    reason,
    superseded: false,
    physical_installer_launch_count: 0,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

function exactTrustedRelease(release, currentVersion) {
  if (!release || release.schema !== 'metaengine.trusted-dev-release.v1') return false;
  if (String(release.version || '') !== currentVersion) return false;
  if (String(release.tag || '') !== `v${currentVersion}`) return false;
  if (!/^[0-9a-f]{40}$/.test(String(release.git_sha || '').toLowerCase())) return false;
  if (!SHA256_RE.test(String(release.installer_sha256 || '').toLowerCase())) return false;
  if (!SHA256_RE.test(String(release.manifest_sha256 || '').toLowerCase())) return false;
  if (!SHA256_RE.test(String(release.installed_executable_sha256 || '').toLowerCase())) return false;
  if (release.target_present_proof_supported !== true) return false;
  if (release.authority_effect !== false) return false;
  return true;
}

/**
 * Reconciles an unresolved installer transaction only from positive evidence that
 * the executable currently on disk is an exact trusted release at or above the
 * transaction target. Version strings alone never clear an unresolved effect.
 *
 * QUARANTINED has a stricter rule than AMBIGUOUS_INSTALL: the running Browser
 * must be a strictly NEWER trusted release. An equal-version process can never
 * erase the quarantine that was created for that exact successor.
 *
 * resolveTrustedInstalledRelease must perform the normal immutable-release trust
 * verification for exactly currentVersion; this function then independently hashes
 * the executable actually installed on disk and requires the manifest-bound digest.
 * No installer or activation effect exists in this module.
 */
async function recoverInstalledSuccessor({
  app,
  resolveTrustedInstalledRelease,
  executablePath = process.execPath,
  hashExecutable = sha256File,
  clock = () => Date.now(),
  transactionState,
  schema,
  noTransactionReason,
  requireStrictlyNewer = false,
} = {}) {
  if (!app || typeof app.getVersion !== 'function' || typeof app.getPath !== 'function') {
    throw new Error('ambiguous_successor_recovery_app_invalid');
  }
  if (typeof resolveTrustedInstalledRelease !== 'function') {
    throw new Error('ambiguous_successor_recovery_release_resolver_required');
  }
  if (typeof hashExecutable !== 'function') throw new Error('ambiguous_successor_recovery_hasher_required');

  const transaction = await readSelfUpdateTransaction(app);
  if (!transaction || transaction.state !== transactionState) {
    return held(noTransactionReason, { transaction_state: transaction?.state || null, schema });
  }

  const currentVersion = String(app.getVersion() || '');
  const targetVersion = String(transaction.target_version || '');
  const comparison = compareMetaengineDevVersions(currentVersion, targetVersion);
  if (comparison == null) {
    return held('VERSION_RELATIONSHIP_UNPROVEN', { current_version: currentVersion, target_version: targetVersion, schema });
  }
  if (comparison < 0) {
    return held('INSTALLED_VERSION_OLDER_THAN_TARGET', { current_version: currentVersion, target_version: targetVersion, schema });
  }
  if (requireStrictlyNewer && comparison === 0) {
    return held('QUARANTINED_REQUIRES_STRICTLY_NEWER_SUCCESSOR', {
      current_version: currentVersion,
      target_version: targetVersion,
      transaction_state: transaction.state,
      schema,
    });
  }

  let release;
  try {
    release = await resolveTrustedInstalledRelease({
      currentVersion,
      targetVersion,
      relationship: comparison === 0 ? 'EXACT' : 'NEWER',
    });
  } catch (error) {
    return held('TRUSTED_RELEASE_RESOLUTION_FAILED', {
      current_version: currentVersion,
      target_version: targetVersion,
      detail: String(error?.message || error).slice(0, 180),
      schema,
    });
  }
  if (!exactTrustedRelease(release, currentVersion)) {
    return held('TRUSTED_INSTALLED_RELEASE_REQUIRED', {
      current_version: currentVersion,
      target_version: targetVersion,
      schema,
    });
  }

  let installedSha;
  try {
    installedSha = String(await hashExecutable(executablePath)).trim().toLowerCase();
  } catch (error) {
    return held('INSTALLED_EXECUTABLE_HASH_FAILED', {
      current_version: currentVersion,
      target_version: targetVersion,
      detail: String(error?.message || error).slice(0, 180),
      schema,
    });
  }
  if (!SHA256_RE.test(installedSha)) {
    return held('INSTALLED_EXECUTABLE_HASH_INVALID', { current_version: currentVersion, target_version: targetVersion, schema });
  }
  if (installedSha !== String(release.installed_executable_sha256).toLowerCase()) {
    return held('INSTALLED_EXECUTABLE_DIGEST_MISMATCH', {
      current_version: currentVersion,
      target_version: targetVersion,
      installed_executable_sha256: installedSha,
      schema,
    });
  }

  const relationship = comparison === 0 ? 'EXACT' : 'NEWER';
  const priorQuarantineReason = transaction.state === 'QUARANTINED'
    ? String(transaction.evidence?.quarantine_reason || transaction.evidence?.reason || '').slice(0, 180) || null
    : null;
  const superseded = await transitionSelfUpdateTransaction(app, 'SUPERSEDED', {
    clock,
    evidence: {
      superseding_version: currentVersion,
      successor_relationship: relationship,
      trusted_release_verified: true,
      trusted_release_git_sha: String(release.git_sha).toLowerCase(),
      trusted_release_manifest_sha256: String(release.manifest_sha256).toLowerCase(),
      trusted_release_installer_sha256: String(release.installer_sha256).toLowerCase(),
      installed_executable_sha256: installedSha,
      physical_installer_launch_count: 0,
      recovery_without_installer_effect: true,
      prior_transaction_state: transaction.state,
      prior_quarantine_reason: priorQuarantineReason,
    },
  });

  return freeze({
    schema,
    state: 'SUPERSEDED',
    reason: 'TRUSTED_INSTALLED_SUCCESSOR_PROVEN',
    superseded: true,
    relationship,
    current_version: currentVersion,
    target_version: targetVersion,
    release_version: release.version,
    release_git_sha: String(release.git_sha).toLowerCase(),
    manifest_sha256: String(release.manifest_sha256).toLowerCase(),
    installer_sha256: String(release.installer_sha256).toLowerCase(),
    installed_executable_sha256: installedSha,
    prior_transaction_state: transaction.state,
    prior_quarantine_reason: priorQuarantineReason,
    transaction: superseded,
    physical_installer_launch_count: 0,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export async function recoverAmbiguousInstalledSuccessor(options = {}) {
  return recoverInstalledSuccessor({
    ...options,
    transactionState: 'AMBIGUOUS_INSTALL',
    schema: AMBIGUOUS_SUCCESSOR_RECOVERY_SCHEMA,
    noTransactionReason: 'NO_AMBIGUOUS_INSTALL',
    requireStrictlyNewer: false,
  });
}

export async function recoverQuarantinedInstalledSuccessor(options = {}) {
  return recoverInstalledSuccessor({
    ...options,
    transactionState: 'QUARANTINED',
    schema: QUARANTINED_SUCCESSOR_RECOVERY_SCHEMA,
    noTransactionReason: 'NO_QUARANTINED_INSTALL',
    requireStrictlyNewer: true,
  });
}
