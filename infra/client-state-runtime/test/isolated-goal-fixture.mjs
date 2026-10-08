import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { provisionLocalApiLogin } from '../db-api-grants.mjs';
import { quoteIdentifier } from '../db-api-core.mjs';
import { launchClientStateRuntime } from '../launcher.mjs';
import { initializeLocalVaultKey } from '../local-vault-key.mjs';
import { applyLocalRuntimeMigrations } from '../local-runtime-migrations.mjs';

const PREFIX = 'compute-goal-fixture-';
const MARKER = 'owned-goal-fixture.json';
const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
const fail = code => { throw new Error('goal_fixture_' + code); };

export function goalFixtureConfig(env = process.env) {
  const names = ['LOCAL_STATE_TEST_GOAL_BACKUP_DIRECTORY', 'LOCAL_STATE_TEST_GOAL_DUMP_SHA256',
    'LOCAL_STATE_TEST_PG_BIN_DIR', 'LOCAL_STATE_TEST_DENO_PATH'];
  if (!env.LOCAL_STATE_TEST_GOAL_BACKUP_DIRECTORY && !env.LOCAL_STATE_TEST_GOAL_DUMP_SHA256) return null;
  if (names.some(name => !env[name])) fail('configuration_incomplete');
  for (const name of ['LOCAL_STATE_TEST_ADMIN_DATABASE_URL', 'LOCAL_STATE_TEST_DATABASE_URL',
    'LOCAL_STATE_TEST_SUPERVISOR_URL', 'LOCAL_STATE_DATABASE_URL', 'LOCAL_STATE_INSPECT_DATABASE_URL']) {
    if (env[name]) fail('external_connection_configuration_forbidden');
  }
  for (const name of names.filter(name => !name.endsWith('SHA256'))) {
    if (!path.isAbsolute(env[name])) fail('absolute_paths_required');
  }
  if (!/^[a-f0-9]{64}$/.test(env.LOCAL_STATE_TEST_GOAL_DUMP_SHA256)) fail('dump_digest_invalid');
  if (env.LOCAL_STATE_TEST_DENO_DIR && !path.isAbsolute(env.LOCAL_STATE_TEST_DENO_DIR)) fail('absolute_paths_required');
  return {
    backupDirectory: path.resolve(env.LOCAL_STATE_TEST_GOAL_BACKUP_DIRECTORY),
    expectedDumpSha256: env.LOCAL_STATE_TEST_GOAL_DUMP_SHA256,
    pgBinDir: path.resolve(env.LOCAL_STATE_TEST_PG_BIN_DIR),
    denoPath: path.resolve(env.LOCAL_STATE_TEST_DENO_PATH),
    denoDirectory: env.LOCAL_STATE_TEST_DENO_DIR ? path.resolve(env.LOCAL_STATE_TEST_DENO_DIR) : undefined,
  };
}

export function schemaOnlyRestorePlan(toc) {
  if (typeof toc !== 'string' || !toc.includes('Dumped from database version: 17.')) fail('pg17_archive_required');
  const omitted = [];
  const selected = [];
  for (const line of toc.split(/\r?\n/)) {
    if (!line || line.startsWith(';')) continue;
    if (!/^\d+; \d+ \d+ /.test(line)) fail('archive_toc_invalid');
    const data = / (?:TABLE DATA|MATERIALIZED VIEW DATA|SEQUENCE SET|BLOBS?|LARGE OBJECT(?: DATA)?) /.test(line);
    const adaptation = / SCHEMA - (?:extensions|vault) /.test(line)
      || / EXTENSION - (?:pgcrypto|supabase_vault) /.test(line)
      || / COMMENT - EXTENSION supabase_vault /.test(line)
      || / EVENT TRIGGER /.test(line)
      || / (?:SUBSCRIPTION|USER MAPPING|SERVER|FOREIGN DATA WRAPPER|FOREIGN TABLE) /.test(line);
    if (data || adaptation) omitted.push(line);
    else selected.push(line);
  }
  if (!selected.length) fail('schema_restore_plan_empty');
  return { selected, omitted, table_data_restored: false, sequence_values_restored: false,
    compatibility: ['generated_test_owner', 'nonlogin_compatibility_roles', 'local_pgcrypto_vault', 'event_triggers_excluded', 'external_connectors_excluded'] };
}

