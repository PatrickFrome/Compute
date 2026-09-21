// R5 closure (ops audit 2026-09-21): the pinned Supabase endpoint used to be
// hard-duplicated in native-supervisor-endpoints.mjs AND
// native-supervisor-client-base.mjs. This file is now the single source of
// truth; client-base re-exports the resolved constant. The pinned default
// remains cloud-first (METAENGINE_H205F22_RECOVERY ref xpeibufgzjknrhbhpffp),
// with an optional METAENGINE_SUPERVISOR_BASE_URL override for local-edge
// rehearsal deployments so a cloud switch never requires a code edit + rebuild.
const DEFAULT_NATIVE_SUPERVISOR_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1';

function resolveNativeSupervisorBase() {
  const raw = String(process.env.METAENGINE_SUPERVISOR_BASE_URL || '').trim();
  if (!raw) return DEFAULT_NATIVE_SUPERVISOR_BASE;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('native_supervisor_base_url_invalid');
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    throw new Error('native_supervisor_base_url_protocol_denied');
  }
  if (parsed.search || parsed.hash) throw new Error('native_supervisor_base_url_invalid');
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

export const NATIVE_SUPERVISOR_BASE = resolveNativeSupervisorBase();
export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';

export function nativeSupervisorRuntimeUrl(pathname) {
  const path = String(pathname || '');
  if (!path.startsWith('/v1/')) throw new Error('native_supervisor_runtime_path_invalid');
  if (path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('..') || path.includes('//')) {
    throw new Error('native_supervisor_runtime_path_invalid');
  }
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
