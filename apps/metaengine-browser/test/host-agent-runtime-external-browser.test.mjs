import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { HostAgentRuntime } from '../src/host-agent-runtime.mjs';

test('Host Agent external mode delegates Browser operations only through typed Browser client', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-external-browser-'));
  const endpoint = path.join(root, 'host.sock');
  const sessionKey = createHostAgentSessionKey();
  const calls = [];
  const browserClient = {
    async status(payload) { calls.push(['status', payload]); return { ready: true, authority_effect: false }; },
    async execute(payload) { calls.push(['execute', payload]); return { status: 'CONFIRMED', authority_effect: true }; },
    async cancel(payload) { calls.push(['cancel', payload]); return { status: 'CANCEL_REQUESTED', authority_effect: false }; },
    snapshot() { return { schema: 'metaengine.browser-executor.ipc-client.v1', connected: true, authority_effect: false }; },
  };
  const runtime = new HostAgentRuntime({
    endpoint,
    sessionKey,
    developmentPlane: {
      request: async () => ({ repository_present: true, authority_effect: false }),
      snapshot: () => ({ state: 'READY', authority_effect: false }),
    },
    fastControl: {
      invoke: async (tool, payload) => ({ result: { tool, payload, authority_effect: false } }),
      snapshot: () => ({ authority_effect: false }),
    },
    browserClient,
  });
  const client = new HostAgentClient({ endpoint, sessionKey });
  t.after(async () => {
    client.close();
    await runtime.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  await runtime.start();
  assert.equal((await client.request('BROWSER_STATUS')).ready, true);
  assert.equal((await client.request('BROWSER_PLAN_EXECUTE', { plan_id: 'p1', steps: [] })).status, 'CONFIRMED');
  assert.equal((await client.request('BROWSER_PLAN_CANCEL', { plan_id: 'p1' })).status, 'CANCEL_REQUESTED');
  assert.deepEqual(calls.map(([kind]) => kind), ['status', 'execute', 'cancel']);
  assert.equal(runtime.snapshot().browser_boundary_mode, 'EXTERNAL_TYPED_IPC');
  assert.equal(runtime.snapshot().browser_executor_transport.connected, true);
  assert.equal(runtime.snapshot().second_scheduler, false);
  assert.equal(runtime.snapshot().raw_cdp_passthrough, false);
});

test('Host Agent refuses ambiguous Browser boundary configuration instead of picking a wider authority path', () => {
  const common = {
    endpoint: '/tmp/unused.sock',
    sessionKey: createHostAgentSessionKey(),
    developmentPlane: { request: async () => null },
    fastControl: { invoke: async () => null },
    browserClient: { status() {}, execute() {}, cancel() {} },
  };
  assert.throws(() => new HostAgentRuntime({ ...common, browserStatus: () => ({}) }), /browser_boundary_ambiguous/);
});
