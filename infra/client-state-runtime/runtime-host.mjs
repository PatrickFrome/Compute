import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchClientStateRuntime, normalizeLauncherConfig } from './launcher.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';

const hostEntry = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(hostEntry), '../..');
const schema = 'compute.runtime-host-config.v1';
const configKeys = ['schema', 'version', 'bundle_directory', 'expected_bundle_sha256', 'state_directory', 'pg_data_directory',
  'database_url', 'inspect_database_url', 'api_port', 'edge_port', 'startup_timeout_ms'];
const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
const failure = code => Object.assign(new Error(code), { code });

function absoluteLocalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^(?:\\\\|\/\/)/.test(value) || /[\x00-\x1f]/.test(value)) {
    throw failure('runtime_host_absolute_local_path_required');
  }
  return path.resolve(value);
}

export function validateRuntimeHostConfig(value) {
  if (!value || Array.isArray(value) || Object.keys(value).length !== configKeys.length || configKeys.some(key => !(key in value))
    || value.schema !== schema || value.version !== 1) throw failure('runtime_host_config_contract_invalid');
  if (!/^[a-f0-9]{64}$/.test(value.expected_bundle_sha256 || '')) throw failure('runtime_host_bundle_pin_required');
  const bundle = absoluteLocalPath(value.bundle_directory);
  const state = absoluteLocalPath(value.state_directory);
  const data = absoluteLocalPath(value.pg_data_directory);
  if (within(bundle, state) || within(state, bundle) || within(repositoryRoot, state) || within(state, repositoryRoot)
    || !within(state, data) || state === data) throw failure('runtime_host_private_state_boundary_invalid');
  return Object.freeze({ ...value, bundle_directory: bundle, state_directory: state, pg_data_directory: data });
}

async function requireCanonicalPath(target, kind) {
  const info = await lstat(target);
  if (info.isSymbolicLink() || (kind === 'file' ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())
    || canonical(await realpath(target)) !== canonical(path.resolve(target))) throw failure('runtime_host_path_invalid');
  return info;
}

async function readConfig(configFile) {
  configFile = absoluteLocalPath(configFile);
  const info = await requireCanonicalPath(configFile, 'file');
  if (info.size > 16384) throw failure('runtime_host_config_too_large');
  const handle = await open(configFile, 'r');
  let value;
  try {
    const bytes = Buffer.alloc(16385);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) throw failure('runtime_host_config_too_large');
    try { value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')); }
    catch { throw failure('runtime_host_config_json_invalid'); }
  } finally { await handle.close(); }
  const config = validateRuntimeHostConfig(value);
  if (within(config.bundle_directory, configFile) || within(repositoryRoot, configFile)) throw failure('runtime_host_private_config_boundary_invalid');
  return config;
}

async function acquireOwnership(stateDirectory) {
  const lockPath = path.join(stateDirectory, 'runtime-host-lock.json');
  const bytes = JSON.stringify({ schema: 'compute.runtime-host-lock.v1', pid: process.pid, owner_nonce: randomUUID() }) + '\n';
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw failure('runtime_host_owner_lock_exists'); throw failure('runtime_host_owner_lock_failed'); }
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch { throw failure('runtime_host_owner_lock_write_failed'); }
  finally { await handle.close(); }
  let released = false;
  return async () => {
    if (released) return;
    // Never erase a replacement lock, nor guess whether a stale PID is ours.
    const info = await lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink() || await readFile(lockPath, 'utf8') !== bytes) throw failure('runtime_host_owner_lock_changed');
    await unlink(lockPath);
    released = true;
  };
}

