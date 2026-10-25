import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_STATE_INSTANCE_UUID, validateLocalStateProviderConfig } from './local-state-provider-policy.mjs';
import { createNativeCodingHostIpcClient } from './native-coding-host-ipc-client.mjs';
import { verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';
import { finiteRuntimeRecoveryHealthFailure } from './runtime-recovery-policy.mjs';

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 45_000;
const ENVIRONMENT_KEYS = [
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'TEMP', 'TMP', 'PATH', 'Path', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE',
];
let ownedHost = null;
let startup = null;
let lastGeneration = null;
const generationObservers = new Set();
let generationSequence = 0;
let generationOrdinal = 0;
const TERMINAL_KEYS = ['schema', 'launch_nonce', 'host_pid', 'instance_id', 'state',
  'children_stopped', 'ownership_released', 'reason', 'authority_effect'].sort().join(',');

// Process exit alone does not establish that API/Edge or an owned database
// stopped. This acknowledgement travels on the exact verified child channel,
// after the Host persisted its terminal state and released its ownership lock.
function acceptTerminal(host, value) {
  const valid = value && Object.keys(value).sort().join(',') === TERMINAL_KEYS
    && value.schema === 'compute.runtime-host-terminal.v1'
    && value.launch_nonce === host.launchNonce && value.host_pid === host.child.pid
    && value.state === 'STOPPED' && value.children_stopped === true
    && value.ownership_released === true && value.authority_effect === false
    && /^[a-z][a-z0-9_]{0,119}$/.test(String(value.reason || ''))
    && (host.summary ? value.instance_id === host.summary.instance_id
      : value.instance_id === null || LOCAL_STATE_INSTANCE_UUID.test(String(value.instance_id || '')));
  if (!valid || (host.terminal && JSON.stringify(host.terminal) !== JSON.stringify(value))) {
    host.terminalRejected = true;
    return false;
  }
  host.terminal = Object.freeze({ ...value });
  return !host.terminalRejected;
}

function cleanupConfirmed(host) {
  return !host || (host.exited && (host.noSpawnEffect === true
    || (host.terminal && !host.terminalRejected)));
}

function generationSnapshot(host) {
  if (!host) return null;
  return Object.freeze({schema: 'metaengine.browser.runtime-host-generation.v1', sequence: host.sequence,
    launch_nonce: host.launchNonce, host_pid: host.child.pid || null, instance_id: host.summary?.instance_id || null,
    ever_ready: host.everReady === true, stopping: host.stopping, exited: host.exited,
    exit_code: host.exitCode ?? null, exit_signal: host.exitSignal ?? null,
    transport_failed: host.transportFailed, terminal_rejected: host.terminalRejected,
    terminal: host.terminal, cleanup_confirmed: Boolean(cleanupConfirmed(host)), authority_effect: false});
}

function publishGeneration(host) {
  if (lastGeneration && lastGeneration.ordinal > host.ordinal) return;
  host.sequence = ++generationSequence;
  lastGeneration = host;
  const snapshot = generationSnapshot(host);
  for (const observer of generationObservers) {
    try { void Promise.resolve(observer(snapshot)).catch(() => {}); } catch { /* Native observers cannot break child cleanup. */ }
  }
}

// Private native-main subscription. There is no renderer IPC surface, caller
// selected PID/path, child handle, configuration or credential in this API.
export function subscribeOwnedLocalRuntimeHostGeneration(observer) {
  if (typeof observer !== 'function') throw new Error('local_runtime_host_observer_invalid');
  generationObservers.add(observer);
  if (lastGeneration) {
    try { void Promise.resolve(observer(generationSnapshot(lastGeneration))).catch(() => {}); } catch {}
  }
  return () => generationObservers.delete(observer);
}

export async function readOwnedLocalRuntimeHostRecoveryObservation({ verifyStorage = verifyOwnerOnlyWindowsStorage } = {}) {
  const host = lastGeneration;
  if (!host) return null;
  const snapshot = generationSnapshot(host);
  let healthWitness = null;
  // The exact child terminal channel binds nonce/PID/instance. The independent
  // protected-file read binds that terminal to the final persisted diagnostic.
  if (snapshot.ever_ready && snapshot.exited && snapshot.cleanup_confirmed && snapshot.terminal?.reason === 'runtime_health_failed') {
    try {
      const file = await canonicalExisting(host.summary.status_file, 'file');
      for (const [target, operation] of [[path.dirname(file), 'VERIFY_DIRECTORY'], [file, 'VERIFY_FILE']]) {
        if ((await verifyStorage(target, {operation}))?.owner_dacl_verified !== true) throw new Error('private_status_unverified');
      }
      const before = await fs.stat(file), bytes = await boundedBytes(file, 128 * 1024, 'private_status_invalid'), after = await fs.stat(file);
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('private_status_changed');
      const status = JSON.parse(bytes.toString('utf8'));
      const failure = finiteRuntimeRecoveryHealthFailure(status.last_health_failure);
      if (status.schema !== 'metaengine.client-state.runtime-status.v1' || status.host_pid !== snapshot.host_pid
        || status.instance_id !== snapshot.instance_id || status.bundle_sha256 !== host.bundleDigest
        || status.state !== 'STOPPED' || status.runtime_ready !== false || status.children_stopped !== true
        || status.reason !== snapshot.terminal.reason || status.authority_effect !== false
        || !Number.isFinite(Date.parse(status.stopped_at)) || !failure) throw new Error('private_status_unbound');
      healthWitness = Object.freeze({schema: 'metaengine.browser.runtime-recovery-health-witness.v1',
        launch_nonce: snapshot.launch_nonce, host_pid: snapshot.host_pid, instance_id: snapshot.instance_id,
        bundle_sha256: host.bundleDigest, status_sha256: createHash('sha256').update(bytes).digest('hex'),
        stopped_at: status.stopped_at, failure, authority_effect: false});
    } catch { /* Absent, changed, unprotected or invalid bytes remain unproven. */ }
  }
  return lastGeneration === host ? Object.freeze({...snapshot, health_witness: healthWitness}) : null;
}

// Native-main capability only. The actual owned ChildProcess and immutable
// descriptor identity select the channel; no renderer-selected PID/endpoint.
export function createOwnedNativeCodingHostCapability(summary) {
  if(!ownedLocalRuntimeHostReady(summary)||!ownedHost.child?.connected) throw new Error('local_runtime_native_coding_host_unavailable');
  return createNativeCodingHostIpcClient({child:ownedHost.child,instanceId:summary.instance_id,hostPid:ownedHost.child.pid});
}
export function readOwnedLocalRuntimeHostSummary() {
  return ownedHost?.summary && ownedLocalRuntimeHostReady(ownedHost.summary) ? ownedHost.summary : null;
}
const shutdownApps = new WeakSet();
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_BINDING_KEYS = ['source_bundle_sha256', 'reviewed_startup_source_sha256',
  'reviewed_startup_files_sha256', 'resource_inventory_sha256'];
const samePath = (first, second) => process.platform === 'win32'
  ? first.toLowerCase() === second.toLowerCase() : first === second;

export function localRuntimeHostEnvironment(configFile, env = process.env) {
  const result = {};
  for (const key of ENVIRONMENT_KEYS) if (typeof env[key] === 'string') result[key] = env[key];
  // Pass only the private configuration's location. Database passwords, keys,
  // loader flags, provider identity and service tokens are never inherited.
  result.COMPUTE_RUNTIME_HOST_CONFIG = configFile;
  return result;
}

async function canonicalExisting(file, kind) {
  const resolved = path.resolve(file);
  let stat;
  let real;
  try { stat = await fs.lstat(resolved); real = await fs.realpath(resolved); }
  catch { throw new Error('local_runtime_host_path_unavailable'); }
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
    throw new Error('local_runtime_host_path_not_canonical');
  }
  if (process.platform === 'win32') {
    // realpath may expand valid 8.3 profile names; reject reparse-point
    // ancestors instead and return the physical spelling for identity checks.
    let current = path.parse(resolved).root;
    for (const segment of path.relative(current, resolved).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('local_runtime_host_path_not_canonical');
    }
  } else if (!samePath(real, resolved)) throw new Error('local_runtime_host_path_not_canonical');
  return real;
}

