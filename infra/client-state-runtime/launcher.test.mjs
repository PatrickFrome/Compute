import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { configFromEnvironment, launchClientStateRuntime, normalizeLauncherConfig, runtimeEnvironment } from './launcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'launcher-fixture.mjs');

async function bind(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}

async function freePort() {
  const { server, port } = await bind();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function setup(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'compute-launcher-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const databasePort = await freePort();
  await writeFile(path.join(dataDir, 'postmaster.pid'), `${process.pid}\n${dataDir}\n0\n${databasePort}\n127.0.0.1\n`);
  const input = {
    mode: 'local',
    postgresMode: 'attached',
    databaseUrl: `postgresql://test:test-password@127.0.0.1:${databasePort}/test`,
    pgBinDir: here,
    pgDataDir: dataDir,
    denoPath: process.execPath,
    apiPort: await freePort(),
    edgePort: await freePort(),
    healthIntervalMs: 100,
    startupTimeoutMs: 10000,
  };
  const identity = { data_directory: dataDir, version: 170006, address: '127.0.0.1', port: databasePort, started_at: '2026-10-07T12:00:00Z' };
  const events = [];
  const hooks = {
    inspectPostgres: async () => ({ ...identity }),
    apiCommand: { command: process.execPath, args: [fixture, 'api'] },
    edgeCommand: { command: process.execPath, args: [fixture, 'edge'] },
    report: event => events.push(event),
  };
  return { input, hooks, identity, events };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('requires local mode, explicit PostgreSQL ownership, loopback URL and distinct ports', () => {
  const good = {
    mode: 'local', postgresMode: 'attached',
    databaseUrl: 'postgresql://test:secret@127.0.0.1:15434/test',
    pgBinDir: here, pgDataDir: here, denoPath: process.execPath,
  };
  assert.equal(normalizeLauncherConfig(good).apiPort, 15432);
  for (const mutation of [
    { mode: undefined }, { postgresMode: undefined },
    { databaseUrl: 'postgresql://test:secret@host.supabase.co:15434/test' },
    { databaseUrl: 'postgresql://test:secret@localhost:15434/test' },
    { databaseUrl: 'postgresql://test:secret@127.0.0.1:15434/test?host=remote' },
    { inspectDatabaseUrl: 'postgresql://test:secret@remote:15434/postgres' },
    { inspectDatabaseUrl: 'postgresql://test:secret@127.0.0.1:15435/postgres' },
    { apiPort: 15434 }, { edgePort: 15432 }, { apiKey: 'insecure' },
    { denoDir: 'relative-cache' }, { expectedStartupSourceSha256: 'bad' },
  ]) assert.throws(() => normalizeLauncherConfig({ ...good, ...mutation }));
});

test('owned server environment removes loader injection and unrelated access tokens', () => {
  const names = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'ELECTRON_RUN_AS_NODE', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'DENO_V8_FLAGS', 'DENO_DIR', 'DENO_AUTH_TOKENS'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'must-not-reach-server';
    const env = runtimeEnvironment({ instanceId: 'test', databaseUrl: 'postgres://local', apiKey: 'local-key', apiPort: 15432, edgePort: 15433 });
    for (const name of names) assert.equal(Object.hasOwn(env, name), false, name);
    assert.equal(env.LOCAL_STATE_API_KEY, 'local-key');
    assert.equal(env.LOCAL_STATE_RUNTIME, 'LOCAL_POSTGRES');
    const selected = runtimeEnvironment({ instanceId: 'test', denoDir: here });
    assert.equal(selected.DENO_DIR, here);
    assert.equal(Object.hasOwn(selected, 'DENO_AUTH_TOKENS'), false);
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});

test('environment configuration remains valid when launch normalizes it again', () => {
  const configured = configFromEnvironment({ LOCAL_STATE_MODE: 'local', LOCAL_STATE_POSTGRES_MODE: 'owned',
    LOCAL_STATE_DATABASE_URL: 'postgresql://test:synthetic@127.0.0.1:15434/test', LOCAL_STATE_PG_BIN_DIR: here,
    LOCAL_STATE_PG_DATA_DIR: here, LOCAL_STATE_DENO_PATH: process.execPath });
  const normalized = normalizeLauncherConfig(configured);
  assert.deepEqual(normalized, configured, 'normalizing an already normalized configuration must preserve identity and secrets');
  assert.throws(() => normalizeLauncherConfig({ ...configured, instanceId: 'not-a-uuid' }), /runtime_instance_id_invalid/);
});

test('automatic child-exit cleanup reports an unconfirmed stop without an unhandled rejection', async t => {
  const { input, hooks } = await setup(t);
  const originalSpawn = childProcess.spawn;
  let apiChild;
  let terminateApi;
  let runtime;
  const rejections = [];
  const onUnhandled = error => rejections.push(error);
  const restoreSpawn = () => { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); };
  try {
    // Start real fixture children, then model an OS refusal to terminate the
    // API through its owned handle. The original handle remains available for
    // test-only cleanup after the launcher reports the failure.
    childProcess.spawn = (...argumentsList) => {
      const child = originalSpawn(...argumentsList);
      if (argumentsList[1]?.includes(fixture) && argumentsList[1]?.includes('api')) {
        apiChild = child;
        terminateApi = child.kill.bind(child);
        child.kill = () => false;
      }
      return child;
    };
    syncBuiltinESMExports();
    process.on('unhandledRejection', onUnhandled);
    runtime = await launchClientStateRuntime(input, hooks);
    restoreSpawn();
    assert.ok(apiChild);
    process.kill(runtime.children.find(child => child.name === 'edge').pid, 'SIGTERM');
    assert.deepEqual(await runtime.finished, { reason: 'runtime_cleanup_unconfirmed', children_stopped: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(rejections, []);
    assert.equal(alive(apiChild.pid), true, 'failure reports the still-running owned child');
  } finally {
    restoreSpawn();
    process.removeListener('unhandledRejection', onUnhandled);
    if (apiChild && apiChild.exitCode === null && apiChild.signalCode === null) {
      const ended = new Promise(resolve => apiChild.once('exit', resolve));
      terminateApi('SIGTERM');
      await ended;
    }
    await runtime?.stop();
  }
});

test('an already cancelled startup refuses all children', async t => {
  const { input, hooks, events } = await setup(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(launchClientStateRuntime({ ...input, signal: controller.signal }, hooks), /runtime_startup_cancelled/);
  assert.equal(events.some(event => event.event === 'spawned'), false);
});

test('a startup source pin mismatch refuses every child before launch', async t => {
  const { input, hooks, events } = await setup(t);
  input.expectedStartupSourceSha256 = '0'.repeat(64);
  await assert.rejects(launchClientStateRuntime(input, hooks), /startup_source_pin_mismatch/);
  assert.equal(events.some(event => event.event === 'spawned'), false);
  assert(alive(process.pid));
});

test('starts real owned API/edge children and stops only those children', async t => {
  const { input, hooks, events } = await setup(t);
  const runtime = await launchClientStateRuntime(input, hooks);
  t.after(() => runtime.stop());
  assert.equal(runtime.children.length, 2);
  assert(runtime.children.every(child => alive(child.pid)));
  assert.equal(runtime.postgresIdentity.pid, process.pid);
  assert.match(runtime.endpoint, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(events.at(-1).event, 'ready');
  assert(!JSON.stringify(events).includes('test-password'));
  const startup = JSON.parse(await readFile(runtime.startupManifestPath, 'utf8'));
  assert.equal(startup.instance_id, runtime.instanceId);
  assert.equal(startup.source_manifest_sha256, runtime.startupManifest.source_manifest_sha256);
  assert.equal(startup.stable_during_startup, true);
  assert.equal(startup.source.policy.dependency_policy, 'FIXTURE_COMMANDS');
  await runtime.stop();
  assert(runtime.children.every(child => !alive(child.pid)));
  assert(alive(process.pid));
});

test('an occupied API port fails without terminating or replacing its owner', async t => {
  const { input, hooks, events } = await setup(t);
  const occupied = await bind(input.apiPort);
  t.after(() => new Promise(resolve => occupied.server.close(resolve)));
  await assert.rejects(launchClientStateRuntime(input, hooks), /occupied/);
  assert.equal(occupied.server.listening, true);
  assert.equal(events.filter(event => event.event === 'spawned').length, 0);
});

test('health cannot mistake a different instance for the child just launched', async t => {
  const { input, hooks, events } = await setup(t);
  const previous = process.env.LAUNCHER_TEST_WRONG_INSTANCE;
  process.env.LAUNCHER_TEST_WRONG_INSTANCE = 'api';
  try {
    await assert.rejects(launchClientStateRuntime(input, hooks), /api_instance_mismatch/);
    assert(events.filter(event => event.event === 'spawned').every(event => !alive(event.pid)));
    assert(alive(process.pid));
  } finally {
    if (previous === undefined) delete process.env.LAUNCHER_TEST_WRONG_INSTANCE;
    else process.env.LAUNCHER_TEST_WRONG_INSTANCE = previous;
  }
});

test('a child exit closes the other child and preserves attached PostgreSQL', async t => {
  const { input, hooks } = await setup(t);
  const runtime = await launchClientStateRuntime(input, hooks);
  t.after(() => runtime.stop());
  process.kill(runtime.children.find(child => child.name === 'edge').pid, 'SIGTERM');
  const result = await runtime.finished;
  assert.equal(result.reason, 'edge_exited');
  assert(runtime.children.every(child => !alive(child.pid)));
  assert(alive(process.pid));
});

test('HTTP liveness without database source attestation cannot produce a ready runtime', async t => {
  const { input, hooks, events } = await setup(t);
  input.startupTimeoutMs = 5000;
  const previous = process.env.LAUNCHER_TEST_UNATTESTED;
  process.env.LAUNCHER_TEST_UNATTESTED = '1';
  try {
    await assert.rejects(launchClientStateRuntime(input, hooks), /edge_readiness_timeout/);
    assert.equal(events.some(event => event.event === 'ready'), false);
    assert(events.filter(event => event.event === 'spawned').every(event => !alive(event.pid)));
    assert(alive(process.pid));
  } finally {
    if (previous === undefined) delete process.env.LAUNCHER_TEST_UNATTESTED;
    else process.env.LAUNCHER_TEST_UNATTESTED = previous;
  }
});

test('a PostgreSQL incarnation change fails closed instead of adopting another server', async t => {
  const { input, hooks, identity } = await setup(t);
  const runtime = await launchClientStateRuntime(input, hooks);
  t.after(() => runtime.stop());
  identity.started_at = '2026-10-07T13:00:00Z';
  const result = await Promise.race([
    runtime.finished,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('monitor_timeout')), 5000);
      timer.unref();
    }),
  ]);
  assert.equal(result.reason, 'runtime_health_failed');
  assert(runtime.children.every(child => !alive(child.pid)));
  assert(alive(process.pid));
});
