import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBridgeClient, nativeComputeRpcEndpoint } from '../src/compute-bridge-client.mjs';

async function startNativeReadOnlyFixture(endpoint, expectedToken) {
  if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
  let requestCount = 0;
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline));
      requestCount += 1;
      assert.equal(request.token, expectedToken);
      assert.equal(request.method, 'runtime.health');
      assert.deepEqual(request.params, {});
      socket.end(`${JSON.stringify({
        id: request.id,
        ok: true,
        effect_class: 'READ_ONLY',
        web_authority_effect: false,
        result: {
          schema: 'metaengine.a2-compute-browser.health.v1',
          runtime: '0.3.0-dev.3',
          profiles: [],
        },
      })}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  return {
    get requestCount() { return requestCount; },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
    },
  };
}

test('native endpoint matches canonical daemon endpoint contract', () => {
  assert.equal(
    nativeComputeRpcEndpoint('/ignored-on-windows', { platform: 'win32', username: 'User Name!' }),
    '\\\\.\\pipe\\metaengine-a2-compute-browser-User_Name_',
  );
  assert.equal(
    nativeComputeRpcEndpoint('/tmp/metaengine-compute', { platform: 'linux', username: 'ignored' }),
    path.resolve('/tmp/metaengine-compute', 'control.sock'),
  );
});

test('stale HTTP manifest recovers through existing native daemon without starting a second runtime', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-native-attach-'));
  const manifestPath = path.join(dir, 'compute-bridge.json');
  const nativeStateRoot = path.join(dir, 'native-state');
  await fs.mkdir(nativeStateRoot, { recursive: true });
  const token = 'a'.repeat(64);
  await fs.writeFile(path.join(nativeStateRoot, 'control-token'), `${token}\n`);
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'http://127.0.0.1:47631/rpc', token: 'stale-http-token' }));
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\metaengine-native-attach-test-${process.pid}-${Date.now()}`
    : path.join(dir, 'native.sock');
  const fixture = await startNativeReadOnlyFixture(endpoint, token);
  let httpCalls = 0;
  const client = new ComputeBridgeClient({
    manifestPath,
    nativeStateRoot,
    nativeEndpoint: endpoint,
    timeoutMs: 1000,
    fetchImpl: async () => {
      httpCalls += 1;
      const error = new Error('connect ECONNREFUSED 127.0.0.1:47631');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    },
  });
  try {
    const health = await client.health();
    assert.equal(httpCalls, 1);
    assert.equal(fixture.requestCount, 1);
    assert.equal(health.state, 'HEALTHY');
    assert.equal(health.available, true);
    assert.equal(health.outage_proven, false);
    assert.equal(health.reason_code, 'HTTP_BRIDGE_RECOVERED_VIA_NATIVE_RPC');
    assert.equal(health.remediation, 'NATIVE_RPC_ATTACH');
    assert.equal(health.transport, 'NATIVE_RPC');
    assert.equal(health.automatic_remediation, true);
    assert.equal(health.result.runtime, '0.3.0-dev.3');
  } finally {
    await fixture.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('missing HTTP manifest can attach to the already-owned native daemon', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-native-missing-manifest-'));
  const nativeStateRoot = path.join(dir, 'native-state');
  await fs.mkdir(nativeStateRoot, { recursive: true });
  const token = 'b'.repeat(64);
  await fs.writeFile(path.join(nativeStateRoot, 'control-token'), `${token}\n`);
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\metaengine-native-missing-test-${process.pid}-${Date.now()}`
    : path.join(dir, 'native.sock');
  const fixture = await startNativeReadOnlyFixture(endpoint, token);
  const client = new ComputeBridgeClient({
    manifestPath: path.join(dir, 'missing.json'),
    nativeStateRoot,
    nativeEndpoint: endpoint,
    timeoutMs: 1000,
  });
  try {
    const health = await client.health();
    assert.equal(health.state, 'HEALTHY');
    assert.equal(health.transport, 'NATIVE_RPC');
    assert.equal(fixture.requestCount, 1);
  } finally {
    await fixture.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('native attach remains read-only and invalid HTTP configuration is not bypassed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-native-failclosed-'));
  const manifestPath = path.join(dir, 'compute-bridge.json');
  await fs.writeFile(manifestPath, JSON.stringify({ url: 'https://example.com/rpc', token: 'bad' }));
  const client = new ComputeBridgeClient({
    manifestPath,
    nativeStateRoot: path.join(dir, 'native-state'),
    nativeEndpoint: process.platform === 'win32' ? '\\\\.\\pipe\\does-not-exist' : path.join(dir, 'does-not-exist.sock'),
  });
  try {
    await assert.rejects(() => client.callNativeReadOnly('action.click', {}), /not_read_only/);
    const health = await client.health();
    assert.equal(health.state, 'UNAVAILABLE_CONFIG');
    assert.equal(health.reason_code, 'MANIFEST_INVALID');
    assert.equal(health.automatic_remediation, false);
    assert.equal('native_attach_error' in health, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
