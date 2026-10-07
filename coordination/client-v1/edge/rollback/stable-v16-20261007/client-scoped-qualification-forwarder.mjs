// A transport adapter for one approved installed client. Device enrollment,
// ADMIN grants, signature verification, nonce fencing and effects remain owned
// by the already qualified backend. This adapter never authenticates or retries.
export const QUALIFIED_META_CANARY_BASE =
  'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v14-canary';

export function createClientScopedQualificationForwarder({
  clientId,
  targetBase = QUALIFIED_META_CANARY_BASE,
  fetchImpl = globalThis.fetch,
  timeoutMs = 25_000,
} = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(clientId || ''))) {
    throw new Error('qualified_client_route_identity_invalid');
  }
  if (targetBase !== QUALIFIED_META_CANARY_BASE) {
    throw new Error('qualified_client_route_destination_invalid');
  }
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('qualified_client_route_transport_invalid');
  }
  const refuse = (status, reason) => new Response(JSON.stringify({
    error: reason,
    automatic_effect_retry_allowed: false,
    transport_is_authority: false,
  }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
  return async function forwardQualifiedClient(req, path) {
    if (req.headers.get('x-a2-chat-bridge-client') !== clientId) return null;
    if (!['GET', 'POST'].includes(req.method)) return null;
    if (typeof path !== 'string' || !/^\/v1\/[A-Za-z0-9][A-Za-z0-9._/-]{0,300}$/.test(path)
      || path.includes('//') || path.split('/').some(part => part === '.' || part === '..')) {
      return refuse(400, 'qualified_client_route_path_invalid');
    }
    if (req.headers.has('x-metaengine-qualified-route-hop')) {
      return refuse(508, 'qualified_client_route_loop_denied');
    }
    const source = new URL(req.url);
    const headers = new Headers(req.headers);
    for (const name of ['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding']) headers.delete(name);
    headers.set('x-metaengine-qualified-route-hop', '1');
    try {
      const body = req.method === 'GET' ? undefined : await req.arrayBuffer();
      const response = await fetchImpl(targetBase + path + source.search, {
        method: req.method,
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (response.status >= 300 && response.status < 400) {
        return refuse(502, 'qualified_client_route_redirect_denied');
      }
      const outHeaders = new Headers(response.headers);
      outHeaders.set('x-metaengine-qualified-client-route', 'META_QUALIFIED_CANARY');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      });
    } catch {
      // The upstream may have admitted an effect before a transport failure.
      // Never fall through to the legacy backend or issue the request again.
      return refuse(503, 'qualified_client_route_outcome_unknown');
    }
  };
}

