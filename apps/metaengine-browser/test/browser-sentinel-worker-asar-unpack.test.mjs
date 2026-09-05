import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { resolveSentinelWorkerScript } from '../src/host-resilience-runtime.mjs';

const WORKER_CLOSURE = [
  'browser-sentinel-worker.cjs',
  'browser-sentinel-liveness.cjs',
  'browser-sentinel-action-journal.cjs',
  'durable-json-file.cjs',
];

test('resolveSentinelWorkerScript maps the asar path onto app.asar.unpacked when the unpacked worker exists', () => {
  const sep = path.sep;
  const asarPath = ['C:', 'Programs', 'METAENGINE Browser Test', 'resources', 'app.asar', 'src', 'browser-sentinel-worker.cjs'].join(sep);
  const unpackedPath = ['C:', 'Programs', 'METAENGINE Browser Test', 'resources', 'app.asar.unpacked', 'src', 'browser-sentinel-worker.cjs'].join(sep);
  const resolved = resolveSentinelWorkerScript(asarPath, (p) => p === unpackedPath);
  assert.equal(resolved, unpackedPath);
});

test('resolveSentinelWorkerScript falls back to the asar path when the unpacked file is missing', () => {
  const sep = path.sep;
  const asarPath = ['C:', 'x', 'resources', 'app.asar', 'src', 'browser-sentinel-worker.cjs'].join(sep);
  assert.equal(resolveSentinelWorkerScript(asarPath, () => false), asarPath);
});

test('resolveSentinelWorkerScript leaves dev-mode paths untouched and handles forward slashes', () => {
  const devPath = path.join('repo', 'apps', 'metaengine-browser', 'src', 'browser-sentinel-worker.cjs');
  assert.equal(resolveSentinelWorkerScript(devPath, () => true), devPath);
  const posixAsar = '/opt/app/resources/app.asar/src/browser-sentinel-worker.cjs';
  const posixUnpacked = '/opt/app/resources/app.asar.unpacked/src/browser-sentinel-worker.cjs';
  assert.equal(resolveSentinelWorkerScript(posixAsar, (p) => p === posixUnpacked), posixUnpacked);
});

