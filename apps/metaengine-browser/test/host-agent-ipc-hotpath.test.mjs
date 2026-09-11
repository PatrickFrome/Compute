import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostAgentClient, createHostAgentServer } from '../src/host-agent-ipc.mjs';
import {
  HOST_AGENT_PROTOCOL_SCHEMA,
  createHostAgentNonce,
  createHostAgentSessionKey,
  hostAgentProtocolManifest,
  serializeHostAgentFrame,
  signHostAgentFrame,
} from '../src/host-agent-protocol.mjs';

test('signed wire serialization is stable after caller payload mutation', () => {
  const key = createHostAgentSessionKey();
  const payload = { query: 'before', nested: { value: 1 } };
  const signed = signHostAgentFrame({
    schema: HOST_AGENT_PROTOCOL_SCHEMA,
    kind: 'REQUEST',
    request_id: 'req:hotpath:0001',
    nonce: createHostAgentNonce(),
    op: 'DEV_QUERY',
    payload,
  }, key);
  const first = serializeHostAgentFrame(signed);
  payload.query = 'after';
  payload.nested.value = 2;
  assert.equal(JSON.parse(first).payload.query, 'before');
  assert.equal(serializeHostAgentFrame(signed), first);
  assert.equal(Object.isFrozen(signed.payload.nested), true);
  assert.equal(hostAgentProtocolManifest().payload_serializations_per_auth, 1);
});

test('persistent IPC preserves multibyte payloads with binary frame accumulation', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-hotpath-'));
  const endpoint = path.join(root, 'agent.sock');
  const sessionKey = createHostAgentSessionKey();
  const server = createHostAgentServer({
    endpoint,
    sessionKey,
    handlers: { PING: async (payload) => ({ echo: payload.value, authority_effect: false }) },
  });
  const client = new HostAgentClient({ endpoint, sessionKey });
  t.after(async () => {
    client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  await server.start();
  const value = 'чат→браузер ⚡ こんにちは';
  assert.equal((await client.request('PING', { value })).echo, value);
  assert.equal(server.snapshot().binary_frame_accumulator, true);
  assert.equal(client.snapshot().redundant_payload_clones, 0);
});
