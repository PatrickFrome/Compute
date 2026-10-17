import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Execute the exact startup guard without importing the daemon/store graph.
const index = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const start = index.indexOf('const ME2_LOCK_FILE =');
const end = index.indexOf('// ── конец стража инкарнации', start);
assert.ok(start > 0 && end > start, 'production incarnation guard missing');
const guard = index.slice(start, end);
assert.ok(end < index.indexOf('setMeta("boot", BOOT_TS);'), 'guard must precede boot metadata writes');

function runGuard(path, { alive = false, failExclusiveOpen = false, readbackError = 'ESRCH' } = {}) {
  const callbacks = [];
  let bootMutations = 0;
  const owner = {
    env: { ME2_LOCK_FILE: path }, pid: process.pid,
    kill: () => { if (!alive) throw Object.assign(new Error(readbackError), { code: readbackError }); },
    on: (_name, fn) => callbacks.push(fn),
    exit: (code) => { throw Object.assign(new Error('startup_refused'), { code }); },
  };
  const execute = new Function('process', 'console', 'join', 'tmpdir', 'existsSync', 'readFileSync', 'unlinkSync', 'openSync', 'writeSync', 'closeSync', 'bootMutation', `${guard}\nbootMutation();`);
  let error;
  try {
    execute(owner, { error: () => {} }, join, tmpdir,
      failExclusiveOpen ? () => false : fs.existsSync,
      fs.readFileSync, fs.unlinkSync, fs.openSync, fs.writeSync, fs.closeSync,
      () => { bootMutations++; });
  } catch (caught) { error = caught; }
  return { error, bootMutations, release: () => callbacks.forEach((fn) => fn()) };
}

function privateDirectory(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'me2-incarnation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('exclusive lock creation failure refuses startup before every boot mutation', (t) => {
  const path = join(privateDirectory(t), 'missing-parent', 'owner.lock');
  const result = runGuard(path);
  assert.equal(result.error?.code, 13);
  assert.equal(result.bootMutations, 0);
});

test('a concurrent exclusive-create loser preserves the winning lock and refuses startup', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  fs.writeFileSync(path, '314159');
  const result = runGuard(path, { failExclusiveOpen: true });
  assert.equal(result.error?.code, 13);
  assert.equal(result.bootMutations, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), '314159');
});

test('an existing live owner is not replaced', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  fs.writeFileSync(path, String(process.pid + 1));
  const result = runGuard(path, { alive: true });
  assert.equal(result.error?.code, 13);
  assert.equal(result.bootMutations, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), String(process.pid + 1));
});

test('an unreadable owner incarnation is not mistaken for a dead process', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  fs.writeFileSync(path, '314159');
  const result = runGuard(path, { readbackError: 'EPERM' });
  assert.equal(result.error?.code, 13);
  assert.equal(result.bootMutations, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), '314159');
});

test('malformed lock evidence refuses startup without deleting the evidence', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  fs.writeFileSync(path, 'not-an-incarnation');
  const result = runGuard(path);
  assert.equal(result.error?.code, 13);
  assert.equal(result.bootMutations, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), 'not-an-incarnation');
});

test('a proven exclusive lock allows startup and releases only its own lock', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  const result = runGuard(path);
  assert.equal(result.error, undefined);
  assert.equal(result.bootMutations, 1);
  assert.equal(fs.readFileSync(path, 'utf8'), String(process.pid));
  result.release();
  assert.equal(fs.existsSync(path), false);
});

test('two contenders preserve a stale owner until custody is explicitly reconciled', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  fs.writeFileSync(path, '314159');
  const first = runGuard(path);
  const second = runGuard(path);
  assert.equal(first.error?.code, 13);
  assert.equal(second.error?.code, 13);
  assert.equal(first.bootMutations + second.bootMutations, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), '314159');
});

test('exactly one contender wins a fresh exclusive lock', (t) => {
  const path = join(privateDirectory(t), 'owner.lock');
  const first = runGuard(path);
  const second = runGuard(path, { alive: true });
  assert.equal(first.error, undefined);
  assert.equal(second.error?.code, 13);
  assert.equal(first.bootMutations + second.bootMutations, 1);
  assert.equal(fs.readFileSync(path, 'utf8'), String(process.pid));
  first.release();
});
