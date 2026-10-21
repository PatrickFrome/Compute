import fs from 'node:fs/promises';
import { canonicalLocalStateSupervisorBase, LOCAL_STATE_INSTANCE_UUID, localStateProviderHealthAttested, localStateProviderOwnerFile, validateLocalStateProviderConfig, validateLocalStateRuntimeIdentity } from './local-state-provider-policy.mjs';
import { ownedLocalRuntimeHostReady, startConfiguredLocalRuntimeHost, stopOwnedLocalRuntimeHost } from './local-runtime-host-controller.mjs';
import { qaUpgradeAdmissionFile, assertQaUpgradeAdmission } from './local-provider-upgrade-admission.mjs';

const CONFIG_MAX_BYTES = 16384;
const RUNTIME_MAX_BYTES = 65536;
// The local /health endpoint performs a bounded PostgreSQL capability read with
// statement_timeout=10s. Preserve a 2s transport margin; a shorter Browser
// admission deadline can reject a still-valid local Owner under contention.
const HEALTH_TIMEOUT_MS = 12000;

async function readBoundedJson(file, maximumBytes, { withBytes = false } = {}) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) throw new Error('local_state_provider_file_invalid');
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(maximumBytes + 1);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > maximumBytes) throw new Error('local_state_provider_file_too_large');
    try {
      const content = bytes.subarray(0, result.bytesRead), value = JSON.parse(content.toString('utf8'));
      return withBytes ? { value, bytes: content } : value;
    } catch { throw new Error('local_state_provider_json_invalid'); }
  } finally { await handle.close(); }
}

function failClosed(env, reason) {
  env.METAENGINE_STATE_PROVIDER = 'LOCAL_POSTGRES';
  env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'BLOCKED';
  env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = reason;
}

