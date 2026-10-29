import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchClientStateRuntime, normalizeLauncherConfig, normalizeRuntimeHealthFailure } from './launcher.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { reconcileAbandonedAttachedRuntimeLock } from './runtime-host-orphan-reconciliation.mjs';
import {createOwnedGuardianTicketConsumer,validateGuardianOwnerConsumeEnvelope} from './guardian-owner-consume.mjs';
import { createNativeCodingHostIpcServer } from './native-coding-host-ipc.mjs';
import { createNativeCodingHostAuthority } from './native-coding-host-authority.mjs';
import {createNativeCodingHostCommitService} from './native-coding-host-commit-service.mjs';
import {createNativeCodingHostSeedBinding} from './native-coding-host-seed-binding.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
import {createNativeCodingHostServiceHeartbeat} from './native-coding-host-service-heartbeat.mjs';
import { createNativeCodingHostOsScope,readNativeCodingOperatorPaths } from './native-coding-host-os-scope.mjs';
import { requireRuntimeHostLaunchNonce, runtimeHostTerminalMessage, runtimeHostFailureMessage,
  sendRuntimeHostLifecycleMessage } from './runtime-host-lifecycle.mjs';

const hostEntry = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(hostEntry), '../..');
const schema = 'compute.runtime-host-config.v1';
const configKeys = ['schema', 'version', 'bundle_directory', 'expected_bundle_sha256', 'state_directory', 'pg_data_directory',
  'database_url', 'inspect_database_url', 'api_port', 'edge_port', 'startup_timeout_ms'];
const postgresModes = new Set(['owned', 'attached']);
const apiRoleModes = new Set(['service_role', 'direct']);
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
  const hasPostgresMode = value && !Array.isArray(value) && Object.hasOwn(value, 'postgres_mode');
  const hasApiRoleMode = value && !Array.isArray(value) && Object.hasOwn(value, 'api_role_mode');
  const hasClusterPin = value && !Array.isArray(value) && Object.hasOwn(value, 'expected_cluster_system_identifier');
  if (!value || Array.isArray(value) || Object.keys(value).length !== configKeys.length + (hasPostgresMode ? 1 : 0) + (hasApiRoleMode ? 1 : 0) + (hasClusterPin ? 1 : 0) || configKeys.some(key => !(key in value))
    || value.schema !== schema || value.version !== 1) throw failure('runtime_host_config_contract_invalid');
  const postgresMode = hasPostgresMode ? value.postgres_mode : 'owned';
  if (!postgresModes.has(postgresMode)) throw failure('runtime_host_postgres_mode_invalid');
  if (hasApiRoleMode && !apiRoleModes.has(value.api_role_mode)) throw failure('runtime_host_api_role_mode_invalid');
  if (postgresMode === 'attached' && value.api_role_mode !== 'direct') throw failure('runtime_host_attached_direct_api_required');
  if ((postgresMode === 'attached' || hasClusterPin) && !/^[1-9][0-9]{0,19}$/.test(value.expected_cluster_system_identifier || '')) {
    throw failure('runtime_host_cluster_identity_pin_required');
  }
  if (!/^[a-f0-9]{64}$/.test(value.expected_bundle_sha256 || '')) throw failure('runtime_host_bundle_pin_required');
  const bundle = absoluteLocalPath(value.bundle_directory);
  const state = absoluteLocalPath(value.state_directory);
  const data = absoluteLocalPath(value.pg_data_directory);
  const dataInsideState = within(state, data) && !within(data, state);
  const stateDataOverlap = within(state, data) || within(data, state) || state === data;
  const invalidOwnedBoundary = postgresMode === 'owned' && !dataInsideState;
  const invalidAttachedBoundary = postgresMode === 'attached' && stateDataOverlap;
  if (within(bundle, state) || within(state, bundle) || within(repositoryRoot, state) || within(state, repositoryRoot)
    || invalidOwnedBoundary || invalidAttachedBoundary || within(bundle, data) || within(data, bundle)
    || within(repositoryRoot, data) || within(data, repositoryRoot)) {
    throw failure('runtime_host_private_state_boundary_invalid');
  }
  return Object.freeze({ ...value, ...(hasPostgresMode ? { postgres_mode: postgresMode } : {}),
    bundle_directory: bundle, state_directory: state, pg_data_directory: data });
}

