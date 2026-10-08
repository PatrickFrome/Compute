import { spawn } from 'node:child_process';
import { startOwnedWindowsPostgres } from './owned-postgres-process.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindStartupManifest, captureStartupSource, persistStartupManifest, safeRuntimePolicy, startupFilesDigest } from './startup-source-manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const executable = name => process.platform === 'win32' ? `${name}.exe` : name;

function runtimeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function port(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) throw runtimeError(`${label}_invalid`);
  return parsed;
}

export function normalizeLauncherConfig(input) {
  if (input.mode !== 'local') throw runtimeError('explicit_local_mode_required');
  if (!['owned', 'attached'].includes(input.postgresMode)) throw runtimeError('explicit_postgres_mode_required');
  let database;
  try { database = new URL(input.databaseUrl); } catch { throw runtimeError('local_database_url_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1') {
    throw runtimeError('loopback_database_required');
  }
  if (database.search || database.hash || !database.username || database.pathname === '/') {
    throw runtimeError('local_database_url_invalid');
  }
  const databasePort = port(database.port, 'database_port');
  let inspectDatabase;
  try { inspectDatabase = new URL(input.inspectDatabaseUrl || database.href); } catch { throw runtimeError('inspection_database_url_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(inspectDatabase.protocol) || inspectDatabase.hostname !== '127.0.0.1' || Number(inspectDatabase.port) !== databasePort || !inspectDatabase.username || inspectDatabase.pathname === '/' || inspectDatabase.search || inspectDatabase.hash) {
    throw runtimeError('inspection_database_url_invalid');
  }
  const apiPort = port(input.apiPort ?? 15432, 'api_port');
  const edgePort = port(input.edgePort ?? 15433, 'edge_port');
  if (new Set([databasePort, apiPort, edgePort]).size !== 3) throw runtimeError('distinct_runtime_ports_required');
  if (!input.pgBinDir || !input.pgDataDir || !input.denoPath) throw runtimeError('local_runtime_paths_required');
  const timeoutMs = Number(input.startupTimeoutMs ?? 60000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw runtimeError('startup_timeout_invalid');
  const apiKey = input.apiKey || randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/i.test(apiKey)) throw runtimeError('local_api_key_invalid');
  if (input.denoDir !== undefined && (typeof input.denoDir !== 'string' || !path.isAbsolute(input.denoDir))) throw runtimeError('deno_cache_absolute_path_required');
  if (input.expectedStartupSourceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedStartupSourceSha256)) throw runtimeError('expected_startup_source_sha256_invalid');
  if (input.expectedStartupFilesSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedStartupFilesSha256)) throw runtimeError('expected_startup_files_sha256_invalid');
  if (input.includeRuntimeHost !== undefined && typeof input.includeRuntimeHost !== 'boolean') throw runtimeError('runtime_host_source_choice_invalid');
  if (input.instanceId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.instanceId)) throw runtimeError('runtime_instance_id_invalid');
  return {
    ...input,
    databaseUrl: database.href,
    database,
    inspectDatabase,
    inspectDatabaseUrl: inspectDatabase.href,
    databasePort,
    apiPort,
    edgePort,
    apiKey,
    pgBinDir: path.resolve(input.pgBinDir),
    pgDataDir: path.resolve(input.pgDataDir),
    denoPath: path.resolve(input.denoPath),
    denoDir: input.denoDir === undefined ? undefined : path.resolve(input.denoDir),
    nodePath: input.nodePath || process.execPath,
    apiEntry: input.apiEntry || path.join(here, 'db-api.mjs'),
    edgeEntry: input.edgeEntry || path.join(projectRoot, 'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts'),
    denoLockPath: path.resolve(input.denoLockPath || path.join(here, 'deno.lock')),
    startupManifestPath: input.startupManifestPath ? path.resolve(input.startupManifestPath) : null,
    startupTimeoutMs: timeoutMs,
    healthIntervalMs: Math.max(100, Number(input.healthIntervalMs) || 2000),
    instanceId: input.instanceId || randomUUID(),
  };
}

