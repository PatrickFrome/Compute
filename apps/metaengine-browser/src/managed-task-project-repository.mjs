import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';
import { MANAGED_TASK_PROJECT_DIRECTORY_NAME, assertManagedProjectPhysicalDirectory,
  assertManagedProjectPrivateReceipt, prepareManagedTaskProjectStorage, verifyManagedProjectPrivateFile } from './managed-task-project-storage.mjs';

export const MANAGED_TASK_PROJECT_REPOSITORY_CONFIG_SCHEMA = 'metaengine.devos.managed-project-repository-config.v1';
const FILE_NAME = 'repository.json';
const FIELDS = ['schema', 'coordination_workspace_id', 'repo_id', 'repo_root', 'managed_root'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const exec = promisify(execFile);
const fail = code => { throw new Error(`managed_project_repository_${code}`); };

function configuration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('|') !== [...FIELDS].sort().join('|')
      || value.schema !== MANAGED_TASK_PROJECT_REPOSITORY_CONFIG_SCHEMA
      || !UUID.test(value.coordination_workspace_id || '')
      || typeof value.repo_id !== 'string' || !/^[a-z0-9][a-z0-9:._/-]{2,159}$/i.test(value.repo_id)
      || !['repo_root', 'managed_root'].every(key => typeof value[key] === 'string')) fail('configuration_invalid');
  const output = Object.fromEntries(FIELDS.map(key => [key, value[key]]));
  const relative = path.relative(output.repo_root, output.managed_root);
  if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) fail('managed_root_inside_repository');
  return Object.freeze(output);
}

async function verifyRepository(value, { runGit = exec } = {}) {
  await assertManagedProjectPhysicalDirectory(value.repo_root);
  await assertManagedProjectPhysicalDirectory(value.managed_root);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const options = { cwd: value.repo_root, shell: false, windowsHide: true, timeout: 15000, maxBuffer: 8192, env };
  const root = await runGit('git', ['rev-parse', '--show-toplevel'], options);
  if (typeof root?.stdout !== 'string' || path.resolve(root.stdout.trim()) !== value.repo_root) fail('git_root_mismatch');
  const head = await runGit('git', ['rev-parse', '--verify', 'HEAD^{commit}'], options);
  if (!/^[0-9a-f]{40}$/.test(String(head?.stdout || '').trim())) fail('git_head_unverified');
  return value;
}

/** Read only the operator's private host configuration. No renderer or command
 * payload can select this file or supply repository paths. Missing configuration
 * is observable; malformed, aliased, broadened or changing files fail closed. */
export async function readManagedTaskProjectRepository({ userDataPath, platform = process.platform,
  verifyStorage = verifyOwnerOnlyWindowsStorage, runGit = exec } = {}) {
  await assertManagedProjectPhysicalDirectory(userDataPath);
  const filePath = path.join(userDataPath, MANAGED_TASK_PROJECT_DIRECTORY_NAME, FILE_NAME);
  const initial = await fs.lstat(filePath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!initial) return null;
  if (platform === 'win32') assertManagedProjectPrivateReceipt(await verifyStorage(path.dirname(filePath), { operation: 'VERIFY_DIRECTORY' }), 'VERIFY_DIRECTORY');
  else if (((await fs.stat(path.dirname(filePath))).mode & 0o077) !== 0) fail('managed_storage_unverified');
  const before = await verifyManagedProjectPrivateFile(filePath, { platform, verifyStorage });
  if (before.size > 16384 || before.size === 0) fail('configuration_invalid');
  const bytes = await fs.readFile(filePath);
  const after = await fs.lstat(filePath);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) fail('configuration_changed');
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { fail('configuration_invalid'); }
  return verifyRepository(configuration(parsed), { runGit });
}

/** The CLI supplies explicit paths chosen by the operator. Configuration is an
 * immutable local trust decision: same-config replay succeeds; drift requires
 * separate retirement/reconfiguration and never silently replaces a registry.
 * This helper neither provisions DB authority nor admits a task. */
export async function configureManagedTaskProjectRepository({ userDataPath, repository, platform = process.platform,
  protectStorage = protectOwnerOnlyWindowsDirectory, verifyStorage = verifyOwnerOnlyWindowsStorage, runGit = exec } = {}) {
  const expected = configuration(repository);
  const directory = await prepareManagedTaskProjectStorage({ userDataPath, platform, protectStorage, verifyStorage });
  const previous = await readManagedTaskProjectRepository({ userDataPath, platform, verifyStorage, runGit });
  if (previous && JSON.stringify(previous) !== JSON.stringify(expected)) fail('configuration_conflict');
  await assertManagedProjectPhysicalDirectory(expected.repo_root);
  let managedCreated = false;
  const existingManaged = await fs.lstat(expected.managed_root).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!existingManaged) {
    await assertManagedProjectPhysicalDirectory(path.dirname(expected.managed_root));
    await fs.mkdir(expected.managed_root, { mode: 0o700 }); managedCreated = true;
  }
  await assertManagedProjectPhysicalDirectory(expected.managed_root);
  if (platform === 'win32') {
    if (managedCreated) assertManagedProjectPrivateReceipt(await protectStorage(expected.managed_root), 'PROTECT_DIRECTORY');
    else assertManagedProjectPrivateReceipt(await verifyStorage(expected.managed_root, { operation: 'VERIFY_DIRECTORY' }), 'VERIFY_DIRECTORY');
  } else if (((await fs.stat(expected.managed_root)).mode & 0o077) !== 0) fail('managed_storage_unverified');
  await verifyRepository(expected, { runGit });
  const filePath = path.join(directory, FILE_NAME);
  let replayed = false;
  let handle;
  try { handle = await fs.open(filePath, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw error; replayed = true; }
  if (handle) {
    try { await handle.writeFile(`${JSON.stringify(expected, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
  }
  const readback = await readManagedTaskProjectRepository({ userDataPath, platform, verifyStorage, runGit });
  if (JSON.stringify(readback) !== JSON.stringify(expected)) fail('configuration_conflict');
  return Object.freeze({ schema: 'metaengine.devos.managed-project-repository-configuration-receipt.v1',
    configured: true, replayed, private_storage_verified: true, repository_verified: true,
    database_provisioned: false, scheduler_authority: false, authority_effect: false });
}
