import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const WORKER_CLOSURE = [
  'browser-sentinel-worker.cjs',
  'browser-sentinel-liveness.cjs',
  'browser-sentinel-action-journal.cjs',
  'durable-json-file.cjs',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHeartbeat(heartbeatPath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const heartbeat = await fs.readFile(heartbeatPath, 'utf8').then(JSON.parse).catch(() => null);
    if (heartbeat) return heartbeat;
    await sleep(25);
  }
  return null;
}

async function makeWorkerLayout() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-recovery-handoff-'));
  const src = path.join(root, 'resources', 'app.asar.unpacked', 'src');
  await fs.mkdir(src, { recursive: true });
  for (const file of WORKER_CLOSURE) {
    await fs.copyFile(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), path.join(src, file));
  }
  return { root, src, workerPath: path.join(src, 'browser-sentinel-worker.cjs') };
}

function boundState({ token, parentPid, executable, workerPath, workerPid, recoveryState = null, recoveryOldPid = null, recoveryCandidatePid = null }) {
  return {
    schema: 'metaengine.browser-sentinel.state.v1',
    token,
    parent_pid: parentPid,
    executable,
    worker_script: workerPath,
    state_revision: 2,
    lifecycle: 'ARMED',
    expected_restart: false,
    installer_handoff: false,
    worker_pid: workerPid,
    worker_released: false,
    worker_recovery_generation: recoveryState ? 1 : 0,
    worker_recovery_state: recoveryState,
    worker_recovery_old_pid: recoveryOldPid,
    worker_recovery_candidate_pid: recoveryCandidatePid,
    authority_effect: false,
  };
}

function workerEnv({ statePath, token, parentPid }) {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    METAENGINE_SENTINEL_STATE_PATH: statePath,
    METAENGINE_SENTINEL_TOKEN: token,
    METAENGINE_SENTINEL_PARENT_PID: String(parentPid),
  };
}

test('recovery candidate waits through exact old-pid intent until parent binds its pid', { timeout: 15_000 }, async () => {
  const { root, workerPath } = await makeWorkerLayout();
  const statePath = path.join(root, 'sentinel-state.json');
  const heartbeatPath = `${statePath}.worker-heartbeat-v1.json`;
  const token = '00000000-0000-4000-8000-0000000000bb';
  const parentPid = process.pid;
  const oldPid = 555321;

  await fs.writeFile(statePath, JSON.stringify(boundState({
    token,
    parentPid,
    executable: process.execPath,
    workerPath,
    workerPid: oldPid,
    recoveryState: 'INTENT_PROVEN_OLD_PID_ABSENT',
    recoveryOldPid: oldPid,
  })));

  const child = spawn(process.execPath, [workerPath], {
    detached: false,
    stdio: 'ignore',
    shell: false,
    env: workerEnv({ statePath, token, parentPid }),
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

  // Deliberately yield after the spawn acknowledgement. On Windows the child can run
  // before the parent performs the durable candidate PID bind; the old implementation
  // observed worker_pid=oldPid and exited 3 in this window.
  await sleep(150);
  await fs.writeFile(statePath, JSON.stringify(boundState({
    token,
    parentPid,
    executable: process.execPath,
    workerPath,
    workerPid: child.pid,
    recoveryState: 'CANDIDATE_BOUND_PENDING_HEARTBEAT',
    recoveryOldPid: oldPid,
    recoveryCandidatePid: child.pid,
  })));

  const heartbeat = await waitForHeartbeat(heartbeatPath);
  let alive = true;
  try { process.kill(child.pid, 0); } catch { alive = false; }
  if (alive) child.kill('SIGTERM');

  assert.ok(heartbeat, 'exact recovery candidate must survive the old-pid intent window and heartbeat after binding');
  assert.equal(heartbeat.worker_pid, child.pid);
  assert.equal(heartbeat.parent_pid, parentPid);
  assert.equal(heartbeat.token, token);
  assert.equal(heartbeat.lifecycle, 'READY');
  assert.equal(heartbeat.authority_effect, false);
});

test('unrelated pre-existing worker binding still fences a new candidate fail-closed', { timeout: 10_000 }, async () => {
  const { root, workerPath } = await makeWorkerLayout();
  const statePath = path.join(root, 'sentinel-state.json');
  const heartbeatPath = `${statePath}.worker-heartbeat-v1.json`;
  const token = '00000000-0000-4000-8000-0000000000cc';
  const parentPid = process.pid;

  await fs.writeFile(statePath, JSON.stringify(boundState({
    token,
    parentPid,
    executable: process.execPath,
    workerPath,
    workerPid: 555654,
  })));

  const child = spawn(process.execPath, [workerPath], {
    detached: false,
    stdio: 'ignore',
    shell: false,
    env: workerEnv({ statePath, token, parentPid }),
  });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const heartbeat = await fs.readFile(heartbeatPath, 'utf8').then(JSON.parse).catch(() => null);

  assert.equal(exit.code, 3, 'candidate without an exact recovery handoff must reject foreign binding');
  assert.equal(exit.signal, null);
  assert.equal(heartbeat, null);
});
