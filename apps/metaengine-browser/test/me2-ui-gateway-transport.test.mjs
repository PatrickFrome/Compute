import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import test from 'node:test';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

test('real HTTP and WebSocket gateway rejects unconfigured and cross-origin upstream effects', { timeout: 12_000 }, async (t) => {
  let allowedHits = 0; let protectedHits = 0; let upgrades = 0;
  const allowed = createServer((req, res) => { allowedHits++; res.setHeader('Content-Type', 'text/html'); res.end(req.url); });
  const protectedService = createServer((req, res) => { protectedHits++; res.end('PRIVATE'); });
  const reservation = createServer();
  let port; let allowedPort; let protectedPort;
  try {
    allowedPort = await listen(allowed); protectedPort = await listen(protectedService); port = await listen(reservation);
    await close(reservation);
  } catch (error) {
    for (const server of [allowed, protectedService, reservation]) server.close();
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('loopback bind denied by this execution environment; CI must run this transport test'); return; }
    throw error;
  }
  process.env.ME2_UI_GATEWAY_PORT = String(port);
  process.env.ME2_UI_PORT = String(allowedPort);
  // This synthetic UI fixture is explicitly adopted for a transport test.
  // Production Browser never enables external UI adoption by default.
  process.env.ME2_UI_ALLOW_EXTERNAL_ADOPT = '1';
  const { startMe2UiGateway, stopMe2UiGateway, me2UiGatewayStatus } = await import('../src/me2/me2-ui-gateway.mjs');
  const { startMe2UiHost, stopMe2UiHost } = await import('../src/me2/me2-ui-host.mjs');
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  const ws = (upstream, origin) => new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => socket.write(
      `GET /socket?XTransformPort=${upstream} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\n\r\n`));
    socket.once('error', reject); socket.once('data', (data) => { socket.destroy(); resolve(data.toString()); });
  });
  allowed.on('upgrade', (_req, socket) => { upgrades++; socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); });
  try {
    await startMe2UiHost();
    await startMe2UiGateway();
    assert.deepEqual(await get(`/events?XTransformPort=${allowedPort}&limit=1`), { status: 200, body: '/events?limit=1' });
    assert.equal((await get(`/private?XTransformPort=${protectedPort}`)).status, 403);
    assert.equal((await get(`/events?XTransformPort=${allowedPort}`, { origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await get(`/events?XTransformPort=${allowedPort}`, { host: `rebinding.invalid:${port}` })).status, 403);
    assert.match(await ws(protectedPort, `http://127.0.0.1:${port}`), /403/);
    assert.match(await ws(allowedPort, 'https://foreign.invalid'), /403/);
    assert.match(await ws(allowedPort, `http://127.0.0.1:${port}`), /101/);
    assert.equal(allowedHits, 2); assert.equal(protectedHits, 0); assert.equal(upgrades, 1);
    assert.equal((await get('/state?XTransformPort=3041')).status, 503, 'an unowned declared daemon port must be denied');
    stopMe2UiGateway();
    assert.equal(me2UiGatewayStatus().active_sockets, 0);
  } finally {
    stopMe2UiGateway(); stopMe2UiHost(); await close(allowed); await close(protectedService);
  }
});
