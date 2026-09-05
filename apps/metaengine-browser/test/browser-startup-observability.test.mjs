import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BROWSER_STARTUP_JOURNAL_FILE,
  BROWSER_STARTUP_JOURNAL_SCHEMA,
  activateExistingPrimaryWindow,
  beginBrowserStartupJournal,
  browserStartupObservabilityContract,
  readBrowserStartupJournal,
  recordBrowserStartupEvent,
  waitForPrimaryActivationAck,
  waitForStablePrimaryWindow,
} from '../src/browser-startup-observability.mjs';
import {
  METAENGINE_BROWSER_APP_ID,
  SINGLE_INSTANCE_LOCK_SCHEMA,
  acquirePrimaryInstance,
  validSingleInstanceLaunchData,
} from '../src/single-instance-guard.mjs';

function fakeApp(root, version = '0.6.6-dev.11.1') {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return root;
    },
    getVersion() { return version; },
  };
}

function fakeWindow({ minimized = false, visible = true, focused = false } = {}) {
  let state = { minimized, visible, focused, destroyed: false };
  return {
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    restore: () => { state.minimized = false; state.visible = true; },
    show: () => { state.visible = true; state.focused = true; },
    focus: () => { state.focused = true; },
    isVisible: () => state.visible,
    isFocused: () => state.focused,
    snapshot: () => ({ ...state }),
  };
}

test('startup journal durably distinguishes import failure from normal boot', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-journal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  let now = Date.parse('2026-09-05T06:00:00Z');
  const clock = () => now;

  const boot = await beginBrowserStartupJournal(app, { clock });
  now += 100;
  await recordBrowserStartupEvent(app, {
    boot_id: boot.boot_id,
    state: 'RUNTIME_IMPORT_FAILED',
    reason: 'MAIN_MODULE_IMPORT_REJECTED',
    error: Object.assign(new Error('synthetic_runtime_import_failure'), { code: 'ERR_MODULE_NOT_FOUND' }),
    details: { host_process_kept_alive: true },
    clock,
  });

  const row = await readBrowserStartupJournal(app);
  assert.equal(row.schema, BROWSER_STARTUP_JOURNAL_SCHEMA);
  assert.equal(row.current_boot_id, boot.boot_id);
  assert.equal(row.events.at(-1).state, 'RUNTIME_IMPORT_FAILED');
  assert.equal(row.events.at(-1).error.code, 'ERR_MODULE_NOT_FOUND');
  assert.equal(row.events.at(-1).details.host_process_kept_alive, true);
  assert.match(row.events.at(-1).error.stack_sha256, /^[0-9a-f]{64}$/);
  assert.equal(path.basename(boot.journal_path), BROWSER_STARTUP_JOURNAL_FILE);
});

test('startup journal preserves prior boot history and advances exact sequence', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  let now = 1_800_000_000_000;
  const clock = () => now;

  const first = await beginBrowserStartupJournal(app, { clock });
  now += 10;
  await recordBrowserStartupEvent(app, {
    boot_id: first.boot_id,
    state: 'PRIMARY_WINDOW_STABLE',
    reason: 'NORMAL_UI_BOOT_VERIFIED',
    clock,
  });
  now += 10;
  const second = await beginBrowserStartupJournal(app, { clock });
  const row = await readBrowserStartupJournal(app);

  assert.notEqual(first.boot_id, second.boot_id);
  assert.deepEqual(row.events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(row.events[0].boot_id, first.boot_id);
  assert.equal(row.events.at(-1).boot_id, second.boot_id);
  assert.equal(row.last_sequence, 3);
});

test('single-instance guard sends exact launch nonce but never silently quits a losing secondary', () => {
  const launchId = '11111111-1111-4111-8111-111111111111';
  let captured = null;
  let quitCalls = 0;
  const app = {
    requestSingleInstanceLock(additionalData) {
      captured = additionalData;
      return false;
    },
    quit() { quitCalls += 1; },
  };

  const guard = acquirePrimaryInstance(app, { launch_id: launchId });
  assert.equal(guard.primary, false);
  assert.equal(guard.secondary_ack_required, true);
  assert.equal(guard.launch_id, launchId);
  assert.equal(quitCalls, 0);
  assert.deepEqual(captured, {
    schema: SINGLE_INSTANCE_LOCK_SCHEMA,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id: launchId,
  });
  assert.equal(validSingleInstanceLaunchData(captured), true);
  assert.equal(validSingleInstanceLaunchData({ ...captured, launch_id: 'caller-text' }), false);
});

