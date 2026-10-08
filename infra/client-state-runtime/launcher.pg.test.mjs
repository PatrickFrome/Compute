import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { launchClientStateRuntime } from './launcher.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'launcher-fixture.mjs');
const bin = process.env.LOCAL_STATE_TEST_PG_BIN_DIR;
const executable = name => path.join(bin, process.platform === 'win32' ? `${name}.exe` : name);

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}

test('owned portable PostgreSQL 17 is qualified, cleanly stopped and restarted with durable data', { skip: !bin, timeout: 60000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'compute-owned-pg-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const dataDir = path.join(temporary, 'data');
  const passwordFile = path.join(temporary, 'password');
  const password = randomBytes(24).toString('hex');
  await writeFile(passwordFile, password, { mode: 0o600 });
  await exec(executable('initdb'), ['-D', dataDir, '--username=postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--no-locale'], { windowsHide: true, timeout: 30000 });
  const databasePort = await freePort();
  const config = {
    mode: 'local', postgresMode: 'owned',
    databaseUrl: `postgresql://postgres:${password}@127.0.0.1:${databasePort}/postgres`,
    pgBinDir: bin, pgDataDir: dataDir, denoPath: process.execPath,
    apiPort: await freePort(), edgePort: await freePort(), startupTimeoutMs: 15000,
  };
  const hooks = {
    apiCommand: { command: process.execPath, args: [fixture, 'api'] },
    edgeCommand: { command: process.execPath, args: [fixture, 'edge'] },
  };
  const query = async text => {
    const result = await exec(executable('psql'), ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-At', '-c', text], {
      windowsHide: true, timeout: 5000,
      env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(databasePort), PGUSER: 'postgres', PGPASSWORD: password, PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3' },
    });
    return result.stdout.trim();
  };

  const first = await launchClientStateRuntime(config, hooks);
  t.after(() => first.stop());
  assert.equal(first.postgresIdentity.pid, first.children.find(child => child.name === 'postgres').pid);
  assert.equal(first.postgresIdentity.version >= 170000 && first.postgresIdentity.version < 180000, true);
  await query('CREATE TABLE durability_probe(value integer); INSERT INTO durability_probe VALUES(17)');
  await first.stop();
  await assert.rejects(readFile(path.join(dataDir, 'postmaster.pid')), { code: 'ENOENT' });

  const second = await launchClientStateRuntime(config, hooks);
  t.after(() => second.stop());
  assert.notEqual(second.instanceId, first.instanceId);
  assert.equal(await query('SELECT value FROM durability_probe'), '17');
  await second.stop();
  await assert.rejects(readFile(path.join(dataDir, 'postmaster.pid')), { code: 'ENOENT' });
});