export function configFromEnvironment(env = process.env) {
  return normalizeLauncherConfig({
    mode: env.LOCAL_STATE_MODE,
    postgresMode: env.LOCAL_STATE_POSTGRES_MODE,
    databaseUrl: env.LOCAL_STATE_DATABASE_URL,
    inspectDatabaseUrl: env.LOCAL_STATE_INSPECT_DATABASE_URL,
    pgBinDir: env.LOCAL_STATE_PG_BIN_DIR,
    pgDataDir: env.LOCAL_STATE_PG_DATA_DIR,
    denoPath: env.LOCAL_STATE_DENO_PATH,
    denoDir: env.LOCAL_STATE_DENO_DIR,
    expectedStartupSourceSha256: env.LOCAL_STATE_EXPECTED_STARTUP_SOURCE_SHA256,
    expectedStartupFilesSha256: env.LOCAL_STATE_EXPECTED_STARTUP_FILES_SHA256,
    includeRuntimeHost: env.LOCAL_STATE_INCLUDE_RUNTIME_HOST === undefined ? undefined : env.LOCAL_STATE_INCLUDE_RUNTIME_HOST === 'true',
    nodePath: env.LOCAL_STATE_NODE_PATH,
    apiPort: env.LOCAL_STATE_API_PORT,
    edgePort: env.LOCAL_STATE_EDGE_PORT,
    startupTimeoutMs: env.LOCAL_STATE_STARTUP_TIMEOUT_MS,
    denoLockPath: env.LOCAL_STATE_DENO_LOCK_PATH,
    startupManifestPath: env.LOCAL_STATE_STARTUP_MANIFEST_PATH,
  });
}

async function requireFreePort(value) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(runtimeError(`runtime_port_${value}_occupied`)));
    server.listen({ host: '127.0.0.1', port: value, exclusive: true }, () => server.close(resolve));
  });
}

function postgresEnvironment(config) {
  const env = { ...process.env };
  const database = config.inspectDatabase || config.database;
  for (const name of Object.keys(env)) if (/^PG/i.test(name)) delete env[name];
  return {
    ...env,
    PGHOST: '127.0.0.1',
    PGPORT: String(config.databasePort),
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '3',
    PGSSLMODE: 'disable',
  };
}

async function runBounded(command, args, { env = process.env, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let text = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(runtimeError('runtime_command_timeout'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { text += chunk; if (text.length > 65536) child.kill(); });
    child.once('error', () => finish(runtimeError('runtime_command_spawn_failed')));
    child.once('exit', code => finish(code === 0 ? null : runtimeError('runtime_command_failed'), text.trim()));
  });
}

export async function inspectPostgres(config) {
  const query = "SELECT json_build_object('data_directory',current_setting('data_directory'),'version',current_setting('server_version_num')::int,'address',host(inet_server_addr()),'port',inet_server_port(),'started_at',pg_postmaster_start_time())::text";
  const output = await runBounded(path.join(config.pgBinDir, executable('psql')), ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { env: postgresEnvironment(config) });
  try { return JSON.parse(output); } catch { throw runtimeError('postgres_identity_invalid'); }
}

export async function assertPostgresIdentity(record, config, ownedPid = null) {
  if (record?.version < 170000 || record?.version >= 180000 || record?.address !== '127.0.0.1' || record?.port !== config.databasePort || !record?.started_at) {
    throw runtimeError('postgres_identity_mismatch');
  }
  const actual = await realpath(record.data_directory);
  const expected = await realpath(config.pgDataDir);
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (canonical(actual) !== canonical(expected)) throw runtimeError('postgres_data_directory_mismatch');
  const pidText = await readFile(path.join(expected, 'postmaster.pid'), 'utf8');
  const lines = pidText.trim().split(/\r?\n/);
  const serverPid = Number(lines[0]);
  if (!Number.isSafeInteger(serverPid) || serverPid <= 0 || Number(lines[3]) !== config.databasePort) throw runtimeError('postgres_pid_file_invalid');
  if (ownedPid !== null && ownedPid !== serverPid) throw runtimeError('postgres_owned_pid_mismatch');
  return { ...record, pid: serverPid, data_directory: expected };
}

