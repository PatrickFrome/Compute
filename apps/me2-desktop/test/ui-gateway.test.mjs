import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUiGateway } from '../src/me2/ui-gateway.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let upstream;
let upstreamBody = JSON.stringify({ ok: true, from: 'daemon-rest' });
let hitPath = null;

before(async () => {
  upstream = createServer((req, res) => {
    hitPath = req.url;
    res.setHeader('content-type', 'application/json');
    res.end(upstreamBody);
  });
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', () => {
      upstream.removeListener('error', reject);
      resolve();
    });
  });
});

after(() => upstream.close());

test('gateway: proxies to allowed XTransformPort target', async () => {
  const gw = createUiGateway({ port: 0, targetMap: { 3041: upstream.address().port } });
  const { port } = await gw.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health?XTransformPort=3041`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), upstreamBody);
    assert.equal(hitPath, '/health?XTransformPort=3041');
  } finally {
    await gw.close();
  }
});

test('gateway: routes UI and rejects disallowed / invalid XTransformPort', async () => {
  const gw = createUiGateway({ port: 0, targetMap: { 3000: upstream.address().port } });
  const { port } = await gw.listen();
  try {
    const noParam = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(noParam.status, 200);
    assert.equal(await noParam.text(), upstreamBody);
    const disallowed = await fetch(`http://127.0.0.1:${port}/x?XTransformPort=9999`);
    assert.equal(disallowed.status, 403);
    const invalid = await fetch(`http://127.0.0.1:${port}/x?XTransformPort=abc`);
    assert.equal(invalid.status, 400);
    const body = await disallowed.json();
    assert.equal(body.reason, 'port_not_allowed');
  } finally {
    await gw.close();
  }
});

test('gateway: upstream down → honest 502', async () => {
  // reserve an ephemeral port, then close it — a genuinely dead upstream
  const dead = createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const deadPort = dead.address().port;
  await new Promise((r) => dead.close(r));
  const gw = createUiGateway({ port: 0, targetMap: { 3043: deadPort } });
  const { port } = await gw.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health?XTransformPort=3043`);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'upstream_unreachable');
  } finally {
    await gw.close();
  }
});

test('gateway shutdown closes upgraded sockets in both directions', { timeout: 3000 }, async () => {
  const { connect } = await import('node:net');
  const ws = createServer();
  let remote;
  const upgraded = new Promise(resolve => ws.on('upgrade', (_req, socket) => {
    remote = socket;
    socket.on('error', error => assert.equal(error.code, 'ECONNRESET'));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.resume(); resolve();
  }));
  await new Promise(resolve => ws.listen(0, '127.0.0.1', resolve));
  const gw = createUiGateway({ port: 0, targetMap: { 3040: ws.address().port } });
  const { port } = await gw.listen();
  const client = connect(port, '127.0.0.1'); client.resume();
  client.on('error', error => assert.equal(error.code, 'ECONNRESET'));
  try {
    await new Promise(resolve => client.once('connect', resolve));
    client.write('GET /socket?XTransformPort=3040 HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    await upgraded;
    const closed = Promise.all([new Promise(resolve => client.once('close', resolve)), new Promise(resolve => remote.once('close', resolve))]);
    await gw.close(); await closed;
    assert.equal(client.destroyed, true); assert.equal(remote.destroyed, true);
  } finally {
    client.destroy(); remote?.destroy(); await gw.close();
    await new Promise(resolve => ws.close(resolve));
  }
});
