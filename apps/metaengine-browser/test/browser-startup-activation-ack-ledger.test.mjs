import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BROWSER_STARTUP_ACTIVATION_ACK_MAX,
  BROWSER_STARTUP_JOURNAL_MAX_EVENTS,
  beginBrowserStartupJournal,
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
    getVersion() { return '0.7.0-dev.activation-ledger'; },
  };
}

test('exact activation ACK survives eviction from the general startup event ring', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-activation-ledger-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  let now = Date.parse('2026-09-09T10:00:00.000Z');
  const clock = () => now;
  const launchId = '77777777-7777-4777-8777-777777777777';
  const boot = await beginBrowserStartupJournal(app, { clock });

  now += 1;
  const activation = await recordBrowserStartupEvent(app, {
    boot_id: boot.boot_id,
    state: 'PRIMARY_WINDOW_ACTIVATED',
    reason: 'PRIMARY_WINDOW_ACTIVATED',
    details: { launch_id: launchId, visible: true, focused: true },
    clock,
  });
  const activationSequence = activation.last_sequence;

  for (let i = 0; i < BROWSER_STARTUP_JOURNAL_MAX_EVENTS + 8; i += 1) {
    now += 1;
    await recordBrowserStartupEvent(app, {
      boot_id: boot.boot_id,
      state: 'RUNTIME_IMPORT_OK',
      reason: 'MAIN_MODULE_IMPORTED',
      details: { filler_index: i },
      clock,
    });
  }

  const row = await readBrowserStartupJournal(app);
  assert.equal(row.events.some((event) => event.sequence === activationSequence), false);
  assert.ok(row.activation_acks.some((ack) => ack.launch_id === launchId && ack.sequence === activationSequence));
  assert.ok(row.activation_acks.length <= BROWSER_STARTUP_ACTIVATION_ACK_MAX);

  const ack = await waitForPrimaryActivationAck(app, {
    launch_id: launchId,
    timeout_ms: 100,
    poll_ms: 10,
    clock,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.reason, 'PRIMARY_ACTIVATION_ACK_EXACT');
  assert.equal(ack.ack_source, 'ACTIVATION_ACK_LEDGER');
  assert.equal(ack.event_sequence, activationSequence);
  assert.equal(ack.primary_boot_id, boot.boot_id);
});

test('activation ACK ledger remains independently bounded to newest exact receipts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-activation-ledger-bound-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  let now = Date.parse('2026-09-09T11:00:00.000Z');
  const clock = () => now;
  const boot = await beginBrowserStartupJournal(app, { clock });
  const total = BROWSER_STARTUP_ACTIVATION_ACK_MAX + 12;

  for (let i = 0; i < total; i += 1) {
    const suffix = String(i).padStart(12, '0');
    const launchId = `88888888-8888-4888-8888-${suffix}`;
    now += 1;
    await recordBrowserStartupEvent(app, {
      boot_id: boot.boot_id,
      state: 'PRIMARY_WINDOW_ACTIVATED',
      reason: 'PRIMARY_WINDOW_ACTIVATED',
      details: { launch_id: launchId, visible: true },
      clock,
    });
  }

  const row = await readBrowserStartupJournal(app);
  assert.equal(row.activation_acks.length, BROWSER_STARTUP_ACTIVATION_ACK_MAX);
  assert.equal(row.activation_acks[0].launch_id, '88888888-8888-4888-8888-000000000012');
  assert.equal(row.activation_acks.at(-1).launch_id, `88888888-8888-4888-8888-${String(total - 1).padStart(12, '0')}`);
  assert.ok(row.events.length <= BROWSER_STARTUP_JOURNAL_MAX_EVENTS);
});
