import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  commitRenameWithReadback,
  transientWindowsRenameError,
} = require('../src/durable-json-file.cjs');

function codedError(code) {
  return Object.assign(new Error(`synthetic:${code}`), { code });
}

test('Windows transient rename retries only after exact readback misses', async () => {
  let renameCalls = 0;
  let readCalls = 0;
  const sleeps = [];
  const result = await commitRenameWithReadback({
    temp: 'state.tmp',
    file: 'state.json',
    payload: 'new-payload',
    platform: 'win32',
    retryDelaysMs: [7],
    renameImpl: async () => {
      renameCalls += 1;
      if (renameCalls === 1) throw codedError('EPERM');
    },
    readFileImpl: async () => {
      readCalls += 1;
      return 'old-payload';
    },
    unlinkImpl: async () => {},
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });

  assert.equal(renameCalls, 2);
  assert.equal(readCalls, 1);
  assert.deepEqual(sleeps, [7]);
  assert.equal(result.confirmation, 'RENAME');
  assert.equal(result.attempts, 2);
  assert.equal(result.authority_effect, false);
});

test('Windows transient rename stops replay when exact destination readback proves commit', async () => {
  let renameCalls = 0;
  let unlinkCalls = 0;
  let sleepCalls = 0;
  const payload = 'unique-current-payload';
  const result = await commitRenameWithReadback({
    temp: 'state.tmp',
    file: 'state.json',
    payload,
    platform: 'win32',
    retryDelaysMs: [1, 2, 3],
    renameImpl: async () => {
      renameCalls += 1;
      throw codedError('EPERM');
    },
    readFileImpl: async () => payload,
    unlinkImpl: async () => { unlinkCalls += 1; },
    sleepImpl: async () => { sleepCalls += 1; },
  });

  assert.equal(renameCalls, 1);
  assert.equal(unlinkCalls, 1);
  assert.equal(sleepCalls, 0);
  assert.equal(result.confirmation, 'EXACT_READBACK');
  assert.equal(result.attempts, 1);
  assert.equal(result.authority_effect, false);
});

test('non-Windows rename errors remain fail-closed without retry', async () => {
  let readCalls = 0;
  let sleepCalls = 0;
  await assert.rejects(
    commitRenameWithReadback({
      temp: 'state.tmp',
      file: 'state.json',
      payload: 'payload',
      platform: 'linux',
      retryDelaysMs: [1, 2],
      renameImpl: async () => { throw codedError('EPERM'); },
      readFileImpl: async () => { readCalls += 1; return 'payload'; },
      unlinkImpl: async () => {},
      sleepImpl: async () => { sleepCalls += 1; },
    }),
    (error) => error?.code === 'EPERM',
  );
  assert.equal(readCalls, 0);
  assert.equal(sleepCalls, 0);
});

test('transient Windows classifier is narrow', () => {
  assert.equal(transientWindowsRenameError(codedError('EPERM'), 'win32'), true);
  assert.equal(transientWindowsRenameError(codedError('EACCES'), 'win32'), true);
  assert.equal(transientWindowsRenameError(codedError('EBUSY'), 'win32'), true);
  assert.equal(transientWindowsRenameError(codedError('ENOENT'), 'win32'), false);
  assert.equal(transientWindowsRenameError(codedError('EPERM'), 'linux'), false);
});