async function requireCanonicalPath(target, kind) {
  const absolute = path.resolve(target);
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || (kind === 'file' ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) {
    throw failure('runtime_host_path_invalid');
  }
  const real = await realpath(absolute);
  if (process.platform === 'win32') {
    // Windows realpath expands valid DOS short names. Walk all path components
    // to reject symlinks/junctions without treating RUNNER~1 as a redirect.
    let current = path.parse(absolute).root;
    for (const segment of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if ((await lstat(current)).isSymbolicLink()) throw failure('runtime_host_path_invalid');
    }
  } else if (canonical(real) !== canonical(absolute)) throw failure('runtime_host_path_invalid');
  return info;
}

// Logical path checks alone cannot distinguish Windows long names and DOS
// 8.3 aliases. Compare physical paths after validating every ancestor to
// ensure private PGDATA/keys never overlap immutable package or source bytes.
export function validateRuntimeHostPhysicalBoundaries({
  bundleDirectory, stateDirectory, pgDataDirectory, privateConfigFile, repositoryDirectory,
  postgresMode = 'owned',
} = {}) {
  const values = [bundleDirectory, stateDirectory, pgDataDirectory, privateConfigFile, repositoryDirectory];
  if (values.some(value => typeof value !== 'string' || !path.isAbsolute(value))) throw failure('runtime_host_path_invalid');
  const mode = postgresMode;
  if (!postgresModes.has(mode)) throw failure('runtime_host_postgres_mode_invalid');
  const dataInsideState = within(stateDirectory, pgDataDirectory) && !within(pgDataDirectory, stateDirectory);
  const stateDataOverlap = within(stateDirectory, pgDataDirectory) || within(pgDataDirectory, stateDirectory)
    || stateDirectory === pgDataDirectory;
  const invalidOwnedBoundary = mode === 'owned' && !dataInsideState;
  const invalidAttachedBoundary = mode === 'attached' && stateDataOverlap;
  if (within(bundleDirectory, stateDirectory) || within(stateDirectory, bundleDirectory)
    || within(repositoryDirectory, stateDirectory) || within(stateDirectory, repositoryDirectory)
    || invalidOwnedBoundary || invalidAttachedBoundary || within(bundleDirectory, pgDataDirectory)
    || within(pgDataDirectory, bundleDirectory) || within(repositoryDirectory, pgDataDirectory)
    || within(pgDataDirectory, repositoryDirectory)) {
    throw failure('runtime_host_private_state_boundary_invalid');
  }
  if (within(bundleDirectory, privateConfigFile) || within(repositoryDirectory, privateConfigFile)) {
    throw failure('runtime_host_private_config_boundary_invalid');
  }
  return true;
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
  // Reject ancestor reparse points and then compare resolved physical
  // directory identities, not user-supplied path spellings.
  await requireCanonicalPath(config.bundle_directory, 'directory');
  await requireCanonicalPath(config.state_directory, 'directory');
  await requireCanonicalPath(config.pg_data_directory, 'directory');
  const [bundleDirectory, stateDirectory, pgDataDirectory, privateConfigFile, repositoryDirectory] = await Promise.all([
    config.bundle_directory, config.state_directory, config.pg_data_directory, configFile, repositoryRoot,
  ].map(target => realpath(target)));
  validateRuntimeHostPhysicalBoundaries({
    bundleDirectory, stateDirectory, pgDataDirectory, privateConfigFile, repositoryDirectory,
    postgresMode: config.postgres_mode || 'owned',
  });
  return config;
}

