import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  HostAgentClient,
  createHostAgentServer,
  hostAgentEndpoint,
} from '../src/host-agent-ipc.mjs';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';

test('browser and host agent exchange authenticated requests over one persistent local connection', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-agent-test-'));
  const endpoint = hostAgentEndpoint({ userDataPath: root });
  const sessionKey = createHostAgentSessionKey();
  const server = createHostAgentServer({
    endpoint,
    sessionKey,
    handlers: {
      PING: async (payload) => ({ pong: true, echo: payload.value ?? null, authority_effect: false }),
      HOST_STATUS: async () => ({ state: 'READY', authority_effect: false }),
    },
  });
  const client = new HostAgentClient({ endpoint, sessionKey });
  t.after(async () => {
    client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  await server.start();
  const first = await client.request('PING', { value: 7 });
  const second = await client.request('HOST_STATUS');

  assert.deepEqual(first, { pong: true, echo: 7, authority_effect: false });
  assert.equal(second.state, 'READY');
  assert.equal(client.snapshot().connected, true);
  assert.equal(server.snapshot().authenticated_frames_only, true);
});

test('wrong session key cannot invoke a host handler', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-agent-auth-'));
  const endpoint = hostAgentEndpoint({ userDataPath: root });
  let invoked = 0;
  const server = createHostAgentServer({
    endpoint,
    sessionKey: createHostAgentSessionKey(),
    handlers: { PING: async () => { invoked += 1; return { pong: true }; } },
  });
  const client = new HostAgentClient({ endpoint, sessionKey: createHostAgentSessionKey() });
  t.after(async () => {
    client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  await server.start();
  await assert.rejects(() => client.request('PING', {}, { timeoutMs: 1000 }));
  assert.equal(invoked, 0);
});

test('endpoint is deterministic per user-data root and uses a Windows named pipe on win32', () => {
  const a = hostAgentEndpoint({ userDataPath: 'C:/Users/Test/AppData/Local/METAENGINE', platform: 'win32' });
  const b = hostAgentEndpoint({ userDataPath: 'C:/Users/Test/AppData/Local/METAENGINE', platform: 'win32' });
  assert.equal(a, b);
  assert.match(a, /^\\\\\.\\pipe\\metaengine-host-agent-[a-f0-9]{24}$/);
});
