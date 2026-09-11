import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  BrowserSentinelActionJournal,
  actionJournalPath,
  predecessorJournalPath,
} = require('../src/browser-sentinel-action-journal.cjs');

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-successor-journal-'));
  return { dir, statePath: path.join(dir, 'metaengine-browser-sentinel-v1.json') };
}

function oldBinding(overrides = {}) {
  return {
    schema: 'metaengine.browser-sentinel.state.v1',
    token: '00000000-0000-4000-8000-0000000000a1',
    parent_pid: 41001,
    executable: process.execPath,
    authority_effect: false,
    ...overrides,
  };
}

function successorBinding(overrides = {}) {
  return {
    schema: 'metaengine.browser-sentinel.state.v1',
    token: '00000000-0000-4000-8000-0000000000b2',
    parent_pid: process.pid,
    executable: process.execPath,
    worker_pid: process.pid,
    worker_released: false,
    lifecycle: 'ARMED',
    authority_effect: false,
    ...overrides,
  };
}

async function staleDispatchedJournal(statePath) {
  const journal = new BrowserSentinelActionJournal({ statePath });
  await journal.init(oldBinding());
  await journal.beginRelaunch(oldBinding(), 'EXACT_OLD_PARENT_ABSENT');
  return journal.markRelaunch(oldBinding(), {
    lifecycle: 'RELAUNCH_DISPATCHED',
    pid: 424242,
    result: 'pid:424242',
  });
}

async function waitForJson(file, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await fs.readFile(file, 'utf8').then((text) => JSON.parse(text)).catch(() => null);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test('stale predecessor action journal remains fail-closed without exact current-worker binding proof', async () => {
  const { statePath } = await fixture();
  await staleDispatchedJournal(statePath);

  const unproven = new BrowserSentinelActionJournal({ statePath });
  await assert.rejects(
    () => unproven.init(successorBinding({ worker_pid: process.pid + 1000 })),
    /binding_drift/,
  );

  const disk = JSON.parse(await fs.readFile(actionJournalPath(statePath), 'utf8'));
  assert.equal(disk.token, oldBinding().token);
  assert.equal(disk.state, 'RELAUNCH_DISPATCHED');
  assert.equal(disk.automatic_retry_allowed, false);
});

test('exact current-worker binding archives predecessor evidence and starts a no-replay successor journal', async () => {
  const { statePath } = await fixture();
  const predecessor = await staleDispatchedJournal(statePath);
  const current = successorBinding();

  const successor = new BrowserSentinelActionJournal({ statePath });
  const row = await successor.init(current);

  assert.equal(row.state, 'SUCCESSOR_BOUND');
  assert.equal(row.token, current.token);
  assert.equal(row.parent_pid, current.parent_pid);
  assert.equal(row.sequence, 1);
  assert.equal(row.predecessor_state, 'RELAUNCH_DISPATCHED');
  assert.equal(row.predecessor_sequence, predecessor.sequence);
  assert.equal(row.predecessor_evidence_archived, true);
  assert.equal(row.physical_effect_attempted, false);
  assert.equal(row.effect_barrier_crossed, false);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
  assert.equal(successor.relaunchAttempted(), false, 'predecessor effect must not be replayed in successor incarnation');
  assert.equal(successor.relaunchRetryAllowed(), false, 'predecessor retry authority must not cross incarnation boundary');

  const archived = JSON.parse(await fs.readFile(predecessorJournalPath(statePath, predecessor), 'utf8'));
  assert.deepEqual(archived, predecessor, 'full predecessor evidence must survive successor reconciliation');
  const active = JSON.parse(await fs.readFile(actionJournalPath(statePath), 'utf8'));
  assert.equal(active.state, 'SUCCESSOR_BOUND');
  assert.equal(active.predecessor_binding_sha256.length, 64);
  assert.equal(Object.hasOwn(active, 'relaunch_pid'), false, 'old physical-effect identity must not become active successor state');
});

test('real sentinel worker survives a persistent-profile predecessor journal and emits heartbeat', { timeout: 20_000 }, async () => {
  const { statePath } = await fixture();
  const predecessor = await staleDispatchedJournal(statePath);
  const workerPath = fileURLToPath(new URL('../src/browser-sentinel-worker.cjs', import.meta.url));
  const token = '00000000-0000-4000-8000-0000000000c3';
  const parentPid = process.pid;

  const baseState = {
    schema: 'metaengine.browser-sentinel.state.v1',
    token,
    parent_pid: parentPid,
    executable: process.execPath,
    worker_script: workerPath,
    state_revision: 1,
    lifecycle: 'ARMED',
    worker_pid: null,
    worker_released: false,
    expected_restart: false,
    installer_handoff: false,
    authority_effect: false,
  };
  await fs.writeFile(statePath, `${JSON.stringify(baseState, null, 2)}\n`);

  const child = spawn(process.execPath, [workerPath], {
    detached: false,
    stdio: 'ignore',
    shell: false,
    env: {
      ...process.env,
      METAENGINE_SENTINEL_STATE_PATH: statePath,
      METAENGINE_SENTINEL_TOKEN: token,
      METAENGINE_SENTINEL_PARENT_PID: String(parentPid),
    },
  });

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  await fs.writeFile(statePath, `${JSON.stringify({ ...baseState, state_revision: 2, worker_pid: child.pid }, null, 2)}\n`);

  const heartbeatPath = `${statePath}.worker-heartbeat-v1.json`;
  const heartbeat = await waitForJson(heartbeatPath);
  let alive = true;
  try { process.kill(child.pid, 0); } catch { alive = false; }
  if (alive) child.kill('SIGTERM');

  assert.ok(heartbeat, 'successor worker must heartbeat instead of exiting 1 on stale action journal');
  assert.equal(heartbeat.token, token);
  assert.equal(heartbeat.parent_pid, parentPid);
  assert.equal(heartbeat.worker_pid, child.pid);
  assert.equal(heartbeat.lifecycle, 'READY');
  assert.equal(heartbeat.authority_effect, false);
  assert.ok(alive, 'successor worker must remain alive while current parent is alive');

  const active = JSON.parse(await fs.readFile(actionJournalPath(statePath), 'utf8'));
  assert.equal(active.state, 'SUCCESSOR_BOUND');
  assert.equal(active.token, token);
  assert.equal(active.automatic_retry_allowed, false);
  const archived = JSON.parse(await fs.readFile(predecessorJournalPath(statePath, predecessor), 'utf8'));
  assert.deepEqual(archived, predecessor);
});
