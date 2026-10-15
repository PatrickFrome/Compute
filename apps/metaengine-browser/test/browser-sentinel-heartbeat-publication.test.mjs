import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const worker = fileURLToPath(new URL('../src/browser-sentinel-worker.cjs', import.meta.url));
async function fixture(t, failure) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-heartbeat-publication-'));
  const statePath = path.join(root, 'sentinel.json');
  const heartbeatPath = statePath + '.worker-heartbeat-v1.json';
  const observations = path.join(root, 'observations.json');
  const hook = path.join(root, 'heartbeat-fault.cjs');
  const token = randomUUID();
  const state = { schema: 'metaengine.browser-sentinel.state.v1', token, parent_pid: process.pid,
    worker_pid: 0, worker_released: false, executable: process.execPath, lifecycle: 'ARMED',
    expected_restart: false, installer_handoff: false, authority_effect: false };
  await fs.writeFile(statePath, JSON.stringify(state));
  await fs.writeFile(hook, `
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const childProcess = require('node:child_process');
const originalRename = fsp.rename.bind(fsp);
const originalKill = process.kill.bind(process);
const evidence = { rename_attempts: 0, process_signal_attempts: 0, relaunch_attempts: 0 };
const record = () => fs.writeFileSync(process.env.TEST_HEARTBEAT_OBSERVATIONS, JSON.stringify(evidence));
fsp.rename = async (from, to) => {
  if (to === process.env.TEST_HEARTBEAT_FILE) {
    evidence.rename_attempts += 1; record();
    const mode = process.env.TEST_HEARTBEAT_FAILURE;
    if (mode === 'reported_success' && evidence.rename_attempts === 1) {
      await originalRename(from, to);
      throw Object.assign(new Error('injected_post_commit_access_error'), { code: 'EPERM' });
    }
    if (mode === 'persistent' || mode === 'non_transient' || (mode === 'transient' && evidence.rename_attempts === 1)) {
      throw Object.assign(new Error('injected_heartbeat_publication_error'), { code: mode === 'non_transient' ? 'EIO' : 'EPERM' });
    }
  }
  return originalRename(from, to);
};
process.kill = (pid, signal) => {
  if (signal !== 0) { evidence.process_signal_attempts += 1; record(); throw new Error('test_process_signal_forbidden'); }
  return originalKill(pid, signal);
};
childProcess.spawn = () => { evidence.relaunch_attempts += 1; record(); throw new Error('test_relaunch_forbidden'); };
record();
`);
  const env = { ...process.env, METAENGINE_SENTINEL_STATE_PATH: statePath,
    METAENGINE_SENTINEL_TOKEN: token, METAENGINE_SENTINEL_PARENT_PID: String(process.pid),
    TEST_HEARTBEAT_FILE: heartbeatPath, TEST_HEARTBEAT_OBSERVATIONS: observations, TEST_HEARTBEAT_FAILURE: failure };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, ['--require', hook, worker], { env, windowsHide: true, shell: false, stdio: 'ignore' });
  let exited = null;
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { exited = { code, signal }; resolve(exited); });
  });
  state.worker_pid = child.pid;
  const prior = Buffer.from(JSON.stringify({ schema: 'metaengine.browser-sentinel.worker-heartbeat.v1',
    token, parent_pid: process.pid, worker_pid: child.pid, lifecycle: 'READY',
    heartbeat_at: '2000-01-01T00:00:00.000Z', authority_effect: false }));
  await fs.writeFile(heartbeatPath, prior);
  await fs.writeFile(statePath, JSON.stringify(state));
  t.after(async () => {
    await fs.writeFile(statePath, JSON.stringify({ ...state, lifecycle: 'PLANNED_SHUTDOWN' }));
    if (!exited) await Promise.race([closed, delay(5000)]);
    if (!exited) { child.kill('SIGTERM'); await closed; }
    await fs.rm(root, { recursive: true, force: true });
  });
  async function waitHeartbeat() {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const row = await fs.readFile(heartbeatPath, 'utf8').then(JSON.parse);
      if (row.heartbeat_at !== '2000-01-01T00:00:00.000Z') return row;
      if (exited) assert.fail('worker_exited_instead_of_recovering_local_heartbeat_publication');
      await delay(25);
    }
    assert.fail('worker_heartbeat_publication_timeout');
  }
  return { child, closed, exited: () => exited, waitHeartbeat, heartbeatPath, prior,
    observations: () => fs.readFile(observations, 'utf8').then(JSON.parse), token };
}

for (const failure of ['transient', 'reported_success']) {
  test(`real sentinel worker survives ${failure} heartbeat rename error without process actuation`, async t => {
    const f = await fixture(t, failure), heartbeat = await f.waitHeartbeat();
    assert.equal(heartbeat.worker_pid, f.child.pid);
    assert.equal(heartbeat.parent_pid, process.pid);
    assert.equal(heartbeat.token, f.token);
    assert.equal(heartbeat.authority_effect, false);
    assert.equal(f.exited(), null);
    process.kill(f.child.pid, 0);
    const observed = await f.observations();
    // This is a continuous worker: another normal heartbeat may publish between
    // observing recovery and sampling the counter. Require the fault recovery
    // minimum; keep zero process/relaunch actuation as the hard invariant.
    assert.ok(observed.rename_attempts >= (failure === 'transient' ? 2 : 1));
    assert.equal(observed.process_signal_attempts, 0);
    assert.equal(observed.relaunch_attempts, 0);
  });
}

for (const failure of ['persistent', 'non_transient']) {
  test(`real sentinel worker fails closed on ${failure} publication failure and preserves the prior heartbeat`, async t => {
    const f = await fixture(t, failure);
    const result = await Promise.race([f.closed, delay(15000, { timed_out: true })]);
    assert.deepEqual(result, { code: 1, signal: null });
    assert.equal((await fs.readFile(f.heartbeatPath)).equals(f.prior), true);
    const observed = await f.observations();
    assert.equal(observed.rename_attempts, failure === 'persistent' ? 6 : 1);
    assert.equal(observed.process_signal_attempts, 0);
    assert.equal(observed.relaunch_attempts, 0);
  });
}
