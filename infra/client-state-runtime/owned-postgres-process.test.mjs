import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startOwnedWindowsPostgres, windowsPostgresCommandMatches } from './owned-postgres-process.mjs';

test('restricted launcher identity requires exact Windows argv for executable, PGDATA, loopback and port', () => {
  const expected = { postgresExecutable: 'C:\\Program Files\\PG17\\postgres.exe',
    pgDataDir: 'C:\\Private State\\owned-cluster', databasePort: 49152 };
  const command = '"C:\\Program Files\\PG17\\postgres.exe" -D "C:\\Private State\\owned-cluster" -h 127.0.0.1 -p 49152';
  assert.equal(windowsPostgresCommandMatches(command, expected), true);
  assert.equal(windowsPostgresCommandMatches(command.replaceAll('\\', '/'), expected), true,
    'pg_ctl canonicalizes the -D directory to forward slashes on Windows');
  for (const changed of [
    command.replace('owned-cluster', 'foreign-cluster'),
    command.replace('49152', '49153'),
    command.replace('127.0.0.1', '0.0.0.0'),
    command.replace('PG17', 'PG16'),
    command + ' -c unrelated="C:\\Private State\\owned-cluster"',
    command + '"',
  ]) assert.equal(windowsPostgresCommandMatches(changed, expected), false);
});

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-owned-pg-refusal-')));
  const bin = path.join(root, 'bin');
  const data = path.join(root, 'data');
  await fs.mkdir(bin); await fs.mkdir(data);
  // Admission failures must occur before any of these non-executables run.
  for (const name of ['postgres', 'pg_ctl', 'pg_isready']) await fs.writeFile(path.join(bin, name + '.exe'), 'fixture executable must never run');
  t.after(async () => {
    assert.equal(path.dirname(root).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
    assert(path.basename(root).startsWith('compute-owned-pg-refusal-'));
    await fs.rm(root, { recursive: true, force: false });
  });
  return { root, bin, data };
}

test('Windows owned PostgreSQL refuses an existing PID file without changing the private cluster', {
  skip: process.platform !== 'win32',
}, async t => {
  const { bin, data } = await fixture(t);
  const pidFile = path.join(data, 'postmaster.pid');
  const prior = `${process.pid}\n${data}\n1\n49152\n`;
  await fs.writeFile(pidFile, prior);
  await assert.rejects(startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: 49152 }),
    { code: 'owned_postgres_existing_pid_file' });
  assert.equal(await fs.readFile(pidFile, 'utf8'), prior);
  assert.deepEqual(await fs.readdir(data), ['postmaster.pid']);
});

test('Windows owned PostgreSQL refuses a live foreign endpoint and leaves it running', {
  skip: process.platform !== 'win32',
}, async t => {
  const { bin, data } = await fixture(t);
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port }),
    { code: 'owned_postgres_existing_endpoint' });
  assert.equal(server.listening, true);
  assert.deepEqual(await fs.readdir(data), []);
});

test('Windows owned PostgreSQL keeps diagnostics inside its private data directory', {
  skip: process.platform !== 'win32',
}, async t => {
  const { root, bin, data } = await fixture(t);
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(startOwnedWindowsPostgres({ pgBinDir: bin, pgDataDir: data, databasePort: port,
    logFile: path.join(root, 'public.log') }), { code: 'owned_postgres_private_log_invalid' });
  assert.deepEqual(await fs.readdir(data), []);
  await assert.rejects(fs.lstat(path.join(root, 'public.log')), { code: 'ENOENT' });
});

test('Windows owned PostgreSQL rejects an already-cancelled launch before reading or writing state', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startOwnedWindowsPostgres({ pgBinDir: 'unavailable', pgDataDir: 'unavailable',
    databasePort: 49152, signal: controller.signal }),
  { code: process.platform === 'win32' ? 'owned_postgres_startup_cancelled' : 'owned_postgres_windows_required' });
});

test('Windows owned PostgreSQL refuses a junction ancestor before starting a process', {
  skip: process.platform !== 'win32',
}, async t => {
  const { root, bin, data } = await fixture(t);
  const alias = path.join(root, 'alias');
  await fs.symlink(root, alias, 'junction');
  // Remove the junction before the recursive, marker-scoped fixture removal.
  try {
    await assert.rejects(startOwnedWindowsPostgres({ pgBinDir: bin,
      pgDataDir: path.join(alias, path.basename(data)), databasePort: 49152 }),
    { code: 'owned_postgres_data_directory_invalid' });
  } finally { await fs.unlink(alias); }
  assert.deepEqual(await fs.readdir(data), []);
});
