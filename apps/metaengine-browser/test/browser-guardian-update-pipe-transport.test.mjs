import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { requestGuardianUpdatePipe } from '../src/browser-guardian-update-actuator-client.mjs';

function fakePipe(t, script, { connectFirst = true } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
  const socket = new EventEmitter();
  socket.writes = 0;
  socket.write = () => { socket.writes += 1; };
  socket.setTimeout = () => {};
  socket.destroy = () => { socket.emit('close'); };
  t.mock.method(net, 'createConnection', () => {
    queueMicrotask(() => {
      if (connectFirst) socket.emit('connect');
      script(socket);
    });
    return socket;
  });
  return socket;
}

function receipt(overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.update-actuator-result.v1',
    state: 'NO_EFFECT_PROVEN', reason: 'OWNER_ENROLLMENT_TICKET_REQUIRED',
    effect_absent_proven: true, automatic_retry_allowed: false,
    caller_supplied_path_used: false, caller_supplied_url_used: false,
    caller_supplied_shell_used: false, authority_effect: false, ...overrides,
  };
}

test('malformed native schema/authority/state rejects inside data handler without an uncaught throw', async (t) => {
  for (const [overrides, pattern] of [
    [{ schema: 'unknown' }, /result_schema_invalid/],
    [{ authority_effect: true }, /result_authority_invalid/],
    [{ state: 'UNKNOWN' }, /result_state_invalid/],
  ]) {
    await t.test(pattern.source, async (t) => {
      const socket = fakePipe(t, (s) => {
        assert.doesNotThrow(() => s.emit('data', Buffer.from(JSON.stringify(receipt(overrides)) + '\n')));
      });
      await assert.rejects(requestGuardianUpdatePipe('probe\n'), pattern);
      assert.equal(socket.writes, 1);
    });
  }
});

test('fragmented valid receipt resolves once and ignores post-settlement bytes', async (t) => {
  const text = JSON.stringify(receipt()) + '\n';
  fakePipe(t, (s) => {
    s.emit('data', Buffer.from(text.slice(0, 17)));
    s.emit('data', Buffer.from(text.slice(17)));
    assert.doesNotThrow(() => s.emit('data', Buffer.from('untrusted late data\n')));
  });
  assert.equal((await requestGuardianUpdatePipe('probe\n')).state, 'NO_EFFECT_PROVEN');
});

test('close without end/result rejects immediately instead of leaving the request pending', async (t) => {
  fakePipe(t, (s) => s.emit('close'));
  await assert.rejects(requestGuardianUpdatePipe('probe\n'), /pipe_closed_without_result/);
});

test('preconnect OS absence remains structured and does not write a request', async (t) => {
  const socket = fakePipe(t, (s) => s.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })),
    { connectFirst: false });
  await assert.rejects(requestGuardianUpdatePipe('probe\n'), { code: 'GUARDIAN_PIPE_NOT_FOUND' });
  assert.equal(socket.writes, 0);
});

test('postconnect ENOENT cannot classify endpoint absence', async (t) => {
  fakePipe(t, (s) => s.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })));
  await assert.rejects(requestGuardianUpdatePipe('probe\n'), { code: 'GUARDIAN_PIPE_IO_ERROR' });
});

test('slow partial data cannot extend absolute deadline and late connect cannot write', async (t) => {
  let drip;
  const socket = fakePipe(t, (s) => { drip = setInterval(() => s.emit('data', Buffer.from(' ')), 25); },
    { connectFirst: false });
  t.after(() => clearInterval(drip));
  await assert.rejects(requestGuardianUpdatePipe('probe\n', { timeoutMs: 1000 }), /pipe_timeout/);
  socket.emit('connect');
  assert.equal(socket.writes, 0);
});
