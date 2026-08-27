import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { RPC_METHOD_EFFECTS, RPC_METHODS } from '../src/rpc-server.mjs';
import { atomicJsonWrite, readJson, rotateControlToken } from '../src/security.mjs';

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

test('target creation persists PREPARING intent before the Chromium effect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-create-intent-'));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  const profileId = 'intent-profile';
  const incarnation = '11111111-1111-4111-8111-111111111111';
  try {
    await runtime.init();
    await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
    const processRef = {
      processIncarnationId: incarnation,
      isRunning: () => true,
      stop: async () => {},
      cdp: {
        call: async (method) => {
          assert.equal(method, 'Target.createTarget');
          const registry = await readJson(path.join(runtime.profileDir(profileId), 'targets.json'), null);
          const prepared = registry.targets.find((row) => row.target_id === 'intent_target');
          assert.equal(prepared.status, 'PREPARING');
          assert.equal(prepared.pending_operation, 'TARGET_CREATE');
          assert.equal(prepared.pending_process_incarnation_id, incarnation);
          assert.match(prepared.pending_operation_id, /^[0-9a-f-]{36}$/);
          return { targetId: 'engine-target-1' };
        }
      }
    };
    runtime.running.set(profileId, { processRef, bindings: new Map(), meta: {}, lockFile: null });
    const created = await runtime.createTarget({ profileId, targetId: 'intent_target' });
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.pending_operation_id, null);
    assert.equal(created.process_incarnation_id, incarnation);
    const registry = await readJson(path.join(runtime.profileDir(profileId), 'targets.json'), null);
    assert.equal(registry.targets[0].status, 'ACTIVE');
    assert.equal(registry.targets[0].last_operation_id, created.last_operation_id);
  } finally {
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ambiguous target creation remains recovery-required and cannot blind retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-create-ambiguous-'));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  const profileId = 'ambiguous-profile';
  let calls = 0;
  try {
    await runtime.init();
    await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
    const processRef = {
      processIncarnationId: '22222222-2222-4222-8222-222222222222',
      isRunning: () => true,
      stop: async () => {},
      cdp: { call: async () => { calls += 1; throw new Error('cdp_call_timeout:Target.createTarget'); } }
    };
    runtime.running.set(profileId, { processRef, bindings: new Map(), meta: {}, lockFile: null });
    await assert.rejects(runtime.createTarget({ profileId, targetId: 'ambiguous_target' }), /cdp_call_timeout/);
    const registry = await readJson(path.join(runtime.profileDir(profileId), 'targets.json'), null);
    assert.equal(registry.targets[0].status, 'PREPARING');
    assert.equal(registry.targets[0].pending_operation, 'TARGET_CREATE');
    await assert.rejects(runtime.createTarget({ profileId, targetId: 'ambiguous_target' }), /target_id_exists/);
    assert.equal(calls, 1);
  } finally {
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ambiguous activate and close intents stay fenced from blind retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-target-ops-'));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  const profileId = 'target-ops-profile';
  const incarnation = '33333333-3333-4333-8333-333333333333';
  let calls = 0;
  try {
    await runtime.init();
    await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
    await atomicJsonWrite(path.join(runtime.profileDir(profileId), 'targets.json'), {
      schema: 'metaengine.a2-compute-browser.targets.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      targets: [
        { target_id: 'activate_target', status: 'ACTIVE', conversation_epoch: 1 },
        { target_id: 'close_target', status: 'ACTIVE', conversation_epoch: 1 }
      ]
    });
    const processRef = {
      processIncarnationId: incarnation,
      isRunning: () => true,
      stop: async () => {},
      cdp: { call: async (method) => { calls += 1; throw new Error(`cdp_call_timeout:${method}`); } }
    };
    const bindings = new Map([
      ['activate_target', { cdp_target_id: 'engine-activate', process_incarnation_id: incarnation }],
      ['close_target', { cdp_target_id: 'engine-close', process_incarnation_id: incarnation }]
    ]);
    runtime.running.set(profileId, { processRef, bindings, meta: {}, lockFile: null });

    await assert.rejects(runtime.activateTarget({ profileId, targetId: 'activate_target' }), /cdp_call_timeout/);
    await assert.rejects(runtime.activateTarget({ profileId, targetId: 'activate_target' }), /target_recovery_required/);
    await assert.rejects(runtime.closeTarget({ profileId, targetId: 'close_target' }), /cdp_call_timeout/);
    await assert.rejects(runtime.closeTarget({ profileId, targetId: 'close_target' }), /target_recovery_required/);
    assert.equal(calls, 2);

    const registry = await readJson(path.join(runtime.profileDir(profileId), 'targets.json'), null);
    const activating = registry.targets.find((row) => row.target_id === 'activate_target');
    const closing = registry.targets.find((row) => row.target_id === 'close_target');
    assert.equal(activating.status, 'ACTIVATING');
    assert.equal(activating.pending_operation, 'TARGET_ACTIVATE');
    assert.equal(closing.status, 'CLOSING');
    assert.equal(closing.pending_operation, 'TARGET_CLOSE');
  } finally {
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
