import { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_RUNTIME_PATH, resolveNativeSupervisorBase } from './native-supervisor-endpoints.mjs';
import { localStateProviderHealthAttested } from './local-state-provider-policy.mjs';

export function localSupervisorProviderProfile(env = process.env) {
  const provider = String(env.METAENGINE_STATE_PROVIDER || '').trim();
  if (!provider) return null;
  if (provider !== 'LOCAL_POSTGRES') throw new Error('local_supervisor_provider_invalid');
  const instanceId = String(env.METAENGINE_LOCAL_STATE_INSTANCE_ID || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanceId)) throw new Error('local_supervisor_instance_invalid');
  const raw = String(env.METAENGINE_SUPERVISOR_BASE_URL || '').trim();
  if (!raw) throw new Error('local_supervisor_base_required');
  let resolved;
  let parsed;
  try {
    resolved = resolveNativeSupervisorBase(raw);
    parsed = new URL(raw);
  } catch { throw new Error('local_supervisor_base_invalid'); }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || Number(parsed.port) < 1024 || parsed.username || parsed.password || parsed.pathname.replace(/\/+$/, '') !== NATIVE_SUPERVISOR_RUNTIME_PATH) throw new Error('local_supervisor_base_invalid');
  return Object.freeze({ provider, base_url: resolved, instance_id: instanceId });
}

export function explicitLocalSupervisorBase({ env = process.env, activeBase = NATIVE_SUPERVISOR_BASE } = {}) {
  const profile = localSupervisorProviderProfile(env);
  return profile?.base_url === activeBase ? profile.base_url : null;
}

export function localSupervisorHealthAttested(body, instanceId) {
  return localStateProviderHealthAttested(body, instanceId);
}
