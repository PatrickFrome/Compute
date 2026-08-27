import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { RPC_METHOD_EFFECTS, RPC_METHODS } from '../src/rpc-server.mjs';
import { rotateControlToken } from '../src/security.mjs';

test('control capability rotates per daemon session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-rotate-'));
  try {
    const first = await rotateControlToken(root);
    const second = await rotateControlToken(root);
    assert.match(first.token, /^[a-f0-9]{64}$/);
    assert.match(second.token, /^[a-f0-9]{64}$/);
    assert.notEqual(first.token, second.token);
    assert.equal(await fs.readFile(second.file, 'utf8'), `${second.token}\n`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('state root admits only one live compute-browser runtime owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-daemon-lock-'));
  const first = new ComputeBrowserRuntime({ stateRoot: root });
  const second = new ComputeBrowserRuntime({ stateRoot: root });
  try {
    await first.init();
    await assert.rejects(second.init(), /daemon_lock_held/);
    await first.shutdown();
    await second.init();
  } finally {
    await second.shutdown().catch(() => {});
    await first.shutdown().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('RPC effect classes are explicit and web authority remains absent', () => {
  assert.deepEqual(Object.keys(RPC_METHOD_EFFECTS), RPC_METHODS);
  assert.equal(RPC_METHOD_EFFECTS['runtime.health'], 'READ_ONLY');
  assert.equal(RPC_METHOD_EFFECTS['profile.start'], 'LOCAL_LIFECYCLE');
  assert.equal(RPC_METHOD_EFFECTS['target.activate'], 'LOCAL_UI');
  for (const value of Object.values(RPC_METHOD_EFFECTS)) {
    assert.match(value, /^(READ_ONLY|LOCAL_LIFECYCLE|LOCAL_UI)$/);
  }
});

test('profile runtime configuration is daemon-owned, not RPC-owned', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-config-'));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  try {
    await runtime.init();
    await assert.rejects(
      runtime.startProfile({ profileId: 'safe-profile', executablePath: '/tmp/attacker', headless: true, allowNoSandbox: true }),
      /engine_executable_not_configured/
    );
  } finally {
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
