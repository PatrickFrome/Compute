import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostAgentRuntime } from '../src/host-agent-runtime.mjs';
import { hostAgentEndpoint } from '../src/host-agent-ipc.mjs';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';

test('Host Agent runtime reports STOPPED after its IPC server closes and can restart cleanly', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-runtime-state-'));
  const runtime = new HostAgentRuntime({
    endpoint: hostAgentEndpoint({ userDataPath: root }),
    sessionKey: createHostAgentSessionKey(),
    developmentPlane: {
      async request() { return { repository_present: true, authority_effect: false }; },
      snapshot() { return { state: 'READY', authority_effect: false }; },
    },
    fastControl: {
      async invoke(tool, payload) { return { result: { tool, payload, authority_effect: false } }; },
      snapshot() { return { authority_effect: false }; },
    },
    browserStatus: async () => ({ state: 'READY', authority_effect: false }),
    browserPlanExecute: async () => ({ state: 'COMPLETED', authority_effect: false }),
    browserPlanCancel: async () => ({ state: 'CANCELLED', authority_effect: false }),
  });

  t.after(async () => {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });

  const firstReady = await runtime.start();
  assert.equal(firstReady.state, 'READY');
  assert.ok(firstReady.started_at);
  assert.equal(firstReady.ipc.listening, true);

  const stopped = await runtime.close();
  assert.equal(stopped.state, 'STOPPED');
  assert.equal(stopped.started_at, null);
  assert.equal(stopped.ipc.listening, false);

  const secondReady = await runtime.start();
  assert.equal(secondReady.state, 'READY');
  assert.ok(secondReady.started_at);
  assert.equal(secondReady.ipc.listening, true);
});
