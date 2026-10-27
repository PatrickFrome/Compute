import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalRuntimeRecoveryFixture } from './local-runtime-recovery-fixture.mjs';

test('owned real child confirms terminal cleanup before replacement; concurrent starts share each generation', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  const { startConfiguredLocalRuntimeHost: start, stopOwnedLocalRuntimeHost: stop,
    ownedLocalRuntimeHostReady: ready } = f.controller;
  const [first, duplicate] = await Promise.all([start(f.startOptions), start(f.startOptions)]);
  assert.equal(first, duplicate);
  assert.equal(f.children.length, 1);
  assert.equal(f.verifications(), 1);
  const stopped = await stop({ timeoutMs: 2_000 });
  assert.equal(stopped.state, 'STOPPED');
  assert.equal(stopped.cleanup_confirmed, true);
  assert.equal(ready(first), false);
  assert.equal(f.children[0].exited, true);
  const [second, secondDuplicate] = await Promise.all([start(f.startOptions), start(f.startOptions)]);
  assert.equal(second, secondDuplicate);
  assert.notEqual(second.instance_id, first.instance_id);
  assert.notEqual(second.pid, first.pid);
  assert.equal(f.children.length, 2);
  assert.equal(f.verifications(), 2);
  assert.equal(ready(first), false);
  assert.equal(ready(second), true);
  assert.equal((await stop({ timeoutMs: 2_000 })).cleanup_confirmed, true);
});

test('unsolicited health failure confirms terminal cleanup and permits one fresh generation', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  const first = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  await f.command(1, 'terminal-stop');
  await f.children[0].ended;
  assert.equal(f.controller.ownedLocalRuntimeHostReady(first), false);
  assert.equal((await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 })).cleanup_confirmed, true);
  const second = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  assert.notEqual(second.instance_id, first.instance_id);
  assert.equal(f.children.length, 2);
  await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 });
});

for (const [name, plan, command] of [
  ['crash without terminal acknowledgment', {}, 'crash'],
  ['zero exit without terminal acknowledgment', { omitTerminal: true }, 'terminal-stop'],
  ['wrong launch nonce', { wrongNonce: true }, 'terminal-stop'],
  ['wrong host PID', { wrongPid: true }, 'terminal-stop'],
  ['wrong runtime instance', { wrongInstance: true }, 'terminal-stop'],
  ['unreleased ownership', { terminalPatch: { ownership_released: false } }, 'terminal-stop'],
  ['children not confirmed stopped', { terminalPatch: { children_stopped: false } }, 'terminal-stop'],
  ['extra terminal fields', { terminalPatch: { private_hint: 'not-authority' } }, 'terminal-stop'],
]) {
  test(`${name} retains cleanup uncertainty and forbids replacement`, async t => {
    const f = await createLocalRuntimeRecoveryFixture(t);
    f.queueGeneration(plan);
    const first = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
    await f.command(1, command);
    await f.children[0].ended;
    const stopped = await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 });
    assert.equal(stopped.state, 'CLEANUP_UNCONFIRMED');
    assert.equal(stopped.cleanup_confirmed, false);
    assert.equal(f.controller.ownedLocalRuntimeHostReady(first), false);
    await assert.rejects(f.controller.startConfiguredLocalRuntimeHost(f.startOptions), /local_runtime_host_/);
    assert.equal(f.children.length, 1);
    assert.equal(f.verifications(), 1);
  });
}

test('two valid conflicting terminal records retain cleanup uncertainty after physical exit', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  f.queueGeneration({ holdExit: true });
  const first = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  const { child, ended } = f.children[0];
  const terminal = new Promise(resolve => {
    const onMessage = value => {
      if (value?.schema !== 'compute.runtime-host-terminal.v1') return;
      child.off('message', onMessage); resolve(value);
    };
    child.on('message', onMessage);
  });
  await f.command(1, 'terminal-stop');
  const original = await terminal;
  assert.equal(original.reason, 'runtime_health_failed');
  child.emit('message', { ...original, reason: 'requested' });
  assert.equal(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON, 'OWNED_RUNTIME_HOST_TERMINAL_INVALID');
  await f.command(1, 'release-exit');
  await ended;
  const stopped = await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 });
  assert.equal(stopped.state, 'CLEANUP_UNCONFIRMED');
  assert.equal(stopped.cleanup_confirmed, false);
  assert.equal(f.controller.ownedLocalRuntimeHostReady(first), false);
  await assert.rejects(f.controller.startConfiguredLocalRuntimeHost(f.startOptions), /local_runtime_host_/);
  assert.equal(f.children.length, 1);
  assert.equal(f.verifications(), 1);
});

