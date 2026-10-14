// METAENGINE P0: no implicit cloud transport. The canonical native supervisor
// endpoint is available only after the own PostgreSQL Owner runtime has
// attested an explicit loopback base and instance identity.
import './local-state-provider-bootstrap.mjs';

export const NATIVE_SUPERVISOR_DEFAULT_BASE = null;

const selectedProvider = String(process.env.METAENGINE_STATE_PROVIDER || '').trim();
if (selectedProvider && selectedProvider !== 'LOCAL_POSTGRES')
  throw new Error('native_supervisor_state_provider_invalid');
export const NATIVE_SUPERVISOR_STATE_PROVIDER = selectedProvider || null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_PATH = '/a2-browser-native-supervisor-v1';
export const NATIVE_SUPERVISOR_RUNTIME_PATH = LOCAL_PATH;

function validateLocalBase(raw) {
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new Error('native_supervisor_local_base_invalid'); }
  const port = Number(parsed.port);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' ||
      !Number.isSafeInteger(port) || port < 1024 || port > 65535 ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname.replace(/\/+$/, '') !== LOCAL_PATH)
    throw new Error('native_supervisor_local_base_invalid');
  return `${parsed.origin}${LOCAL_PATH}`;
}

// Syntax-only validation. This does not pin a transport or attest an Owner.
export function validateNativeSupervisorLocalBase(raw) {
  return validateLocalBase(raw);
}

function attestedLocalBase() {
  const raw = String(process.env.METAENGINE_SUPERVISOR_BASE_URL || '').trim();
  const instance = String(process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID || '').trim();
  const bootState = String(process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE || '').trim();
  // Diagnostic startup with missing Owner is allowed, but has no transport.
  if (!raw && !instance) return null;
  if (!raw || !UUID.test(instance) || bootState !== 'READY')
    throw new Error('native_supervisor_local_provider_unattested');
  return validateLocalBase(raw);
}

const pinnedLocalProviderBase = selectedProvider === 'LOCAL_POSTGRES' ?
  attestedLocalBase() : null;
// Capture instance identity at module load, never on a later mutable env read.
export const NATIVE_SUPERVISOR_PINNED_INSTANCE_ID = pinnedLocalProviderBase
  ? String(process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID).trim().toLowerCase() : null;

// Dynamic ESM binding is retained for old importers. It is null until a
// trusted local Owner bootstrap succeeds; it never resolves to Supabase.
export let NATIVE_SUPERVISOR_BASE = pinnedLocalProviderBase;

export function resolveNativeSupervisorBase(rawBase = null) {
  const raw = rawBase == null
    ? String(process.env.METAENGINE_SUPERVISOR_BASE_URL || '').trim()
    : String(rawBase).trim();
  if (!raw) return null;
  const target = validateLocalBase(raw);
  if (!pinnedLocalProviderBase || target !== pinnedLocalProviderBase)
    throw new Error('native_supervisor_local_provider_endpoint_pinned');
  return target;
}

export function setNativeSupervisorBase(rawBase) {
  const raw = String(rawBase ?? '').trim();
  if (!raw) throw new Error('native_supervisor_base_url_required');
  const target = resolveNativeSupervisorBase(raw);
  if (!target) throw new Error('native_supervisor_local_provider_unattested');
  NATIVE_SUPERVISOR_BASE = target;
  return target;
}

export function nativeSupervisorRuntimeUrl(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/') || path.includes('?') || path.includes('#') ||
      path.includes('\\') || path.includes('..') || path.includes('//'))
    throw new Error('native_supervisor_runtime_path_invalid');
  if (!NATIVE_SUPERVISOR_BASE)
    throw new Error('native_supervisor_local_provider_unattested');
  return `${NATIVE_SUPERVISOR_BASE}${path}`;
}

export function nativeSupervisorSigningPath(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/') || path.includes('?') || path.includes('#') ||
      path.includes('\\') || path.includes('..') || path.includes('//'))
    throw new Error('native_supervisor_runtime_path_invalid');
  return `${NATIVE_SUPERVISOR_RUNTIME_PATH}${path}`;
}
