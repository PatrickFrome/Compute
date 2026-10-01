import assert from 'node:assert/strict';
import test from 'node:test';
import { guardianUpdatePipeConnectionError } from '../src/browser-guardian-update-actuator-client.mjs';

test('only structured pre-connect ENOENT qualifies pipe endpoint absence', () => {
  const error = Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' });
  assert.equal(guardianUpdatePipeConnectionError(error, { connected: false }).code, 'GUARDIAN_PIPE_NOT_FOUND');
  assert.equal(guardianUpdatePipeConnectionError(error, { connected: true }).code, 'GUARDIAN_PIPE_IO_ERROR');
  assert.equal(guardianUpdatePipeConnectionError(error, { connected: null }).code, 'GUARDIAN_PIPE_IO_ERROR');
});

test('message-only ENOENT and other OS errors cannot qualify pipe absence', () => {
  for (const code of [undefined, 'EACCES', 'ECONNRESET', 'EBUSY', 'ETIMEDOUT']) {
    const error = Object.assign(new Error('connect ENOENT'), { code });
    assert.equal(guardianUpdatePipeConnectionError(error, { connected: false }).code, 'GUARDIAN_PIPE_IO_ERROR');
  }
});

test('pipe diagnostic is bounded and preserves no authority or retry capability', () => {
  const error = guardianUpdatePipeConnectionError(Object.assign(new Error('x'.repeat(500)), { code: 'EACCES' }));
  assert.ok(error.message.length <= 'guardian_update_actuator_pipe_error:'.length + 180);
  assert.equal(error.code, 'GUARDIAN_PIPE_IO_ERROR');
  assert.equal(error.automatic_retry_allowed, undefined);
  assert.equal(error.authority_effect, undefined);
});
