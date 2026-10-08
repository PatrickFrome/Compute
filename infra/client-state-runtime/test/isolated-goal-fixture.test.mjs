import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { assertFixturePortsClosed, assertOwnedFixtureDirectory, createFixtureLifecycle, goalFixtureConfig, schemaOnlyRestorePlan } from './isolated-goal-fixture.mjs';

const config = () => ({
  LOCAL_STATE_TEST_GOAL_BACKUP_DIRECTORY: path.resolve(os.tmpdir(), 'private-archive'),
  LOCAL_STATE_TEST_GOAL_DUMP_SHA256: 'a'.repeat(64),
  LOCAL_STATE_TEST_PG_BIN_DIR: path.resolve(os.tmpdir(), 'pgsql/bin'),
  LOCAL_STATE_TEST_DENO_PATH: path.resolve(os.tmpdir(), 'deno'),
});

test('goal integration opts in with pinned archive and no caller-supplied connection', () => {
  assert.equal(goalFixtureConfig({}), null);
  assert.equal(goalFixtureConfig({ LOCAL_STATE_TEST_PG_BIN_DIR: '/other-test', LOCAL_STATE_TEST_ADMIN_DATABASE_URL: 'postgres://local/main' }), null);
  assert.equal(goalFixtureConfig(config()).expectedDumpSha256, 'a'.repeat(64));
  assert.throws(() => goalFixtureConfig({ LOCAL_STATE_TEST_GOAL_DUMP_SHA256: 'a'.repeat(64) }), /configuration_incomplete/);
  assert.throws(() => goalFixtureConfig({ ...config(), LOCAL_STATE_TEST_ADMIN_DATABASE_URL: 'postgres://local/production' }), /external_connection_configuration_forbidden/);
  assert.throws(() => goalFixtureConfig({ ...config(), LOCAL_STATE_TEST_SUPERVISOR_URL: 'http://127.0.0.1:15433' }), /external_connection_configuration_forbidden/);
  assert.throws(() => goalFixtureConfig({ ...config(), LOCAL_STATE_TEST_GOAL_BACKUP_DIRECTORY: 'relative' }), /absolute_paths_required/);
  assert.throws(() => goalFixtureConfig({ ...config(), LOCAL_STATE_TEST_GOAL_DUMP_SHA256: 'not-a-digest' }), /dump_digest_invalid/);
});

test('schema-only archive plan excludes data, triggers and external connectors', () => {
  const toc = '; Dumped from database version: 17.6\n' + [
    '1; 2615 1 SCHEMA - public postgres',
    '2; 2615 2 SCHEMA - extensions postgres',
    '3; 3079 3 EXTENSION - supabase_vault ',
    '4; 1259 4 TABLE public synthetic postgres',
    '5; 0 4 TABLE DATA public synthetic postgres',
    '6; 0 5 SEQUENCE SET public synthetic_id_seq postgres',
    '7; 0 6 MATERIALIZED VIEW DATA public cached postgres',
    '8; 3466 7 EVENT TRIGGER - pgrst_ddl_watch postgres',
    '9; 2328 8 SERVER - remote postgres',
    '10; 6100 9 SUBSCRIPTION - remote postgres',
    '11; 0 10 BLOB - 100 postgres',
  ].join('\n');
  const plan = schemaOnlyRestorePlan(toc);
  assert.equal(plan.selected.length, 2);
  assert.equal(plan.omitted.length, 9);
  assert.equal(plan.table_data_restored, false);
  assert.equal(plan.sequence_values_restored, false);
  assert.throws(() => schemaOnlyRestorePlan('; Dumped from database version: 16.9'), /pg17_archive_required/);
  assert.throws(() => schemaOnlyRestorePlan('; Dumped from database version: 17.6\nbad entry'), /archive_toc_invalid/);
});