async function acquireOwnership(stateDirectory, config) {
  // A crashed lock-reconciliation attempt may have quarantined the previous
  // lock but not yet acquired the successor. Never bypass its durable gate.
  try { await lstat(path.join(stateDirectory, 'runtime-host-recovery-gate.json')); throw failure('runtime_host_recovery_gate_unresolved'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lockPath = path.join(stateDirectory, 'runtime-host-lock.json');
  const bytes = JSON.stringify({ schema: 'compute.runtime-host-lock.v1', pid: process.pid, owner_nonce: randomUUID() }) + '\n';
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw failure('runtime_host_owner_lock_failed');
    if (config.postgres_mode !== 'attached') throw failure('runtime_host_owner_lock_exists');
    // Never delete or overwrite a prior owner's lock. Only exact stale-lock,
    // child-PID and port absence can quarantine an abandoned attached host.
    await reconcileAbandonedAttachedRuntimeLock({config});
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch { throw failure('runtime_host_owner_reacquisition_unconfirmed'); }
  }
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

async function denoExecutableIdentity(file, expected, singleLink) {
  await requireCanonicalPath(path.dirname(file), 'directory');
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || (singleLink && before.nlink !== 1)) {
    throw failure('runtime_host_deno_executable_path_invalid');
  }
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  const after = await lstat(file);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
    || after.isSymbolicLink() || !after.isFile() || (singleLink && after.nlink !== 1)
    || after.size !== expected.bytes || hash.digest('hex') !== expected.sha256) {
    throw failure('runtime_host_deno_executable_digest_mismatch');
  }
  return after;
}