export function validatePackagedLocalRuntimeBinding(pkg, { bundleDirectory, expectedBundleDigest, resourcesPath }) {
  const binding = pkg?.metaengineClientStateRuntime;
  if (!binding || binding.schema !== 'metaengine.browser.client-state-runtime-binding.v1'
    || binding.schema_version !== 1 || typeof pkg.version !== 'string' || !pkg.version
    || binding.package_version !== pkg.version
    || !/^[a-f0-9]{40}$/.test(String(binding.source_head_sha || ''))
    || binding.bundle_manifest_relative_path !== 'offline-runtime-bundle.json'
    || binding.runtime_verifier_relative_path !== 'infra/client-state-runtime/offline-runtime-bundle.mjs'
    || typeof expectedBundleDigest !== 'string' || !SHA256.test(expectedBundleDigest) || binding.authority_effect !== false
    || !Number.isSafeInteger(binding.resource_file_count) || binding.resource_file_count < 1 || binding.resource_file_count > 10000
    || !Number.isSafeInteger(binding.resource_size_bytes) || binding.resource_size_bytes < 1 || binding.resource_size_bytes > 2 ** 31
    || typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)
    || !samePath(path.resolve(bundleDirectory), path.resolve(resourcesPath, 'client-state-runtime'))
    || ['bundle_sha256', 'bundle_manifest_sha256', 'runtime_verifier_sha256', ...SOURCE_BINDING_KEYS]
      .some(key => typeof binding[key] !== 'string' || !SHA256.test(binding[key]))) {
    throw new Error('packaged_local_runtime_binding_invalid');
  }
  // The package itself is well-formed, but the preserved Owner profile pins
  // another runtime generation. Never rewrite its custody as a side effect.
  if (binding.bundle_sha256 !== expectedBundleDigest) {
    throw new Error('packaged_local_runtime_owner_digest_mismatch');
  }
  return Object.freeze({ ...binding });
}

