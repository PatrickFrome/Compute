import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, lstat, link, realpath, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLocalVaultKey } from './local-vault-key.mjs';

test('vault key is random, private and stable across repeated initialization', async () => {
  const fixturePath = await mkdtemp(join(tmpdir(), 'compute-vault-key-'));
  // Windows runners can expose TEMP through an 8.3 alias; production requires canonical paths.
  const dir = await realpath(fixturePath);
  try {
    await writeFile(join(dir, 'PG_VERSION'), '17\n');
    if (process.platform === 'win32' && fixturePath.toLowerCase() !== dir.toLowerCase()) {
      await assert.rejects(initializeLocalVaultKey({ dataDirectory: fixturePath }), /data_directory_invalid/);
    }
    const first = await initializeLocalVaultKey({ dataDirectory: dir });
    const bytes = await readFile(first.key_file, 'utf8');
    assert.equal(first.created, true);
    assert.match(bytes, /^[a-f0-9]{64}\n$/);
    const second = await initializeLocalVaultKey({ dataDirectory: dir });
    assert.equal(second.created, false);
    assert.equal(await readFile(second.key_file, 'utf8'), bytes);
    if (process.platform !== 'win32') assert.equal((await lstat(first.key_file)).mode & 0o777, 0o600);
    assert.equal(first.plaintext_key_logged, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('vault key rejects invalid data directories and aliased key files', async () => {
  await assert.rejects(initializeLocalVaultKey({ dataDirectory: 'relative/path' }), /absolute_required/);
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'compute-vault-key-invalid-')));
  try {
    await writeFile(join(dir, 'PG_VERSION'), '16\n');
    await assert.rejects(initializeLocalVaultKey({ dataDirectory: dir }), /pg17_data_directory_required/);
    await writeFile(join(dir, 'PG_VERSION'), '17\n');
    await writeFile(join(dir, 'original-key'), 'a'.repeat(64) + '\n');
    await link(join(dir, 'original-key'), join(dir, 'client-vault.key'));
    await assert.rejects(initializeLocalVaultKey({ dataDirectory: dir }), /key_file_invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('vault key rejects a PGDATA directory reached through a junction or symlink', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'compute-vault-key-alias-')));
  try {
    const actual = join(dir, 'actual');
    await mkdir(join(actual, 'pgdata'), { recursive: true });
    await writeFile(join(actual, 'pgdata/PG_VERSION'), '17\n');
    await symlink(actual, join(dir, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(initializeLocalVaultKey({ dataDirectory: join(dir, 'alias/pgdata') }), /data_directory_invalid/);
    await assert.rejects(lstat(join(actual, 'pgdata/client-vault.key')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
