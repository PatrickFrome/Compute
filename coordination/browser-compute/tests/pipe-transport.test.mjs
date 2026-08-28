import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { CdpPipeClient, NulJsonFrameDecoder } from '../src/cdp-client.mjs';

test('NUL decoder accepts partial and multiple JSON frames in order', () => {
  const messages = [];
  const decoder = new NulJsonFrameDecoder({ onMessage: (message) => messages.push(message) });
  const frames = Buffer.from('{"id":1,"result":{"text":"hé"}}\0{"method":"Target.targetCreated","params":{}}\0');
  const multibyte = frames.indexOf(Buffer.from('é'));
  decoder.push(frames.subarray(0, multibyte + 1));
  decoder.push(frames.subarray(multibyte + 1));
  decoder.finish();
  assert.deepEqual(messages, [
    { id: 1, result: { text: 'hé' } },
    { method: 'Target.targetCreated', params: {} }
  ]);
});

test('NUL decoder rejects empty, malformed, truncated, and oversized frames', () => {
  assert.throws(
    () => new NulJsonFrameDecoder({ onMessage() {} }).push(Buffer.from('\0')),
    /cdp_pipe_empty_frame/
  );
  assert.throws(
    () => new NulJsonFrameDecoder({ onMessage() {} }).push(Buffer.from('{bad}\0')),
    /cdp_pipe_json_invalid/
  );
  const truncated = new NulJsonFrameDecoder({ onMessage() {} });
  truncated.push(Buffer.from('{"id":1}'));
  assert.throws(() => truncated.finish(), /cdp_pipe_truncated_frame/);
  assert.throws(
    () => new NulJsonFrameDecoder({ maxFrameBytes: 1024, onMessage() {} }).push(Buffer.alloc(1025, 97)),
    /cdp_pipe_frame_too_large/
  );
});

test('pipe client correlates success and CDP error responses', async () => {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const client = await new CdpPipeClient({ writable: toChrome, readable: fromChrome }).connect();
  try {
    toChrome.once('data', (frame) => {
      const request = JSON.parse(frame.subarray(0, frame.length - 1).toString('utf8'));
      fromChrome.write(`${JSON.stringify({ id: request.id, result: { product: 'Chromium/Test' } })}\0`);
    });
    assert.deepEqual(await client.call('Browser.getVersion'), { product: 'Chromium/Test' });

    toChrome.once('data', (frame) => {
      const request = JSON.parse(frame.subarray(0, frame.length - 1).toString('utf8'));
      fromChrome.write(`${JSON.stringify({ id: request.id, error: { code: -32000, message: 'denied' } })}\0`);
    });
    await assert.rejects(client.call('Target.createTarget'), /cdp_error:-32000:denied/);
    assert.equal(client.pendingCount, 0);
  } finally {
    await client.close();
  }
});

test('flattened session correlation is exact and detach rejects only that session', async () => {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const client = await new CdpPipeClient({ writable: toChrome, readable: fromChrome }).connect();
  const requests = [];
  toChrome.on('data', (frame) => requests.push(JSON.parse(frame.subarray(0, frame.length - 1).toString('utf8'))));
  try {
    const root = client.call('Browser.getVersion');
    const sessionA = client.call('DOMSnapshot.captureSnapshot', {}, { sessionId: 'session-a' });
    const sessionB = client.call('Accessibility.getFullAXTree', {}, { sessionId: 'session-b' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 3);
    assert.equal(requests[0].sessionId, undefined);
    assert.equal(requests[1].sessionId, 'session-a');
    assert.equal(requests[2].sessionId, 'session-b');
    fromChrome.write(`${JSON.stringify({ id: requests[0].id, result: { root: true } })}\0`);
    fromChrome.write(`${JSON.stringify({ id: requests[2].id, sessionId: 'session-b', result: { b: true } })}\0`);
    assert.deepEqual(await root, { root: true });
    assert.deepEqual(await sessionB, { b: true });
    assert.equal(client.rejectSession('session-a', new Error('snapshot_stale')), 1);
    await assert.rejects(sessionA, /snapshot_stale/);
    assert.equal(client.pendingCount, 0);
  } finally {
    await client.close();
  }
});

test('a response cannot cross a flattened session boundary', async () => {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const client = await new CdpPipeClient({ writable: toChrome, readable: fromChrome }).connect();
  try {
    toChrome.once('data', (frame) => {
      const request = JSON.parse(frame.subarray(0, frame.length - 1).toString('utf8'));
      fromChrome.write(`${JSON.stringify({ id: request.id, sessionId: 'session-b', result: {} })}\0`);
    });
    await assert.rejects(
      client.call('DOMSnapshot.captureSnapshot', {}, { sessionId: 'session-a' }),
      /cdp_session_response_mismatch/
    );
    assert.equal(client.connected, false);
    await assert.rejects(client.call('Browser.getVersion'), /cdp_not_connected/);
  } finally {
    await client.close();
  }
});

test('pipe close and malformed input reject every pending call', async () => {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const client = await new CdpPipeClient({ writable: toChrome, readable: fromChrome }).connect();
  const pending = client.call('Browser.getVersion', {}, { timeoutMs: 5000 });
  assert.equal(client.pendingCount, 1);
  fromChrome.write('{bad}\0');
  await assert.rejects(pending, /cdp_pipe_json_invalid/);
  assert.equal(client.pendingCount, 0);
  await assert.rejects(client.call('Browser.getVersion'), /cdp_not_connected/);
});

test('pipe client bounds outbound frames and times out without replay', async () => {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const client = await new CdpPipeClient({ writable: toChrome, readable: fromChrome, maxFrameBytes: 1024 }).connect();
  try {
    await assert.rejects(client.call('Test.large', { value: 'x'.repeat(1100) }), /cdp_pipe_frame_too_large/);
    await assert.rejects(client.call('Test.timeout', {}, { timeoutMs: 10 }), /cdp_call_timeout:Test.timeout/);
    assert.equal(client.pendingCount, 0);
  } finally {
    await client.close();
  }
});
