import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import { HostAgentRuntime } from '../src/host-agent-runtime.mjs';
import {
  BrowserExecutorClient,
  browserExecutorEndpoint,
  createBrowserExecutorServer,
} from '../src/browser-executor-ipc.mjs';

test('external Host Agent and Browser executor compose through two persistent authenticated sockets with no direct callback shortcut', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-browser-composition-'));
  const browserKey = createHostAgentSessionKey();
  const hostKey = createHostAgentSessionKey();
  const browserEndpoint = browserExecutorEndpoint({ userDataPath: root });
  const hostEndpoint = path.join(root, 'host-agent.sock');
  const physical = [];

  const browserServer = createBrowserExecutorServer({
    endpoint: browserEndpoint,
    sessionKey: browserKey,
    browserStatus: async () => ({ state: 'READY', exact_target_generation: 7, authority_effect: false }),
    browserPlanExecute: async (payload) => {
      physical.push({ kind: 'execute', plan_id: payload.plan_id });
      return { status: 'CONFIRMED', plan_id: payload.plan_id, exact_target_generation: 7, authority_effect: true };
    },
    browserPlanCancel: async (payload) => {
      physical.push({ kind: 'cancel', plan_id: payload.plan_id });
      return { status: 'CANCEL_REQUESTED', plan_id: payload.plan_id, authority_effect: false };
    },
  });
  await browserServer.start();
  const browserClient = new BrowserExecutorClient({ endpoint: browserEndpoint, sessionKey: browserKey });
  await browserClient.connect();

  const runtime = new HostAgentRuntime({
    endpoint: hostEndpoint,
    sessionKey: hostKey,
    developmentPlane: {
      request: async () => ({ repository_present: true, head: 'a'.repeat(40), authority_effect: false }),
      snapshot: () => ({ state: 'READY', authority_effect: false }),
    },
    fastControl: {
      invoke: async (tool, payload) => ({ result: { tool, payload, authority_effect: false } }),
      snapshot: () => ({ second_scheduler: false, authority_effect: false }),
    },
    browserClient,
  });
  await runtime.start();
  const publicClient = new HostAgentClient({ endpoint: hostEndpoint, sessionKey: hostKey });
  t.after(async () => {
    publicClient.close();
    await runtime.close().catch(() => {});
    browserClient.close();
    await browserServer.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const status = await publicClient.request('BROWSER_STATUS');
  assert.equal(status.exact_target_generation, 7);
  const receipt = await publicClient.request('BROWSER_PLAN_EXECUTE', { plan_id: 'plan:composition:1', steps: [] }, { timeoutMs: 5000 });
  assert.equal(receipt.status, 'CONFIRMED');
  assert.equal(receipt.exact_target_generation, 7);
  assert.deepEqual(physical, [{ kind: 'execute', plan_id: 'plan:composition:1' }]);
  assert.equal(runtime.snapshot().browser_boundary_mode, 'EXTERNAL_TYPED_IPC');
  assert.equal(runtime.snapshot().browser_executor_transport.ipc.connected, true);
  assert.equal(runtime.snapshot().automatic_effect_retry_allowed, false);
  assert.equal(runtime.snapshot().second_scheduler, false);
});