test('fixture cleanup requires canonical temporary root and exact owned marker', async () => {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await realpath(await mkdtemp(path.join(temporaryRoot, 'compute-goal-fixture-')));
  const markerId = randomUUID();
  try {
    const marker = { schema: 'compute.owned-goal-fixture.v1', id: markerId, purpose: 'synthetic-goal-schema-only' };
    await writeFile(path.join(directory, 'owned-goal-fixture.json'), JSON.stringify(marker));
    assert.equal(await assertOwnedFixtureDirectory({ directory, temporaryRoot, markerId }), directory);
    await assert.rejects(assertOwnedFixtureDirectory({ directory, temporaryRoot, markerId: randomUUID() }), /cleanup_marker_mismatch/);
    await assert.rejects(assertOwnedFixtureDirectory({ directory: temporaryRoot, temporaryRoot, markerId }), /cleanup_target_outside_temporary_root/);
    await mkdir(path.join(directory, 'actual'));
    await symlink(path.join(directory, 'actual'), path.join(directory, 'compute-goal-fixture-alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertOwnedFixtureDirectory({ directory: path.join(directory, 'compute-goal-fixture-alias'), temporaryRoot: directory, markerId }), /cleanup_alias_forbidden/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('whole-runtime restart requires all three qualified loopback ports closed', async () => {
  const servers = [];
  const ports = [];
  try {
    for (let count = 0; count < 3; count += 1) {
      const server = net.createServer(socket => socket.destroy());
      servers.push(server);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      ports.push(server.address().port);
    }
    await assert.rejects(assertFixturePortsClosed(ports), /restart_port_still_open/);
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    await assertFixturePortsClosed(ports);
    await assert.rejects(assertFixturePortsClosed([ports[0], ports[0], ports[2]]), /restart_ports_invalid/);
    await assert.rejects(assertFixturePortsClosed([0, -1, 80]), /restart_ports_invalid/);
  } finally {
    for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});

test('fixture lifecycle rejects concurrent restarts and shares cleanup after a pending restart', async () => {
  let finishRestart;
  let stopCount = 0;
  const lifecycle = createFixtureLifecycle({ restart: () => new Promise(resolve => { finishRestart = resolve; }),
    stop: async () => { stopCount += 1; } });
  const restarting = lifecycle.restart();
  await Promise.resolve();
  await assert.rejects(lifecycle.restart(), /restart_state_invalid/);
  const stopping = lifecycle.stop();
  assert.equal(lifecycle.stop(), stopping);
  assert.equal(stopCount, 0);
  await assert.rejects(lifecycle.restart(), /restart_state_invalid/);
  finishRestart('restarted');
  assert.equal(await restarting, 'restarted');
  await stopping;
  await lifecycle.stop();
  assert.equal(stopCount, 1);
});

test('failed restart releases its guard; failed cleanup is retried without admitting restart', async () => {
  let restartCount = 0;
  let stopCount = 0;
  const lifecycle = createFixtureLifecycle({ restart: async () => {
    restartCount += 1;
    if (restartCount === 1) throw new Error('vault_hash_failed');
    return 'restarted';
  }, stop: async () => { stopCount += 1; if (stopCount === 1) throw new Error('cleanup_unconfirmed'); } });
  await assert.rejects(lifecycle.restart(), /vault_hash_failed/);
  assert.equal(await lifecycle.restart(), 'restarted');
  await assert.rejects(lifecycle.stop(), /cleanup_unconfirmed/);
  await assert.rejects(lifecycle.restart(), /restart_state_invalid/);
  await lifecycle.stop();
  assert.equal(stopCount, 2);
});

test('a synchronous preflight exception releases restart ownership before a retry', async () => {
  let attempts = 0;
  const lifecycle = createFixtureLifecycle({ restart: () => {
    attempts += 1;
    if (attempts === 1) throw new Error('vault_hash_failed');
    return 'restarted';
  }, stop: () => {} });
  const failed = lifecycle.restart();
  await assert.rejects(lifecycle.restart(), /restart_state_invalid/);
  await assert.rejects(failed, /vault_hash_failed/);
  assert.equal(await lifecycle.restart(), 'restarted');
  assert.equal(attempts, 2);
  await lifecycle.stop();
});

test('cleanup waits for rejected restart preflight and can retry a synchronous stop failure', async () => {
  let rejectPreflight;
  let stopCount = 0;
  const lifecycle = createFixtureLifecycle({ restart: () => new Promise((resolve, reject) => { rejectPreflight = reject; }),
    stop: () => {
      stopCount += 1;
      if (stopCount === 1) throw new Error('cleanup_unconfirmed');
    } });
  const restarting = lifecycle.restart();
  await Promise.resolve();
  const stopping = lifecycle.stop();
  const restartFailure = assert.rejects(restarting, /vault_hash_failed/);
  const stopFailure = assert.rejects(stopping, /cleanup_unconfirmed/);
  assert.equal(lifecycle.stop(), stopping);
  await Promise.resolve();
  assert.equal(stopCount, 0, 'cleanup must not overlap restart preflight');
  rejectPreflight(new Error('vault_hash_failed'));
  await restartFailure;
  await stopFailure;
  await assert.rejects(lifecycle.restart(), /restart_state_invalid/);
  await lifecycle.stop();
  assert.equal(stopCount, 2);
});