// Deno creates DENO_DIR/node_compat_bin/node.exe as a hardlink to its running
// executable. Running the sealed bundle's Deno would therefore change its link
// count and invalidate the next bundle verification. Execute an independently
// copied, pinned private binary; generated node compatibility links stay private.
export async function stageManagedDenoExecutable({ verified, stateDirectory }) {
  await requireCanonicalPath(stateDirectory, 'directory');
  const source = verified?.paths?.denoExecutable;
  const record = verified?.manifest?.files?.find(file => file.path === 'runtime/deno/deno.exe' && file.component === 'deno');
  if (!record || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 1
    || !path.isAbsolute(source || '') || within(stateDirectory, source)) throw failure('runtime_host_deno_executable_pin_required');
  const sourceIdentity = await denoExecutableIdentity(source, record, true);
  const root = path.join(stateDirectory, 'deno-runtime');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await requireCanonicalPath(root, 'directory');
  const directory = path.join(root, record.sha256);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await requireCanonicalPath(directory, 'directory');
  const target = path.join(directory, 'deno.exe');
  try {
    // A previous private copy may have its normal Deno compatibility hardlink.
    // Verify it before replacement; changed private bytes are never repaired.
    await denoExecutableIdentity(target, record, false);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(directory, '.deno-' + randomUUID() + '.exe');
  try {
    // A newly created file inherits the protected state DACL. Native Windows
    // CopyFile can retain the source descriptor, which belongs to the bundle.
    await pipeline(createReadStream(source), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const copyIdentity = await denoExecutableIdentity(temporary, record, true);
    if (copyIdentity.ino === sourceIdentity.ino && copyIdentity.dev === sourceIdentity.dev) {
      throw failure('runtime_host_deno_executable_copy_aliased');
    }
    await denoExecutableIdentity(source, record, true);
    // Atomic replacement gives this run a single-link copy even when the
    // previous private inode remains reachable from node_compat_bin/node.exe.
    await rename(temporary, target);
    await denoExecutableIdentity(target, record, true);
    return target;
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
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
  const postgresMode = config.postgres_mode || 'owned';
  const launcherConfig = normalizeLauncherConfig({ mode: 'local', postgresMode,
    apiRoleMode: config.api_role_mode || 'service_role',
    expectedClusterSystemIdentifier: config.expected_cluster_system_identifier,
    databaseUrl: config.database_url, inspectDatabaseUrl: config.inspect_database_url,
    apiPort: config.api_port, edgePort: config.edge_port, startupTimeoutMs: config.startup_timeout_ms,
    pgDataDir: config.pg_data_directory, pgBinDir: verified.paths.postgresBinDirectory,
    nodePath: verified.paths.nodeExecutable, denoPath: verified.paths.denoExecutable, denoDir: verified.paths.denoDirectory,
    expectedStartupFilesSha256: verified.manifest.reviewed_startup_files_sha256, includeRuntimeHost: true, signal,
    startupManifestPath: path.join(config.state_directory, `runtime-startup-${randomUUID()}.json`),
  });
  const release = await acquireOwnership(config.state_directory, config);
  const baseStatus = { schema: 'metaengine.client-state.runtime-status.v1', state: 'STARTING', runtime_ready: false,
    state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false, automatic_cloud_fallback: false,
    host_pid: process.pid, bundle_sha256: config.expected_bundle_sha256, process_code_attested: false,
    last_health_failure: null, authority_effect: false };
  let runtime;
  let terminalPromise;
  let stopPromise;
  let guardianTicketConsumer = null;
  let guardianOpening = null;
  let guardianDrainPromise = null;
  let guardianCleanupUnconfirmed = false;
  const guardianAbort = new AbortController();
  let nativeCodingAuthority = null;
  let nativeCodingSql = null;
  let nativeCodingSeedBinding = null;
  let nativeCodingStartup = null;
  let abortRequested = signal?.aborted === true;
  let lastStatus = baseStatus;
  let lastHealthFailure = null;
  let persistTail = Promise.resolve();
  // Serialize health and lifecycle writes so a late diagnostic cannot replace
  // the terminal state. Functional updates use the latest persisted metadata.
  const persist = update => {
    const pending = persistTail.then(async () => {
      const status = typeof update === 'function' ? update(lastStatus) : update;
      await writeStatus(config.state_directory, status);
      lastStatus = status;
    });
    persistTail = pending.catch(() => {});
    return pending;
  };
  const reportRuntimeHealth = async event => {
    if (terminalPromise) return;
    if (event?.event === 'health_failure') {
      let diagnostic;
      try { diagnostic = normalizeRuntimeHealthFailure(event.health_failure); } catch { return; }
      lastHealthFailure = diagnostic;
      await persist(previous => ({ ...previous, last_health_failure: diagnostic }));
    } else if (event?.event === 'health_recovered') {
      lastHealthFailure = null;
      await persist(previous => ({ ...previous, last_health_failure: null }));
    }
  };
  const drainGuardianLane=()=>guardianDrainPromise??=(async()=>{
    let timer;
    try{await Promise.race([(async()=>{await guardianOpening;await guardianTicketConsumer?.close();})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('runtime_host_cleanup_unconfirmed')),6500);})]);}
    finally{clearTimeout(timer);}
  })();
  const finalize = outcome => {
    // Fence private ticket consumption synchronously, before any cleanup await.
    guardianAbort.abort();
    void guardianTicketConsumer?.close().catch(()=>{});
    if (!terminalPromise) terminalPromise = (async () => {
      let confirmed = outcome.children_stopped === true;
      try{await drainGuardianLane();}catch{guardianCleanupUnconfirmed=true;}
      if(guardianCleanupUnconfirmed)confirmed=false;
      // Startup may still own private reads or an acquired service. Fence it
      // through terminalPromise, then join its cleanup before ending SQL or
      // releasing the Host lock. A failed preparation is not a live capability.
      await nativeCodingStartup?.catch(() => {});
      nativeCodingAuthority?.close();
      nativeCodingSeedBinding?.close();
      if(nativeCodingSql) {await nativeCodingSql.end({timeout:5});nativeCodingSql=null;}
      if (outcome.last_health_failure) {
        try { lastHealthFailure = normalizeRuntimeHealthFailure(outcome.last_health_failure); } catch { /* Never forward unvalidated diagnostics. */ }
      }
      try { await persist(previous => ({ ...previous, state: confirmed ? 'STOPPED' : 'FAILED', runtime_ready: false,
        reason: confirmed ? String(outcome.reason || 'runtime_ended') : 'runtime_host_cleanup_unconfirmed',
        children_stopped: confirmed, last_health_failure: lastHealthFailure, stopped_at: new Date().toISOString() })); }
      finally { signal?.removeEventListener('abort', onAbort); if (confirmed) await release(); }
      if (confirmed) await hooks.onTerminal?.({ instance_id: lastStatus.instance_id || null,
        children_stopped: true, ownership_released: true, reason: outcome.reason });
      return confirmed?outcome:{...outcome,children_stopped:false,reason:'runtime_host_cleanup_unconfirmed'};
    })();
    return terminalPromise;
  };
  const stop = (reason = 'requested') => {
    guardianAbort.abort();
    const guardianDrain=guardianTicketConsumer?.close();
    void guardianDrain?.catch(()=>{});
    if (!stopPromise) stopPromise = (async () => {
      let outcome;
      let guardianClean=true;
      try{await drainGuardianLane();await guardianDrain;}catch{guardianClean=false;guardianCleanupUnconfirmed=true;}
      try { outcome = await runtime.stop(['requested', 'signal', 'parent_disconnect', 'startup_cancelled'].includes(reason) ? reason : 'requested'); }
      catch { await finalize({ reason: 'runtime_host_cleanup_unconfirmed', children_stopped: false }); throw failure('runtime_host_cleanup_unconfirmed'); }
      if(!guardianClean){await finalize({...outcome,children_stopped:false});throw failure('runtime_host_cleanup_unconfirmed');}
      return finalize(outcome);
    })();
    return stopPromise;
  };
  function onAbort() { guardianAbort.abort(); abortRequested = true; if (runtime) void stop('startup_cancelled').catch(() => {}); }
  // Lazy and private: ordinary startup opens no additional owner connection.
  // A failed/unsupported acquisition is not retried within this generation.
  async function handleGuardianTicketMessage(message,handle){
    if(handle){try{handle.destroy?.();}catch{}return;}
    if(guardianAbort.signal.aborted||abortRequested||terminalPromise||runtime?.stopped!==false)return;
    try{validateGuardianOwnerConsumeEnvelope(message,{host_instance_id:runtime.instanceId,host_pid:process.pid,
      parent_pid:process.ppid,launch_nonce:process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE});}catch{return;}
    guardianOpening??=(async()=>{
      const deadline=setTimeout(()=>guardianAbort.abort(),30000),clearDeadline=()=>clearTimeout(deadline);
      guardianAbort.signal.addEventListener('abort',clearDeadline,{once:true});
      try{
        const candidate=await createOwnedGuardianTicketConsumer({runtime,config,signal:guardianAbort.signal});
        if(guardianAbort.signal.aborted||abortRequested||terminalPromise||runtime.stopped===true)await candidate.close();
        else guardianTicketConsumer=candidate;
      }catch(error){
        if(error?.code==='guardian_owner_consume_cleanup_unconfirmed')guardianCleanupUnconfirmed=true;
        // Unsupported/legacy/unprotected profiles remain unavailable.
      }finally{clearTimeout(deadline);guardianAbort.signal.removeEventListener('abort',clearDeadline);}
    })();
    let releaseAbort;
    try{await Promise.race([guardianOpening,new Promise(resolve=>{
      releaseAbort=()=>resolve();guardianAbort.signal.addEventListener('abort',releaseAbort,{once:true});
      if(guardianAbort.signal.aborted)resolve();
    })]);}finally{guardianAbort.signal.removeEventListener('abort',releaseAbort);}
    if(!guardianAbort.signal.aborted)await guardianTicketConsumer?.handleMessage(message,handle);
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await persist(baseStatus);
    if (abortRequested) throw failure('runtime_host_startup_cancelled');
    const denoDir = await (hooks.stageDenoCache || stageManagedDenoCache)({ verified, stateDirectory: config.state_directory });
    const denoPath = await (hooks.stageDenoExecutable || stageManagedDenoExecutable)({ verified, stateDirectory: config.state_directory });
    runtime = await (hooks.launchRuntime || launchClientStateRuntime)({ ...launcherConfig, denoDir, denoPath }, { report: reportRuntimeHealth });
    if (abortRequested) { await stop('startup_cancelled'); throw failure('runtime_host_startup_cancelled'); }
    const descriptor = Object.freeze({ ...runtimeProviderDescriptor(runtime), status_file: path.join(config.state_directory, 'runtime-instance.json') });
    if (runtime.stopped === true) throw failure('runtime_host_child_ended_during_startup');
    const postgresContinuity=await runtimeRecoveryPostgresProof({identity:runtime.postgresIdentity,
      pgDataDirectory:config.pg_data_directory,expectedClusterSystemIdentifier:config.expected_cluster_system_identifier});
    if(abortRequested||runtime.stopped===true)throw failure('runtime_host_child_ended_during_startup');
    await persist({ ...baseStatus, state: 'READY', runtime_ready: true, checked_at: new Date().toISOString(),
      last_health_failure: lastHealthFailure,
      postgres_continuity:postgresContinuity,
      instance_id: descriptor.instance_id, endpoint: descriptor.endpoint, capability_health: runtime.edgeHealth.capability_health,
      postgres_mode: postgresMode, api_role_mode: launcherConfig.apiRoleMode, children: runtime.children, startup_source_sha256: runtime.startupManifest.source_manifest_sha256 });
    const finished = runtime.finished.then(finalize, () => finalize({ reason: 'runtime_host_child_failed', children_stopped: false }));
    if (runtime.stopped === true) throw failure('runtime_host_child_ended_during_startup');
    // Publish the pending lifetime before its first await. Finalization joins
    // this exact attempt; it never restarts native preparation.
    nativeCodingStartup = Promise.resolve().then(async () => {
      if(abortRequested||runtime.stopped===true||terminalPromise)throw failure('runtime_host_child_ended_during_startup');
      // An operator must first publish this private local-QA descriptor. Ordinary
      // installed clients do not open another DB capability or enable a backend.
      const operatorFile=path.join(config.state_directory,'native-coding-operator-v1.json');
      if(await lstat(operatorFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;})) {
        await readNativeCodingOperatorPaths(config.state_directory);
        const {default:postgres}=await import('postgres');
        // A terminal callback may have run while the private paths/import were
        // awaited. Never create new owned resources after its cleanup snapshot.
        if(abortRequested||runtime.stopped===true||terminalPromise)throw failure('runtime_host_child_ended_during_startup');
        nativeCodingSql=postgres(config.inspect_database_url,{max:2,connect_timeout:10,idle_timeout:30,prepare:false});
        const native=createNativeCodingHostOsScope({config,sql:nativeCodingSql,parentPid:process.ppid});
        let commitService=null,serviceHeartbeatOperations=null,transferred=false;
        try{
          // A missing/invalid separate commit capability fences commit only. It
          // must not take the existing PG/API or readonly agent path offline.
          try{
            if(await lstat(path.join(config.state_directory,'native-coding-git-commit-operator-v1.json')))
              commitService=await createNativeCodingHostCommitService({sql:nativeCodingSql,stateDirectory:config.state_directory,
                readNativeScope:native.readNativeScope,readProtectedReceipt:native.readProtectedReceipt});
          }catch{/* Missing/unreadable/invalid commit capability remains COMMIT_CAPABILITY_HOLD only. */}
          if(abortRequested||runtime.stopped===true||terminalPromise)throw failure('runtime_host_child_ended_during_startup');
          nativeCodingSeedBinding=createNativeCodingHostSeedBinding({sql:nativeCodingSql,stateDirectory:config.state_directory,
            readNativeScope:native.readNativeScope,hostInstanceId:descriptor.instance_id,hostPid:process.pid});
          try{await nativeCodingSeedBinding.prepare();}
          catch{/* Keep PG/API available; a later authenticated readonly discovery can inspect a newly published profile. */}
          const seedOperations=nativeCodingSeedBinding.operations;
          if(abortRequested||runtime.stopped===true||terminalPromise)throw failure('runtime_host_child_ended_during_startup');
          const serviceVerifier=createNativeCodingDeviceRequestVerifier({sql:nativeCodingSql,hostInstanceId:descriptor.instance_id,hostPid:process.pid});
          let serviceContext;
          try{serviceContext=createNativeCodingAuthenticatedRequestContext({verifier:serviceVerifier});}
          catch(error){serviceVerifier.close();throw error;}
          try{
            const service=await createNativeCodingHostServiceHeartbeat({sql:nativeCodingSql,hostInstanceId:descriptor.instance_id,hostPid:process.pid,
              readNativeScope:native.readNativeScope,readCurrentDevice:serviceContext.readCurrentDevice});
            serviceHeartbeatOperations={...Object.fromEntries(['SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT'].map(action=>[action,
              request=>serviceContext.run(action,request,(_input,checked)=>service[action](checked))])),
              close(){service.close();serviceContext.close();serviceVerifier.close();}};
          }catch{serviceContext.close();serviceVerifier.close();}
          if(abortRequested||runtime.stopped===true||terminalPromise)throw failure('runtime_host_child_ended_during_startup');
          const candidate=await createNativeCodingHostAuthority({sql:nativeCodingSql,...native,commitService,seedOperations,serviceHeartbeatOperations});
          transferred=true;
          if(abortRequested||runtime.stopped===true||terminalPromise){
            candidate.close();throw failure('runtime_host_child_ended_during_startup');
          }
          nativeCodingAuthority=candidate;
        }finally{
          // An ended Host may already have a cached finalize promise while an
          // optional service is still being created. Reclaim local capabilities
          // that never reached the canonical authority; never restart/stop PG.
          if(!transferred){
            try{commitService?.close();}finally{
              try{nativeCodingSeedBinding?.close();}finally{serviceHeartbeatOperations?.close();}
            }
          }
        }
      }
    });
    await nativeCodingStartup;
    return { descriptor, statusFile: path.join(config.state_directory, 'runtime-instance.json'), stop, finished,
      nativeCodingAuthority, handleGuardianTicketMessage };
  } catch (error) {
    // Also fence a pending optional binding when stop/finalize already has a
    // cached promise. Closing it cannot stop or replace the working PostgreSQL.
    nativeCodingSeedBinding?.close();
    if (runtime) await stop('requested');
    else {
      signal?.removeEventListener('abort', onAbort);
      try { await persist({ ...baseStatus, state: 'FAILED', last_health_failure: lastHealthFailure,
        reason: /^[a-z0-9_]+$/.test(error.code || '') ? error.code : 'runtime_host_start_failed' }); }
      finally { if (error.code !== 'runtime_cleanup_unconfirmed') await release(); }
      // launchClientStateRuntime rejects only after its bounded stop has
      // completed. Cleanup uncertainty has a distinct error and retains the
      // lock above. FAILED remains the startup status; this receipt proves
      // resource cleanup, never startup success or permission to retry work.
      if (error.code !== 'runtime_cleanup_unconfirmed') await hooks.onTerminal?.({ instance_id: null,
        children_stopped: true, ownership_released: true, reason: 'runtime_host_start_failed' });
    }
    throw error;
  }
}