async function boundedBytes(file, maximumBytes, failure) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) throw new Error(failure);
    const bytes = await fs.readFile(file);
    if (bytes.length !== stat.size || bytes.length > maximumBytes) throw new Error(failure);
    return bytes;
  } catch { throw new Error(failure); }
}

async function verifyBundle(options) {
  // electron-builder packages the reviewed, builtin-only verifier in app.asar.
  // Executable children and their dependencies live in the pinned real bundle.
  const packaged = /[\\/]app\.asar(?:[\\/]|$)/i.test(fileURLToPath(import.meta.url));
  if (packaged) {
    let pkg;
    try { pkg = JSON.parse(await boundedBytes(new URL('../package.json', import.meta.url), 1024 * 1024, 'packaged_local_runtime_binding_invalid')); }
    catch { throw new Error('packaged_local_runtime_binding_invalid'); }
    const binding = validatePackagedLocalRuntimeBinding(pkg, { ...options, resourcesPath: process.resourcesPath });
    const manifestFile = path.join(options.bundleDirectory, 'offline-runtime-bundle.json');
    const before = await boundedBytes(manifestFile, 8 * 1024 * 1024, 'packaged_local_runtime_manifest_mismatch');
    if (createHash('sha256').update(before).digest('hex') !== binding.bundle_manifest_sha256) {
      throw new Error('packaged_local_runtime_manifest_mismatch');
    }
    const verifierBytes = await boundedBytes(new URL('../' + binding.runtime_verifier_relative_path, import.meta.url),
      1024 * 1024, 'packaged_local_runtime_verifier_mismatch');
    if (createHash('sha256').update(verifierBytes).digest('hex') !== binding.runtime_verifier_sha256) {
      throw new Error('packaged_local_runtime_verifier_mismatch');
    }
    // Builtin-only verifier bytes are read from protected app.asar, checked
    // against its own metadata and executed without resolving mutable files.
    // Runtime-generated source is checked by the protected bundle digest; it is not a static source import.
    const verifierModuleUrl = 'data:text/javascript;base64,' + verifierBytes.toString('base64');
    const verifier = await import(verifierModuleUrl);
    const verified = await verifier.verifyOfflineRuntimeBundle(options);
    const after = await boundedBytes(manifestFile, 8 * 1024 * 1024, 'packaged_local_runtime_manifest_mismatch');
    if (!before.equals(after) || SOURCE_BINDING_KEYS.some(key => verified.manifest[key] !== binding[key])
      || verified.manifest.files.length !== binding.resource_file_count
      || verified.manifest.files.reduce((sum, file) => sum + file.bytes, 0) !== binding.resource_size_bytes) {
      throw new Error('packaged_local_runtime_resource_binding_mismatch');
    }
    return verified;
  }
  const module = await import(new URL('../../../infra/client-state-runtime/offline-runtime-bundle.mjs', import.meta.url));
  return module.verifyOfflineRuntimeBundle(options);
}

