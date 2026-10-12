import './local-state-provider-bootstrap.mjs';

// Own-PostgreSQL-only endpoint authority.
// Historical cloud/reserve fallback is retired: no base is available when the
// exact private local Owner cannot be attested. All mutating requests fail
// closed instead of selecting a hosted provider or a guessed localhost port.
// This ESM binding is shared by the Browser's existing Supervisor clients.
// Own PostgreSQL only. An absent owner is explicitly UNCONFIGURED, never a
// cloud URL. Packaged clients may start diagnostic UI but cannot submit effects.
const DEFAULT_NATIVE_SUPERVISOR_BASE = null;

export const NATIVE_SUPERVISOR_DEFAULT_BASE = DEFAULT_NATIVE_SUPERVISOR_BASE;

const selectedProvider = String(process.env.METAENGINE_STATE_PROVIDER || '').trim();
if (selectedProvider && selectedProvider !== 'LOCAL_POSTGRES') throw new Error('native_supervisor_state_provider_invalid');
export const NATIVE_SUPERVISOR_STATE_PROVIDER = selectedProvider || null;

function requiredLocalProviderBase() {
  const raw = String(process.env.METAENGINE_SUPERVISOR_BASE_URL || '').trim();
  const instanceId = String(process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID || '').trim();
  if (!raw) throw new Error('native_supervisor_local_base_required');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instanceId)) throw new Error('native_supervisor_local_instance_required');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('native_supervisor_local_base_invalid'); }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !Number.isSafeInteger(port) || port < 1024 || port > 65535 || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/, '') !== '/a2-browser-native-supervisor-v1') {
    throw new Error('native_supervisor_local_base_invalid');
  }
  return `${parsed.origin}/a2-browser-native-supervisor-v1`;
}

const pinnedLocalProviderBase = selectedProvider === 'LOCAL_POSTGRES' ? requiredLocalProviderBase() : null;

export function resolveNativeSupervisorBase(rawBase = null) {
  const raw = rawBase == null
    ? String(process.env.METAENGINE_SUPERVISOR_BASE_URL || '').trim()
    : String(rawBase).trim();
  if (!raw) throw new Error('native_supervisor_local_base_required');
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new Error('native_supervisor_base_url_invalid'); }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
    || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('native_supervisor_base_url_protocol_denied');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname.replace(/\/+$/, '') !== '/a2-browser-native-supervisor-v1') {
    throw new Error('native_supervisor_base_url_invalid');
  }
  return `${parsed.origin}/a2-browser-native-supervisor-v1`;
}

export let NATIVE_SUPERVISOR_BASE = pinnedLocalProviderBase;

// Failover hook (Fallback Console): validate + swap the live supervisor base.
// Throws on invalid input; refuses empty values so a misconfigured sentinel
// can never silently detach the client from an explicit operator decision.
export function setNativeSupervisorBase(rawBase) {
  const raw = String(rawBase ?? '').trim();
  if (!raw) throw new Error('native_supervisor_base_url_required');
  if (!pinnedLocalProviderBase) throw new Error('native_supervisor_local_owner_unconfigured');
  const next = resolveNativeSupervisorBase(raw);
  if (next !== pinnedLocalProviderBase) throw new Error('native_supervisor_local_provider_endpoint_pinned');
  NATIVE_SUPERVISOR_BASE = next;
  return NATIVE_SUPERVISOR_BASE;
}

export function nativeSupervisorRuntimeUrl(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/')) throw new Error('native_supervisor_runtime_path_invalid');
  if (path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('..') || path.includes('//')) {
    throw new Error('native_supervisor_runtime_path_invalid');
  }
  if (!NATIVE_SUPERVISOR_BASE) throw new Error('native_supervisor_local_owner_unconfigured');
  return `${NATIVE_SUPERVISOR_BASE}${path}`;
}

export function nativeSupervisorSigningPath(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/')) throw new Error('native_supervisor_runtime_path_invalid');
  if (path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('..') || path.includes('//')) {
    throw new Error('native_supervisor_runtime_path_invalid');
  }
  return `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
}

export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';
