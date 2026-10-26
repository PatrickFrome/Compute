import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSourceAcceptance, stopOwnedChild } from './ui-source-acceptance.mjs';

test('the harness refuses an original root symlink or Windows junction before creating evidence or launching children', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-source-root-'));
  t.after(() => fs.rmSync(temporary, {recursive:true,force:true}));
  const root = path.join(temporary, 'bundle'), alias = path.join(temporary, 'alias'), evidence = path.join(temporary, 'evidence');
  fs.mkdirSync(root);
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runSourceAcceptance({root:alias,'expected-sha':'a'.repeat(40),'evidence-dir':evidence,
    chromium:'must-not-be-resolved','playwright-module':'must-not-be-resolved'}), /me2_ui_runtime_root_not_physical/);
  assert.equal(fs.existsSync(evidence), false);
});

// Real inert children establish the shutdown observations. No Next runtime,
// browser, network listener, user installation or unrelated process is used.
function ownedChild(t, source) {
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  return { child, closed };
}
async function runningChild(t, signalHandler) {
  const f = ownedChild(t, `${signalHandler}; process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`);
  await once(f.child.stdout, 'data', { signal: AbortSignal.timeout(3000) });
  assert.equal(f.child.exitCode, null);
  return f;
}

for (const code of [0, 1]) test(`a server already exited with code ${code} cannot qualify owned shutdown`, async t => {
  const f = ownedChild(t, `process.exit(${code})`);
  await f.closed;
  assert.equal(f.child.exitCode, code);
  await assert.rejects(stopOwnedChild(f.child, f.closed), /acceptance_server_exited_before_shutdown/);
});

const posix = { skip: process.platform === 'win32' ? 'Windows does not execute POSIX SIGTERM handlers' : false };
for (const code of [0, 143]) test(`a running owned server may exit ${code} after the harness requests SIGTERM`, posix, async t => {
  const f = await runningChild(t, `process.once('SIGTERM', () => process.exit(${code}))`);
  const observation = await stopOwnedChild(f.child, f.closed);
  assert.equal(observation.sigterm_sent, true);
  assert.equal(observation.forced_shutdown, false);
  assert.equal(observation.exit_code, code);
  assert.equal(observation.signal, null);
});

test('an ordinary owned SIGTERM signal exit is accepted', posix, async t => {
  const f = await runningChild(t, '');
  const observation = await stopOwnedChild(f.child, f.closed);
  assert.equal(observation.sigterm_sent, true);
  assert.equal(observation.exit_code, null);
  assert.equal(observation.signal, 'SIGTERM');
});

test('a nonzero failure after the owned SIGTERM request is rejected', posix, async t => {
  const f = await runningChild(t, "process.once('SIGTERM', () => process.exit(1))");
  await assert.rejects(stopOwnedChild(f.child, f.closed), /acceptance_server_shutdown_exit_unexpected/);
  assert.equal(f.child.exitCode, 1);
});

test('SIGKILL cleanup of an unresponsive owned child never qualifies as graceful acceptance', { ...posix, timeout: 12_000 }, async t => {
  const f = await runningChild(t, "process.on('SIGTERM', () => {})");
  await assert.rejects(stopOwnedChild(f.child, f.closed), error => {
    assert.match(error.message, /acceptance_server_required_forced_shutdown/);
    assert.equal(error.shutdown.forced_shutdown, true);
    assert.equal(error.shutdown.signal, 'SIGKILL');
    return true;
  });
  assert.equal(f.child.signalCode, 'SIGKILL');
});
