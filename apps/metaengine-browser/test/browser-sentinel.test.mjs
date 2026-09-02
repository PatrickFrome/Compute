import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BrowserSentinelHost, readSentinelState } from '../src/browser-sentinel.mjs';

async function tempState() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-'));
  return { dir, statePath: path.join(dir, 'metaengine-browser-sentinel-v1.json') };
}

function fakeSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    return { pid: 43210, unref() { calls[calls.length - 1].unref = true; } };
  };
}

function transientError(code = 'EPERM') {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

test('sentinel seals exact parent incarnation before detached worker launch', async () => {
  const { dir, statePath } = await tempState();
  const calls = [];
  const app = new EventEmitter();
  const worker = path.join(dir, 'browser-sentinel-worker.cjs');
  const executable = 'C:\\METAENGINE\\METAENGINE Browser.exe';
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: worker, executable, spawnImpl: fakeSpawn(calls) });
  const snap = await sentinel.start({ app });
  const disk = await readSentinelState(statePath);
  assert.equal(snap.lifecycle, 'ARMED');
  assert.equal(disk.token, snap.token);
  assert.equal(disk.parent_pid, process.pid);
  assert.equal(disk.executable, executable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, executable);
  assert.deepEqual(calls[0].args, [worker]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(calls[0].options.env.METAENGINE_SENTINEL_TOKEN, snap.token);
  assert.equal(calls[0].unref, true);
  assert.equal(snap.authority_effect, false);
});

test('planned user quit suppresses crash relaunch authority', async () => {
  const { dir, statePath } = await tempState();
  const app = new EventEmitter();
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'), executable: 'browser.exe', spawnImpl: fakeSpawn([]) });
  await sentinel.start({ app });
  app.emit('before-quit');
  await new Promise((resolve) => setImmediate(resolve));
  const disk = await readSentinelState(statePath);
  assert.equal(disk.lifecycle, 'PLANNED_SHUTDOWN');
  assert.equal(disk.expected_restart, false);
});

test('self-update arms expected-restart grace instead of planned shutdown', async () => {
  const { dir, statePath } = await tempState();
  const app = new EventEmitter();
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'), executable: 'browser.exe', spawnImpl: fakeSpawn([]) });
  await sentinel.start({ app });
  await sentinel.prepareExpectedRestart('SELF_UPDATE');
  app.emit('before-quit');
  await new Promise((resolve) => setImmediate(resolve));
  const disk = await readSentinelState(statePath);
  assert.equal(disk.lifecycle, 'EXPECTED_RESTART');
  assert.equal(disk.expected_restart, true);
  assert.equal(disk.expected_restart_reason, 'SELF_UPDATE');
  assert.equal(disk.relaunch_attempted, false);
});

test('parent progress retries transient EPERM only after target readback proves no commit', async () => {
  const { dir, statePath } = await tempState();
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'), executable: 'browser.exe', spawnImpl: fakeSpawn([]) });
  await sentinel.start();
  const originalRename = fs.rename;
  let calls = 0;
  fs.rename = async (...args) => {
    calls += 1;
    if (calls === 1) throw transientError('EPERM');
    return originalRename(...args);
  };

  try {
    await sentinel.prepareExpectedRestart('SELF_UPDATE');
    const disk = await readSentinelState(statePath);
    assert.equal(calls, 2);
    assert.equal(disk.lifecycle, 'EXPECTED_RESTART');
    assert.equal(disk.expected_restart, true);
    assert.equal(disk.expected_restart_reason, 'SELF_UPDATE');
  } finally {
    fs.rename = originalRename;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('parent progress never replays ambiguous committed rename after exact readback', async () => {
  const { dir, statePath } = await tempState();
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'), executable: 'browser.exe', spawnImpl: fakeSpawn([]) });
  await sentinel.start();
  const originalRenameSync = fsSync.renameSync;
  let calls = 0;
  fsSync.renameSync = (...args) => {
    calls += 1;
    originalRenameSync(...args);
    throw transientError('EPERM');
  };

  try {
    sentinel.markPlannedShutdownSync();
    const disk = await readSentinelState(statePath);
    assert.equal(calls, 1);
    assert.equal(disk.lifecycle, 'PLANNED_SHUTDOWN');
    assert.equal(disk.expected_restart, false);
  } finally {
    fsSync.renameSync = originalRenameSync;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