async function writeStatus(stateDirectory, status) {
  const target = path.join(stateDirectory, 'runtime-instance.json');
  try {
    const previous = await lstat(target);
    if (!previous.isFile() || previous.isSymbolicLink() || previous.nlink !== 1) throw failure('runtime_host_status_path_invalid');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(stateDirectory, `.runtime-status-${randomUUID()}.json`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(status, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, target); }
  catch { await unlink(temporary).catch(() => {}); throw failure('runtime_host_status_write_failed'); }
}

export async function stageManagedDenoCache({ verified, stateDirectory }) {
  await requireCanonicalPath(stateDirectory, 'directory');
  const cacheDirectory = path.join(stateDirectory, 'deno-cache');
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  await requireCanonicalPath(cacheDirectory, 'directory');
  const prefix = 'runtime/deno-cache/';
  const files = verified.manifest.files.filter(file => file.component === 'deno_cache' && file.path.startsWith(prefix));
  if (!files.length) throw failure('runtime_host_dependency_cache_missing');
  for (const file of files) {
    const relative = file.path.slice(prefix.length);
    const target = path.resolve(cacheDirectory, relative);
    if (!within(cacheDirectory, target)) throw failure('runtime_host_dependency_cache_invalid');
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await requireCanonicalPath(path.dirname(target), 'directory');
    const expectedBytes = await readFile(path.join(verified.paths.denoDirectory, relative));
    if (expectedBytes.length !== file.bytes || createHash('sha256').update(expectedBytes).digest('hex') !== file.sha256) {
      throw failure('runtime_host_dependency_cache_source_changed');
    }
    try { await writeFile(target, expectedBytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await requireCanonicalPath(target, 'file');
    const actual = await readFile(target);
    if (!actual.equals(expectedBytes)) throw failure('runtime_host_dependency_cache_changed');
  }
  return cacheDirectory;
}

export function runtimeProviderDescriptor(runtime) {
  if (!/^[a-f0-9-]{36}$/i.test(runtime?.instanceId || '') || runtime?.edgeHealth?.runtime_ready !== true
    || runtime.edgeHealth.state_provider !== 'LOCAL_POSTGRES' || runtime.edgeHealth.hosted_supabase_required !== false
    || runtime.edgeHealth.capability_health?.state !== 'ATTESTED' || runtime.edgeHealth.capability_health.authority_effect !== false) {
    throw failure('runtime_host_provider_unattested');
  }
  const endpoint = new URL(runtime.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || endpoint.pathname !== '/a2-browser-native-supervisor-v1') throw failure('runtime_host_provider_endpoint_invalid');
  return Object.freeze({ schema: 'compute.runtime-host-provider.v1', provider: 'LOCAL_POSTGRES',
    endpoint: endpoint.href, instance_id: runtime.instanceId, runtime_ready: true, automatic_cloud_fallback: false,
    hosted_supabase_required: false, authority_effect: false });
}

export async function startManagedRuntimeHost({ configFile, signal } = {}, hooks = {}) {
  const config = await readConfig(configFile);
  await requireCanonicalPath(config.state_directory, 'directory');
  await requireCanonicalPath(config.pg_data_directory, 'directory');
  if ((await readFile(path.join(config.pg_data_directory, 'PG_VERSION'), 'utf8')).trim() !== '17') throw failure('runtime_host_restored_pg17_required');
  const vaultFile = path.join(config.pg_data_directory, 'client-vault.key');
  await requireCanonicalPath(vaultFile, 'file');
  if (!/^[a-f0-9]{64}\n$/.test(await readFile(vaultFile, 'utf8'))) throw failure('runtime_host_existing_vault_key_required');
  const verified = await (hooks.verifyBundle || verifyOfflineRuntimeBundle)({ bundleDirectory: config.bundle_directory, expectedBundleDigest: config.expected_bundle_sha256 });
  if (canonical(await realpath(hooks.modulePath || hostEntry)) !== canonical(verified.paths.hostEntry)
    || canonical(await realpath(hooks.executablePath || process.execPath)) !== canonical(verified.paths.nodeExecutable)) {
    throw failure('runtime_host_execution_resource_mismatch');
  }
  const launcherConfig = normalizeLauncherConfig({ mode: 'local', postgresMode: 'owned',
    databaseUrl: config.database_url, inspectDatabaseUrl: config.inspect_database_url,
    apiPort: config.api_port, edgePort: config.edge_port, startupTimeoutMs: config.startup_timeout_ms,
    pgDataDir: config.pg_data_directory, pgBinDir: verified.paths.postgresBinDirectory,
    nodePath: verified.paths.nodeExecutable, denoPath: verified.paths.denoExecutable, denoDir: verified.paths.denoDirectory,
    expectedStartupFilesSha256: verified.manifest.reviewed_startup_files_sha256, includeRuntimeHost: true, signal,
    startupManifestPath: path.join(config.state_directory, `runtime-startup-${randomUUID()}.json`),
  });
  const release = await acquireOwnership(config.state_directory);
  const baseStatus = { schema: 'metaengine.client-state.runtime-status.v1', state: 'STARTING', runtime_ready: false,
    state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false, automatic_cloud_fallback: false,
    host_pid: process.pid, bundle_sha256: config.expected_bundle_sha256, process_code_attested: false, authority_effect: false };
  let runtime;
  let terminalPromise;
  let stopPromise;
  let abortRequested = signal?.aborted === true;
  let lastStatus = baseStatus;
  const persist = async status => { await writeStatus(config.state_directory, status); lastStatus = status; };
  const finalize = outcome => {
    if (!terminalPromise) terminalPromise = (async () => {
      const confirmed = outcome.children_stopped === true;
      try { await persist({ ...lastStatus, state: confirmed ? 'STOPPED' : 'FAILED', runtime_ready: false,
        reason: confirmed ? String(outcome.reason || 'runtime_ended') : 'runtime_host_cleanup_unconfirmed',
        children_stopped: confirmed, stopped_at: new Date().toISOString() }); }
      finally { signal?.removeEventListener('abort', onAbort); if (confirmed) await release(); }
      return outcome;
    })();
    return terminalPromise;
  };
  const stop = (reason = 'requested') => {
    if (!stopPromise) stopPromise = (async () => {
      let outcome;
      try { outcome = await runtime.stop(['requested', 'signal', 'parent_disconnect', 'startup_cancelled'].includes(reason) ? reason : 'requested'); }
      catch { await finalize({ reason: 'runtime_host_cleanup_unconfirmed', children_stopped: false }); throw failure('runtime_host_cleanup_unconfirmed'); }
      return finalize(outcome);
    })();
    return stopPromise;
  };
  function onAbort() { abortRequested = true; if (runtime) void stop('startup_cancelled').catch(() => {}); }
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await persist(baseStatus);
    if (abortRequested) throw failure('runtime_host_startup_cancelled');
    const denoDir = await (hooks.stageDenoCache || stageManagedDenoCache)({ verified, stateDirectory: config.state_directory });
    runtime = await (hooks.launchRuntime || launchClientStateRuntime)({ ...launcherConfig, denoDir });
    if (abortRequested) { await stop('startup_cancelled'); throw failure('runtime_host_startup_cancelled'); }
    const descriptor = Object.freeze({ ...runtimeProviderDescriptor(runtime), status_file: path.join(config.state_directory, 'runtime-instance.json') });
    if (runtime.stopped === true) throw failure('runtime_host_child_ended_during_startup');
    await persist({ ...baseStatus, state: 'READY', runtime_ready: true, checked_at: new Date().toISOString(),
      instance_id: descriptor.instance_id, endpoint: descriptor.endpoint, capability_health: runtime.edgeHealth.capability_health,
      postgres_mode: 'owned', children: runtime.children, startup_source_sha256: runtime.startupManifest.source_manifest_sha256 });
    const finished = runtime.finished.then(finalize, () => finalize({ reason: 'runtime_host_child_failed', children_stopped: false }));
    if (runtime.stopped === true) throw failure('runtime_host_child_ended_during_startup');
    return { descriptor, statusFile: path.join(config.state_directory, 'runtime-instance.json'), stop, finished };
  } catch (error) {
    if (runtime) await stop('requested');
    else {
      signal?.removeEventListener('abort', onAbort);
      try { await persist({ ...baseStatus, state: 'FAILED', reason: /^[a-z0-9_]+$/.test(error.code || '') ? error.code : 'runtime_host_start_failed' }); }
      finally { if (error.code !== 'runtime_cleanup_unconfirmed') await release(); }
    }
    throw error;
  }
}

async function main() {
  const controller = new AbortController();
  let host;
  let pendingStop = null;
  const requestStop = reason => { pendingStop ||= reason; controller.abort(); if (host) void host.stop(reason).catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', () => requestStop('signal'));
  process.once('SIGTERM', () => requestStop('signal'));
  process.once('disconnect', () => requestStop('parent_disconnect'));
  process.on('message', message => {
    if (message?.schema === 'compute.runtime-host-control.v1' && message.command === 'stop') requestStop('requested');
  });
  host = await startManagedRuntimeHost({ configFile: process.env.COMPUTE_RUNTIME_HOST_CONFIG, signal: controller.signal });
  if (pendingStop || (process.send && !process.connected)) await host.stop(pendingStop || 'parent_disconnect');
  else if (process.send) process.send(host.descriptor);
  else console.log(JSON.stringify(host.descriptor));
  const outcome = await host.finished;
  if (!['requested', 'signal', 'parent_disconnect', 'startup_cancelled'].includes(outcome.reason)) process.exitCode = 1;
  if (process.connected) process.disconnect();
}

if (process.argv[1] && path.resolve(process.argv[1]) === hostEntry) {
  main().catch(error => {
    // Child/DB/config errors can contain private connection strings. Emit only a fixed category.
    console.error(JSON.stringify({ schema: 'compute.runtime-host-failure.v1', state: 'FAILED',
      reason: /^[a-z0-9_]+$/.test(error.code || '') ? error.code : 'runtime_host_start_failed', credentials_included: false }));
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