// Installer onboarding uses the exact same protected-ASAR and immutable bundle
// verification as a normal provider boot. This publishes no credentials or effects.
export async function verifyInstalledClientStateResources({ bundleDirectory, expectedBundleDigest }) {
  return verifyBundle({ bundleDirectory, expectedBundleDigest });
}

function validProviderDescriptor(value, config) {
  const keys = ['schema', 'provider', 'endpoint', 'instance_id', 'status_file', 'runtime_ready',
    'automatic_cloud_fallback', 'hosted_supabase_required', 'authority_effect'];
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
    && value.schema === 'compute.runtime-host-provider.v1' && value.provider === 'LOCAL_POSTGRES'
    && value.endpoint === config.base_url && LOCAL_STATE_INSTANCE_UUID.test(value.instance_id)
    && typeof value.status_file === 'string' && path.isAbsolute(value.status_file)
    && path.resolve(value.status_file) === path.resolve(config.runtime_identity_file)
    && value.runtime_ready === true && value.automatic_cloud_fallback === false
    && value.hosted_supabase_required === false && value.authority_effect === false;
}

function waitForExit(host, timeoutMs) {
  if (host.exited) return Promise.resolve(true);
  return new Promise(resolve => {
    const complete = confirmed => {
      clearTimeout(timer);
      host.child.off('exit', onExit);
      resolve(confirmed);
    };
    const onExit = () => complete(true);
    const timer = setTimeout(() => complete(false), timeoutMs);
    host.child.once('exit', onExit);
  });
}

async function stopHost(host, timeoutMs) {
  if (!host || host.exited) return Boolean(cleanupConfirmed(host));
  host.stopping = true;
  publishGeneration(host);
  host.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'BLOCKED';
  host.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = 'OWNED_RUNTIME_HOST_STOPPING';
  try {
    if (host.child.connected) host.child.send({ schema: 'compute.runtime-host-control.v1', command: 'stop' });
  } catch {}
  const exited = await waitForExit(host, timeoutMs);
  if (!exited && host.child.connected) {
    // Disconnect is also the child's parent-death cleanup signal. Never kill
    // the host while it owns database/API processes; it retains its owner lock
    // if its bounded cleanup cannot confirm that those children stopped.
    try { host.child.disconnect(); } catch {}
  }
  return exited && Boolean(cleanupConfirmed(host));
}

export async function stopOwnedLocalRuntimeHost({ timeoutMs = STOP_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > STOP_TIMEOUT_MS) throw new Error('local_runtime_host_stop_timeout_invalid');
  // A quit/installer request can arrive while the pinned host is still starting.
  // Its own startup/failed-start cleanup is bounded; never report NO_OWNED_HOST
  // just because its ready descriptor has not arrived yet.
  const pending = startup;
  if (pending) {
    pending.cancelled = true;
    pending.cancel?.();
    await pending.promise.catch(() => {});
  }
  const host = ownedHost || pending?.host;
  const confirmed = await stopHost(host, timeoutMs);
  if (host && confirmed && ownedHost === host) ownedHost = null;
  return Object.freeze({ state: host ? (confirmed ? 'STOPPED' : 'CLEANUP_UNCONFIRMED') : 'NO_OWNED_HOST',
    cleanup_confirmed: confirmed, authority_effect: false });
}

export function ownedLocalRuntimeHostReady(summary) {
  // HTTP health can finish after shutdown or an unexpected child exit. Bind
  // final Browser admission to the exact still-owned process, without starting
  // a replacement host or trusting the previous READY descriptor alone.
  return Boolean(summary && ownedHost?.summary === summary && !ownedHost.exited
    && !ownedHost.stopping && !ownedHost.terminal && !ownedHost.terminalRejected && !ownedHost.transportFailed
    && ownedHost.child.connected !== false);
}