test('electron-builder unpacks the full sentinel worker require closure', async () => {
  const config = JSON.parse(await fs.readFile(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
  const unpacked = Array.isArray(config.asarUnpack) ? config.asarUnpack : [];
  for (const file of WORKER_CLOSURE) {
    assert.ok(
      unpacked.some((pattern) => pattern.endsWith(file)),
      `asarUnpack must cover ${file}`,
    );
  }
});

test('sentinel worker closure is loadable by vanilla node from an app.asar.unpacked layout (ELECTRON_RUN_AS_NODE regime)', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-unpack-'));
  const unpackedSrc = path.join(root, 'resources', 'app.asar.unpacked', 'src');
  await fs.mkdir(unpackedSrc, { recursive: true });
  // a placeholder asar file proves we are NOT reading from the archive
  await fs.writeFile(path.join(root, 'resources', 'app.asar'), 'not-a-real-archive');
  for (const file of WORKER_CLOSURE) {
    await fs.copyFile(new URL(`../src/${file}`, import.meta.url).pathname, path.join(unpackedSrc, file));
  }

  const statePath = path.join(root, 'sentinel-state.json');
  const token = '00000000-0000-4000-8000-0000000000aa';
  const parentPid = process.pid;
  await fs.writeFile(statePath, JSON.stringify({
    schema: 'metaengine.browser-sentinel.state.v1',
    token,
    parent_pid: parentPid,
    executable: process.execPath,
    worker_script: path.join(unpackedSrc, 'browser-sentinel-worker.cjs'),
    state_revision: 1,
    lifecycle: 'ARMED',
    worker_pid: null,
    worker_released: false,
    expected_restart: false,
    installer_handoff: false,
    authority_effect: false,
  }));

  const workerPath = path.join(unpackedSrc, 'browser-sentinel-worker.cjs');
  // resolve like the packaged runtime does
  const asarStylePath = workerPath.split(`${path.sep}app.asar.unpacked${path.sep}`).join(`${path.sep}app.asar${path.sep}`);
  const resolved = resolveSentinelWorkerScript(asarStylePath);
  assert.equal(resolved, workerPath, 'resolver must select the unpacked worker');

  const child = spawn(process.execPath, [resolved], {
    detached: false,
    stdio: 'ignore',
    shell: false,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      METAENGINE_SENTINEL_STATE_PATH: statePath,
      METAENGINE_SENTINEL_TOKEN: token,
      METAENGINE_SENTINEL_PARENT_PID: String(parentPid),
    },
  });

  // The real parent binds the spawned worker pid into the durable state file
  // before the worker can heartbeat (single-writer fence). Simulate that here.
  await new Promise((resolve) => child.once('spawn', resolve));
  await fs.writeFile(statePath, JSON.stringify({
    schema: 'metaengine.browser-sentinel.state.v1',
    token,
    parent_pid: parentPid,
    executable: process.execPath,
    worker_script: workerPath,
    state_revision: 2,
    lifecycle: 'ARMED',
    worker_pid: child.pid,
    worker_released: false,
    expected_restart: false,
    installer_handoff: false,
    authority_effect: false,
  }));

  const heartbeatPath = `${statePath}.worker-heartbeat-v1.json`;
  const deadline = Date.now() + 20_000;
  let heartbeat = null;
  while (Date.now() < deadline) {
    heartbeat = await fs.readFile(heartbeatPath, 'utf8').then((t) => JSON.parse(t)).catch(() => null);
    if (heartbeat) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  let alive = true;
  try { process.kill(child.pid, 0); } catch { alive = false; }
  if (alive) child.kill('SIGTERM');

  assert.ok(heartbeat, 'vanilla-node worker spawned from app.asar.unpacked must produce a heartbeat');
  assert.equal(heartbeat.schema, 'metaengine.browser-sentinel.worker-heartbeat.v1');
  assert.equal(heartbeat.token, token);
  assert.equal(heartbeat.parent_pid, parentPid);
  assert.equal(heartbeat.worker_pid, child.pid);
  assert.equal(heartbeat.lifecycle, 'READY');
  assert.equal(heartbeat.authority_effect, false);
  assert.ok(alive, 'worker must stay alive while its parent lives (no instant require-time exit)');
});

test('worker recovery telemetry records the exact child exit code for instantly-dying candidates', async () => {
  const { EventEmitter } = await import('node:events');
  const { BrowserSentinelHost } = await import('../src/browser-sentinel.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-exitproof-'));
  const statePath = path.join(dir, 'sentinel-state.json');
  const alive = new Set();
  const children = [];
  let nextPid = 555000;
  const spawnImpl = (executable, args) => {
    const child = new EventEmitter();
    child.pid = nextPid;
    child.unref = () => {};
    alive.add(child.pid);
    children.push(child);
    nextPid += 1;
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'worker.cjs'),
    executable: 'browser.exe',
    spawnImpl,
    processAliveImpl: (pid) => alive.has(Number(pid)),
  });
  await sentinel.start({ app: new EventEmitter() });
  const firstState = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(firstState.worker_pid, 555000);

  // the bound worker dies instantly at require time (exit code 1) — the asar defect
  alive.delete(555000);
  children[0].emit('exit', 1, null);

  // the replacement candidate acks spawn, then also dies with a distinct exit code
  setTimeout(() => {
    if (children[1]) {
      alive.delete(children[1].pid);
      children[1].emit('exit', 7, null);
    }
  }, 100);

  const recovery = await sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 600 });
  assert.equal(recovery.state, 'CANDIDATE_CONFIRMED_ABSENT');
  assert.equal(recovery.automatic_retry_allowed, true);
  assert.equal(recovery.authority_effect, false);
  const disk = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(disk.worker_recovery_state, 'CANDIDATE_CONFIRMED_ABSENT');
  assert.match(String(disk.worker_recovery_result), /exit_code:7/);
  assert.equal(disk.authority_effect, false);
});