test('second instance activation restores hidden or minimized primary window', () => {
  const win = fakeWindow({ minimized: true, visible: false, focused: false });
  const BaseWindow = {
    getAllWindows: () => [win],
    getFocusedWindow: () => null,
  };
  const result = activateExistingPrimaryWindow(BaseWindow);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'PRIMARY_WINDOW_ACTIVATED');
  assert.equal(result.restored, true);
  assert.deepEqual(win.snapshot(), {
    minimized: false,
    visible: true,
    focused: true,
    destroyed: false,
  });
});

test('second instance activation is explicit when no primary window exists', () => {
  const result = activateExistingPrimaryWindow({
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PRIMARY_WINDOW_NOT_READY');
});

test('losing secondary accepts only durable activation ACK for its exact launch nonce', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-ack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  const launchId = '22222222-2222-4222-8222-222222222222';
  let now = Date.parse('2026-09-05T06:10:00Z');
  const clock = () => now;
  const boot = await beginBrowserStartupJournal(app, { clock });
  let wrote = false;
  const sleep = async (ms) => {
    now += ms;
    if (!wrote && now >= Date.parse('2026-09-05T06:10:00.200Z')) {
      wrote = true;
      await recordBrowserStartupEvent(app, {
        boot_id: boot.boot_id,
        state: 'PRIMARY_WINDOW_ACTIVATED',
        reason: 'PRIMARY_WINDOW_ACTIVATED',
        details: { launch_id: launchId, visible: true, focused: true },
        clock,
      });
    }
  };

  const ack = await waitForPrimaryActivationAck(app, {
    launch_id: launchId,
    timeout_ms: 1_000,
    poll_ms: 100,
    clock,
    sleep,
  });
  assert.equal(ack.ok, true);
  assert.equal(ack.reason, 'PRIMARY_ACTIVATION_ACK_EXACT');
  assert.equal(ack.launch_id, launchId);
  assert.equal(ack.primary_boot_id, boot.boot_id);
});

test('stale/old primary without launch ACK becomes an explicit timeout, never false success', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-old-primary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root, '0.6.6-dev.4.1');
  const launchId = '33333333-3333-4333-8333-333333333333';
  let now = 0;
  const out = await waitForPrimaryActivationAck(app, {
    launch_id: launchId,
    timeout_ms: 500,
    poll_ms: 100,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'PRIMARY_ACTIVATION_ACK_TIMEOUT');
});

test('ACK for another secondary launch cannot satisfy this launch', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-wrong-ack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  let now = 0;
  const boot = await beginBrowserStartupJournal(app, { clock: () => now });
  await recordBrowserStartupEvent(app, {
    boot_id: boot.boot_id,
    state: 'PRIMARY_WINDOW_ACTIVATED',
    reason: 'PRIMARY_WINDOW_ACTIVATED',
    details: {
      launch_id: '44444444-4444-4444-8444-444444444444',
      visible: true,
    },
    clock: () => now,
  });
  const out = await waitForPrimaryActivationAck(app, {
    launch_id: '55555555-5555-4555-8555-555555555555',
    timeout_ms: 300,
    poll_ms: 100,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'PRIMARY_ACTIVATION_ACK_TIMEOUT');
});

test('normal UI readback requires the same visible BaseWindow to remain stable', async () => {
  const win = fakeWindow({ visible: false });
  let now = 0;
  const BaseWindow = {
    getAllWindows: () => [win],
  };
  const sleep = async (ms) => {
    now += ms;
    if (now >= 200) win.show();
  };
  const out = await waitForStablePrimaryWindow(BaseWindow, {
    timeout_ms: 2_000,
    stable_ms: 500,
    poll_ms: 100,
    clock: () => now,
    sleep,
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'PRIMARY_WINDOW_STABLE');
  assert.ok(out.stable_ms >= 500);
});

test('observability contract rejects stderr-only and mixed-version singleton silence', () => {
  const contract = browserStartupObservabilityContract();
  assert.equal(contract.runtime_import_failure_must_be_durable, true);
  assert.equal(contract.gui_stderr_is_diagnostic_authority, false);
  assert.equal(contract.second_instance_must_activate_primary_window, true);
  assert.equal(contract.second_instance_activation_ack_must_match_launch_id, true);
  assert.equal(contract.mixed_version_primary_without_ack_must_surface_error, true);
  assert.equal(contract.secondary_must_not_mutate_primary_journal, true);
  assert.equal(contract.normal_ui_boot_requires_stable_window_readback, true);
  assert.equal(contract.authority_effect, false);
});