export function installLocalRuntimeHostShutdown(app) {
  if (!app || typeof app.on !== 'function' || typeof app.quit !== 'function') throw new Error('local_runtime_host_shutdown_app_invalid');
  if (shutdownApps.has(app)) return true;
  shutdownApps.add(app);
  let finishing = false;
  let pending = false;
  app.on('will-quit', event => {
    if (finishing || (!startup && (!ownedHost || cleanupConfirmed(ownedHost)))) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void stopOwnedLocalRuntimeHost().then(result => {
      pending = false;
      if (result.cleanup_confirmed !== true) {
        console.error(JSON.stringify({ schema: 'metaengine.browser.runtime-host.v1',
          state: 'LOCAL_RUNTIME_QUIT_BLOCKED', cleanup_confirmed: false,
          primary_kept_alive: true, authority_effect: false }));
        return;
      }
      finishing = true;
      app.quit();
    }).catch(() => {
      pending = false;
      console.error(JSON.stringify({ schema: 'metaengine.browser.runtime-host.v1',
        state: 'LOCAL_RUNTIME_QUIT_BLOCKED', cleanup_confirmed: false,
        primary_kept_alive: true, authority_effect: false }));
    });
  });
  return true;
}

export async function startConfiguredLocalRuntimeHost({
  config: rawConfig, env = process.env, verifyBundleImpl = verifyBundle, spawnImpl = spawn,
  startupTimeoutMs = START_TIMEOUT_MS, stopTimeoutMs = STOP_TIMEOUT_MS,
} = {}) {
  const config = validateLocalStateProviderConfig(rawConfig);
  if (!config.runtime_host) return null;
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > START_TIMEOUT_MS
    || !Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1 || stopTimeoutMs > STOP_TIMEOUT_MS) {
    throw new Error('local_runtime_host_timeout_invalid');
  }
  const ownerKey = JSON.stringify(config);
  if (startup) {
    if (startup.ownerKey !== ownerKey || startup.cancelled) throw new Error('local_runtime_host_startup_owner_conflict');
    return startup.promise;
  }
  if (ownedHost) {
    if (ownedHost.ownerKey !== ownerKey || !ownedLocalRuntimeHostReady(ownedHost.summary)) throw new Error('local_runtime_host_existing_owner_conflict');
    return ownedHost.summary;
  }
  const attempt = { ownerKey, promise: null, cancelled: false, cancel: null, host: null };
  const assertActive = () => { if (attempt.cancelled) throw new Error('local_runtime_host_start_cancelled'); };
  const promise = (async () => {
    const bundleDirectory = await canonicalExisting(config.runtime_host.bundle_directory, 'directory');
    const configFile = await canonicalExisting(config.runtime_host.config_file, 'file');
    if (configFile === path.resolve(config.runtime_identity_file)) throw new Error('local_runtime_host_config_identity_conflict');
    const verified = await verifyBundleImpl({
      bundleDirectory, expectedBundleDigest: config.runtime_host.expected_bundle_sha256,
    });
    // Quit/installer shutdown can happen while the bundle is being hashed.
    // A late verifier result must never create a new child after that stop.
    assertActive();
    const launchNonce = randomUUID();
    const child = spawnImpl(verified.paths.nodeExecutable, [verified.paths.hostEntry], {
      cwd: verified.paths.sourceRoot, env: { ...localRuntimeHostEnvironment(configFile, env),
        COMPUTE_RUNTIME_HOST_LAUNCH_NONCE: launchNonce },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true, shell: false,
    });
    const host = { child, env, ownerKey, launchNonce, exited: false, stopping: false,
      noSpawnEffect: false, terminal: null, terminalRejected: false, transportFailed: false, summary: null,
      bundleDigest: config.runtime_host.expected_bundle_sha256, everReady: false, sequence: 0, ordinal: ++generationOrdinal };
    attempt.host = host;
    publishGeneration(host);
    child.on('message', value => {
      if (value?.schema !== 'compute.runtime-host-terminal.v1') return;
      acceptTerminal(host, value);
      env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'BLOCKED';
      env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = host.terminalRejected
        ? 'OWNED_RUNTIME_HOST_TERMINAL_INVALID' : 'OWNED_RUNTIME_HOST_STOPPED';
      publishGeneration(host);
    });
    child.on('error', () => {
      host.transportFailed = true;
      // spawn errors have no live child and never emit exit. Mark this bounded
      // failure cleaned up instead of retaining an owner for a nonexistent PID.
      if (!child.pid) { host.exited = true; host.noSpawnEffect = true; }
      // An owned child can also report transport errors after readiness. Those
      // events never expose its private config or gain a hosted fallback.
      if (host.summary && !host.stopping) {
        env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'BLOCKED';
        env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = 'OWNED_RUNTIME_HOST_TRANSPORT_ERROR';
      }
      publishGeneration(host);
    });
    let stderrBytes = 0;
    child.stderr?.on('data', bytes => { stderrBytes += bytes.length; });
    child.once('disconnect', () => {
      host.transportFailed = true;
      if (!host.stopping && !host.terminal) {
        env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'BLOCKED';
        env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = 'OWNED_RUNTIME_HOST_DISCONNECTED';
      }
      publishGeneration(host);
    });
    child.once('exit', (code, signal) => {
      host.exited = true;
      host.exitCode = code;
      host.exitSignal = signal;
      // Retain an unknown generation. A subsequent bootstrap must not mistake
      // its disappearance for permission to start a replacement writer.
      if (ownedHost === host && cleanupConfirmed(host)) ownedHost = null;
      if (host.summary && !host.stopping) {
        env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'BLOCKED';
        env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = 'OWNED_RUNTIME_HOST_EXITED';
        console.error(JSON.stringify({ schema: 'metaengine.browser.runtime-host.v1',
          state: 'OWNED_RUNTIME_HOST_EXITED', automatic_cloud_fallback: false, authority_effect: false }));
      }
      publishGeneration(host);
    });
    try {
      const descriptor = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.off('message', onMessage);
          child.off('error', onError);
          child.off('exit', onExit);
          attempt.cancel = null;
          error ? reject(error) : resolve(value);
        };
        const onMessage = value => {
          if (value?.schema === 'compute.runtime-host-terminal.v1') return;
          if (value?.schema === 'compute.runtime-host-provider.v1') {
            finish(validProviderDescriptor(value, config) ? null : new Error('local_runtime_host_descriptor_invalid'), value);
          } else if (value?.schema === 'compute.runtime-host-failure.v1') {
            // Propagate one fixed actionable category from the pinned child.
            // Arbitrary error strings, paths and extra IPC fields stay private.
            const startupRecovery = value.state === 'FAILED' && value.credentials_included === false
              && Object.keys(value).sort().join(',') === 'credentials_included,reason,schema,state'
              && value.reason === 'runtime_host_recovery_startup_custody_missing';
            finish(new Error(startupRecovery ? 'local_runtime_host_startup_recovery_required'
              : 'local_runtime_host_start_failed'));
          } else finish(new Error('local_runtime_host_message_invalid'));
        };
        const onError = () => finish(new Error('local_runtime_host_spawn_failed'));
        const onExit = () => finish(new Error('local_runtime_host_exited_before_ready'));
        const timer = setTimeout(() => finish(new Error('local_runtime_host_start_timeout')), startupTimeoutMs);
        child.on('message', onMessage);
        child.once('error', onError);
        child.once('exit', onExit);
        attempt.cancel = () => finish(new Error('local_runtime_host_start_cancelled'));
        if (attempt.cancelled) attempt.cancel();
      });
      if (host.exited) throw new Error('local_runtime_host_exited_before_ready');
      if (host.stopping) throw new Error('local_runtime_host_stopped_before_ready');
      if (host.terminal || host.terminalRejected) throw new Error('local_runtime_host_stopped_before_ready');
      if (host.transportFailed) throw new Error('local_runtime_host_transport_failed_before_ready');
      assertActive();
      host.summary = Object.freeze({ schema: 'metaengine.browser.runtime-host.v1', state: 'READY',
        instance_id: descriptor.instance_id, endpoint: descriptor.endpoint,
        status_file: descriptor.status_file, pid: child.pid, runtime_owned: true,
        credentials_included: false, authority_effect: false });
      ownedHost = host;
      host.everReady = true;
      publishGeneration(host);
      return host.summary;
    } catch (error) {
      const cleanupConfirmed = await stopHost(host, stopTimeoutMs);
      if (!cleanupConfirmed) ownedHost = host;
      // Keep raw stderr and private config diagnostics in the owned server.
      // Only a fixed failure category escapes into Browser startup evidence.
      void stderrBytes;
      throw new Error(cleanupConfirmed ? String(error.message) : 'local_runtime_host_cleanup_unconfirmed');
    }
  })();
  attempt.promise = promise;
  startup = attempt;
  try { return await promise; } finally { if (startup?.promise === promise) startup = null; }
}