test('shutdown during queued verification cancels startup before the child can spawn', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  const gate = f.holdVerification();
  const starting = f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  const rejected = assert.rejects(starting, /local_runtime_host_.*(?:stop|cancel|shutdown)/);
  await gate.entered;
  const stopping = f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 });
  gate.release();
  await rejected;
  assert.equal((await stopping).cleanup_confirmed, true);
  assert.equal(f.children.length, 0);
});

test('shutdown after spawn but before READY stops that exact generation without admitting it', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  f.queueGeneration({ holdReady: true });
  const starting = f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  const rejected = assert.rejects(starting, /local_runtime_host_.*(?:stop|cancel|shutdown|exited_before_ready)/);
  await f.waitForEvent('STARTED', { generation: 1 });
  const stopped = await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 });
  await rejected;
  assert.equal(stopped.cleanup_confirmed, true);
  assert.equal(f.children[0].exited, true);
  assert.equal((await f.events()).some(row => row.type === 'READY'), false);
  assert.equal(f.controller.readOwnedLocalRuntimeHostSummary(), null);
});

test('a valid terminal acknowledgment alone cannot confirm cleanup before physical exit', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  f.queueGeneration({ holdExit: true });
  await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  let settled = false;
  const stopping = f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 }).then(value => { settled = true; return value; });
  await f.waitForEvent('TERMINAL_SENT', { generation: 1 });
  assert.equal(f.children[0].exited, false);
  assert.equal(settled, false);
  await f.command(1, 'release-exit');
  assert.equal((await stopping).cleanup_confirmed, true);
  assert.equal(f.children[0].exited, true);
});

test('a malformed terminal before READY cannot be followed by an admitted descriptor', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  f.queueGeneration({ holdReady: true });
  const starting = f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  const rejected = assert.rejects(starting, /local_runtime_host_/);
  await f.waitForEvent('STARTED', { generation: 1 });
  await f.command(1, 'invalid-terminal-then-ready');
  await rejected;
  assert.equal(f.controller.readOwnedLocalRuntimeHostSummary(), null);
  assert.equal((await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 })).cleanup_confirmed, false);
  await assert.rejects(f.controller.startConfiguredLocalRuntimeHost(f.startOptions), /local_runtime_host_/);
  assert.equal(f.children.length, 1);
});

test('a malformed terminal after READY revokes readiness and cannot mint a fresh native capability', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  const first = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  await f.command(1, 'invalid-terminal');
  await f.waitForEvent('INVALID_TERMINAL_SENT', { generation: 1 });
  // Observing the environment transition avoids assuming cross-process event
  // file visibility implies delivery of the IPC frame to the parent.
  const deadline = Date.now() + 2_000;
  while (f.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON !== 'OWNED_RUNTIME_HOST_TERMINAL_INVALID' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON, 'OWNED_RUNTIME_HOST_TERMINAL_INVALID');
  assert.equal(f.controller.ownedLocalRuntimeHostReady(first), false);
  assert.equal(f.controller.readOwnedLocalRuntimeHostSummary(), null);
  assert.throws(() => f.controller.createOwnedNativeCodingHostCapability(first), /unavailable/);
  await assert.rejects(f.controller.startConfiguredLocalRuntimeHost(f.startOptions), /local_runtime_host_/);
  assert.equal(f.children.length, 1);
  assert.equal((await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 })).cleanup_confirmed, false);
});

test('an outstanding native read cannot be rebound to a replacement child', async t => {
  const f = await createLocalRuntimeRecoveryFixture(t);
  f.queueGeneration({ holdNativeReads: true });
  const first = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  const capability = f.controller.createOwnedNativeCodingHostCapability(first);
  const pending = capability.readScope();
  const rejected = assert.rejects(pending, error => error.automatic_retry_allowed === false
    && ['CHILD_EXIT', 'CHANNEL_CLOSED', 'HOST_TERMINATED'].includes(error.reason));
  await f.waitForEvent('NATIVE_REQUEST', { generation: 1 });
  await f.command(1, 'terminal-stop');
  await f.children[0].ended;
  await rejected;
  const second = await f.controller.startConfiguredLocalRuntimeHost(f.startOptions);
  const replacement = f.controller.createOwnedNativeCodingHostCapability(second);
  const observed = await replacement.readScope();
  assert.equal(observed.instance_id, second.instance_id);
  assert.equal(observed.generation, 2);
  assert.equal(capability.snapshot().closed, true);
  await assert.rejects(capability.readScope(), error => error.reason === 'CHANNEL_CLOSED');
  capability.close();
  replacement.close();
  assert.equal((await f.events()).filter(row => row.type === 'NATIVE_REQUEST' && row.generation === 2).length, 1);
  await f.controller.stopOwnedLocalRuntimeHost({ timeoutMs: 2_000 });
});
