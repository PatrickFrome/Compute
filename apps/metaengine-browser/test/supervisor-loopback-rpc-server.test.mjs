import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SupervisorLoopbackRpcServer, SUPERVISOR_LOOPBACK_RPC_SCHEMA, SUPERVISOR_LOOPBACK_RPC_METHODS } from '../src/supervisor-loopback-rpc-server.mjs';

function tempManifestPath() {
  return path.join(os.tmpdir(), `supervisor-loopback-test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
}

async function withServer({ executeCommand = async () => ({ ok: true, authority_effect: false }), snapshotProvider = async () => ({ running: true }), clientConnectionStatusProvider = null, clientWorkReadinessProvider = null } = {}, run) {
  const manifestPath = tempManifestPath();
  const server = new SupervisorLoopbackRpcServer({ executeCommand, snapshotProvider, clientConnectionStatusProvider, clientWorkReadinessProvider, manifestPath });
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
  assert.throws(() => new SupervisorLoopbackRpcServer({ executeCommand: async () => ({}), clientConnectionStatusProvider: {} }), /supervisor_loopback_client_connection_status_provider_invalid/);
  assert.throws(() => new SupervisorLoopbackRpcServer({ executeCommand: async () => ({}), clientWorkReadinessProvider: true }), /supervisor_loopback_client_work_readiness_provider_invalid/);
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
    assert.deepEqual(new Set(Object.keys(SUPERVISOR_LOOPBACK_RPC_METHODS)), new Set(['supervisor.health', 'supervisor.snapshot', 'supervisor.command', 'client.connection-status', 'client.work-readiness']));
    assert.equal(JSON.stringify(snapshot).includes(token), false);
    await server.stop();
    assert.equal(server.snapshot().state, 'STOPPED');
    await assert.rejects(() => fs.access(manifestPath), /ENOENT/);
    await assert.rejects(() => rpc(url, token, { method: 'supervisor.health' }));
  });
});

const clientConnection = () => ({
  schema: 'metaengine.client.connection-status.v1', local_runtime_ready: true, secure_device_key_ready: true,
  device_enrolled: true, enrollment_state: 'ENROLLED', admin_ready: true, access_tier: 'ADMIN',
  admin_scopes: ['CONTROL_PLANE', 'DEVOS', 'FLEET'], admin_grant_epoch: 4, cloud_control_state: 'CONNECTED',
  automatic_reconnect: true, reconnect_uses_existing_supervisor_cycle: true, second_connection_scheduler: false,
  local_shell_survives_cloud_outage: true, network_availability_guaranteed: false, legacy_daemon_feed_is_authority: false,
  master_secret_embedded: false, service_role_embedded: false, cloudflare_token_embedded: false,
  automatic_effect_retry_allowed: false, authority_effect: false,
});
const clientReadiness = () => ({
  schema: 'metaengine.client.work-readiness.v1', observed_at: '2026-10-03T00:00:00.000Z',
  state: 'BLOCKED', reason: 'AGENT_ORIGIN_UNVERIFIED', label: 'Agents unverified',
  detail: 'No active Agent session has matching origin and generation evidence.',
  execution_ready: false, heartbeat_fresh: true, generation_floor: 28, local_generation_floor: 28,
  supervisor_state: 'WAITING', supervisor_cycle_seq: 2, proven_agent_count: 0,
  active_agent_count: 0, bound_unverified_agent_count: 1, useful_work_verified: false,
  recovery_effect_exposed: false, scheduler_authority: false, automatic_retry_allowed: false, authority_effect: false,
});

test('authenticated Client reads delegate without parameters and never enter the command executor', async () => {
  let executions = 0;
  const calls = [];
  let readiness = clientReadiness();
  await withServer({
    executeCommand: async () => { executions += 1; throw new Error('must_not_execute'); },
    clientConnectionStatusProvider: (...args) => { calls.push({ method: 'connection', args }); return clientConnection(); },
    clientWorkReadinessProvider: (...args) => { calls.push({ method: 'readiness', args }); return readiness; },
  }, async ({ url, token, manifestPath }) => {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    for (const method of ['client.connection-status', 'client.work-readiness']) {
      assert.equal(manifest.methods[method], 'READ_ONLY');
      const result = await rpc(url, token, { method, params: {} });
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.effect_class, 'READ_ONLY');
      assert.equal(result.body.authority_effect, false);
      assert.equal(result.body.result.authority_effect, false);
    }
    readiness = { ...readiness, state: 'PAUSED', reason: 'WORKSPACE_EXECUTION_PAUSED' };
    const fresh = await rpc(url, token, { method: 'client.work-readiness' });
    assert.equal(fresh.body.result.state, 'PAUSED', 'read must use current owner state rather than a cached ready result');
    assert.equal(fresh.body.result.reason, 'WORKSPACE_EXECUTION_PAUSED');
    assert.equal(fresh.body.result.useful_work_verified, false);
    assert.equal(executions, 0);
    assert.deepEqual(calls, [{ method: 'connection', args: [] }, { method: 'readiness', args: [] }, { method: 'readiness', args: [] }]);
  });
});

test('Client read authentication and parameter rejection precede every provider call', async () => {
  let executions = 0;
  let observations = 0;
  await withServer({
    executeCommand: async () => { executions += 1; return {}; },
    clientConnectionStatusProvider: () => { observations += 1; return clientConnection(); },
    clientWorkReadinessProvider: () => { observations += 1; return clientReadiness(); },
  }, async ({ url, token }) => {
    for (const method of ['client.connection-status', 'client.work-readiness']) {
      const denied = await rpc(url, 'wrong-token', { method });
      assert.equal(denied.status, 401);
      for (const params of [null, [], 'status', { now: 0 }, { device_id: 'caller-device' }, { command: { action: 'NAVIGATE' } }, { authority_effect: true }]) {
        const result = await rpc(url, token, { method, params });
        assert.equal(result.status, 400);
        assert.equal(result.body.error, 'supervisor_loopback_client_params_forbidden');
      }
    }
    assert.equal(observations, 0);
    assert.equal(executions, 0);
  });
});

test('missing Client providers report unavailable without fabricating a readback', async () => {
  let executions = 0;
  await withServer({ executeCommand: async () => { executions += 1; return {}; } }, async ({ url, token }) => {
    for (const method of ['client.connection-status', 'client.work-readiness']) {
      const result = await rpc(url, token, { method });
      assert.equal(result.status, 503);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error, 'supervisor_loopback_client_provider_unavailable');
      assert.equal(Object.hasOwn(result.body, 'result'), false);
    }
    assert.equal(executions, 0);
  });
});

test('Client observation replies omit secrets, identity payloads and unknown fields and bound arrays/text', async () => {
  const secret = 'SENTINEL_PRIVATE_DEVICE_SECRET';
  const hidden = { token: secret, private_key: secret, device_id: secret, device: { key: secret }, prompt: secret, command: { payload: secret }, result_summary: secret };
  await withServer({
    clientConnectionStatusProvider: () => ({ ...clientConnection(), ...hidden, admin_scopes: Array.from({ length: 24 }, (_, i) => `SCOPE_${i}_${'x'.repeat(100)}`) }),
    clientWorkReadinessProvider: () => ({ ...clientReadiness(), ...hidden, label: 'l'.repeat(120), detail: 'd'.repeat(500), reason: 'r'.repeat(140) }),
  }, async ({ url, token }) => {
    const connection = await rpc(url, token, { method: 'client.connection-status' });
    assert.equal(connection.status, 200);
    assert.equal(connection.body.result.admin_scopes.length, 16);
    assert.ok(connection.body.result.admin_scopes.every((scope) => scope.length <= 64));
    const readiness = await rpc(url, token, { method: 'client.work-readiness' });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.result.label.length, 80);
    assert.equal(readiness.body.result.detail.length, 320);
    assert.equal(readiness.body.result.reason.length, 96);
    for (const body of [connection.body, readiness.body]) {
      assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
      for (const field of Object.keys(hidden)) assert.equal(Object.hasOwn(body.result, field), false);
      assert.equal(body.result.authority_effect, false);
    }
  });
});

test('Client owner schema, field types and effect violations are rejected rather than relabelled read-only', async () => {
  let executions = 0;
  let connection = clientConnection();
  let readiness = clientReadiness();
  await withServer({
    executeCommand: async () => { executions += 1; return {}; },
    clientConnectionStatusProvider: () => connection,
    clientWorkReadinessProvider: () => readiness,
  }, async ({ url, token }) => {
    for (const value of [null, [], { ...clientConnection(), schema: 'other' }, { ...clientConnection(), authority_effect: true }, { ...clientConnection(), authority_effect: undefined }, { ...clientConnection(), admin_scopes: ['DEVOS', {}] }, { ...clientConnection(), second_connection_scheduler: true }]) {
      connection = value;
      const result = await rpc(url, token, { method: 'client.connection-status' });
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'supervisor_loopback_client_read_invalid');
      assert.equal(Object.hasOwn(result.body, 'result'), false);
    }
    for (const value of [{ ...clientReadiness(), schema: 'other' }, { ...clientReadiness(), authority_effect: true }, { ...clientReadiness(), scheduler_authority: true }, { ...clientReadiness(), useful_work_verified: true }, { ...clientReadiness(), proven_agent_count: -1 }, { ...clientReadiness(), detail: { private_key: 'SENTINEL_SECRET' } }]) {
      readiness = value;
      const result = await rpc(url, token, { method: 'client.work-readiness' });
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'supervisor_loopback_client_read_invalid');
      assert.doesNotMatch(JSON.stringify(result.body), /SENTINEL_SECRET/);
    }
    assert.equal(executions, 0);
  });
});

test('Client provider failures never export internal error text or trigger commands', async () => {
  let executions = 0;
  const fail = () => { throw new Error('SENTINEL_PRIVATE_KEY'); };
  await withServer({
    executeCommand: async () => { executions += 1; return {}; },
    clientConnectionStatusProvider: fail, clientWorkReadinessProvider: fail,
  }, async ({ url, token }) => {
    for (const method of ['client.connection-status', 'client.work-readiness']) {
      const result = await rpc(url, token, { method });
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'supervisor_loopback_client_read_failed');
      assert.doesNotMatch(JSON.stringify(result.body), /SENTINEL_PRIVATE_KEY/);
    }
    assert.equal(executions, 0);
  });
});

test('inherited object method names cannot bypass the exact RPC allowlist', async () => {
  let executions = 0;
  let observations = 0;
  await withServer({
    executeCommand: async () => { executions += 1; return {}; },
    clientConnectionStatusProvider: () => { observations += 1; return clientConnection(); },
    clientWorkReadinessProvider: () => { observations += 1; return clientReadiness(); },
  }, async ({ url, token }) => {
    for (const method of ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty', 'client.submit-goal']) {
      const result = await rpc(url, token, { method, params: { command: { action: 'NAVIGATE', payload: { url: 'https://example.com' } } } });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'supervisor_loopback_method_unknown');
    }
    assert.equal(executions, 0);
    assert.equal(observations, 0);
  });
});

test('RPC method arrays and objects cannot coerce into valid read or command methods', async () => {
  let executions = 0;
  let observations = 0;
  await withServer({
    executeCommand: async () => { executions += 1; return {}; },
    clientConnectionStatusProvider: () => { observations += 1; return clientConnection(); },
    clientWorkReadinessProvider: () => { observations += 1; return clientReadiness(); },
  }, async ({ url, token }) => {
    for (const method of [['client.work-readiness'], ['client.connection-status'], ['supervisor.command'], ['supervisor.health'], { toString: 'supervisor.command' }, null, 0, true]) {
      const result = await rpc(url, token, { method, params: { command: { action: 'NAVIGATE' } } });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'supervisor_loopback_method_invalid');
    }
    assert.equal(executions, 0);
    assert.equal(observations, 0);
  });
});

test('Client schema and authority flags alone cannot qualify an empty or partial observation', async () => {
  let executions = 0;
  let connection = clientConnection();
  let readiness = clientReadiness();
  await withServer({
    executeCommand: async () => { executions += 1; return {}; },
    clientConnectionStatusProvider: () => connection,
    clientWorkReadinessProvider: () => readiness,
  }, async ({ url, token }) => {
    for (const [method, fixture, setValue] of [
      ['client.connection-status', clientConnection(), value => { connection = value; }],
      ['client.work-readiness', clientReadiness(), value => { readiness = value; }],
    ]) {
      setValue({ schema: fixture.schema, authority_effect: false });
      const empty = await rpc(url, token, { method });
      assert.equal(empty.status, 500);
      assert.equal(empty.body.error, 'supervisor_loopback_client_read_invalid');
      for (const field of Object.keys(fixture)) {
        const partial = { ...fixture };
        delete partial[field];
        setValue(partial);
        const result = await rpc(url, token, { method });
        assert.equal(result.status, 500, `${method} must reject missing ${field}`);
        assert.equal(result.body.ok, false);
        assert.equal(result.body.error, 'supervisor_loopback_client_read_invalid');
        assert.equal(Object.hasOwn(result.body, 'result'), false);
      }
    }
    assert.equal(executions, 0);
  });
});
