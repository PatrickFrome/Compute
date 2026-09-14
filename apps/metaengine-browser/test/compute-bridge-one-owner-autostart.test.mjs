import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBridgeClient } from '../src/compute-bridge-client.mjs';

async function startFixture(endpoint, token) {
  if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline));
      assert.equal(request.token, token);
      assert.equal(request.method, 'runtime.health');
      socket.end(`${JSON.stringify({
        id: request.id,
        ok: true,
        effect_class: 'READ_ONLY',
        web_authority_effect: false,
        result: { schema: 'metaengine.a2-compute-browser.health.v1', runtime: '0.3.0-dev.3', profiles: [] },
      })}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  return async () => {
    await new Promise((resolve) => server.close(resolve));
    if (process.platform !== 'win32') await fs.rm(endpoint, { force: true }).catch(() => {});
  };
}

test('native owner is attached before autostart is considered', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-one-owner-first-'));
  const nativeStateRoot = path.join(dir, 'native');
  await fs.mkdir(nativeStateRoot, { recursive: true });
  const token = 'c'.repeat(64);
  await fs.writeFile(path.join(nativeStateRoot, 'control-token'), token);
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\metaengine-one-owner-first-${process.pid}-${Date.now()}`
    : path.join(dir, 'native.sock');
  const close = await startFixture(endpoint, token);
  let launchCount = 0;
  const client = new ComputeBridgeClient({
    manifestPath: path.join(dir, 'missing.json'),
    nativeStateRoot,
    nativeEndpoint: endpoint,
    autoStart: true,
    launchBridge: async () => { launchCount += 1; throw new Error('must_not_launch'); },
  });
  try {
    const health = await client.health();
    assert.equal(health.state, 'HEALTHY');
    assert.equal(health.transport, 'NATIVE_RPC');
    assert.equal(health.remediation, 'NATIVE_RPC_ATTACH');
    assert.equal(launchCount, 0);
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('daemon-lock race converges by attaching to the winning owner instead of launching a second daemon', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-one-owner-race-'));
  const nativeStateRoot = path.join(dir, 'native');
  await fs.mkdir(nativeStateRoot, { recursive: true });
  const token = 'd'.repeat(64);
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\metaengine-one-owner-race-${process.pid}-${Date.now()}`
    : path.join(dir, 'native.sock');
  let close = null;
  let launchCount = 0;
  const client = new ComputeBridgeClient({
    manifestPath: path.join(dir, 'missing.json'),
    nativeStateRoot,
    nativeEndpoint: endpoint,
    autoStart: true,
    autoStartTimeoutMs: 1500,
    autoStartPollMs: 25,
    launchBridge: async () => {
      launchCount += 1;
      await fs.writeFile(path.join(nativeStateRoot, 'control-token'), token);
      close = await startFixture(endpoint, token);
      throw new Error('daemon_lock_held');
    },
  });
  try {
    const health = await client.health();
    assert.equal(launchCount, 1);
    assert.equal(health.state, 'HEALTHY');
    assert.equal(health.transport, 'NATIVE_RPC');
    assert.equal(health.remediation, 'NATIVE_RPC_ATTACH');
    assert.match(health.remediation_error, /daemon_lock_held/);
  } finally {
    if (close) await close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
