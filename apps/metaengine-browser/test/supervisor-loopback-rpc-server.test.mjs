import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SupervisorLoopbackRpcServer, SUPERVISOR_LOOPBACK_RPC_SCHEMA, SUPERVISOR_LOOPBACK_RPC_METHODS } from '../src/supervisor-loopback-rpc-server.mjs';

function tempManifestPath() {
  return path.join(os.tmpdir(), `supervisor-loopback-test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
}

async function withServer({ executeCommand = async () => ({ ok: true, authority_effect: false }), snapshotProvider = async () => ({ running: true }) } = {}, run) {
  const manifestPath = tempManifestPath();
  const server = new SupervisorLoopbackRpcServer({ executeCommand, snapshotProvider, manifestPath });
  await server.start();
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const { token, url } = manifest;
  try {
    await run({ server, url, token, manifestPath });
  } finally {
    await server.stop().catch(() => {});
    await fs.unlink(manifestPath).catch(() => {});
  }
}

async function rpc(url, token, body, method = 'POST', pathSuffix = '/rpc') {
  const response = await fetch(new URL(pathSuffix, url).href, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test('constructor refuses non-loopback bind hosts', () => {
  assert.throws(() => new SupervisorLoopbackRpcServer({ executeCommand: async () => ({}), host: '0.0.0.0' }), /supervisor_loopback_host_not_loopback/);
  assert.throws(() => new SupervisorLoopbackRpcServer({ executeCommand: async () => ({}), host: 'example.com' }), /supervisor_loopback_host_not_loopback/);
  assert.throws(() => new SupervisorLoopbackRpcServer({ executeCommand: null }), /supervisor_loopback_executor_required/);
});

test('start writes a 0600 manifest and serves supervisor.health/snapshot', async () => {
  await withServer({}, async ({ url, token, manifestPath }) => {
    const stat = await fs.stat(manifestPath);
    // POSIX-only: Windows fs.stat does not reflect chmod bits (0600 request
    // is still made — it is just not observable there).
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o077, 0);
    const health = await rpc(url, token, { method: 'supervisor.health' });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.schema, SUPERVISOR_LOOPBACK_RPC_SCHEMA);
    assert.equal(health.body.authority_effect, false);
    const snapshot = await rpc(url, token, { method: 'supervisor.snapshot' });
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.result.running, true);
  });
});

test('supervisor.command delegates to the fenced executor and passes authority through', async () => {
  const seen = [];
  await withServer({
    executeCommand: async (command) => {
      seen.push(command);
      return { ok: true, tab_id: 'tab-1', authority_effect: true };
    },
  }, async ({ url, token }) => {
    const response = await rpc(url, token, {
      method: 'supervisor.command',
      params: { command: { action: 'NAVIGATE', payload: { url: 'https://example.com' }, command_id: 'cmd-loop-1' } },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.authority_effect, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].action, 'NAVIGATE');
    assert.equal(seen[0].command_id, 'cmd-loop-1');
    const mutating = JSON.stringify(seen[0]);
    assert.equal(mutating.includes('cmd-loop-1'), true);
  });
});

test('executor failures become ok:false RPC results, not transport errors', async () => {
  await withServer({
    executeCommand: async () => { throw new Error('tab_not_found'); },
  }, async ({ url, token }) => {
    const response = await rpc(url, token, { method: 'supervisor.command', params: { command: { action: 'SELECT_TAB' } } });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error, 'supervisor_loopback_command_failed');
    assert.equal(response.body.message, 'tab_not_found');
    assert.equal(response.body.authority_effect, false);
  });
});

test('auth, route, method and payload contracts are enforced', async () => {
  await withServer({}, async ({ url, token }) => {
    const wrongToken = await rpc(url, 'wrong-token', { method: 'supervisor.health' });
    assert.equal(wrongToken.status, 401);
    const get = await fetch(new URL('/rpc', url).href, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(get.status, 405);
    const wrongPath = await rpc(url, token, { method: 'supervisor.health' }, 'POST', '/other');
    assert.equal(wrongPath.status, 404);
    const unknown = await rpc(url, token, { method: 'supervisor.click_everything' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'supervisor_loopback_method_unknown');
    const badCommand = await rpc(url, token, { method: 'supervisor.command', params: { command: 'NAVIGATE' } });
    assert.equal(badCommand.status, 400);
    assert.equal(badCommand.body.error, 'supervisor_loopback_command_invalid');
  });
});

test('snapshot hides the token; stop closes the listener and removes the manifest', async () => {
  await withServer({}, async ({ server, url, token, manifestPath }) => {
    const snapshot = server.snapshot();
    assert.equal(snapshot.state, 'LISTENING');
    assert.equal(snapshot.token_exposed, false);
    assert.equal(snapshot.command_transport_authority, 'SHARED_FENCED_EXECUTOR');
    assert.deepEqual(new Set(Object.keys(SUPERVISOR_LOOPBACK_RPC_METHODS)), new Set(['supervisor.health', 'supervisor.snapshot', 'supervisor.command']));
    assert.equal(JSON.stringify(snapshot).includes(token), false);
    await server.stop();
    assert.equal(server.snapshot().state, 'STOPPED');
    await assert.rejects(() => fs.access(manifestPath), /ENOENT/);
    await assert.rejects(() => rpc(url, token, { method: 'supervisor.health' }));
  });
});
