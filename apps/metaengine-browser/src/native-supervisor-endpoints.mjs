// R5 closure (ops audit 2026-09-21): the pinned Supabase endpoint used to be
// hard-duplicated in native-supervisor-endpoints.mjs AND
// native-supervisor-client-base.mjs. This file is now the single source of
// truth; client-base re-exports the resolved constant. The pinned default
// remains cloud-first (METAENGINE_H205F22_RECOVERY ref xpeibufgzjknrhbhpffp),
// with an optional METAENGINE_SUPERVISOR_BASE_URL override for local-edge
// rehearsal deployments so a cloud switch never requires a code edit + rebuild.
//
// Fallback Console closure (operator directive 2026-09-21): the resolved base
// is now a live ESM binding with a guarded setter. The Supabase health
// sentinel (supabase-health-sentinel.mjs) + fallback console runtime
// (fallback-console-runtime.mjs) may re-point the whole supervisor client at
// the local reserve edge while the pinned cloud is unresponsive or degraded,
// and switch back once the cloud proves stable again. The setter validates
// with the exact same rules as startup resolution, never accepts an empty
// value (no silent mid-run fallback to the pinned default), and the swap is
// refusal-free for importers because `export let` bindings stay live across
// the re-export chain (client-base → client-core-base request builders).
const DEFAULT_NATIVE_SUPERVISOR_BASE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1';

export const NATIVE_SUPERVISOR_DEFAULT_BASE = DEFAULT_NATIVE_SUPERVISOR_BASE;

export function resolveNativeSupervisorBase(rawBase = null) {
  const raw = rawBase == null
    ? String(process.env.METAENGINE_SUPERVISOR_BASE_URL || '').trim()
    : String(rawBase).trim();
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

export let NATIVE_SUPERVISOR_BASE = resolveNativeSupervisorBase();

// Failover hook (Fallback Console): validate + swap the live supervisor base.
// Throws on invalid input; refuses empty values so a misconfigured sentinel
// can never silently detach the client from an explicit operator decision.
export function setNativeSupervisorBase(rawBase) {
  const raw = String(rawBase ?? '').trim();
  if (!raw) throw new Error('native_supervisor_base_url_required');
  const next = resolveNativeSupervisorBase(raw);
  NATIVE_SUPERVISOR_BASE = next;
  return NATIVE_SUPERVISOR_BASE;
}

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

export const NATIVE_SUPERVISOR_RUNTIME_PATH = '/a2-browser-native-supervisor-v1';
