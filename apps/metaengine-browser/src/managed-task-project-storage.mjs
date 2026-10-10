import fs from 'node:fs/promises';
import path from 'node:path';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';

export const MANAGED_TASK_PROJECT_DIRECTORY_NAME = 'managed-task-projects-v1';
const fail = code => { throw new Error(`managed_project_storage_${code}`); };

export async function assertManagedProjectPhysicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory
      || directory.length > 2048 || /^(?:\\\\|\/\/)/.test(directory) || /[\x00-\x1f]/.test(directory)) fail('directory_invalid');
  let current = path.parse(directory).root;
  for (const part of path.relative(current, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('directory_alias_forbidden');
  }
  if (await fs.realpath(directory) !== directory) fail('directory_alias_forbidden');
}

export function assertManagedProjectPrivateReceipt(receipt, operation) {
  if (receipt?.owner_dacl_verified !== true || receipt.operation !== operation) fail('unverified');
}

/** Only the dedicated child directory receives a new DACL. Existing ACLs must
 * already be private and are verified without broadening or repairing them. */
export async function prepareManagedTaskProjectStorage({ userDataPath, platform = process.platform,
  protectStorage = protectOwnerOnlyWindowsDirectory, verifyStorage = verifyOwnerOnlyWindowsStorage } = {}) {
  if (!['win32', 'linux', 'darwin'].includes(platform)) fail('platform_unsupported');
  await assertManagedProjectPhysicalDirectory(userDataPath);
  const directory = path.join(userDataPath, MANAGED_TASK_PROJECT_DIRECTORY_NAME);
  let created = false;
  try { await fs.mkdir(directory, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await assertManagedProjectPhysicalDirectory(directory);
  if (platform === 'win32') {
    if (created) assertManagedProjectPrivateReceipt(await protectStorage(directory), 'PROTECT_DIRECTORY');
    else assertManagedProjectPrivateReceipt(await verifyStorage(directory, { operation: 'VERIFY_DIRECTORY' }), 'VERIFY_DIRECTORY');
  } else if (((await fs.stat(directory)).mode & 0o077) !== 0) fail('unverified');
  return directory;
}

export async function verifyManagedProjectPrivateFile(filePath, { platform = process.platform,
  verifyStorage = verifyOwnerOnlyWindowsStorage } = {}) {
  await assertManagedProjectPhysicalDirectory(path.dirname(filePath));
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('file_alias_forbidden');
  if (platform === 'win32') assertManagedProjectPrivateReceipt(await verifyStorage(filePath), 'VERIFY_FILE');
  else if ((stat.mode & 0o077) !== 0) fail('unverified');
  return stat;
}
