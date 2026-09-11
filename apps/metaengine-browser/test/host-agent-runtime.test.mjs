import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { HostAgentRuntime } from '../src/host-agent-runtime.mjs';

test('host agent routes bounded fast-control and browser-plan operations without raw authority', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-runtime-'));
  const endpoint = path.join(root, 'agent.sock');
  const sessionKey = createHostAgentSessionKey();
  const fastCalls = [];
  const planCalls = [];
  const runtime = new HostAgentRuntime({
    endpoint,
    sessionKey,
    developmentPlane: {
      request: async (capability) => ({ repository: 'PatrickFrome/Compute', head: 'a'.repeat(40), capability, authority_effect: false }),
      snapshot: () => ({ state: 'READY', authority_effect: false }),
    },
    fastControl: {
      invoke: async (tool, payload) => {
        fastCalls.push({ tool, payload });
        return { tool, result: { tool, payload, authority_effect: false }, authority_effect: false };
      },
      snapshot: () => ({ second_scheduler: false, authority_effect: false }),
    },
    browserStatus: async () => ({ state: 'READY', authority_effect: false }),
    browserPlanExecute: async (payload) => { planCalls.push(['execute', payload]); return { state: 'COMPLETED', authority_effect: false }; },
    browserPlanCancel: async (payload) => { planCalls.push(['cancel', payload]); return { state: 'CANCEL_REQUESTED', authority_effect: false }; },
  });
  const client = new HostAgentClient({ endpoint, sessionKey });
  t.after(async () => {
    client.close();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });

  await runtime.start();
  const source = await client.request('SOURCE_STATUS');
  const query = await client.request('DEV_QUERY', { query: 'source tracker', limit: 4 });
  const context = await client.request('CONTROL_CONTEXT_GET', { fields: ['development'] });
  const plan = await client.request('BROWSER_PLAN_EXECUTE', { plan_id: 'plan:test:0001', steps: [] });

  assert.equal(source.head, 'a'.repeat(40));
  assert.equal(query.tool, 'dev_query');
  assert.equal(context.tool, 'context_get');
  assert.equal(plan.state, 'COMPLETED');
  assert.deepEqual(fastCalls.map((row) => row.tool), ['dev_query', 'context_get']);
  assert.equal(planCalls.length, 1);
  assert.equal(runtime.snapshot().chat_dom_scheduler, false);
  assert.equal(runtime.snapshot().raw_shell, false);
  assert.equal(runtime.snapshot().raw_cdp_passthrough, false);
});
