import path from 'node:path';

export const LOCAL_STATE_PROVIDER_CONFIG_SCHEMA = 'metaengine.browser.local-state-provider-config.v1';
export const LOCAL_STATE_PROVIDER_PROFILE = 'CLIENT_LOCAL_POSTGRES_V1';
export const LOCAL_STATE_PROVIDER_CONFIG_FILE = 'metaengine-state-provider-v1.json';
export const LOCAL_STATE_INSTANCE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalLocalStateSupervisorBase(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('local_state_provider_base_invalid'); }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/, '') !== '/a2-browser-native-supervisor-v1') {
    throw new Error('local_state_provider_base_invalid');
  }
  return `${parsed.origin}/a2-browser-native-supervisor-v1`;
}

export function localStateProviderOwnerFile({ env = process.env, platform = process.platform } = {}) {
  const root = String(platform === 'win32' ? env.APPDATA || '' : env.XDG_CONFIG_HOME || '').trim();
  if (!root || !path.isAbsolute(root)) return null;
  return path.join(root, '@metaengine', 'browser-shell', LOCAL_STATE_PROVIDER_CONFIG_FILE);
}

export function validateLocalStateProviderConfig(value) {
  const keys = ['schema', 'version', 'profile', 'provider', 'base_url', 'runtime_identity_file', 'authority_effect'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) {
    throw new Error('local_state_provider_config_shape_invalid');
  }
  if (value.schema !== LOCAL_STATE_PROVIDER_CONFIG_SCHEMA || value.version !== 1 || value.profile !== LOCAL_STATE_PROVIDER_PROFILE || value.provider !== 'LOCAL_POSTGRES' || value.authority_effect !== false) {
    throw new Error('local_state_provider_config_contract_invalid');
  }
  const runtimeFile = String(value.runtime_identity_file || '');
  if (!path.isAbsolute(runtimeFile) || /^(?:\\\\|\/\/)/.test(runtimeFile) || runtimeFile.length > 2048 || /[\x00-\x1f]/.test(runtimeFile)) throw new Error('local_state_provider_runtime_file_invalid');
  return Object.freeze({
    schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1,
    profile: LOCAL_STATE_PROVIDER_PROFILE, provider: 'LOCAL_POSTGRES',
    base_url: canonicalLocalStateSupervisorBase(value.base_url),
    runtime_identity_file: path.normalize(runtimeFile), authority_effect: false,
  });
}

export function validateLocalStateRuntimeIdentity(value, baseUrl) {
  if (!value || value.schema !== 'metaengine.client-state.runtime-status.v1' || value.state !== 'READY' || value.runtime_ready !== true || value.state_provider !== 'LOCAL_POSTGRES' || value.hosted_supabase_required !== false || value.automatic_cloud_fallback !== false || value.authority_effect !== false || !LOCAL_STATE_INSTANCE_UUID.test(String(value.instance_id || ''))) {
    throw new Error('local_state_provider_runtime_identity_invalid');
  }
  if (canonicalLocalStateSupervisorBase(value.endpoint) !== baseUrl || value.capability_health?.state !== 'ATTESTED' || value.capability_health?.authority_effect !== false) throw new Error('local_state_provider_runtime_identity_mismatch');
  return Object.freeze({ instance_id: String(value.instance_id), base_url: baseUrl });
}

export function localStateProviderHealthAttested(value, instanceId) {
  return LOCAL_STATE_INSTANCE_UUID.test(String(instanceId || ''))
    && value?.ok === true
    && value.instance_id === instanceId
    && value.state_provider === 'LOCAL_POSTGRES'
    && value.hosted_supabase_required === false
    && value.runtime_ready === true
    && value.capability_health?.state === 'ATTESTED'
    && value.capability_health?.authority_effect === false;
}
