import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectClientFirstRun } from './first-run-preflight.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';

const runFile = promisify(execFile);
const digest = /^[0-9a-f]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};

async function canonicalCredentialFile(filename, { bundleDirectory, stateDirectory }) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || /^(?:\\\\|\/\/)/.test(filename)) {
    fail('client_initdb_password_file_path_invalid');
  }
  const resolved = path.resolve(filename);
  let current = path.parse(resolved).root;
  for (const part of path.relative(current, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const item = await fs.lstat(current);
    if (item.isSymbolicLink()) fail('client_initdb_password_file_alias_denied');
    if (current !== resolved && !item.isDirectory()) fail('client_initdb_password_file_parent_invalid');
    if (current === resolved && (!item.isFile() || item.nlink !== 1 || item.size < 2 || item.size > 4096)) {
      fail('client_initdb_password_file_invalid');
    }
  }
  const [physical, bundle, state] = await Promise.all([
    fs.realpath(resolved), fs.realpath(bundleDirectory), fs.realpath(stateDirectory).catch(error => {
      if (error?.code === 'ENOENT') return path.resolve(stateDirectory);
      throw error;
    }),
  ]);
  if (inside(bundle, physical) || inside(state, physical)) fail('client_initdb_password_file_private_boundary_invalid');
  return physical;
}

export async function runClientInitdb({
  executable, dataDirectory, passwordFile, stateDirectory, timeoutMs = 120000,
}) {
  const env = {};
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'HOME', 'USERPROFILE', 'LANG']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name];
  }
  const args = ['-D', dataDirectory, '--username=postgres', '--auth=scram-sha-256',
    '--encoding=UTF8', '--no-locale', '--data-checksums', '--no-instructions', `--pwfile=${passwordFile}`];
  try {
    await runFile(executable, args, { cwd: stateDirectory, env, windowsHide: true,
      shell: false, timeout: timeoutMs, maxBuffer: 65536 });
  } catch { fail('client_initdb_process_failed_review_required'); }
}

export async function initializeFreshClientPg17({
  bundleDirectory, expectedBundleSha256, stateDirectory, pgDataDirectory,
  runtimeConfigFile, ownerFile, passwordFile, ownerAction,
}, { verifyBundle = verifyOfflineRuntimeBundle, initdb = runClientInitdb } = {}) {
  if (ownerAction !== 'INITIALIZE_FRESH_LOCAL_POSTGRES_17') fail('client_initdb_owner_approval_required');
  if (!digest.test(expectedBundleSha256 || '')) fail('client_initdb_reviewed_bundle_digest_required');
  const selected = { bundleDirectory, stateDirectory, pgDataDirectory, runtimeConfigFile, ownerFile };
  const preflight = await inspectClientFirstRun(selected);
  if (preflight.state !== 'PREPARATION_REVIEW_REQUIRED') fail('client_initdb_existing_state_requires_reconciliation');
  const verified = await verifyBundle({ bundleDirectory, expectedBundleDigest: expectedBundleSha256 });
  if (verified?.manifest?.bundle_sha256 !== expectedBundleSha256
    || typeof verified?.paths?.postgresBinDirectory !== 'string') fail('client_initdb_bundle_unattested');
  const bundlePhysical = await fs.realpath(bundleDirectory);
  const pgBinPhysical = await fs.realpath(verified.paths.postgresBinDirectory);
  if (!inside(bundlePhysical, pgBinPhysical) || pgBinPhysical === bundlePhysical) fail('client_initdb_executable_outside_bundle');
  const executable = path.join(pgBinPhysical, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
  const executableStat = await fs.lstat(executable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink() || executableStat.nlink !== 1) {
    fail('client_initdb_executable_invalid');
  }
  const password = await canonicalCredentialFile(passwordFile, { bundleDirectory, stateDirectory });
  // Source and selected private layout can change while bundle verification
  // runs. Recheck immediately before the first filesystem write.
  const reread = await inspectClientFirstRun(selected);
  if (reread.state !== 'PREPARATION_REVIEW_REQUIRED') fail('client_initdb_state_changed_before_ownership');
  let madeState = false;
  try {
    await fs.mkdir(stateDirectory, { mode: 0o700 });
    madeState = true;
  } catch (error) { if (error?.code !== 'EEXIST') fail('client_initdb_private_directory_unavailable'); }
  // The directory is required to have been absent or empty at preflight;
  // never adopt an unexpected directory after a concurrent replacement.
  if (madeState === false) {
    const info = await fs.lstat(stateDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || (await fs.readdir(stateDirectory)).length) {
      fail('client_initdb_private_directory_changed');
    }
  }
  const lockFile = path.join(stateDirectory, 'client-first-run-initdb.lock');
  let handle;
  try { handle = await fs.open(lockFile, 'wx', 0o600); }
  catch { fail('client_initdb_exclusive_owner_conflict'); }
  // Failure or a timeout keeps a review lock plus all partial PGDATA.
  // No auto-delete, no re-run and no kill based on guessed process identity.
  const lockBytes = JSON.stringify({ schema: 'compute.client-initdb-owner-lock.v1', state: 'INITDB_UNCONFIRMED' }) + '\n';
  try {
    await handle.writeFile(lockBytes);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await fs.mkdir(pgDataDirectory, { mode: 0o700 }); // exclusive: EEXIST blocks replacement
    await initdb({ executable, dataDirectory: pgDataDirectory, passwordFile: password, stateDirectory });
    const [version, config, base] = await Promise.all([
      fs.readFile(path.join(pgDataDirectory, 'PG_VERSION'), 'utf8'),
      fs.lstat(path.join(pgDataDirectory, 'postgresql.conf')),
      fs.lstat(path.join(pgDataDirectory, 'base')),
    ]);
    if (version.trim() !== '17' || !config.isFile() || !base.isDirectory()) {
      fail('client_initdb_postcondition_unproven');
    }
    const lockInfo = await fs.lstat(lockFile);
    if (!lockInfo.isFile() || lockInfo.isSymbolicLink() || lockInfo.nlink !== 1
      || (await fs.readFile(lockFile, 'utf8')) !== lockBytes) fail('client_initdb_owner_lock_changed');
    await fs.unlink(lockFile);
    return Object.freeze({ schema: 'compute.client-initdb-receipt.v1',
      state: 'PG17_INITIALIZED_UNPROVISIONED', database_initialized: true,
      credentials_exported: false, vault_key_created: false, schema_provisioned: false,
      runtime_ready: false, owner_profile_written: false, automatic_cloud_fallback: false,
      authority_effect: false });
  } catch (error) {
    // Never unlink a lock or partial PGDATA following a failed/unknown effect.
    if (String(error?.code || '').startsWith('client_initdb_')) throw error;
    fail('client_initdb_incomplete_review_required');
  }
}
