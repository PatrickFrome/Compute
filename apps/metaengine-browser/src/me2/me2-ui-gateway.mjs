/**
 * ME2 UI Gateway (R50 smart merge, фаза B) — встроенный мини-gateway браузерной оболочки.
 *
 * Порт механизма desktop/src/gateway.ts (R46) в me2-плоскость: UI Mission Control (панели v5)
 * написан относительно gateway (в песочнице — Caddy :81): все запросы — относительные пути
 * с query `XTransformPort=NNNN`, WS — тот же принцип. Чтобы ЕДИНЫЙ UI работал внутри
 * METAENGINE Browser без единой правки:
 *   • обычные запросы → http://127.0.0.1:3000 (Next UI, см. me2-ui-host.mjs);
 *   • ?XTransformPort=NNNN → http://127.0.0.1:NNNN (daemon :3040/:3041, стримы :3042/:3043);
 *   • WebSocket-upgrade проксируется сырым TCP-pipe (socket.io, screencast).
 * Наследие K2/K6-решения: авторитетная оболочка — браузер; desktop/ остаётся источником
 * механизмов, но собственных ворот больше не несёт.
 *
 * Гарантии: loopback-only (127.0.0.1), fail-open (занятый порт → честный DEGRADED, браузер живёт),
 * zero-authority (ничего не знает о self-update/окнах).
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as tcpConnect } from 'node:net';

export const ME2_UI_GATEWAY_SCHEMA = 'metaengine.browser.me2.ui-gateway.v1';

const GATEWAY_PORT = Number(process.env.ME2_UI_GATEWAY_PORT || 8137);
const UI_PORT = Number(process.env.ME2_UI_PORT || 3000);

let server = null;
let state = 'IDLE';
let lastError = null;
let stats = { http_ok: 0, http_fail: 0, ws_upgrades: 0 };

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

function targetPort(reqUrl) {
  const q = reqUrl.indexOf('XTransformPort=');
  if (q < 0) return UI_PORT;
  const end = reqUrl.indexOf('&', q);
  const raw = reqUrl.slice(q + 'XTransformPort='.length, end < 0 ? undefined : end);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : UI_PORT;
}

/** URL без служебного query-параметра (upstream не должен его видеть). */
function stripTransform(rawUrl) {
  const [path, query = ''] = rawUrl.split('?');
  if (!query) return path;
  const parts = query.split('&').filter((kv) => !kv.startsWith('XTransformPort='));
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

function proxyHttp(req, res) {
  const port = targetPort(req.url ?? '/');
  const path = stripTransform(req.url ?? '/');
  const headers = { ...req.headers, host: `127.0.0.1:${port}`, connection: 'close' };
  const upstream = httpRequest({ host: '127.0.0.1', port, path, method: req.method, headers }, (ur) => {
    if (ur.statusCode && ur.statusCode < 500) stats.http_ok += 1; else stats.http_fail += 1;
    res.writeHead(ur.statusCode ?? 502, ur.headers);
    ur.pipe(res);
  });
  upstream.on('error', (e) => {
    stats.http_fail += 1;
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `gateway: upstream :${port} недоступен (${String(e).slice(0, 80)})` }));
  });
  req.pipe(upstream);
}

/** WS-upgrade: переписываем первую строку (path без XTransformPort) и Host, дальше — сырой pipe. */
function proxyUpgrade(req, socket, head) {
  const port = targetPort(req.url ?? '/');
  const path = stripTransform(req.url ?? '/');
  stats.ws_upgrades += 1;
  const upstream = tcpConnect({ host: '127.0.0.1', port }, () => {
    const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      if (!k || /^host$/i.test(k) || /^connection$/i.test(k) || /^upgrade$/i.test(k)) continue;
      lines.push(`${k}: ${req.rawHeaders[i + 1] ?? ''}`);
    }
    lines.push('Connection: Upgrade', 'Upgrade: websocket', '\r\n');
    upstream.write(lines.join('\r\n'));
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
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
  if (server) {
    try { server.close(); } catch { /* уже закрыт */ }
    server = null;
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
    url: state === 'LIVE' ? `http://127.0.0.1:${GATEWAY_PORT}` : null,
    last_error: lastError,
    stats: { ...stats },
  };
}
