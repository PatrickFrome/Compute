import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import test from 'node:test';
import {
  BrowserSentinelHost,
  browserSentinelWorkerHeartbeatPath,
} from '../src/browser-sentinel.mjs';

function fakeDeadChild(pid) {
  return { pid, unref() {}, kill() { return false; } };
}

async function tempState(label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), label));
  return { dir, statePath: path.join(dir, 'metaengine-browser-sentinel-v1.json') };
}

test('stale heartbeat never creates a second watchdog while exact prior worker PID is still alive', async () => {
  const { dir, statePath } = await tempState('metaengine-sentinel-live-stale-');
  const live = nodeSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  let spawnCount = 0;
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: 'ignored-worker.cjs',
    executable: process.execPath,
    spawnImpl: () => { spawnCount += 1; return live; },
  });
  try {
    await sentinel.start();
    const out = await sentinel.reconcileWorker({ timeoutMs: 500 });
    assert.equal(spawnCount, 1, 'live stale worker must block replacement spawn');
    assert.equal(out.worker_ready, false);
    assert.equal(out.worker_recovery.state, 'STALE_WORKER_PID_ALIVE');
    assert.equal(out.worker_recovery.blocked_ambiguous, false);
  } finally {
    try { live.kill('SIGKILL'); } catch {}
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('positively absent old worker is replaced once and requires exact heartbeat readback', async () => {
  const { dir, statePath } = await tempState('metaengine-sentinel-dead-recover-');
  let spawnCount = 0;
  let replacement = null;
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: 'ignored-worker.cjs',
    executable: process.execPath,
    spawnImpl: (_exe, _args, options) => {
      spawnCount += 1;
      if (spawnCount === 1) return fakeDeadChild(99_999_991);
      replacement = nodeSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      setTimeout(() => {
        void fs.writeFile(browserSentinelWorkerHeartbeatPath(statePath), `${JSON.stringify({
          schema: 'metaengine.browser-sentinel.worker-heartbeat.v1',
          token: options.env.METAENGINE_SENTINEL_TOKEN,
          parent_pid: Number(options.env.METAENGINE_SENTINEL_PARENT_PID),
          worker_pid: replacement.pid,
          lifecycle: 'READY',
          heartbeat_at: new Date().toISOString(),
          authority_effect: false,
        }, null, 2)}\n`, { mode: 0o600 });
      }, 75);
      return replacement;
    },
  });
  try {
    await sentinel.start();
    const out = await sentinel.reconcileWorker({ timeoutMs: 2_000 });
    assert.equal(spawnCount, 2);
    assert.equal(out.worker_ready, true);
    assert.equal(out.worker_recovery.state, 'RECOVERED');
    assert.equal(out.worker_recovery.restart_count, 1);
    assert.equal(out.worker_recovery.blocked_ambiguous, false);
  } finally {
    try { replacement?.kill('SIGKILL'); } catch {}
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('expected restart suppresses dead-worker replacement instead of racing installer handoff', async () => {
  const { dir, statePath } = await tempState('metaengine-sentinel-transition-');
  let spawnCount = 0;
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: 'ignored-worker.cjs',
    executable: process.execPath,
    spawnImpl: () => { spawnCount += 1; return fakeDeadChild(99_999_992); },
  });
  try {
    await sentinel.start();
    await sentinel.prepareExpectedRestart('TEST_UPDATE');
    const out = await sentinel.reconcileWorker({ timeoutMs: 500 });
    assert.equal(spawnCount, 1);
    assert.equal(out.worker_recovery.state, 'SUPPRESSED_EXPECTED_TRANSITION');
    assert.equal(out.expected_restart, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('parent progress loop wires bounded sentinel reconciliation after durable progress', async () => {
  const source = await fs.readFile(new URL('../src/host-resilience-runtime.mjs', import.meta.url), 'utf8');
  const progressAt = source.indexOf('await this.#progressLease.mark({ kind, detail })');
  const reconcileAt = source.indexOf('await this.#sentinel.reconcileWorker', progressAt);
  assert.ok(progressAt >= 0);
  assert.ok(reconcileAt > progressAt, 'worker repair must not precede parent-progress durability');
  assert.match(source, /sentinel_worker_recovery:/);
});
