import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchRpc, RPC_METHOD_EFFECTS, startHttpBridge } from '../src/rpc-server.mjs';

function makeMockRuntime() {
  const healthResult = {
    schema: 'metaengine.a2-compute-browser.health.v1',
    runtime: '0.2.0-dev.2',
    web_authority_effect: false,
    profiles: []
  };
  return {
    stateRoot: path.join(os.tmpdir(), 'a2-http-bridge-test'),
    health: () => Promise.resolve(healthResult),
    startProfile: ({ profileId }) => Promise.resolve({ profile_id: profileId, running: true }),
    stopProfile: (profileId) => Promise.resolve({ profile_id: profileId, running: false }),
    listProfiles: () => Promise.resolve([]),
    createContext: () => Promise.resolve({ context_id: 'c1' }),
    listContexts: () => Promise.resolve([]),
    closeContext: () => Promise.resolve({ closed: true }),
    createTarget: () => Promise.resolve({ target_id: 't1', bound: true }),
    listTargets: () => Promise.resolve([]),
    semanticSnapshot: () => Promise.resolve({ schema: 'metaengine.a2-browser-operator.semantic-frame.v1', nodes: [] }),
    activateTarget: () => Promise.resolve({ activated: true }),
    closeTarget: () => Promise.resolve({ closed: true }),
    navigateAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'NAVIGATE', status: 'EFFECTED' }),
    clickAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'CLICK', status: 'EFFECTED' }),
    typeAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'TYPE', status: 'EFFECTED' }),
    submitAction: (params) => Promise.resolve({ action_id: params?.actionId, kind: 'SUBMIT', status: 'EFFECTED' })
  };
}

function httpPost(port, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, headers: res.headers, body: raw ? JSON.parse(raw) : null });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('HTTP bridge accepts valid RPC call and returns health', async () => {
  const runtime = makeMockRuntime();
  const token = 'test-token-123';
  const bridge = await startHttpBridge(runtime, 0, token);
  try {
    const response = await httpPost(bridge.port, token, { method: 'runtime.health', id: 1, params: {} });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.id, 1);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.effect_class, RPC_METHOD_EFFECTS['runtime.health']);
    assert.equal(response.body.web_authority_effect, false);
    const expected = await runtime.health();
    assert.deepEqual(response.body.result, expected);
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge rejects missing auth header with 401', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'secret-token');
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: bridge.port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({}));
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, 'rpc_unauthorized');
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge rejects wrong token with 401', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'correct-token');
  try {
    const response = await httpPost(bridge.port, 'wrong-token', { method: 'runtime.health', id: 1 });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, 'rpc_unauthorized');
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge rejects unknown method with 403', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'token');
  try {
    const response = await httpPost(bridge.port, 'token', { method: 'evil.method', id: 1 });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error, 'rpc_method_forbidden');
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge rejects invalid JSON with 400', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'token');
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: bridge.port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength('not json')
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.on('error', reject);
      req.write('not json');
      req.end();
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, 'rpc_json_invalid');
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge rejects oversized body with 413', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'token');
  try {
    const largeBody = 'x'.repeat(1024 * 1024 + 1);
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: bridge.port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(largeBody)
        }
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.on('error', reject);
      req.write(largeBody);
      req.end();
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.body.error, 'rpc_frame_too_large');
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge returns correct effect_class for ACTUATION methods', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'token');
  try {
    const lease = { lease_id: 'l1', resource_id: 't1', actor_id: 'supervisor', not_after: new Date(Date.now() + 60000).toISOString(), hmac: 'fakehmac' };
    const actuationCases = [
      { method: 'action.navigate', params: { profileId: 'p1', targetId: 't1', actionId: 'a1', lease, url: 'about:blank', idempotencyKey: 'k1' } },
      { method: 'action.click', params: { profileId: 'p1', targetId: 't1', actionId: 'a2', lease, semanticId: 's1', framePath: [], idempotencyKey: 'k2' } },
      { method: 'action.type', params: { profileId: 'p1', targetId: 't1', actionId: 'a3', lease, semanticId: 's2', text: 'hello', idempotencyKey: 'k3' } },
      { method: 'action.submit', params: { profileId: 'p1', targetId: 't1', actionId: 'a4', lease, semanticId: 's3', idempotencyKey: 'k4' } }
    ];
    for (const { method, params } of actuationCases) {
      const response = await httpPost(bridge.port, 'token', { method, id: 1, params });
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.effect_class, 'ACTUATION');
    }
  } finally {
    await bridge.close();
  }
});

test('HTTP bridge rejects non-POST and non-/rpc with 404', async () => {
  const runtime = makeMockRuntime();
  const bridge = await startHttpBridge(runtime, 0, 'token');
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: bridge.port,
        path: '/other',
        method: 'GET'
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await bridge.close();
  }
});

test('dispatchRpc is exported and callable directly', async () => {
  const runtime = makeMockRuntime();
  const result = await dispatchRpc(runtime, 'runtime.health', {});
  assert.ok(result);
  assert.equal(result.schema, 'metaengine.a2-compute-browser.health.v1');
});
