const TRANSFORM = 'XTransformPort';

export function gatewayPort(value, fallback) {
  const raw = String(value ?? fallback);
  if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) throw new Error('gateway_port_invalid');
  return Number(raw);
}

export function gatewayConfiguration(env = process.env) {
  const gateway_port = gatewayPort(env.ME2_UI_GATEWAY_PORT, 8137);
  const ui_port = gatewayPort(env.ME2_UI_PORT, 3000);
  const daemon_port = gatewayPort(env.ME2_REST_PORT, 3041);
  // The dedicated Browser probe has no Socket.IO or stream server. Dormant
  // legacy ports cannot authorize unrelated services on the user's machine.
  const upstream_ports = [...new Set([ui_port, daemon_port])];
  if (upstream_ports.includes(gateway_port)) throw new Error('gateway_recursive_route_denied');
  return Object.freeze({ gateway_port, ui_port, daemon_port, upstream_ports: Object.freeze(upstream_ports) });
}

// Loopback binding alone does not stop a web page or DNS rebinding from using
// the gateway as a relay. Both HTTP and WebSocket must pass the same policy
// before opening an upstream socket.
export function resolveGatewayRequest({ url = '/', headers = {} } = {}, config) {
  const denied = (status, reason) => Object.freeze({ ok: false, status, reason });
  const origin = `http://127.0.0.1:${config.gateway_port}`;
  if (headers.host !== `127.0.0.1:${config.gateway_port}`) return denied(403, 'gateway_host_denied');
  if (headers.origin != null && headers.origin !== origin) return denied(403, 'gateway_origin_denied');
  if (headers['sec-fetch-site'] != null && !['same-origin', 'none'].includes(headers['sec-fetch-site'])) {
    return denied(403, 'gateway_cross_site_denied');
  }
  if (typeof url !== 'string' || url.length > 8192 || !url.startsWith('/') || url.startsWith('//')
    || /[\\\x00-\x20\x7f#]/.test(url)) return denied(400, 'gateway_url_invalid');
  let parsed;
  try { parsed = new URL(url, origin); } catch { return denied(400, 'gateway_url_invalid'); }
  const values = parsed.searchParams.getAll(TRANSFORM);
  if (values.length > 1) return denied(400, 'gateway_duplicate_route');
  let port = config.ui_port;
  try { if (values.length) port = gatewayPort(values[0]); } catch { return denied(400, 'gateway_port_invalid'); }
  if (!config.upstream_ports.includes(port)) return denied(403, 'gateway_upstream_denied');
  parsed.searchParams.delete(TRANSFORM);
  return Object.freeze({ ok: true, port, path: `${parsed.pathname}${parsed.search}`, origin });
}

export function gatewayUpstreamHeaders(headers, port) {
  const removed = new Set(['host', 'connection', 'proxy-connection', 'keep-alive', 'transfer-encoding',
    'te', 'trailer', 'upgrade', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for']);
  for (const name of String(headers.connection || '').split(',')) removed.add(name.trim().toLowerCase());
  return { ...Object.fromEntries(Object.entries(headers).filter(([name]) => !removed.has(name.toLowerCase()))),
    host: `127.0.0.1:${port}`, connection: 'close' };
}