export async function bootstrapPersistentLocalProvider({
  env = process.env,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  ownerFile = localStateProviderOwnerFile({ env, platform }),
} = {}) {
  if (!ownerFile) {
    failClosed(env, 'NO_OWNER_CONFIG');
    delete env.METAENGINE_SUPERVISOR_BASE_URL;
    delete env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
    delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
    return Object.freeze({ state: 'NO_OWNER_CONFIG', persistent: false, authority_effect: false });
  }
  // An operator's two-phase install can publish the future Owner before NSIS
  // replaces the old image. No Browser may start that host until full installed
  // payload readback commits the transaction and retires this gate.
  try {
    await fs.lstat(ownerFile + '.qa-upgrade-gate.json');
    failClosed(env, 'local_state_provider_upgrade_install_pending');
    delete env.METAENGINE_SUPERVISOR_BASE_URL;
    delete env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
    delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
    throw new Error('local_state_provider_upgrade_install_pending');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      failClosed(env, 'local_state_provider_upgrade_install_pending');
      throw new Error('local_state_provider_upgrade_install_pending');
    }
  }
  let exists;
  try { exists = await fs.lstat(ownerFile); } catch (error) {
    if (error?.code === 'ENOENT') {
      failClosed(env, 'NO_OWNER_CONFIG');
      delete env.METAENGINE_SUPERVISOR_BASE_URL;
      delete env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
      delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
      return Object.freeze({ state: 'NO_OWNER_CONFIG', persistent: false, authority_effect: false });
    }
    failClosed(env, 'OWNER_CONFIG_UNREADABLE');
    throw new Error('local_state_provider_owner_config_unreadable');
  }
  if (!exists) throw new Error('local_state_provider_owner_config_unreadable');
  const inherited = {
    provider: String(env.METAENGINE_STATE_PROVIDER || '').trim(),
    base: String(env.METAENGINE_SUPERVISOR_BASE_URL || '').trim(),
    instance: String(env.METAENGINE_LOCAL_STATE_INSTANCE_ID || '').trim(),
  };
  failClosed(env, 'OWNER_CONFIG_VALIDATION_PENDING');
  try {
    const ownerRead = await readBoundedJson(ownerFile, CONFIG_MAX_BYTES, { withBytes: true });
    const config = validateLocalStateProviderConfig(ownerRead.value);
    // Retiring the install gate is not the final commit. New operator QA state
    // directories remain blocked through crashes/failures until a separate,
    // exact-Owner and bundle-bound admission record is durably committed.
    try {
      const admissionFile = qaUpgradeAdmissionFile(config);
      if (admissionFile) {
        assertQaUpgradeAdmission(await readBoundedJson(admissionFile, CONFIG_MAX_BYTES),
          { owner: config, ownerBytes: ownerRead.bytes });
      }
    } catch {
      delete env.METAENGINE_SUPERVISOR_BASE_URL;
      delete env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
      delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
      throw new Error('local_state_provider_upgrade_admission_unverified');
    }
    if ((inherited.provider && inherited.provider !== 'LOCAL_POSTGRES') || (inherited.base && canonicalLocalStateSupervisorBase(inherited.base) !== config.base_url) || (inherited.instance && !LOCAL_STATE_INSTANCE_UUID.test(inherited.instance))) {
      throw new Error('local_state_provider_environment_conflict');
    }
    env.METAENGINE_SUPERVISOR_BASE_URL = config.base_url;
    delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
    // An explicitly provisioned descriptor starts only its pinned offline host
    // and existing database. The Browser never reads private server config.
    const runtimeHost = await startConfiguredLocalRuntimeHost({ config, env });
    const identity = validateLocalStateRuntimeIdentity(await readBoundedJson(config.runtime_identity_file, RUNTIME_MAX_BYTES), config.base_url);
    if (runtimeHost && identity.instance_id !== runtimeHost.instance_id) throw new Error('local_state_provider_host_identity_mismatch');
    // Runtime restarts issue a new UUID. The durable owner file binds the base
    // and identity-file location; fresh health confirms that file's current UUID.
    env.METAENGINE_LOCAL_STATE_INSTANCE_ID = identity.instance_id;
    if (typeof fetchImpl !== 'function') throw new Error('local_state_provider_health_unavailable');
    const response = await fetchImpl(`${config.base_url}/health`, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response?.ok || !localStateProviderHealthAttested(await response.json(), identity.instance_id)) throw new Error('local_state_provider_health_unattested');
    if (runtimeHost && !ownedLocalRuntimeHostReady(runtimeHost)) throw new Error('local_state_provider_owned_host_not_ready');
    env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'READY';
    env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = 'OWNER_CONFIG_AND_RUNTIME_ATTESTED';
    return Object.freeze({
      state: 'READY', persistent: true, schema: config.schema, profile: config.profile,
      provider: 'LOCAL_POSTGRES', base_url: config.base_url, instance_id: identity.instance_id,
      owner_file: ownerFile, authority_effect: false,
      ...(runtimeHost ? { runtime_host: runtimeHost } : {}),
    });
  } catch (error) {
    const cleanup = await stopOwnedLocalRuntimeHost().catch(() => ({ cleanup_confirmed: false }));
    // Filesystem/network errors may include private paths or configuration.
    // Only bounded fixed categories reach Browser logs and the local dialog.
    const rawReason = String(error?.message || '');
    const reason = cleanup.cleanup_confirmed !== true ? 'local_runtime_host_cleanup_unconfirmed'
      : /^[a-z][a-z0-9_]{0,119}$/.test(rawReason) ? rawReason : 'local_state_provider_boot_failed';
    failClosed(env, reason);
    throw new Error(reason);
  }
}

const nonRuntimeProbeArguments = new Set([
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-client-goal-journal-probe',
  '--metaengine-single-instance-probe',
  '--metaengine-self-update-smoke',
  '--metaengine-installer-shutdown',
]);

export function localProviderRuntimeBootRequired(argv = process.argv) {
  return !argv.some(argument => nonRuntimeProbeArguments.has(String(argument)));
}

// These exact entrypoint modes do not load the Browser runtime. They must
// remain offline even when the owner selected a stopped local server.
export let persistentLocalProviderBootstrap = localProviderRuntimeBootRequired()
  ? await bootstrapPersistentLocalProvider()
  : Object.freeze({ state: 'OFFLINE_DIAGNOSTIC', persistent: false, network_started: false, authority_effect: false });

// Only the admitted packaged primary calls this *after* the existing protected
// attached-Keeper configuration was written. A second local health check must
// update the in-process binding consumed by the endpoint's static import; an
// inherited READY environment marker is never an acceptable substitute.
// This zero-argument entry point cannot select a profile, endpoint or fetcher.
export async function revalidatePersistentLocalProviderAfterAttach() {
  persistentLocalProviderBootstrap = Object.freeze({
    state: 'ATTACH_REVALIDATING', persistent: false, authority_effect: false,
  });
  try {
    const observed = await bootstrapPersistentLocalProvider();
    persistentLocalProviderBootstrap = observed;
    return observed;
  } catch (error) {
    persistentLocalProviderBootstrap = Object.freeze({
      state: 'BLOCKED', persistent: false, authority_effect: false,
    });
    throw error;
  }
}
