import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BrowserSentinelHost,
  browserSentinelWorkerHeartbeatPath,
  readSentinelState,
} from '../src/browser-sentinel.mjs';

async function tempState() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-incarnation-'));
  return { dir, statePath: path.join(dir, 'metaengine-browser-sentinel-v1.json') };
}

async function writeHeartbeat(statePath, options, pid) {
  await fs.writeFile(browserSentinelWorkerHeartbeatPath(statePath), `${JSON.stringify({
    schema: 'metaengine.browser-sentinel.worker-heartbeat.v1',
    token: options.env.METAENGINE_SENTINEL_TOKEN,
    parent_pid: Number(options.env.METAENGINE_SENTINEL_PARENT_PID),
    worker_pid: pid,
    lifecycle: 'READY',
    heartbeat_at: new Date().toISOString(),
    authority_effect: false,
  })}\n`, { mode: 0o600 });
}

test('owned child exit proof defeats PID reuse ambiguity without trusting pid liveness alone', async () => {
  const { dir, statePath } = await tempState();
  const children = [];
  let spawnIndex = 0;
  const spawnImpl = (_executable, _args, options) => {
    spawnIndex += 1;
    const child = new EventEmitter();
    child.pid = spawnIndex === 1 ? 51001 : 51002;
    child.unref = () => {};
    child.kill = () => true;
    children.push(child);
    if (spawnIndex === 2) {
      setImmediate(() => {
        child.emit('spawn');
        setTimeout(() => void writeHeartbeat(statePath, options, child.pid), 20);
      });
    }
    return child;
  };

  // PID 51001 appears alive even after the exact owned ChildProcess exited, modeling
  // a PID-reuse false positive. The owned exit event is stronger incarnation proof.
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'worker.cjs'),
    executable: 'browser.exe',
    spawnImpl,
    processAliveImpl: (pid) => Number(pid) === 51001 || Number(pid) === 51002,
  });
  await sentinel.start();
  children[0].emit('exit', 0, null);

  const recovery = await sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 800 });
  assert.equal(recovery.state, 'RECOVERED');
  assert.equal(recovery.worker_pid, 51002);
  assert.equal(spawnIndex, 2);
  const disk = await readSentinelState(statePath);
  assert.equal(disk.worker_recovery_result, 'heartbeat_pid:51002');
  assert.equal(sentinel.snapshot().exact_child_exit_observed, false);
});

test('expected restart transition latch suppresses sentinel recovery before any replacement spawn', async () => {
  const { dir, statePath } = await tempState();
  let spawnCount = 0;
  let initialChild;
  const spawnImpl = () => {
    spawnCount += 1;
    const child = new EventEmitter();
    child.pid = 52001 + spawnCount - 1;
    child.unref = () => {};
    child.kill = () => true;
    if (spawnCount === 1) initialChild = child;
    return child;
  };
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'worker.cjs'),
    executable: 'browser.exe',
    spawnImpl,
    processAliveImpl: () => false,
  });
  await sentinel.start();
  initialChild.emit('exit', 0, null);
  await sentinel.prepareExpectedRestart('SELF_UPDATE');

  const recovery = await sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 500 });
  assert.equal(recovery.state, 'SUPPRESSED_TRANSITION');
  assert.equal(recovery.automatic_retry_allowed, false);
  assert.equal(spawnCount, 1);
  assert.equal(sentinel.snapshot().transition_latched, 'EXPECTED_RESTART');
});

test('before-quit racing a proven recovery intent leaves spawned candidate unbound', async () => {
  const { dir, statePath } = await tempState();
  const app = new EventEmitter();
  let spawnCount = 0;
  let initialChild;
  let candidate;
  const spawnImpl = () => {
    spawnCount += 1;
    const child = new EventEmitter();
    child.pid = spawnCount === 1 ? 53001 : 53002;
    child.unref = () => {};
    child.kill = () => true;
    if (spawnCount === 1) {
      initialChild = child;
    } else {
      candidate = child;
      setImmediate(() => child.emit('spawn'));
      // Simulate Electron entering shutdown synchronously during replacement spawn.
      app.emit('before-quit');
    }
    return child;
  };
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'worker.cjs'),
    executable: 'browser.exe',
    spawnImpl,
    processAliveImpl: () => false,
  });
  await sentinel.start({ app });
  initialChild.emit('exit', 0, null);

  const recovery = await sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 500 });
  assert.equal(recovery.state, 'CANDIDATE_UNBOUND_TRANSITION');
  assert.equal(recovery.worker_pid, candidate.pid);
  assert.equal(recovery.automatic_retry_allowed, false);
  assert.equal(spawnCount, 2);
  const disk = await readSentinelState(statePath);
  assert.equal(disk.worker_pid, 53001);
  assert.equal(disk.lifecycle, 'PLANNED_SHUTDOWN');
  assert.equal(sentinel.snapshot().transition_latched, 'PLANNED_SHUTDOWN');
});
