/**
 * ME2 UI Gateway (R50 smart merge, фаза B) — встроенный мини-gateway браузерной оболочки.
 *
 * Порт механизма desktop/src/gateway.ts (R46) в me2-плоскость: UI Mission Control (панели v5)
 * написан относительно gateway (в песочнице — Caddy :81): все запросы — относительные пути
 * с query `XTransformPort=NNNN`, WS — тот же принцип. Чтобы ЕДИНЫЙ UI работал внутри
 * METAENGINE Browser без единой правки:
 *   • обычные запросы → http://127.0.0.1:3000 (Next UI, см. me2-ui-host.mjs);
 *   • ?XTransformPort=NNNN → configured, ownership-qualified UI or read-only probe;
 *   • retired daemon WS/stream ports and all unconfigured ports are denied;
 *   • WebSocket-upgrade проксируется сырым TCP-pipe (socket.io, screencast).
 * Наследие K2/K6-решения: авторитетная оболочка — браузер; desktop/ остаётся источником
 * механизмов, но собственных ворот больше не несёт.
 *
 * Гарантии: loopback-only (127.0.0.1), fail-open (занятый порт → честный DEGRADED, браузер живёт),
 * zero-authority (ничего не знает о self-update/окнах).
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as tcpConnect } from 'node:net';
import { me2UiHostStatus } from './me2-ui-host.mjs';
import { me2DaemonStatus } from './me2-daemon-host.mjs';
import { gatewayConfiguration, resolveGatewayRequest, gatewayUpstreamHeaders } from './me2-ui-gateway-policy.mjs';

export const ME2_UI_GATEWAY_SCHEMA = 'metaengine.browser.me2.ui-gateway.v1';

const CONFIG = gatewayConfiguration();
const GATEWAY_PORT = CONFIG.gateway_port;
const UI_PORT = CONFIG.ui_port;

let server = null;
let state = 'IDLE';
let lastError = null;
let stats = { http_ok: 0, http_fail: 0, ws_upgrades: 0 };
const sockets = new Set();

function trackSocket(socket) {
  if (!socket || typeof socket.once !== 'function') return socket;
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  return socket;
}

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

function uiRouteAuthorized(port) {
  if (port === UI_PORT) return me2UiHostStatus()?.routing_authorized === true;
  return port === CONFIG.daemon_port && me2DaemonStatus()?.routing_authorized === true;
}

function proxyHttp(req, res) {
  const route = resolveGatewayRequest(req, CONFIG);
  if (!route.ok) {
    stats.http_fail += 1;
    res.writeHead(route.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: route.reason }));
    return;
  }
  const { port, path } = route;
  if (!uiRouteAuthorized(port)) {
    stats.http_fail += 1;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'gateway: upstream_unowned' }));
    return;
  }
  const headers = gatewayUpstreamHeaders(req.headers, port);
  const upstream = httpRequest({ host: '127.0.0.1', port, path, method: req.method, headers }, (ur) => {
    if (ur.statusCode && ur.statusCode < 500) stats.http_ok += 1; else stats.http_fail += 1;
    res.writeHead(ur.statusCode ?? 502, ur.headers);
    ur.pipe(res);
  });
  upstream.on('socket', trackSocket);
  upstream.setTimeout(30_000, () => upstream.destroy(new Error('gateway_upstream_timeout')));
  res.on('close', () => upstream.destroy());
  upstream.on('error', (e) => {
    stats.http_fail += 1;
    if (res.destroyed) return;
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `gateway: upstream :${port} недоступен (${String(e).slice(0, 80)})` }));
  });
  req.pipe(upstream);
}

/** WS-upgrade: переписываем первую строку (path без XTransformPort) и Host, дальше — сырой pipe. */
function proxyUpgrade(req, socket, head) {
  const route = resolveGatewayRequest(req, CONFIG);
  if (!route.ok || route.port !== UI_PORT || req.method !== 'GET' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    stats.http_fail += 1;
    try { socket.end(`HTTP/1.1 ${route.status || 400} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    return;
  }
  const { port, path } = route;
  if (!uiRouteAuthorized(port)) {
    stats.http_fail += 1;
    try { socket.destroy(); } catch { /* already closed */ }
    return;
  }
  stats.ws_upgrades += 1;
  const upstream = trackSocket(tcpConnect({ host: '127.0.0.1', port }, () => {
    const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`];
    for (const [key, value] of Object.entries(gatewayUpstreamHeaders(req.headers, port))) {
      if (key === 'host' || key === 'connection') continue;
      lines.push(`${key}: ${value}`);
    }
    lines.push('Connection: Upgrade', 'Upgrade: websocket', '\r\n');
    upstream.write(lines.join('\r\n'));
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  }));
  trackSocket(socket);
  const kill = () => { try { socket.destroy(); } catch { /* уже мёртв */ } try { upstream.destroy(); } catch { /* уже мёртв */ } };
  upstream.on('error', kill);
  socket.on('error', kill);
  upstream.on('close', kill);
  socket.on('close', kill);
}

export async function startMe2UiGateway() {
  if (server) return me2UiGatewayStatus();
  state = 'STARTING';
  await new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      try { proxyHttp(req, res); } catch (e) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `gateway: ${String(e).slice(0, 100)}` }));
        } catch { /* сокет уже закрыт */ }
      }
    });
    server.on('connection', trackSocket);
    server.on('upgrade', (req, socket, head) => {
      try { proxyUpgrade(req, socket, head); } catch { try { socket.destroy(); } catch { /* noop */ } }
    });
    server.once('error', (e) => {
      state = 'DEGRADED';
      lastError = String(e?.message || e).slice(0, 140);
      emitRow({ schema: ME2_UI_GATEWAY_SCHEMA, event: 'GATEWAY_FAILED', port: GATEWAY_PORT, error: lastError }, { error: true });
      reject(e);
    });
    server.listen(GATEWAY_PORT, '127.0.0.1', () => {
      state = 'LIVE';
      emitRow({ schema: ME2_UI_GATEWAY_SCHEMA, event: 'GATEWAY_LIVE', port: GATEWAY_PORT, ui_port: UI_PORT });
      resolve();
    });
  });
  return me2UiGatewayStatus();
}

export function stopMe2UiGateway() {
  const current = server;
  server = null;
  // R84 desktop semantic port: server.close() does not terminate upgraded
  // WebSockets. Destroy every tracked browser↔gateway/upstream socket so ME2
  // shutdown cannot retain process handles after the Browser lifecycle owner
  // exits. This is cleanup only and grants no browser or scheduler authority.
  for (const socket of [...sockets]) {
    try { socket.destroy(); } catch { /* already closed */ }
  }
  sockets.clear();
  if (current) {
    try { current.close(); } catch { /* уже закрыт */ }
  }
  state = 'STOPPED';
  return me2UiGatewayStatus();
}

export function me2UiGatewayStatus() {
  return {
    schema: ME2_UI_GATEWAY_SCHEMA,
    state,
    port: GATEWAY_PORT,
    ui_port: UI_PORT,
    allowed_upstream_ports: CONFIG.upstream_ports,
    same_origin_required: true,
    ui_route_authorized: me2UiHostStatus()?.routing_authorized === true,
    url: state === 'LIVE' ? `http://127.0.0.1:${GATEWAY_PORT}` : null,
    last_error: lastError,
    stats: { ...stats },
    active_sockets: sockets.size,
    upgraded_socket_shutdown_bounded: true,
    authority_effect: false,
  };
}
