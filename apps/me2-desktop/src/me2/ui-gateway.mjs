/**
 * ME2 ui-gateway (:8137) — the desktop's internal gate, zero-based rebuild of the
 * R50 contract: every proxied request MUST carry ?XTransformPort=<allowed port>;
 * HTTP is proxied request/response, WS upgrades are raw-TCP piped. The gateway
 * never touches the network outside the ME2 allowlist.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { GATEWAY } from '../shared/me2-constants.mjs';
import { resolveGatewayRoute } from '../shared/me2-constants.mjs';

export function createUiGateway({ port = GATEWAY.PORT, allowlist = GATEWAY.ALLOWED_TARGETS, targetMap = null, log = () => {} } = {}) {
  // targetMap: test/diagnostic override {3041: <port>} — production routes 1:1.
  const resolveTarget = (t) => (targetMap && targetMap[t]) ?? t;
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const server = createServer((req, res) => {
    const route = resolveGatewayRoute({ url: req.url, allowlist });
    if (!route.allow) {
      res.writeHead(route.reason === 'port_not_allowed' ? 403 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'gateway_route_rejected', reason: route.reason }));
      log({ plane: 'ui-gateway', event: 'rejected', url: req.url, reason: route.reason });
      return;
    }
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: resolveTarget(route.target),
        path: route.pathname,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${route.target}` },
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('socket', track);
    res.on('close', () => upstream.destroy());
    upstream.on('error', (err) => {
      if (res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream_unreachable', target: route.target, detail: String(err?.code ?? err).slice(0, 80) }));
      log({ plane: 'ui-gateway', event: 'upstream_error', target: route.target });
    });
    req.pipe(upstream);
  });

  server.on('connection', track);

  // WS upgrade → raw TCP pipe to the allowed target (socket.io :3040, screencast :3042)
  server.on('upgrade', (req, socket, head) => {
    const route = resolveGatewayRoute({ url: req.url, allowlist });
    if (!route.allow) {
      socket.destroy();
      log({ plane: 'ui-gateway', event: 'upgrade_rejected', url: req.url, reason: route.reason });
      return;
    }
    const upstream = netConnect(resolveTarget(route.target), '127.0.0.1', () => {
      const raw = `${req.method} ${route.pathname} HTTP/1.1\r\n${Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n')}\r\n\r\n`;
      upstream.write(raw);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    track(upstream);
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return {
    server,
    port,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          const bound = server.address().port;
          log({ plane: 'ui-gateway', event: 'listening', port: bound });
          resolve({ port: bound });
        });
      });
    },
    close() {
      return new Promise(resolve => {
        server.close(() => resolve());
        // server.close does not terminate upgraded WebSocket connections.
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
