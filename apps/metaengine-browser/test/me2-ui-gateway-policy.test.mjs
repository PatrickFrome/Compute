import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayConfiguration, resolveGatewayRequest, gatewayUpstreamHeaders } from '../src/me2/me2-ui-gateway-policy.mjs';

const config = gatewayConfiguration({});
const request = (url, headers = {}) => ({ url, headers: { host: '127.0.0.1:8137', ...headers } });

test('same-origin UI and configured daemon routes preserve query semantics and strip only the routing key', () => {
  assert.equal(resolveGatewayRequest(request('/'), config).port, 3000);
  const route = resolveGatewayRequest(request('/events?limit=7&XTransformPort=3041&query=a%26b', { origin: 'http://127.0.0.1:8137' }), config);
  assert.equal(route.ok, true);
  assert.equal(route.port, 3041);
  assert.equal(new URL(route.path, 'http://localhost').searchParams.get('query'), 'a&b');
  assert.equal(new URL(route.path, 'http://localhost').searchParams.has('XTransformPort'), false);
  assert.equal(resolveGatewayRequest(request('/XTransformPort=9999'), config).port, 3000);
});

for (const url of ['/state?XTransformPort=22', '/state?XTransformPort=5432', '/state?XTransformPort=8137',
  '/state?XTransformPort=3042', '/state?XTransformPort=65536', '/state?XTransformPort=3041.5',
  '/state?XTransformPort=3e3', '/state?XTransformPort=', '/state?XTransformPort=-1',
  '/state?XTransformPort=3041&XTransformPort=3040', '/state?XTransformPort=3041&%58TransformPort=3040',
  '//foreign.invalid/state', 'http://foreign.invalid/state', '/state\\evil', '/state\r\nInjected: yes']) {
  test(`reject unsafe route ${JSON.stringify(url)} before any upstream selection`, () => {
    const route = resolveGatewayRequest(request(url), config);
    assert.equal(route.ok, false);
    assert.equal(route.port, undefined);
  });
}

for (const headers of [{ host: 'rebinding.invalid:8137' }, { host: '127.0.0.1:3000' },
  { origin: 'https://foreign.invalid' }, { origin: 'null' }, { origin: 'http://127.0.0.1:3000' },
  { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
  test(`reject cross-origin HTTP and WS policy ${JSON.stringify(headers)}`, () => {
    assert.equal(resolveGatewayRequest(request('/socket.io/?XTransformPort=3041', headers), config).ok, false);
  });
}

test('port overrides authorize exactly the declared services; invalid or recursive config is rejected', () => {
  const cfg = gatewayConfiguration({ ME2_UI_GATEWAY_PORT: '8138', ME2_REST_PORT: '3241' });
  assert.equal(resolveGatewayRequest({ url: '/?XTransformPort=3241', headers: { host: '127.0.0.1:8138' } }, cfg).ok, true);
  assert.equal(resolveGatewayRequest({ url: '/?XTransformPort=3041', headers: { host: '127.0.0.1:8138' } }, cfg).ok, false);
  assert.throws(() => gatewayConfiguration({ ME2_UI_PORT: '8137' }), /recursive/);
  assert.throws(() => gatewayConfiguration({ ME2_REST_PORT: 'NaN' }), /port_invalid/);
});

test('forwarded and connection-nominated headers cannot influence upstream origin or authentication', () => {
  const headers = gatewayUpstreamHeaders({ host: '127.0.0.1:8137', connection: 'keep-alive, x-secret',
    'x-secret': 'remove', forwarded: 'host=foreign.invalid', 'x-forwarded-host': 'foreign.invalid',
    'proxy-connection': 'keep-alive', 'sec-websocket-key': 'key', cookie: 'session=test' }, 3041);
  assert.equal(headers.host, '127.0.0.1:3041');
  assert.equal(headers.connection, 'close');
  assert.equal(headers.cookie, 'session=test');
  assert.equal(headers['sec-websocket-key'], 'key');
  for (const key of ['x-secret', 'forwarded', 'x-forwarded-host', 'proxy-connection']) assert.equal(headers[key], undefined);
});