async function fileHash(target) {
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || canonical(await realpath(target)) !== canonical(path.resolve(target))) fail('archive_regular_file_required');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  const after = await lstat(target);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) fail('archive_changed_during_hash');
  return hash.digest('hex');
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function assertFixturePortsClosed(ports) {
  if (!Array.isArray(ports) || ports.length !== 3 || new Set(ports).size !== 3
    || ports.some(port => !Number.isSafeInteger(port) || port < 1024 || port > 65535)) fail('restart_ports_invalid');
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('goal_fixture_restart_port_probe_timeout')); }, 2000);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('goal_fixture_restart_port_still_open')); });
      socket.once('error', error => {
        clearTimeout(timer);
        socket.destroy();
        error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('goal_fixture_restart_port_probe_failed'));
      });
    });
  }
}

export function createFixtureLifecycle({ restart, stop, prepareHost }) {
  let activeRestart = null;
  let activeStop = null;
  let closing = false;
  let stopped = false;
  const runExclusive = operation => {
      if (closing || stopped || activeRestart) return Promise.reject(new Error('goal_fixture_restart_state_invalid'));
      // Own the whole operation, including vault/source preflight. A rejected
      // preflight must release the guard and cleanup must wait for it to settle.
      activeRestart = Promise.resolve().then(operation).finally(() => { activeRestart = null; });
      return activeRestart;
  };
  return {
    restart: () => runExclusive(restart),
    prepareHost: options => runExclusive(() => prepareHost(options)),
    stop() {
      if (stopped) return Promise.resolve();
      if (activeStop) return activeStop;
      closing = true;
      const pendingRestart = activeRestart;
      activeStop = Promise.resolve().then(async () => {
        await pendingRestart?.catch(() => {});
        await stop();
        stopped = true;
      }).finally(() => { activeStop = null; });
      return activeStop;
    },
  };
}

async function runTool(command, args, env, stage, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(output);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('goal_fixture_' + stage + '_timeout')); }, timeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 2 * 1024 * 1024) { child.kill(); finish(new Error('goal_fixture_' + stage + '_output_overflow')); }
    });
    child.once('error', () => finish(new Error('goal_fixture_' + stage + '_spawn_failed')));
    child.once('close', code => finish(code === 0 ? null : new Error('goal_fixture_' + stage + '_failed')));
  });
}

export async function assertOwnedFixtureDirectory({ directory, temporaryRoot, markerId }) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(temporaryRoot) || !/^[a-f0-9-]{36}$/.test(markerId || '')) fail('cleanup_identity_invalid');
  const resolved = path.resolve(directory);
  if (canonical(path.dirname(resolved)) !== canonical(path.resolve(temporaryRoot)) || !path.basename(resolved).startsWith(PREFIX)) fail('cleanup_target_outside_temporary_root');
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || canonical(await realpath(resolved)) !== canonical(resolved)) fail('cleanup_alias_forbidden');
  const markerPath = path.join(resolved, MARKER);
  const markerInfo = await lstat(markerPath);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.nlink !== 1) fail('cleanup_marker_invalid');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (marker.schema !== 'compute.owned-goal-fixture.v1' || marker.id !== markerId || marker.purpose !== 'synthetic-goal-schema-only') fail('cleanup_marker_mismatch');
  return resolved;
}

const ROLE_NAMES = ['anon', 'authenticated', 'authenticator', 'cli_login_postgres', 'cli_login_supabase_read_only_user',
  'dashboard_user', 'pgbouncer', 'postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin', 'supabase_etl_admin',
  'supabase_privileged_role', 'supabase_read_only_user', 'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_storage_admin'];

