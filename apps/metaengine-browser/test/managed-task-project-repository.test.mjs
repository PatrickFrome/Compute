import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configureManagedTaskProjectRepository, readManagedTaskProjectRepository,
  MANAGED_TASK_PROJECT_REPOSITORY_CONFIG_SCHEMA } from '../src/managed-task-project-repository.mjs';

const exec = promisify(execFile);
const verifyStorage = async (_target, { operation = 'VERIFY_FILE' } = {}) => ({ owner_dacl_verified: true, operation });
const unitStorage = { verifyStorage, protectStorage: target => verifyStorage(target, { operation: 'PROTECT_DIRECTORY' }) };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-repository-config-')));
  const userDataPath = path.join(root, 'profile'); const repo = path.join(root, 'repo');
  await fs.mkdir(userDataPath); await fs.mkdir(repo);
  const git = argv => exec('git', argv, { cwd: repo, shell: false, windowsHide: true });
  await git(['init', '-q']); await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, userDataPath, repository: { schema: MANAGED_TASK_PROJECT_REPOSITORY_CONFIG_SCHEMA,
    coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4', repo_id: 'github:test/repo', repo_root: repo,
    managed_root: path.join(userDataPath, 'projects') }, file: path.join(userDataPath, 'managed-task-projects-v1', 'repository.json') };
}

test('explicit operator configuration verifies Git and private physical roots, writes once and accepts exact replay', async t => {
  const h = await fixture(t);
  assert.equal(await readManagedTaskProjectRepository({ userDataPath: h.userDataPath }), null);
  const result = await configureManagedTaskProjectRepository(h);
  assert.equal(result.configured, true); assert.equal(result.replayed, false); assert.equal(result.database_provisioned, false);
  assert.equal(result.private_storage_verified, true); assert.equal(result.authority_effect, false);
  assert.deepEqual(await readManagedTaskProjectRepository({ userDataPath: h.userDataPath }), h.repository);
  const before = await fs.stat(h.file);
  assert.equal((await configureManagedTaskProjectRepository(h)).replayed, true);
  const after = await fs.stat(h.file); assert.equal(before.mtimeMs, after.mtimeMs); assert.equal(before.ino, after.ino);
});

test('repository configuration drift is rejected before creating another managed directory', async t => {
  const h = await fixture(t); await configureManagedTaskProjectRepository({ ...h, ...unitStorage });
  const original = await fs.readFile(h.file, 'utf8'); const candidate = path.join(h.userDataPath, 'other-projects');
  await assert.rejects(configureManagedTaskProjectRepository({ ...h, ...unitStorage, repository: { ...h.repository, managed_root: candidate } }), /configuration_conflict/);
  await assert.rejects(fs.stat(candidate), { code: 'ENOENT' }); assert.equal(await fs.readFile(h.file, 'utf8'), original);
});

test('managed projects cannot live inside the configured repository or enter through a directory alias', async t => {
  const h = await fixture(t);
  await assert.rejects(configureManagedTaskProjectRepository({ ...h, ...unitStorage, repository: { ...h.repository, managed_root: path.join(h.repository.repo_root, 'projects') } }), /managed_root_inside_repository/);
  const alias = path.join(h.root, 'repo-alias'); await fs.symlink(h.repository.repo_root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(configureManagedTaskProjectRepository({ ...h, ...unitStorage, repository: { ...h.repository, repo_root: alias } }), /directory_alias_forbidden/);
  await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
});

test('plain folders, repository subdirectories and unknown config fields cannot become a trusted Git root', async t => {
  const h = await fixture(t); const plain = path.join(h.root, 'plain'); await fs.mkdir(plain);
  await assert.rejects(configureManagedTaskProjectRepository({ ...h, ...unitStorage, repository: { ...h.repository, repo_root: plain } }));
  const child = path.join(h.repository.repo_root, 'child'); await fs.mkdir(child);
  await assert.rejects(configureManagedTaskProjectRepository({ ...h, ...unitStorage, repository: { ...h.repository, repo_root: child } }), /git_root_mismatch/);
  await assert.rejects(configureManagedTaskProjectRepository({ ...h, ...unitStorage, repository: { ...h.repository, service_role: 'forbidden' } }), /configuration_invalid/);
  await assert.rejects(fs.stat(h.file), { code: 'ENOENT' });
});

test('malformed or broadened private configuration is refused without a database callback', async t => {
  const h = await fixture(t); await configureManagedTaskProjectRepository({ ...h, ...unitStorage });
  await assert.rejects(readManagedTaskProjectRepository({ userDataPath: h.userDataPath, platform: 'win32', verifyStorage: async () => ({ owner_dacl_verified: false }) }), /storage_unverified/);
  await fs.writeFile(h.file, '{broken');
  await assert.rejects(readManagedTaskProjectRepository({ userDataPath: h.userDataPath, ...unitStorage }), /configuration_invalid/);
});
