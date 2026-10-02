'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MATERIAL_SCHEMA = 'metaengine.browser.package-lock-material.v1';
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(code) {
  throw new Error(code);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function readJson(filePath, code) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(code);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(code);
  return parsed;
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sortedObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, val]) => [String(key), String(val)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function equalObject(a, b) {
  return JSON.stringify(sortedObject(a)) === JSON.stringify(sortedObject(b));
}

function validateDirectMap(packageJson, rootLock, field) {
  const manifest = sortedObject(packageJson[field]);
  const locked = sortedObject(rootLock[field]);
  if (!equalObject(manifest, locked)) fail(`package_lock_${field}_mismatch`);
  return Object.keys(manifest).length;
}

function countMaterial(entries) {
  let packageEntryCount = 0;
  let integrityEntryCount = 0;
  let resolvedEntryCount = 0;
  let optionalEntryCount = 0;
  let platformRestrictedEntryCount = 0;
  for (const [key, value] of Object.entries(entries || {})) {
    if (key === '') continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('package_lock_packages_entry_invalid');
    packageEntryCount += 1;
    if (typeof value.integrity === 'string' && value.integrity.trim()) integrityEntryCount += 1;
    if (typeof value.resolved === 'string' && value.resolved.trim()) resolvedEntryCount += 1;
    if (value.optional === true) optionalEntryCount += 1;
    if (Array.isArray(value.os) || Array.isArray(value.cpu)) platformRestrictedEntryCount += 1;
  }
  return {
    package_entry_count: packageEntryCount,
    integrity_entry_count: integrityEntryCount,
    resolved_entry_count: resolvedEntryCount,
    optional_entry_count: optionalEntryCount,
    platform_restricted_entry_count: platformRestrictedEntryCount,
  };
}

function createPackageLockMaterial({
  packageJsonPath,
  packageLockPath,
  nodeVersion = process.version,
  npmVersion = null,
} = {}) {
  if (!packageJsonPath) fail('package_lock_package_json_path_missing');
  if (!packageLockPath) fail('package_lock_path_missing');
  const packagePath = path.resolve(String(packageJsonPath));
  const lockPath = path.resolve(String(packageLockPath));
  if (!fs.existsSync(packagePath)) fail('package_lock_package_json_missing');
  if (!fs.existsSync(lockPath)) fail('package_lock_missing');

  const packageJson = readJson(packagePath, 'package_lock_package_json_invalid');
  const lockBytes = fs.readFileSync(lockPath);
  let lock;
  try {
    lock = JSON.parse(lockBytes.toString('utf8'));
  } catch {
    fail('package_lock_json_invalid');
  }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) fail('package_lock_json_invalid');

  const name = String(packageJson.name || '').trim();
  const version = String(packageJson.version || '').trim();
  if (!name) fail('package_lock_package_name_invalid');
  if (!version) fail('package_lock_package_version_invalid');

  if (String(lock.name || '').trim() !== name) fail('package_lock_top_level_name_mismatch');
  if (String(lock.version || '').trim() !== version) fail('package_lock_top_level_version_mismatch');

  const lockfileVersion = Number(lock.lockfileVersion);
  if (!Number.isSafeInteger(lockfileVersion) || lockfileVersion < 2 || lockfileVersion > 3) {
    fail('package_lock_lockfile_version_invalid');
  }

  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    fail('package_lock_packages_invalid');
  }
  const root = lock.packages[''];
  if (!root || typeof root !== 'object' || Array.isArray(root)) fail('package_lock_root_entry_missing');
  if (String(root.name || '').trim() !== name) fail('package_lock_root_name_mismatch');
  if (String(root.version || '').trim() !== version) fail('package_lock_root_version_mismatch');

  const direct = {
    dependency_count: validateDirectMap(packageJson, root, 'dependencies'),
    dev_dependency_count: validateDirectMap(packageJson, root, 'devDependencies'),
    optional_dependency_count: validateDirectMap(packageJson, root, 'optionalDependencies'),
    peer_dependency_count: validateDirectMap(packageJson, root, 'peerDependencies'),
  };

  const material = countMaterial(lock.packages);
  const packageLockSha256 = sha256Bytes(lockBytes);
  if (!SHA256_RE.test(packageLockSha256)) fail('package_lock_sha256_invalid');

  return Object.freeze({
    schema: MATERIAL_SCHEMA,
    package_name: name,
    package_version: version,
    lockfile_version: lockfileVersion,
    package_lock_sha256: packageLockSha256,
    package_lock_bytes: lockBytes.length,
    node_version: String(nodeVersion || ''),
    npm_version: npmVersion == null ? null : String(npmVersion),
    ...direct,
    ...material,
    authority_effect: false,
  });
}

function validatePackageLockMaterial(value, expected = {}) {
  if (!value || value.schema !== MATERIAL_SCHEMA) fail('package_lock_material_schema_invalid');
  if (value.authority_effect !== false) fail('package_lock_material_authority_invalid');
  if (!SHA256_RE.test(String(value.package_lock_sha256 || '').toLowerCase())) fail('package_lock_material_sha256_invalid');
  for (const field of [
    'package_lock_bytes',
    'lockfile_version',
    'dependency_count',
    'dev_dependency_count',
    'optional_dependency_count',
    'peer_dependency_count',
    'package_entry_count',
    'integrity_entry_count',
    'resolved_entry_count',
    'optional_entry_count',
    'platform_restricted_entry_count',
  ]) {
    const n = Number(value[field]);
    if (!Number.isSafeInteger(n) || n < 0) fail(`package_lock_material_${field}_invalid`);
  }
  if (![2, 3].includes(Number(value.lockfile_version))) fail('package_lock_material_lockfile_version_invalid');
  if (!String(value.package_name || '').trim()) fail('package_lock_material_package_name_invalid');
  if (!String(value.package_version || '').trim()) fail('package_lock_material_package_version_invalid');
  if (!String(value.node_version || '').trim()) fail('package_lock_material_node_version_invalid');
  if (!String(value.npm_version || '').trim()) fail('package_lock_material_npm_version_invalid');

  const checks = {
    package_name: expected.package_name ?? expected.packageName,
    package_version: expected.package_version ?? expected.packageVersion,
    package_lock_sha256: expected.package_lock_sha256 ?? expected.packageLockSha256,
    node_version: expected.node_version ?? expected.nodeVersion,
    npm_version: expected.npm_version ?? expected.npmVersion,
  };
  for (const [field, wanted] of Object.entries(checks)) {
    if (wanted === undefined || wanted === null) continue;
    if (String(value[field]) !== String(wanted)) fail(`package_lock_material_${field}_mismatch`);
  }
  return Object.freeze(canonicalize(value));
}

function loadPackageLockMaterialProof(filePath, {
  packageJsonPath,
  packageLockPath,
} = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail('package_lock_material_proof_unreadable');
  }
  const proof = validatePackageLockMaterial(parsed);
  if (packageJsonPath && packageLockPath) {
    const exact = createPackageLockMaterial({
      packageJsonPath,
      packageLockPath,
      nodeVersion: proof.node_version,
      npmVersion: proof.npm_version,
    });
    if (JSON.stringify(canonicalize(exact)) !== JSON.stringify(canonicalize(proof))) {
      fail('package_lock_material_proof_drift');
    }
  }
  return proof;
}

module.exports = Object.freeze({
  MATERIAL_SCHEMA,
  createPackageLockMaterial,
  validatePackageLockMaterial,
  loadPackageLockMaterialProof,
});
