import path from 'node:path';

export const LOCAL_CLIENT_PROVIDER_SCHEMA = 'metaengine.client-local-provider-launch.v1';
const mount = '/a2-browser-native-supervisor-v1';

export function resolveLocalClientBase(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('local_client_base_invalid'); }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('local_client_loopback_base_required');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/, '') !== mount) {
    throw new Error('local_client_base_invalid');
  }
  return `${parsed.origin}${mount}`;
}

export function buildLocalClientEnvironment({ baseUrl, inheritedEnv = process.env } = {}) {
  const base = resolveLocalClientBase(baseUrl);
  const env = { ...inheritedEnv };
  for (const name of Object.keys(env)) {
    if (/^SUPABASE_/i.test(name) || /^LOCAL_STATE_/i.test(name) || /^PG/i.test(name)) delete env[name];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;
  env.METAENGINE_SUPERVISOR_BASE_URL = base;
  return env;
}

export async function verifyLocalClientProvider({ baseUrl, instanceId, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const base = resolveLocalClientBase(baseUrl);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(instanceId || ''))) {
    throw new Error('local_client_runtime_instance_required');
  }
  const response = await fetchImpl(`${base}/health`, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error('local_client_provider_unhealthy');
  const body = await response.json();
  if (body.instance_id !== instanceId) throw new Error('local_client_provider_instance_mismatch');
  if (body.ok !== true || body.state_provider !== 'LOCAL_POSTGRES' || body.hosted_supabase_required !== false) {
    throw new Error('local_client_provider_contract_invalid');
  }
  if (body.runtime_ready !== true || body.capability_health?.state !== 'ATTESTED' || body.capability_health?.authority_effect !== false) {
    throw new Error('local_client_provider_unattested');
  }
  return Object.freeze({ base_url: base, instance_id: instanceId, state_provider: 'LOCAL_POSTGRES', attested: true, authority_effect: false });
}

export async function prepareInstalledClientLocalLaunch({
  executablePath,
  baseUrl,
  instanceId,
  inheritedEnv = process.env,
  fetchImpl = fetch,
} = {}) {
  if (!path.isAbsolute(String(executablePath || ''))) throw new Error('installed_client_absolute_executable_required');
  const provider = await verifyLocalClientProvider({ baseUrl, instanceId, fetchImpl });
  return Object.freeze({
    schema: LOCAL_CLIENT_PROVIDER_SCHEMA,
    executable_path: path.normalize(executablePath),
    arguments: Object.freeze([]),
    environment: Object.freeze({ ...buildLocalClientEnvironment({ baseUrl: provider.base_url, inheritedEnv }), METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_LOCAL_STATE_INSTANCE_ID: instanceId }),
    provider,
    launch_kind: 'NORMAL_COLD_START',
    existing_primary_must_be_closed: true,
    preserve_existing_user_data: true,
    preserve_device_identity: true,
    automatic_cloud_fallback: false,
    installed_release_mutated: false,
    authority_effect: false,
  });
}
