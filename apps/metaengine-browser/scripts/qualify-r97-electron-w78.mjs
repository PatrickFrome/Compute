import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PIN = Object.freeze({
  version: '44.0.0',
  resolved: 'https://registry.npmjs.org/electron/-/electron-44.0.0.tgz',
  integrity: 'sha512-FkTqPrFPZYljdPI5b7KORGsJTd6FgUQDefl5MrU3Xz9R87pAj9JLreIjDqcRN8hJIkFHIou0o8kKzvcpT9qiRQ==',
});
const FORBIDDEN_ENV = [
  'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME',
  'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_SKIP_BINARY_DOWNLOAD',
  'ELECTRON_USE_LOCAL_VERSION', 'NPM_CONFIG_ELECTRON_MIRROR',
];

async function ordinary(file) {
  const stat = await lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'w78_regular_file_required');
  assert.equal(await realpath(file), path.resolve(file), 'w78_path_alias_forbidden');
  return stat;
}
async function json(file) {
  await ordinary(file);
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function checkR97ElectronInputs(root = ROOT, env = process.env) {
  for (const key of FORBIDDEN_ENV)
    assert.equal(String(env[key] ?? '').trim(), '', 'w78_electron_override_forbidden:' + key);
  const [manifest, lock, actual] = await Promise.all([
    json(path.join(root, 'package.json')),
    json(path.join(root, 'package-lock.json')),
    json(path.join(root, 'node_modules/electron/package.json')),
  ]);
  assert.equal(manifest.devDependencies?.electron, PIN.version, 'w78_manifest_version_drift');
  assert.equal(lock.lockfileVersion, 3, 'w78_lockfile_version_drift');
  assert.equal(lock.packages?.['']?.devDependencies?.electron, PIN.version, 'w78_lock_root_drift');
  const entry = lock.packages?.['node_modules/electron'];
  assert.equal(entry?.version, PIN.version, 'w78_electron_version_drift');
  assert.equal(entry?.resolved, PIN.resolved, 'w78_electron_registry_drift');
  assert.equal(entry?.integrity, PIN.integrity, 'w78_electron_integrity_drift');
  assert.match(lock.packages?.['node_modules/@electron/get']?.integrity ?? '', /^sha512-/, 'w78_get_not_lock_pinned');
  assert.equal(actual.name, 'electron', 'w78_installed_name_drift');
  assert.equal(actual.version, PIN.version, 'w78_installed_version_drift');
  await ordinary(path.join(root, 'node_modules/electron/install.js'));
  return Object.freeze({ electron_version: PIN.version, locked_upstream: true });
}
export async function verifyR97ElectronBinary(root = ROOT, env = process.env) {
  await checkR97ElectronInputs(root, env);
  const base = path.join(root, 'node_modules/electron');
  await ordinary(path.join(base, 'path.txt'));
  assert.equal((await readFile(path.join(base, 'path.txt'), 'utf8')).trim(), 'electron.exe', 'w78_electron_entry_drift');
  const binary = path.join(base, 'dist/electron.exe');
  const stat = await ordinary(binary);
  assert.ok(stat.size > 1000000, 'w78_binary_invalid_size');
  const sha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  return Object.freeze({
    schema: 'metaengine.client.w78.r97-electron-binary.v1',
    source_head: String(env.ME2_BUILD_SHA || ''),
    electron_version: PIN.version,
    binary_sha256: sha256,
    binary_bytes: stat.size,
    provenance_scope: 'ISOLATED_CI_SOURCE_ONLY',
    installed_proof: 'UNKNOWN',
    authority_effect: false,
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.match(String(process.env.ME2_BUILD_SHA || ''), /^[0-9a-f]{40}$/, 'w78_source_sha_required');
    const mode = process.argv[2];
    assert.ok(['--check-inputs', '--verify-binary'].includes(mode), 'w78_unknown_provisioning_mode');
    const receipt = mode === '--verify-binary' ? await verifyR97ElectronBinary() : await checkR97ElectronInputs();
    console.log('w78_r97_electron_receipt=' + JSON.stringify(receipt));
  } catch (error) {
    console.error('w78_r97_electron_failed:' + String(error?.message ?? error));
    process.exitCode = 1;
  }
}