async function main() {
  // Legacy direct qualification callers have IPC but no Browser generation
  // nonce. They receive no terminal proof. The Browser always supplies a nonce
  // and requires its matching proof, so absence cannot downgrade its cleanup.
  const launchNonce = process.send && process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE !== undefined
    ? requireRuntimeHostLaunchNonce(process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE) : null;
  const controller = new AbortController();
  let host;
  let pendingStop = null;
  let nativeCodingIpc = null;
  const requestStop = reason => { pendingStop ||= reason; controller.abort(); if (host) void host.stop(reason).catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', () => requestStop('signal'));
  process.once('SIGTERM', () => requestStop('signal'));
  process.once('disconnect', () => requestStop('parent_disconnect'));
  process.on('message', (message,handle) => {
    if (message?.schema === 'compute.runtime-host-control.v1' && message.command === 'stop') requestStop('requested');
    else if(message?.body?.schema==='metaengine.private.guardian-owner-consume.v1')
      void host?.handleGuardianTicketMessage(message,handle);
    else if(nativeCodingIpc) void nativeCodingIpc.handleMessage(message,handle);
  });
  host = await startManagedRuntimeHost({ configFile: process.env.COMPUTE_RUNTIME_HOST_CONFIG, signal: controller.signal }, {
    onTerminal: outcome => launchNonce === null ? undefined : sendRuntimeHostLifecycleMessage(process,
      runtimeHostTerminalMessage({ launchNonce, hostPid: process.pid, outcome })),
  });
  if(host.nativeCodingAuthority && process.send && process.connected) {
    nativeCodingIpc=createNativeCodingHostIpcServer({instanceId:host.descriptor.instance_id,
      operations:host.nativeCodingAuthority,hostPid:process.pid,parentPid:process.ppid,send:process.send.bind(process)});
  }
  if (pendingStop || (process.send && !process.connected)) await host.stop(pendingStop || 'parent_disconnect');
  else if (process.send) process.send(host.descriptor);
  else console.log(JSON.stringify(host.descriptor));
  const outcome = await host.finished;
  nativeCodingIpc?.close();
  if (!['requested', 'signal', 'parent_disconnect', 'startup_cancelled'].includes(outcome.reason)) process.exitCode = 1;
  if (process.connected) process.disconnect();
}

if (process.argv[1] && path.resolve(process.argv[1]) === hostEntry) {
  main().catch(async error => {
    // Child/DB/config errors can contain private connection strings. Emit only a fixed category.
    console.error(JSON.stringify({ schema: 'compute.runtime-host-failure.v1', state: 'FAILED',
      reason: /^[a-z0-9_]+$/.test(error.code || '') ? error.code : 'runtime_host_start_failed', credentials_included: false }));
    process.exitCode = 1;
    await sendRuntimeHostLifecycleMessage(process, runtimeHostFailureMessage(error));
    if (process.connected) process.disconnect();
  });
}