export function runtimeEnvironment(config) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^SUPABASE_/i.test(name) || /^LOCAL_STATE_/i.test(name) || /^PG/i.test(name) || /^DENO_/i.test(name)
    || /^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|ELECTRON_RUN_AS_NODE|GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|NPM_TOKEN|NODE_AUTH_TOKEN|DENO_V8_FLAGS|DENO_UNSTABLE_INTERNALS)$/i.test(name)) delete env[name];
  return {
    ...env,
    ...(config.denoDir ? { DENO_DIR: config.denoDir } : {}),
    LOCAL_STATE_MODE: 'local',
    LOCAL_STATE_RUNTIME: 'LOCAL_POSTGRES',
    LOCAL_STATE_INSTANCE_ID: config.instanceId,
    LOCAL_STATE_DATABASE_URL: config.databaseUrl,
    LOCAL_STATE_API_KEY: config.apiKey,
    LOCAL_STATE_API_HOST: '127.0.0.1',
    LOCAL_STATE_API_PORT: String(config.apiPort),
    LOCAL_STATE_API_BASE_URL: `http://127.0.0.1:${config.apiPort}`,
    LOCAL_STATE_EDGE_PORT: String(config.edgePort),
    SUPABASE_URL: `http://127.0.0.1:${config.apiPort}`,
    SUPABASE_DB_URL: config.databaseUrl,
    SUPABASE_DB_SESSION_URL: config.databaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.apiKey,
    SUPABASE_SECRET_KEYS: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_ANON_KEY: '',
  };
}

const allowedEnvironment = [
  'LOCAL_STATE_MODE', 'LOCAL_STATE_RUNTIME', 'LOCAL_STATE_INSTANCE_ID', 'LOCAL_STATE_EDGE_PORT', 'LOCAL_STATE_API_BASE_URL',
  'LOCAL_STATE_DATABASE_URL', 'LOCAL_STATE_API_KEY', 'LOCAL_STATE_API_PORT',
  'SUPABASE_URL', 'SUPABASE_DB_URL', 'SUPABASE_DB_SESSION_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE',
  'PGUSERNAME', 'PGCONNECT_TIMEOUT', 'PGTARGETSESSIONATTRS', 'PGAPPNAME',
  'PGMAX', 'PGSSL', 'PGIDLE_TIMEOUT', 'PGMAX_LIFETIME', 'PGMAX_PIPELINE',
  'PGBACKOFF', 'PGKEEP_ALIVE', 'PGPREPARE', 'PGDEBUG', 'PGFETCH_TYPES',
  'PGPUBLICATIONS', 'PGTARGET_SESSION_ATTRS',
];

