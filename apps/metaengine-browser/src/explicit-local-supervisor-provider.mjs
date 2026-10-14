import { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_PINNED_INSTANCE_ID, NATIVE_SUPERVISOR_RUNTIME_PATH, validateNativeSupervisorLocalBase } from './native-supervisor-endpoints.mjs';
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
    resolved = validateNativeSupervisorLocalBase(raw);
    parsed = new URL(raw);
  } catch { throw new Error('local_supervisor_base_invalid'); }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || Number(parsed.port) < 1024 || parsed.username || parsed.password || parsed.pathname.replace(/\/+$/, '') !== NATIVE_SUPERVISOR_RUNTIME_PATH) throw new Error('local_supervisor_base_invalid');
  return Object.freeze({ provider, base_url: resolved, instance_id: instanceId });
}

export function explicitLocalSupervisorBase({ env = process.env, activeBase = NATIVE_SUPERVISOR_BASE } = {}) {
  // A missing or failed Host Owner bootstrap is an observational UNKNOWN,
  // not a malformed caller input that should crash a read-only page/sentinel.
  // Never turn this into a hosted/alternate Supervisor fallback.
  const boot = String(env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE || '').trim();
  if (boot !== 'READY') return null;
  const profile = localSupervisorProviderProfile(env);
  if (!NATIVE_SUPERVISOR_BASE) return null;
  // Caller-supplied env/activeBase cannot stand in for the module's native
  // Owner-bound pin established at bootstrap (including after process reuse).
  return profile?.base_url === activeBase && profile.base_url === NATIVE_SUPERVISOR_BASE
    && profile.instance_id.toLowerCase() === NATIVE_SUPERVISOR_PINNED_INSTANCE_ID
    ? profile.base_url : null;
}

export function localSupervisorHealthAttested(body, instanceId) {
  return localStateProviderHealthAttested(body, instanceId);
}
