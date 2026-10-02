#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MATERIAL_SCHEMA = 'metaengine.browser.package-lock-material.v1';
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(code) {
  throw new Error(code);
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
  if (!equalObject(manifest, locked)) {
    fail(`package_lock_${field}_mismatch`);
  }
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('package_lock_packages_entry_invalid');
    }
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

export function createPackageLockMaterial({
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

  const lockfileVersion = Number(lock.lockfileVersion);
  if (!Number.isSafeInteger(lockfileVersion) || lockfileVersion < 2 || lockfileVersion > 3) {
    fail('package_lock_lockfile_version_invalid');
  }

  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    fail('package_lock_packages_invalid');
  }
  const root = lock.packages[''];
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    fail('package_lock_root_entry_missing');
  }

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

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function npmVersion() {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('package_lock_npm_version_unavailable');
  const version = String(result.stdout || '').trim();
  if (!version) fail('package_lock_npm_version_unavailable');
  return version;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(String(args.root || process.cwd()));
  const packageJsonPath = path.resolve(String(args['package-json'] || path.join(root, 'package.json')));
  const packageLockPath = path.resolve(String(args['package-lock'] || path.join(root, 'package-lock.json')));
  const material = createPackageLockMaterial({
    packageJsonPath,
    packageLockPath,
    nodeVersion: process.version,
    npmVersion: await npmVersion(),
  });
  const json = JSON.stringify(material, null, 2) + '\n';
  if (args.out && args.out !== true) {
    fs.writeFileSync(path.resolve(String(args.out)), json, 'utf8');
  }
  process.stdout.write(JSON.stringify(material) + '\n');
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser.package-lock-material-error.v1',
      code: String(error?.message || error).split(':')[0],
      message: String(error?.message || error).slice(0, 1000),
      authority_effect: false,
    }) + '\n');
    process.exitCode = 1;
  });
}

export { MATERIAL_SCHEMA };
