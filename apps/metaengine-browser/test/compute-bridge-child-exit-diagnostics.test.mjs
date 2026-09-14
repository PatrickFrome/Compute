import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBridgeClient, observeComputeBridgeChild } from '../src/compute-bridge-client.mjs';

function deadChild({ stderr = 'compute_bridge_worker_failed:test_failure', code = 1 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  const diagnostics = observeComputeBridgeChild(child);
  queueMicrotask(() => {
    child.emit('spawn');
    child.stderr.write(`${stderr}\n`);
    child.stderr.end();
    child.exitCode = code;
    child.signalCode = null;
    child.emit('exit', code, null);
  });
  return { child, diagnostics };
}

test('post-launch worker exit is surfaced instead of hiding behind stale manifest ECONNREFUSED', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-compute-child-exit-'));
  const manifestPath = path.join(dir, 'missing-manifest.json');
  const nativeStateRoot = path.join(dir, 'native');
  let launches = 0;
  const client = new ComputeBridgeClient({
    manifestPath,
    nativeStateRoot,
    autoStart: true,
    autoStartTimeoutMs: 500,
    autoStartPollMs: 25,
    launchBridge: async () => {
      launches += 1;
      return deadChild({ stderr: 'compute_bridge_worker_failed:daemon_boot_failed' });
    },
  });
  try {
    const health = await client.health();
    assert.equal(launches, 1);
    assert.equal(health.available, false);
    assert.equal(health.automatic_remediation, true);
    assert.equal(health.remediation, 'BUNDLED_DAEMON_AUTOSTART');
    assert.match(String(health.remediation_error), /compute_bridge_worker_exit:1:none:compute_bridge_worker_failed:daemon_boot_failed/);
  } finally {
    await client.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('observer recovers an already-exited child identity across an async launcher boundary', () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = 17;
  child.signalCode = null;
  const observed = observeComputeBridgeChild(child);
  assert.equal(observed.spawned, true);
  assert.equal(observed.exited, true);
  assert.equal(observed.exit_code, 17);
  assert.equal(observed.signal, null);
});

test('child observer bounds diagnostics and records exit identity', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const observed = observeComputeBridgeChild(child);
  child.emit('spawn');
  child.stderr.write('x'.repeat(10000));
  child.emit('exit', 23, 'SIGTERM');
  assert.equal(observed.spawned, true);
  assert.equal(observed.exited, true);
  assert.equal(observed.exit_code, 23);
  assert.equal(observed.signal, 'SIGTERM');
  assert.ok(Buffer.byteLength(observed.stderr, 'utf8') <= 4096);
});
