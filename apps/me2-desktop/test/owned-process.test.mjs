import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { startOwned, stopOwned } from '../src/me2/owned-process.mjs';
import { pollUntil } from '../src/me2/probes.mjs';
import { Me2Plane } from '../src/me2/plane.mjs';
function fake(pid = 10) {
  const child = new EventEmitter(); child.pid = pid;
  child.stdout = { resume() { child.stdoutDrained = true; } };
  child.stderr = { resume() { child.stderrDrained = true; } };
  child.kill = () => true; return child;
}
test('spawn errors degrade without crashing; late events cannot clear replacement', () => {
  let child = fake(); child.pid = undefined;
  const host = { spawnImpl: () => child };
  startOwned(host, 'missing', [], {});
  child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
  assert.equal(host.child, null); assert.equal(host.status, 'degraded');
  const old = child; child = fake(11);
  assert.equal(startOwned(host, 'new', [], {}).ok, true);
  old.emit('exit', 1); assert.equal(host.child, child);
  assert.equal(child.stdoutDrained && child.stderrDrained, true);
});
test('unconfirmed stop retains ownership and prevents duplicate spawn', async () => {
  const child = fake(); const host = { spawnImpl: () => child };
  startOwned(host, 'bin', [], {});
  assert.equal((await stopOwned(host, { timeoutMs: 5 })).ok, false);
  assert.equal(startOwned(host, 'bin', [], {}).reason, 'owned_process_still_running');
  child.emit('exit', 0); assert.equal(host.child, null);
  assert.equal(child.listenerCount('close'), 0);
});
test('kill errors on existing PID retain ownership; confirmed stop cleans up', async () => {
  const child = fake(); const host = { spawnImpl: () => child };
  startOwned(host, 'bin', [], {});
  child.emit('error', Object.assign(new Error(), { code: 'EPERM' }));
  assert.equal(host.child, child);
  child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); return true; };
  assert.equal((await stopOwned(host)).ok, true); assert.equal(host.child, null);
});
test('adopted services are not killed; terminal probe failures do not retry', async () => {
  assert.equal((await stopOwned({ child: null })).ok, true);
  let probes = 0;
  await pollUntil(async () => { probes++; return { ok: false, terminal: true }; }, { tries: 20, intervalMs: 1 });
  assert.equal(probes, 1);
});
test('host degradation overrides cached healthy plane status', () => {
  const plane = new Me2Plane(); plane.status.daemon.ok = plane.status.ui.ok = true;
  plane.daemonHost.status = plane.uiHost.status = 'degraded';
  assert.equal(plane.snapshot().daemon.ok, false); assert.equal(plane.snapshot().ui.ok, false);
});
test('real missing executable is handled without an unhandled error', async () => {
  const host = { spawnImpl: spawn };
  startOwned(host, '/nonexistent/me2-test-binary', [], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(resolve => host.child.once('close', resolve));
  assert.equal(host.processFailure, 'ENOENT'); assert.equal(host.child, null);
});
