import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import {
  BrowserExecutorClient,
  browserExecutorEndpoint,
  browserExecutorIpcManifest,
  createBrowserExecutorServer,
} from '../src/browser-executor-ipc.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-browser-executor-'));
  const endpoint = browserExecutorEndpoint({ userDataPath: root });
  const sessionKey = createHostAgentSessionKey();
  const calls = [];
  const server = createBrowserExecutorServer({
    endpoint,
    sessionKey,
    browserStatus: async (payload) => { calls.push(['status', payload]); return { ready: true, authority_effect: false }; },
    browserPlanExecute: async (payload) => { calls.push(['execute', payload]); return { status: 'CONFIRMED', plan_id: payload.plan_id, authority_effect: true }; },
    browserPlanCancel: async (payload) => { calls.push(['cancel', payload]); return { status: 'CANCEL_REQUESTED', plan_id: payload.plan_id, authority_effect: false }; },
  });
  await server.start();
  t.after(async () => {
    await server.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return { root, endpoint, sessionKey, server, calls };
}

test('Host Agent can call only typed Browser status execute and cancel over a persistent local connection', async (t) => {
  const h = await fixture(t);
  const client = new BrowserExecutorClient({ endpoint: h.endpoint, sessionKey: h.sessionKey });
  t.after(() => client.close());
  await client.connect();
  const status = await client.status({ detail: 'bounded' });
  const executed = await client.execute({ plan_id: 'plan-1', steps: [] });
  const cancelled = await client.cancel({ plan_id: 'plan-1' });
  assert.equal(status.ready, true);
  assert.equal(executed.status, 'CONFIRMED');
  assert.equal(cancelled.status, 'CANCEL_REQUESTED');
  assert.deepEqual(h.calls.map(([kind]) => kind), ['status', 'execute', 'cancel']);
  assert.equal(client.snapshot().ipc.connected, true);
  assert.equal(h.server.snapshot().command_leasing, false);
  assert.equal(h.server.snapshot().supervisor_identity, false);
});

test('authenticated caller cannot use Browser executor endpoint for control development or emergency operations', async (t) => {
  const h = await fixture(t);
  const generic = new HostAgentClient({ endpoint: h.endpoint, sessionKey: h.sessionKey });
  t.after(() => generic.close());
  await assert.rejects(generic.request('CONTROL_RUN_SUBMIT', { plan: [] }), /op_unhandled:CONTROL_RUN_SUBMIT/);
  await assert.rejects(generic.request('DEV_QUERY', { query: 'secret' }), /op_unhandled:DEV_QUERY/);
  await assert.rejects(generic.request('CONTROL_EMERGENCY_STOP', { action: 'DISARM' }), /op_unhandled:CONTROL_EMERGENCY_STOP/);
  assert.equal(h.calls.length, 0);
});

test('wrong Browser executor session key cannot reach any handler', async (t) => {
  const h = await fixture(t);
  const attacker = new BrowserExecutorClient({ endpoint: h.endpoint, sessionKey: createHostAgentSessionKey() });
  t.after(() => attacker.close());
  await assert.rejects(attacker.status(), /closed|auth|timeout/i);
  assert.equal(h.calls.length, 0);
});

test('Browser executor endpoint is deterministic and distinct from Host Agent control and identity signer naming', () => {
  const endpoint = browserExecutorEndpoint({ userDataPath: 'C:\\Users\\Owner\\AppData\\Roaming\\METAENGINE', platform: 'win32' });
  assert.match(endpoint, /^\\\\\.\\pipe\\metaengine-browser-executor-[0-9a-f]{24}$/);
  assert.equal(endpoint.includes('host-agent-'), false);
  assert.equal(endpoint.includes('identity-signer-'), false);
});

test('Browser executor manifest is narrow and has no command lease identity or raw execution surface', () => {
  const manifest = browserExecutorIpcManifest();
  assert.deepEqual(manifest.allowed_ops, ['BROWSER_STATUS', 'BROWSER_PLAN_EXECUTE', 'BROWSER_PLAN_CANCEL']);
  assert.equal(manifest.control_ops, false);
  assert.equal(manifest.development_ops, false);
  assert.equal(manifest.command_leasing, false);
  assert.equal(manifest.supervisor_identity, false);
  assert.equal(manifest.raw_shell, false);
  assert.equal(manifest.raw_cdp, false);
  assert.equal(manifest.arbitrary_eval, false);
  assert.equal(manifest.authority_effect, false);
});
