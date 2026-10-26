import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import { createHostAgentSessionKey, signHostAgentFrame, createHostAgentNonce, HOST_AGENT_PROTOCOL_SCHEMA } from '../src/host-agent-protocol.mjs';

// No network or OS socket: exercise the real parser, HMAC and nonce boundary.
function harness() {
  const sessionKey = createHostAgentSessionKey();
  class Socket extends EventEmitter {
    destroyed = false;
    frames = [];
    write(text) { this.frames.push(JSON.parse(text)); }
    destroy() { if (!this.destroyed) { this.destroyed = true; queueMicrotask(() => this.emit('close')); } }
    respond(index, changes = {}, key = sessionKey) {
      const request = this.frames[index];
      const response = signHostAgentFrame({ schema: HOST_AGENT_PROTOCOL_SCHEMA, kind: 'RESPONSE',
        request_id: request.request_id, nonce: createHostAgentNonce(), op: request.op,
        payload: { ok: true, result: { index } }, ...changes }, key);
      this.emit('data', Buffer.from(`${JSON.stringify(response)}\n`));
    }
  }
  const socket = new Socket();
  const client = new HostAgentClient({ endpoint: 'memory-only', sessionKey,
    netModule: { createConnection() { queueMicrotask(() => socket.emit('connect')); return socket; } } });
  return { client, socket };
}
async function expired(h) {
  // Keep one referenced timer alive: production request timers intentionally unref.
  const keepAlive = setTimeout(() => {}, 2000);
  try { await assert.rejects(h.client.request('PING', {}, { timeoutMs: 100 }), /host_agent_request_timeout:PING/); }
  finally { clearTimeout(keepAlive); }
}

test('authenticated late response cannot fail an unrelated live request', async t => {
  const h = harness(); t.after(() => h.client.close());
  await expired(h);
  const pending = h.client.request('HOST_STATUS', {}, { timeoutMs: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  h.socket.respond(0);
  h.socket.respond(1);
  assert.deepEqual(await pending, { index: 1 });
  assert.equal(h.client.snapshot().connected, true);
});

for (const variant of ['wrong-op', 'unknown-request', 'bad-signature']) {
  test(`late response exception still rejects ${variant}`, async t => {
    const h = harness(); t.after(() => h.client.close());
    await expired(h);
    const pending = h.client.request('HOST_STATUS', {}, { timeoutMs: 1000 });
    const rejected = assert.rejects(pending);
    await new Promise(resolve => setImmediate(resolve));
    h.socket.respond(0, variant === 'wrong-op' ? { op: 'HOST_STATUS' }
      : variant === 'unknown-request' ? { request_id: 'req:00000000-0000-4000-8000-000000000001' } : {},
    variant === 'bad-signature' ? createHostAgentSessionKey() : undefined);
    await rejected;
    assert.equal(h.socket.destroyed, true);
  });
}

test('a late response tombstone is consumed only once', async t => {
  const h = harness(); t.after(() => h.client.close());
  await expired(h);
  h.socket.respond(0);
  assert.equal(h.socket.destroyed, false);
  const pending = h.client.request('HOST_STATUS');
  const rejected = assert.rejects(pending, /response_unmatched/);
  await new Promise(resolve => setImmediate(resolve));
  // A fresh valid nonce must not allow a second response to the expired ID.
  h.socket.respond(0);
  await rejected;
});

test('expired-request retention is bounded and an evicted ID remains unsolicited', async t => {
  const h = harness(); t.after(() => h.client.close());
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    await Promise.all(Array.from({ length: 257 }, () =>
      assert.rejects(h.client.request('PING', {}, { timeoutMs: 100 }), /request_timeout/)));
  } finally { clearTimeout(keepAlive); }
  const pending = h.client.request('HOST_STATUS');
  const rejected = assert.rejects(pending, /response_unmatched/);
  await new Promise(resolve => setImmediate(resolve));
  h.socket.respond(0);
  await rejected;
});