export async function launchClientStateRuntime(input, hooks = {}) {
  const config = normalizeLauncherConfig(input);
  const report = hooks.report || (() => {});
  const children = [];
  const exits = new Map();
  const env = runtimeEnvironment(config);
  let stopping = false;
  let monitor;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  let postgresIdentity;
  let startupManifest;
  let postgresPreparation;

  const stopChild = async child => {
    if (exits.has(child)) return;
    const awaitExit = timeoutMs => new Promise(resolve => {
      const onExit = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(); }, timeoutMs);
      child.once('exit', onExit);
    });
    const ended = awaitExit(5000);
    child.kill('SIGTERM');
    await ended;
    if (!exits.has(child)) {
      const killed = awaitExit(2000);
      child.kill('SIGKILL');
      await killed;
    }
    if (!exits.has(child)) throw runtimeError('runtime_child_stop_unconfirmed');
  };

  const stop = async (reason = 'requested') => {
    if (stopping) return finished;
    stopping = true;
    clearInterval(monitor);
    config.signal?.removeEventListener('abort', onAbort);
    let cleanupFailure;
    // pg_ctl exits before its restricted-token postmaster. Settle that
    // preparation before deciding which exact processes this launcher owns.
    if (postgresPreparation) {
      try { await postgresPreparation; }
      catch (error) { if (error?.code === 'runtime_cleanup_unconfirmed') cleanupFailure = error; }
    }
    for (const item of [...children].reverse()) {
      if (item.session) {
        try {
          const outcome = await item.session.stop();
          if (outcome.cleanup_confirmed !== true) throw runtimeError('runtime_cleanup_unconfirmed');
        } catch { cleanupFailure = runtimeError('runtime_cleanup_unconfirmed'); }
        continue;
      }
      if (item.name === 'postgres' && !exits.has(item.child)) {
        // pg_ctl targets the already-qualified data directory, never an arbitrary port.
        try {
          const verified = await assertPostgresIdentity(await inspectPostgres(config), config, item.child.pid);
          if (verified.pid === postgresIdentity?.pid) {
            await runBounded(path.join(config.pgBinDir, executable('pg_ctl')), ['stop', '-D', config.pgDataDir, '-m', 'fast', '-t', '10'], { timeoutMs: 12000 });
          }
        } catch { /* Only the child handle below may be terminated on a failed qualification. */ }
      }
      try { await stopChild(item.child); }
      catch { cleanupFailure = runtimeError('runtime_cleanup_unconfirmed'); }
    }
    report({ event: 'stopped', instance_id: config.instanceId, reason });
    finish({ reason: cleanupFailure ? cleanupFailure.code : reason, children_stopped: !cleanupFailure });
    if (cleanupFailure) throw cleanupFailure;
    return finished;
  };

  const onAbort = () => { void stop('startup_cancelled').catch(() => {}); };
  config.signal?.addEventListener('abort', onAbort, { once: true });

  function start(name, command, args) {
    if (stopping || config.signal?.aborted) throw runtimeError('runtime_startup_cancelled');
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push({ name, child });
    child.once('error', () => {
      exits.set(child, { code: null });
      if (!stopping) void stop(`${name}_spawn_failed`).catch(() => {});
    });
    child.once('exit', (code, signal) => {
      exits.set(child, { code, signal });
      if (!stopping) void stop(`${name}_exited`).catch(() => {});
    });
    report({ event: 'spawned', component: name, pid: child.pid, instance_id: config.instanceId });
    return child;
  }

  async function waitReady(operation, label) {
    const deadline = Date.now() + config.startupTimeoutMs;
    do {
      if (stopping) throw runtimeError(`${label}_process_failed`);
      try { return await operation(); } catch (error) {
        if (String(error.code || '').includes('mismatch')) throw error;
      }
      await sleep(100);
    } while (Date.now() < deadline);
    throw runtimeError(`${label}_readiness_timeout`);
  }

  async function health(which) {
    const endpoint = which === 'api' ? `http://127.0.0.1:${config.apiPort}/health` : `http://127.0.0.1:${config.edgePort}/a2-browser-native-supervisor-v1/health`;
    const response = await fetch(endpoint, { headers: { apikey: config.apiKey }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw runtimeError(`${which}_health_failed`);
    const body = await response.json();
    if (body.instance_id !== config.instanceId) throw runtimeError(`${which}_instance_mismatch`);
    if (body.ok !== true) throw runtimeError(`${which}_health_failed`);
    if (which === 'edge' && (body.runtime_ready !== true || body.capability_health?.state !== 'ATTESTED')) {
      throw runtimeError('edge_runtime_unattested');
    }
    return body;
  }

  try {
    if (config.signal?.aborted) throw runtimeError('runtime_startup_cancelled');
    await requireFreePort(config.apiPort);
    await requireFreePort(config.edgePort);
    const startedAt = new Date().toISOString();
    const fixture = Boolean(hooks.apiCommand || hooks.edgeCommand);
    const fixtureEntry = (command, fallback) => command ? command.args.find((arg) => path.isAbsolute(arg) && /\.(mjs|js|ts)$/.test(arg)) || fallback : fallback;
    const captureOptions = {
      repositoryRoot: projectRoot, entries: [fileURLToPath(import.meta.url), fixtureEntry(hooks.apiCommand, config.apiEntry), fixtureEntry(hooks.edgeCommand, config.edgeEntry),
        ...(config.includeRuntimeHost ? [path.join(here, 'runtime-host.mjs'), path.join(here, 'fresh-pg17-initdb.mjs')] : [])],
      nodePath: config.nodePath, denoPath: config.denoPath, denoLockPath: config.denoLockPath,
      pgBinDir: hooks.inspectPostgres ? undefined : config.pgBinDir, env, fixture, policy: safeRuntimePolicy(config, { fixture }),
    };
    const before = await captureStartupSource(captureOptions);
    if (config.expectedStartupSourceSha256 && before.manifest_sha256 !== config.expectedStartupSourceSha256) throw runtimeError('startup_source_pin_mismatch');
    if (config.expectedStartupFilesSha256 && startupFilesDigest(before.files) !== config.expectedStartupFilesSha256) throw runtimeError('startup_files_pin_mismatch');
    let pgChild;
    let ownedPostgresPid = null;
    if (config.postgresMode === 'owned') {
      await requireFreePort(config.databasePort);
      if (process.platform === 'win32' && !hooks.inspectPostgres) {
        postgresPreparation = startOwnedWindowsPostgres({ pgBinDir: config.pgBinDir, pgDataDir: config.pgDataDir,
          databasePort: config.databasePort, env, startupTimeoutMs: config.startupTimeoutMs, signal: config.signal })
          .then(session => {
            children.push({ name: 'postgres', session });
            report({ event: 'spawned', component: 'postgres', pid: session.pid, instance_id: config.instanceId });
            return session;
          });
        ownedPostgresPid = (await postgresPreparation).pid;
        if (stopping || config.signal?.aborted) throw runtimeError('runtime_startup_cancelled');
      } else {
        pgChild = start('postgres', path.join(config.pgBinDir, executable('postgres')), ['-D', config.pgDataDir, '-h', '127.0.0.1', '-p', String(config.databasePort)]);
        ownedPostgresPid = pgChild.pid;
      }
    }
    const inspector = hooks.inspectPostgres || inspectPostgres;
    postgresIdentity = await waitReady(async () => assertPostgresIdentity(await inspector(config), config, ownedPostgresPid), 'postgres');
    const apiCommand = hooks.apiCommand || { command: config.nodePath, args: [config.apiEntry] };
    start('api', apiCommand.command, apiCommand.args);
    await waitReady(() => health('api'), 'api');
    const edgeCommand = hooks.edgeCommand || {
      command: config.denoPath,
      args: ['run', '--no-config', `--lock=${config.denoLockPath}`, '--frozen-lockfile', '--cached-only', '--no-prompt', '--node-modules-dir=none', `--allow-env=${allowedEnvironment.join(',')}`, `--allow-net=127.0.0.1:${config.databasePort},127.0.0.1:${config.apiPort},127.0.0.1:${config.edgePort}`, config.edgeEntry],
    };
    start('edge', edgeCommand.command, edgeCommand.args);
    const edgeHealth = await waitReady(() => health('edge'), 'edge');
    const endpoint = `http://127.0.0.1:${config.edgePort}/a2-browser-native-supervisor-v1`;
    startupManifest = bindStartupManifest({ before, after: await captureStartupSource(captureOptions), instanceId: config.instanceId, endpoint,
      children: children.map(({ name, child, session }) => ({ name, pid: session?.pid ?? child.pid })), startedAt, readyAt: new Date().toISOString() });
    const startupManifestPath = config.startupManifestPath || path.join(config.pgDataDir, `runtime-startup-${config.instanceId}.json`);
    await persistStartupManifest(startupManifestPath, startupManifest, projectRoot);
    let failedProbes = 0;
    let probing = false;
    monitor = setInterval(async () => {
      if (stopping || probing) return;
      probing = true;
      try {
        await health('api');
        await health('edge');
        const session = children.find(item => item.name === 'postgres')?.session;
        if (session) await session.verify();
        const current = await assertPostgresIdentity(await inspector(config), config, ownedPostgresPid);
        if (current.pid !== postgresIdentity.pid || current.started_at !== postgresIdentity.started_at) throw runtimeError('postgres_incarnation_mismatch');
        failedProbes = 0;
      } catch (error) {
        failedProbes += 1;
        if (String(error.code || '').includes('mismatch') || failedProbes >= 3) void stop('runtime_health_failed').catch(() => {});
      } finally { probing = false; }
    }, config.healthIntervalMs);
    report({ event: 'ready', instance_id: config.instanceId, endpoint, postgres_mode: config.postgresMode,
      startup_source_sha256: startupManifest.source_manifest_sha256, startup_manifest_path: startupManifestPath });
    return { endpoint, instanceId: config.instanceId, postgresIdentity, edgeHealth, startupManifest, startupManifestPath, stop, finished,
      get stopped() { return stopping; }, children: children.map(({ name, child, session }) => ({ name, pid: session?.pid ?? child.pid })) };
  } catch (error) {
    await stop(error.code || 'runtime_start_failed');
    throw error;
  }
}

async function main() {
  let runtime;
  let stopping = false;
  const stop = () => {
    stopping = true;
    if (runtime) void runtime.stop('signal');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  runtime = await launchClientStateRuntime(configFromEnvironment(), { report: value => console.log(JSON.stringify(value)) });
  if (stopping) await runtime.stop('signal');
  const result = await runtime.finished;
  if (result.reason !== 'signal' && result.reason !== 'requested') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'runtime_failed', error: error.code || 'runtime_start_failed' }));
    process.exitCode = 1;
  });
}
