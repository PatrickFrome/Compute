import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { CdpPipeClient } from '../src/cdp-pipe-client.mjs';

function harness(options = {}) {
  const outbound = new PassThrough();
  const inbound = new PassThrough();
  const writes = [];
  outbound.on('data', (chunk) => writes.push(Buffer.from(chunk)));
  const client = new CdpPipeClient(outbound, inbound, options);
  return { outbound, inbound, writes, client };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

function lastRequest(writes) {
  const bytes = Buffer.concat(writes);
  const zero = bytes.lastIndexOf(0);
  assert.ok(zero >= 0);
  const before = bytes.subarray(0, zero);
  const previous = before.lastIndexOf(0);
  return JSON.parse(before.subarray(previous + 1).toString('utf8'));
}

test('pipe client correlates a NUL-delimited response split across chunks', async () => {
  const { inbound, writes, client } = harness();
  await client.connect();
  const pending = client.call('Browser.getVersion');
  await nextTurn();
  const request = lastRequest(writes);
  const response = Buffer.from(`${JSON.stringify({ id: request.id, result: { product: 'Chrome/Test' } })}\0`);
  inbound.write(response.subarray(0, 7));
  inbound.write(response.subarray(7));
  assert.deepEqual(await pending, { product: 'Chrome/Test' });
  await client.close();
});

test('pipe client parses multiple frames in one chunk and dispatches events', async () => {
  const { inbound, writes, client } = harness();
  await client.connect();
  let event = null;
  client.on('Target.targetCreated', (params) => { event = params; });
  const pending = client.call('Target.getTargets');
  await nextTurn();
  const request = lastRequest(writes);
  inbound.write(Buffer.from(
    `${JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 't1' } } })}\0` +
    `${JSON.stringify({ id: request.id, result: { targetInfos: [] } })}\0`
  ));
  assert.deepEqual(await pending, { targetInfos: [] });
  assert.equal(event?.targetInfo?.targetId, 't1');
  await client.close();
});

test('malformed pipe JSON fails all pending calls closed', async () => {
  const { inbound, client } = harness();
  await client.connect();
  const pending = client.call('Browser.getVersion', {}, { timeoutMs: 1000 });
  inbound.write(Buffer.from('{bad-json}\0'));
  await assert.rejects(pending, /cdp_pipe_json_invalid/);
  await assert.rejects(client.call('Target.getTargets'), /cdp_pipe_json_invalid/);
  await client.close();
});

test('oversized unterminated frame fails all pending calls closed', async () => {
  const { inbound, client } = harness({ maxFrameBytes: 64 });
  await client.connect();
  const pending = client.call('Browser.getVersion', {}, { timeoutMs: 1000 });
  inbound.write(Buffer.alloc(65, 0x61));
  await assert.rejects(pending, /cdp_pipe_frame_too_large/);
  await client.close();
});

test('pipe close rejects pending calls immediately', async () => {
  const { inbound, client } = harness();
  await client.connect();
  const pending = client.call('Browser.getVersion', {}, { timeoutMs: 5000 });
  inbound.end();
  await assert.rejects(pending, /cdp_pipe_closed/);
  await client.close();
});