export async function createIsolatedGoalFixture(config) {
  const dump = path.join(config.backupDirectory, 'database.dump');
  if (await fileHash(dump) !== config.expectedDumpSha256) fail('archive_digest_mismatch');
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await realpath(await mkdtemp(path.join(temporaryRoot, PREFIX)));
  const markerId = randomUUID();
  await writeFile(path.join(directory, MARKER), JSON.stringify({ schema: 'compute.owned-goal-fixture.v1', id: markerId,
    purpose: 'synthetic-goal-schema-only' }), { flag: 'wx', mode: 0o600 });
  const dataDirectory = path.join(directory, 'data');
  const owner = 'goal_fixture_owner';
  const ownerPassword = randomBytes(32).toString('hex');
  const apiPassword = randomBytes(32).toString('hex');
  const passwordFile = path.join(directory, 'init-password');
  await writeFile(passwordFile, ownerPassword, { flag: 'wx', mode: 0o600 });
  const executable = name => path.join(config.pgBinDir, process.platform === 'win32' ? name + '.exe' : name);
  const port = await freePort();
  const adminUrl = `postgresql://${owner}:${ownerPassword}@127.0.0.1:${port}/postgres`;
  const apiUrl = `postgresql://goal_fixture_api:${apiPassword}@127.0.0.1:${port}/postgres`;
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^PG/i.test(name)) delete env[name];
  Object.assign(env, { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: owner, PGPASSWORD: ownerPassword,
    PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '3' });
  let pg;
  let sql;
  let runtime;
  let apiKey;
  let apiPort;
  let edgePort;
  let stopped = false;
  let closePromise;
  const postmasterPids = [];
  const stopPostgres = async () => {
    let connectionFailure;
    if (sql) {
      try { await sql.end({ timeout: 5 }); sql = null; }
      catch { connectionFailure = new Error('goal_fixture_admin_connection_cleanup_failed'); }
    }
    if (pg && pg.exitCode === null && pg.signalCode === null) {
      const pidFile = (await readFile(path.join(dataDirectory, 'postmaster.pid'), 'utf8')).trim().split(/\r?\n/);
      if (Number(pidFile[0]) !== pg.pid || Number(pidFile[3]) !== port
        || canonical(await realpath(pidFile[1])) !== canonical(await realpath(dataDirectory))) fail('owned_postmaster_identity_changed');
      await runTool(executable('pg_ctl'), ['-D', dataDirectory, 'stop', '-m', 'fast', '-w', '-t', '10'], env, 'stop', 15000);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('goal_fixture_postmaster_close_timeout')), 5000);
        closePromise.then(() => { clearTimeout(timer); resolve(); }, reject);
      });
    }
    if (pg && pg.exitCode === null && pg.signalCode === null) fail('postmaster_still_running');
    if (pg) {
      try { await lstat(path.join(dataDirectory, 'postmaster.pid')); fail('postmaster_pid_file_remains'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (connectionFailure) throw connectionFailure;
  };
  const startPostgres = async () => {
    pg = spawn(executable('postgres'), ['-D', dataDirectory, '-p', String(port), '-h', '127.0.0.1'], {
      env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
    });
    postmasterPids.push(pg.pid);
    let spawnFailed = false;
    pg.once('error', () => { spawnFailed = true; });
    closePromise = new Promise(resolve => pg.once('close', resolve));
    let ready = false;
    for (let attempt = 0; attempt < 75; attempt += 1) {
      if (spawnFailed || pg.exitCode !== null) fail('postmaster_start_failed');
      try { await runTool(executable('pg_isready'), ['--timeout=1'], env, 'readiness', 3000); ready = true; break; }
      catch { await sleep(200); }
    }
    if (!ready) fail('postmaster_readiness_timeout');
    sql = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {}, connection: { timezone: 'UTC' } });
  };
  const startRuntime = async () => {
    apiKey = randomBytes(32).toString('hex');
    runtime = await launchClientStateRuntime({ mode: 'local', postgresMode: 'attached', databaseUrl: apiUrl, inspectDatabaseUrl: adminUrl,
      pgBinDir: config.pgBinDir, pgDataDir: dataDirectory, denoPath: config.denoPath, denoDir: config.denoDirectory, apiPort, edgePort, apiKey, startupTimeoutMs: 60000 });
  };
  const stopStack = async () => {
    if (stopped) return;
    let cleanupFailure;
    try { await runtime?.stop(); runtime = null; }
    catch { cleanupFailure = new Error('goal_fixture_runtime_cleanup_unconfirmed'); }
    try { await stopPostgres(); }
    catch (error) { cleanupFailure ||= error; }
    if (cleanupFailure) throw cleanupFailure;
    if (apiPort && edgePort) await assertFixturePortsClosed([port, apiPort, edgePort]);
    await assertOwnedFixtureDirectory({ directory, temporaryRoot, markerId });
    if (await fileHash(dump) !== config.expectedDumpSha256) fail('archive_changed_after_restore');
    await rm(directory, { recursive: true, force: false });
    stopped = true;
  };
  const restartStack = async () => {
    if (stopped || !runtime || !sql) fail('restart_state_invalid');
    const previous = { instanceId: runtime.instanceId, postgres: runtime.postgresIdentity, key: apiKey,
      manifestPath: runtime.startupManifestPath, sourceDigest: runtime.startupManifest.source_manifest_sha256 };
    const vaultKeyDigest = await fileHash(path.join(dataDirectory, 'client-vault.key'));
    await runtime.stop();
    runtime = null;
    await stopPostgres();
    await assertFixturePortsClosed([port, apiPort, edgePort]);
    await assertOwnedFixtureDirectory({ directory, temporaryRoot, markerId });
    await startPostgres();
    await startRuntime();
    if (runtime.instanceId === previous.instanceId || apiKey === previous.key
      || runtime.postgresIdentity.pid === previous.postgres.pid || runtime.postgresIdentity.started_at === previous.postgres.started_at
      || runtime.startupManifestPath === previous.manifestPath) fail('restart_identity_not_fresh');
    if (runtime.startupManifest.source_manifest_sha256 !== previous.sourceDigest) fail('restart_source_bytes_changed');
    if (await fileHash(path.join(dataDirectory, 'client-vault.key')) !== vaultKeyDigest) fail('restart_vault_key_changed');
    return { complete_stop_observed: true, ports_closed_before_restart: true, postgres_restarted: true,
      instance_id_changed: true, api_key_rotated: true, startup_receipt_changed: true, selected_source_bytes_unchanged: true,
      private_vault_key_preserved: true, before_instance_id: previous.instanceId, after_instance_id: runtime.instanceId,
      before_postmaster_pid: previous.postgres.pid, after_postmaster_pid: runtime.postgresIdentity.pid,
      production_qualification: false, process_code_attested: false };
  };
  const prepareHostStack = async ({ bundleDirectory, expectedBundleDigest } = {}) => {
    if (!path.isAbsolute(bundleDirectory || '') || !/^[a-f0-9]{64}$/.test(expectedBundleDigest || '')) fail('managed_host_bundle_binding_invalid');
    if (stopped || !runtime || !sql) fail('restart_state_invalid');
    await runtime.stop();
    runtime = null;
    await stopPostgres();
    await assertFixturePortsClosed([port, apiPort, edgePort]);
    await assertOwnedFixtureDirectory({ directory, temporaryRoot, markerId });
    const configFile = path.join(directory, 'managed-runtime-host-config.json');
    await writeFile(configFile, JSON.stringify({ schema: 'compute.runtime-host-config.v1', version: 1,
      bundle_directory: path.resolve(bundleDirectory), expected_bundle_sha256: expectedBundleDigest,
      state_directory: directory, pg_data_directory: dataDirectory, database_url: apiUrl, inspect_database_url: adminUrl,
      api_port: apiPort, edge_port: edgePort, startup_timeout_ms: 60000 }), { flag: 'wx', mode: 0o600 });
    return { configFile, statusFile: path.join(directory, 'runtime-instance.json'),
      endpoint: `http://127.0.0.1:${edgePort}/a2-browser-native-supervisor-v1`, ports: [port, apiPort, edgePort] };
  };
  const lifecycle = createFixtureLifecycle({ restart: restartStack, stop: stopStack, prepareHost: prepareHostStack });
  const stop = () => lifecycle.stop();
  const restart = () => lifecycle.restart();
  // Captured probes retain a private test credential without returning it to callers or receipts.
  const captureApiHealthProbe = () => {
    if (!runtime || !apiKey || stopped) fail('api_probe_state_invalid');
    const key = apiKey;
    return () => fetch(`http://127.0.0.1:${apiPort}/health`, { headers: { apikey: key }, signal: AbortSignal.timeout(5000) });
  };
  try {
    await runTool(executable('initdb'), ['-D', dataDirectory, '--username=' + owner, '--auth=scram-sha-256', '--pwfile=' + passwordFile,
      '--encoding=UTF8', '--no-locale'], env, 'initdb', 120000);
    await startPostgres();
    for (const role of ROLE_NAMES) await sql.unsafe(`CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION ${role === 'service_role' ? 'BYPASSRLS' : 'NOBYPASSRLS'}`);
    await sql.unsafe('CREATE SCHEMA extensions; CREATE SCHEMA vault; CREATE EXTENSION pgcrypto WITH SCHEMA extensions');
    await initializeLocalVaultKey({ dataDirectory });
    await sql.unsafe(await readFile(path.join(runtimeRoot, 'local-vault-compat.sql'), 'utf8'));
    const toc = await runTool(executable('pg_restore'), ['--list', dump], env, 'archive_toc');
    const plan = schemaOnlyRestorePlan(toc);
    const tocFile = path.join(directory, 'schema-only.list');
    await writeFile(tocFile, plan.selected.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    await runTool(executable('pg_restore'), ['--schema-only', '--no-owner', '--exit-on-error', '--single-transaction',
      '--dbname=postgres', '--use-list=' + tocFile, dump], env, 'schema_restore', 60000);
    const tables = await sql.unsafe(`SELECT n.nspname AS schema, c.relname AS name FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2`);
    for (const table of tables) {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS count FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`);
      if (row.count !== 0) fail('restored_schema_contains_data');
    }
    const migrations = await applyLocalRuntimeMigrations({ sql });
    await provisionLocalApiLogin({ sql, databaseName: 'postgres', login: 'goal_fixture_api', password: apiPassword });
    await sql.unsafe(`INSERT INTO destruktion_meta.metaengine_devos_roadmap_authority_h205f22
      (authority_key,roadmap_id,active_milestone_key,integration_line,baseline_sha,alignment_epoch)
      VALUES($1,$2,$3,$4,$5,1)`, ['CLIENT_V1_SYNTHETIC_TEST', 'metaengine-client-v1', 'SYNTHETIC_GOAL_FIXTURE', 'synthetic/goal-fixture', 'a'.repeat(40)]);
    do { apiPort = await freePort(); } while (apiPort === port);
    do { edgePort = await freePort(); } while (edgePort === apiPort || edgePort === port);
    await startRuntime();
    const journalDirectory = path.join(directory, 'synthetic-client-profile');
    await mkdir(journalDirectory);
    return { get sql() { return sql; }, get runtime() { return runtime; }, stop, restart,
      prepareManagedRuntimeHost: options => lifecycle.prepareHost(options), captureApiHealthProbe, journalDirectory,
      fixture: { isolated: true, generated_postmaster_pid: pg.pid, generated_postmaster_pids: postmasterPids,
      schema_only: true, source_dump_sha256: config.expectedDumpSha256, source_data_rows_restored: 0,
      empty_tables_verified: tables.length, compatibility: plan.compatibility, local_migrations: migrations.migrations,
      production_qualification: false, useful_coding_proven: false } };
  } catch (error) {
    try { await stop(); } catch { throw new Error('goal_fixture_setup_failed_cleanup_unconfirmed'); }
    throw new Error(String(error?.message || '').startsWith('goal_fixture_') ? error.message : 'goal_fixture_setup_failed_' + String(error?.code || 'unknown'));
  }
}
