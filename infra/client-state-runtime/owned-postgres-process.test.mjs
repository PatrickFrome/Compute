import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runOwnedPostgresControlProcess, startOwnedWindowsPostgres, windowsPostgresCommandMatches,
  windowsPostgresStartupTimestampsMatch } from './owned-postgres-process.mjs';

const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
const exec = promisify(execFile);

test('owned control completion follows exit while a real descendant retains stdout handles', { timeout: 60000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'compute-owned-control-pipes-')));
  const descendant = path.join(root, 'descendant.mjs');
  const parent = path.join(root, 'parent.mjs');
  await fs.writeFile(descendant, `import fs from 'node:fs';
    const [gate,pidFile]=process.argv.slice(2);
    fs.writeFileSync(pidFile,String(process.pid),{flag:'wx'});
    if(process.send)process.send('ready');
    setInterval(()=>{if(fs.existsSync(gate))process.exit(0)},25);
    setTimeout(()=>process.exit(0),45000);
  `);
  await fs.writeFile(parent, `import {spawn} from 'node:child_process';
    import fs from 'node:fs';
    const [descendant,gate,pidFile]=process.argv.slice(2);
    const child=spawn(process.execPath,[descendant,gate,pidFile],{
      shell:false,windowsHide:true,detached:true,stdio:['ignore','inherit','inherit']});
    child.unref();
    const wait=setInterval(()=>{if(fs.existsSync(pidFile)){clearInterval(wait);process.exit(0)}},25);
  `);
  const gates = ['reference', 'control'].map(name => path.join(root, name + '.stop'));
  const pidFiles = ['reference', 'control'].map(name => path.join(root, name + '.pid'));
  t.after(async () => {
    for (const gate of gates) await fs.writeFile(gate, 'stop');
    for (const pidFile of pidFiles) {
      const pid = Number(await fs.readFile(pidFile, 'utf8').catch(() => '0'));
      if (!pid) continue;
      const deadline = Date.now() + 5000;
      let alive = true;
      do { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
        if (alive) await sleep(25);
      } while (alive && Date.now() < deadline);
      assert.equal(alive, false, 'fixture descendant exited before deleting its private directory');
    }
    assert.equal(path.dirname(root).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase());
    assert(path.basename(root).startsWith('compute-owned-control-pipes-'));
    await fs.rm(root, { recursive: true, force: false });
  });

  let referenceCallbackSettled = false;
  let referenceExitAt = null;
  let referenceCloseAt = null;
  const referenceStarted = Date.now();
  const reference = exec(process.execPath, [parent, descendant, gates[0], pidFiles[0]],
    { shell: false, windowsHide: true, timeout: 30000 });
  reference.child.once('close', () => { referenceCloseAt = Date.now() - referenceStarted; });
  const referenceOutcome = reference.then(() => { referenceCallbackSettled = true; });
  await new Promise((resolve, reject) => {
    reference.child.once('error', reject);
    reference.child.once('exit', (code, signal) => { referenceExitAt = Date.now() - referenceStarted; try { assert.equal(code, 0); assert.equal(signal, null); resolve(); } catch (error) { reject(error); } });
  });
  await sleep(100);
  assert.equal(referenceCallbackSettled, false, `execFile callback waits for descendant-owned stdout handles (exit=${referenceExitAt}ms, close=${referenceCloseAt}ms)`);
  const referencePid = Number(await fs.readFile(pidFiles[0], 'utf8'));
  assert.doesNotThrow(() => process.kill(referencePid, 0));
  await fs.writeFile(gates[0], 'stop');
  await referenceOutcome;

  const started = Date.now();
  await runOwnedPostgresControlProcess(process.execPath, [parent, descendant, gates[1], pidFiles[1]], { timeoutMs: 10000 });
  assert(Date.now() - started < 5000, 'control returns before its timeout with descendant still running');
  const controlPid = Number(await fs.readFile(pidFiles[1], 'utf8'));
  assert.doesNotThrow(() => process.kill(controlPid, 0));
  await assert.rejects(fs.lstat(gates[1]), { code: 'ENOENT' });
  await fs.writeFile(gates[1], 'stop');
});

test('owned control process bounds timeout, cancellation and nonzero exit without public stderr', { timeout: 15000 }, async () => {
  await assert.rejects(runOwnedPostgresControlProcess(process.execPath,
    ['-e', "process.stderr.write('private detail');process.exit(7)"], { timeoutMs: 5000 }),
  { code: 'owned_postgres_control_failed', message: 'owned_postgres_control_failed' });
  const started = Date.now();
  await assert.rejects(runOwnedPostgresControlProcess(process.execPath,
    ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300 }), { code: 'owned_postgres_control_timeout' });
  assert(Date.now() - started < 5000);
  const controller = new AbortController();
  const aborted = runOwnedPostgresControlProcess(process.execPath,
    ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 10000, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(aborted, { code: 'owned_postgres_control_cancelled' });
  await assert.rejects(runOwnedPostgresControlProcess('unavailable', [], { timeoutMs: 1000 }),
    { code: 'owned_postgres_control_failed', message: 'owned_postgres_control_failed' });
});

test('owned startup binds cold PostgreSQL initialization to the exact finite Windows launch window', () => {
  const launchedAt = Date.parse('2026-10-10T21:00:00.000Z');
  const valid = { launchedAt, observedAt: launchedAt + 41000, startupTimeoutMs: 120000,
    processCreatedAt: new Date(launchedAt + 500).toISOString(), postmasterStartIdentity: String((launchedAt + 40000) / 1000) };
  assert.equal(windowsPostgresStartupTimestampsMatch(valid), true, '40 seconds of cold process initialization fits its startup budget');
  assert.equal(windowsPostgresStartupTimestampsMatch({ ...valid, processCreatedAt: new Date(launchedAt + 595).toISOString(),
    postmasterStartIdentity: String(launchedAt / 1000) }), true, 'whole-second pg startup rounds below process creation');
  const invalid = [
    { processCreatedAt: new Date(launchedAt - 3000).toISOString(), postmasterStartIdentity: String((launchedAt - 3000) / 1000) },
    { processCreatedAt: new Date(launchedAt + 5000).toISOString(), postmasterStartIdentity: String(launchedAt / 1000) },
    { startupTimeoutMs: 30000 },
    { postmasterStartIdentity: String((launchedAt + 45000) / 1000) },
    { observedAt: launchedAt + 124000, postmasterStartIdentity: String((launchedAt + 124000) / 1000) },
    { processCreatedAt: new Date(launchedAt + 45000).toISOString() },
    { processCreatedAt: 'invalid' },
    { postmasterStartIdentity: '-1' },
    { postmasterStartIdentity: '0' },
    { postmasterStartIdentity: '1.5' },
    { observedAt: launchedAt - 1 },
  ];
  for (const mutation of invalid) assert.equal(windowsPostgresStartupTimestampsMatch({ ...valid, ...mutation }), false);
});

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
