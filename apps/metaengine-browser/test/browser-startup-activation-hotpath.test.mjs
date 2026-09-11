import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  PRIMARY_ACTIVATION_ACK_POLL_MS,
  beginBrowserStartupJournal,
  browserStartupObservabilityContract,
  readBrowserStartupJournal,
  recordBrowserStartupEvent,
  waitForPrimaryActivationAck,
} from '../src/browser-startup-observability.mjs';

function fakeApp(root) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return root;
    },
    getVersion() { return '0.6.6-hotpath-test'; },
  };
}

test('second-instance receive marker is advisory and exact activation ACK advances durability once', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-activation-hotpath-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  const launchId = '22222222-2222-4222-8222-222222222222';
  let now = Date.parse('2026-09-06T14:00:00Z');
  const clock = () => now;

  const boot = await beginBrowserStartupJournal(app, { clock });
  const before = await readBrowserStartupJournal(app);
  assert.equal(before.last_sequence, boot.last_sequence);

  const advisory = await recordBrowserStartupEvent(app, {
    boot_id: boot.boot_id,
    state: 'SECOND_INSTANCE_RECEIVED',
    reason: 'SINGLE_INSTANCE_LAUNCH_NONCE_RECEIVED',
    details: { launch_id: launchId },
    clock,
  });
  assert.equal(advisory.durable, false);
  assert.equal(advisory.represented_by_exact_activation_ack, true);

  const afterAdvisory = await readBrowserStartupJournal(app);
  assert.equal(afterAdvisory.last_sequence, before.last_sequence);
  assert.equal(afterAdvisory.events.some((event) => event.state === 'SECOND_INSTANCE_RECEIVED'), false);

  now += 1;
  await recordBrowserStartupEvent(app, {
    boot_id: boot.boot_id,
    state: 'PRIMARY_WINDOW_ACTIVATED',
    reason: 'PRIMARY_WINDOW_ACTIVATED',
    details: { launch_id: launchId, visible: true, focused: true },
    clock,
  });
  const afterAck = await readBrowserStartupJournal(app);
  assert.equal(afterAck.last_sequence, before.last_sequence + 1);
  assert.equal(afterAck.events.at(-1).state, 'PRIMARY_WINDOW_ACTIVATED');
  assert.equal(afterAck.events.at(-1).details.launch_id, launchId);

  const ack = await waitForPrimaryActivationAck(app, {
    launch_id: launchId,
    timeout_ms: 100,
    poll_ms: 1,
    clock,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.event_sequence, afterAck.last_sequence);
  assert.equal(ack.primary_pid, process.pid);
});

test('activation ACK poll interval and UUID fence stay bounded and exact', async (t) => {
  assert.equal(PRIMARY_ACTIVATION_ACK_POLL_MS, 25);
  const contract = browserStartupObservabilityContract();
  assert.equal(contract.second_instance_receive_marker_is_advisory_only, true);
  assert.equal(contract.second_instance_activation_ack_is_single_durable_write, true);
  assert.equal(contract.primary_activation_ack_poll_ms, 25);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-activation-uuid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  let now = 0;

  const canonical = await waitForPrimaryActivationAck(app, {
    launch_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    timeout_ms: 1,
    poll_ms: 1,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(canonical.reason, 'PRIMARY_ACTIVATION_ACK_TIMEOUT');

  const malformed = await waitForPrimaryActivationAck(app, {
    launch_id: 'aaaaaaaa-4ccc-8ddd-eeeeeeeeeeee',
    timeout_ms: 1,
    poll_ms: 1,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(malformed.reason, 'PRIMARY_ACTIVATION_ACK_LAUNCH_ID_INVALID');
});
