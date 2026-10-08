import fs from 'node:fs/promises';
import { canonicalLocalStateSupervisorBase, LOCAL_STATE_INSTANCE_UUID, localStateProviderHealthAttested, localStateProviderOwnerFile, validateLocalStateProviderConfig, validateLocalStateRuntimeIdentity } from './local-state-provider-policy.mjs';

const CONFIG_MAX_BYTES = 16384;
const RUNTIME_MAX_BYTES = 65536;
const HEALTH_TIMEOUT_MS = 3000;

async function readBoundedJson(file, maximumBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) throw new Error('local_state_provider_file_invalid');
  const handle = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(maximumBytes + 1);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > maximumBytes) throw new Error('local_state_provider_file_too_large');
    try { return JSON.parse(bytes.subarray(0, result.bytesRead).toString('utf8')); } catch { throw new Error('local_state_provider_json_invalid'); }
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
  if (!ownerFile) return Object.freeze({ state: 'NO_OWNER_CONFIG', persistent: false, authority_effect: false });
  let exists;
  try { exists = await fs.lstat(ownerFile); } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ state: 'NO_OWNER_CONFIG', persistent: false, authority_effect: false });
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
    const config = validateLocalStateProviderConfig(await readBoundedJson(ownerFile, CONFIG_MAX_BYTES));
    if ((inherited.provider && inherited.provider !== 'LOCAL_POSTGRES') || (inherited.base && canonicalLocalStateSupervisorBase(inherited.base) !== config.base_url) || (inherited.instance && !LOCAL_STATE_INSTANCE_UUID.test(inherited.instance))) {
      throw new Error('local_state_provider_environment_conflict');
    }
    env.METAENGINE_SUPERVISOR_BASE_URL = config.base_url;
    delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
    const identity = validateLocalStateRuntimeIdentity(await readBoundedJson(config.runtime_identity_file, RUNTIME_MAX_BYTES), config.base_url);
    // Runtime restarts issue a new UUID. The durable owner file binds the base
    // and identity-file location; fresh health confirms that file's current UUID.
    env.METAENGINE_LOCAL_STATE_INSTANCE_ID = identity.instance_id;
    if (typeof fetchImpl !== 'function') throw new Error('local_state_provider_health_unavailable');
    const response = await fetchImpl(`${config.base_url}/health`, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response?.ok || !localStateProviderHealthAttested(await response.json(), identity.instance_id)) throw new Error('local_state_provider_health_unattested');
    env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE = 'READY';
    env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON = 'OWNER_CONFIG_AND_RUNTIME_ATTESTED';
    return Object.freeze({
      state: 'READY', persistent: true, schema: config.schema, profile: config.profile,
      provider: 'LOCAL_POSTGRES', base_url: config.base_url, instance_id: identity.instance_id,
      owner_file: ownerFile, authority_effect: false,
    });
  } catch (error) {
    failClosed(env, String(error?.message || 'LOCAL_PROVIDER_BOOT_FAILED').slice(0, 120));
    throw error;
  }
}

const nonRuntimeProbeArguments = new Set([
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-client-goal-journal-probe',
  '--metaengine-single-instance-probe',
  '--metaengine-self-update-smoke',
]);

export function localProviderRuntimeBootRequired(argv = process.argv) {
  return !argv.some(argument => nonRuntimeProbeArguments.has(String(argument)));
}

// These exact entrypoint modes do not load the Browser runtime. They must
// remain offline even when the owner selected a stopped local server.
export const persistentLocalProviderBootstrap = localProviderRuntimeBootRequired()
  ? await bootstrapPersistentLocalProvider()
  : Object.freeze({ state: 'OFFLINE_DIAGNOSTIC', persistent: false, network_started: false, authority_effect: false });
