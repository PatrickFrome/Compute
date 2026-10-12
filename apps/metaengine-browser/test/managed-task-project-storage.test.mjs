import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertManagedProjectPhysicalDirectory, prepareManagedTaskProjectStorage,
  verifyManagedProjectPrivateFile } from '../src/managed-task-project-storage.mjs';
import { verifyOwnerOnlyWindowsStorage } from '../src/private-windows-storage-acl.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-project-storage-')));
  // Scoped package names produce this separator spelling in Electron userData.
  const directory = path.join(root, '@metaengine', 'browser-shell');
  await fs.mkdir(directory, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, directory, userDataPath: path.join(root, '@metaengine') + '/browser-shell' };
}

test('Electron scoped-package userData resolves to one physical private store and survives restart', async t => {
  const h = await fixture(t);
  assert.equal(await assertManagedProjectPhysicalDirectory(h.userDataPath), h.directory);
  const directory = await prepareManagedTaskProjectStorage({ userDataPath: h.userDataPath });
  assert.equal(directory, path.join(h.directory, 'managed-task-projects-v1'));
  assert.equal(directory, await fs.realpath(directory));
  const journal = path.join(directory, 'effects.sqlite');
  await fs.writeFile(journal, 'durable-test-content', { flag: 'wx', mode: 0o600 });
  const before = await verifyManagedProjectPrivateFile(journal);
  assert.equal(await prepareManagedTaskProjectStorage({ userDataPath: h.directory }), directory);
  assert.equal(await prepareManagedTaskProjectStorage({ userDataPath: h.userDataPath }), directory);
  const after = await verifyManagedProjectPrivateFile(journal);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(await fs.readFile(journal, 'utf8'), 'durable-test-content');
});

test('separator normalization preserves denial of relative, traversal, noncanonical and remote paths', async t => {
  const h = await fixture(t);
  for (const directory of [
    'relative/profile', '', null,
    `${h.directory}${path.sep}..${path.sep}browser-shell`,
    `${h.directory}${path.sep}.${path.sep}`,
    `${h.directory}${path.sep}${path.sep}child`,
    `${h.directory}\u0000child`,
    '//server/share/profile', '\\\\server\\share\\profile',
  ]) {
    await assert.rejects(assertManagedProjectPhysicalDirectory(directory), /managed_project_storage_directory_invalid/);
  }
});

test('a mixed-separator userData path through a junction cannot create private state in its target', async t => {
  const h = await fixture(t);
  const alias = path.join(h.root, 'alias');
  await fs.symlink(path.dirname(h.directory), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const userDataPath = alias + '/browser-shell';
  await assert.rejects(prepareManagedTaskProjectStorage({ userDataPath }), /managed_project_storage_directory_alias_forbidden/);
  await assert.rejects(fs.stat(path.join(h.directory, 'managed-task-projects-v1')), { code: 'ENOENT' });
});

test('an existing broad NTFS store remains rejected after separator normalization without DACL repair', {
  skip: process.platform !== 'win32',
}, async t => {
  const h = await fixture(t);
  const directory = await prepareManagedTaskProjectStorage({ userDataPath: h.userDataPath });
  await promisify(execFile)(path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT, 'System32', 'icacls.exe'),
    [directory, '/grant', '*S-1-1-0:(R)'], { shell: false, windowsHide: true, timeout: 120000, maxBuffer: 8192 });
  let protectedAgain = 0;
  const verifyBefore = await verifyOwnerOnlyWindowsStorage(directory, { operation: 'VERIFY_DIRECTORY' })
    .then(() => true, () => false);
  assert.equal(verifyBefore, false, 'a real Everyone grant fails private-storage verification');
  await assert.rejects(prepareManagedTaskProjectStorage({ userDataPath: h.userDataPath,
    protectStorage: async () => { protectedAgain++; throw Error('unexpected_acl_repair'); },
  }), /private_windows_storage_acl_not_confirmed/);
  assert.equal(protectedAgain, 0);
});
