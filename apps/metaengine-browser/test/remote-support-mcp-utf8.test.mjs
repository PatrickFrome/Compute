import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createRemoteSupportMcp } from '../src/remote-support-mcp.mjs';

test('MCP JSON-RPC preserves UTF-8 when a multibyte character crosses chunks', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const replies = [];
  output.on('data', chunk => replies.push(JSON.parse(String(chunk))));
  const service = createRemoteSupportMcp({ input, output, platform: 'linux' });
  try {
    const wire = Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 'проверка-кириллицы', method: 'tools/call',
      params: { name: 'support_status', arguments: {} },
    }) + '\n', 'utf8');
    const marker = wire.indexOf(Buffer.from('кириллицы', 'utf8'));
    assert.ok(marker > 0);
    input.write(wire.subarray(0, marker + 1));
    input.write(wire.subarray(marker + 1, marker + 3));
    input.write(wire.subarray(marker + 3));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length, 1);
    assert.equal(replies[0].id, 'проверка-кириллицы');
    assert.equal(replies[0].result.isError, false);
  } finally {
    service.close();
    input.destroy();
    output.destroy();
  }
});

function transport() {
  const input = new PassThrough(), output = new PassThrough(), replies = [];
  output.on('data', chunk => replies.push(JSON.parse(String(chunk))));
  const service = createRemoteSupportMcp({ input, output, platform: 'linux' });
  return { input, replies, close() { service.close(); input.destroy(); output.destroy(); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const ping = id => Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }) + '\n');

test('byte-by-byte Cyrillic, emoji and combined frames keep exact request identity', async () => {
  const t = transport();
  try {
    const id = 'Задача 🧠 协作 é';
    for (const byte of ping(id)) t.input.write(Buffer.from([byte]));
    t.input.write(Buffer.concat([ping('второй'), ping('третий')]));
    await settle();
    assert.deepEqual(t.replies.map(reply => reply.id), [id, 'второй', 'третий']);
  } finally { t.close(); }
});

test('message limit counts UTF-8 bytes and discards the entire oversized frame', async () => {
  const t = transport();
  try {
    // Under 128 KiB in JavaScript characters, but over 128 KiB on the wire.
    const large = ping('я'.repeat(70000));
    t.input.write(large.subarray(0, 132000));
    t.input.write(Buffer.concat([large.subarray(132000), ping(9)]));
    await settle();
    assert.equal(t.replies.length, 2);
    assert.equal(t.replies[0].error.message, 'Message too large');
    assert.equal(t.replies[1].id, 9);
  } finally { t.close(); }
});

test('valid coalesced messages may exceed the per-message bound in total', async () => {
  const t = transport();
  try {
    const ids = ['a'.repeat(70000), 'b'.repeat(70000)];
    t.input.write(Buffer.concat(ids.map(ping)));
    await settle();
    assert.deepEqual(t.replies.map(reply => reply.id), ids);
  } finally { t.close(); }
});

test('malformed UTF-8 is rejected without substituting request data', async () => {
  const t = transport();
  try {
    t.input.write(Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":"'), Buffer.from([0xc3, 0x28]),
      Buffer.from('","method":"ping"}\n'), ping(10),
    ]));
    await settle();
    assert.equal(t.replies.length, 2);
    assert.equal(t.replies[0].error.code, -32700);
    assert.equal(t.replies[1].id, 10);
  } finally { t.close(); }
});

test('EOF discards partial UTF-8 and unterminated requests', async () => {
  const t = transport();
  try {
    t.input.end(Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":"'), Buffer.from([0xf0, 0x9f])]));
    await settle();
    assert.deepEqual(t.replies, []);
  } finally { t.close(); }
});
