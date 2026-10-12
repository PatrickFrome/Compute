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
  notifyPrimaryWindowShown,
  observePrimaryWindowStartup,
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

test('late cold-start window preserves the timeout and durably confirms actual stability', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-late-window-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = fakeApp(root);
  const boot = await beginBrowserStartupJournal(app);
  const win = fakeWindow({ visible: false });
  let now = 0;
  let finishRecovery;
  const recovered = new Promise((resolve) => { finishRecovery = resolve; });
  const observer = observePrimaryWindowStartup({ getAllWindows: () => [win] }, {
    clock: () => now,
    sleep: async (ms) => { now += ms; },
    onReadback: async (readback) => {
      await recordBrowserStartupEvent(app, {
        boot_id: boot.boot_id,
        state: readback.reason,
        details: {
          visible: readback.visible === true,
          stable_ms: readback.stable_ms ?? 0,
          elapsed_ms: readback.elapsed_ms,
          observation_phase: readback.observation_phase,
        },
      });
      if (readback.observation_phase === 'WINDOW_SHOWN') finishRecovery(readback);
    },
  });
  t.after(() => observer.stop());
  const initial = await observer.initial;
  assert.equal(initial.ok, false);
  assert.equal(initial.elapsed_ms, 30_000);
  assert.equal((await readBrowserStartupJournal(app)).events.at(-1).state, 'PRIMARY_WINDOW_STABLE_TIMEOUT');

  // The installed .52 window actually arrived after the one-shot 30 s bound.
  now = 44_000;
  win.show();
  notifyPrimaryWindowShown(win);
  const late = await recovered;
  assert.equal(late.ok, true);
  assert.equal(late.stable_ms, 1_500);
  assert.equal(late.elapsed_ms, 1_500, 'the show notification must not manufacture stability');
  assert.deepEqual((await readBrowserStartupJournal(app)).events.slice(1).map((row) => [row.state, row.details.observation_phase]), [
    ['PRIMARY_WINDOW_STABLE_TIMEOUT', 'BOOTSTRAP'],
    ['PRIMARY_WINDOW_STABLE', 'WINDOW_SHOWN'],
  ]);
});

test('show racing the initial deadline queues one independent stability readback', async (t) => {
  const win = fakeWindow({ visible: false });
  let now = 0;
  const rows = [];
  let finishRecovery;
  const recovered = new Promise((resolve) => { finishRecovery = resolve; });
  const observer = observePrimaryWindowStartup({ getAllWindows: () => [win] }, {
    timeout_ms: 500,
    stable_ms: 200,
    poll_ms: 100,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
      if (now === 400) {
        win.show();
        notifyPrimaryWindowShown(win);
        notifyPrimaryWindowShown(win);
      }
    },
    onReadback: (row) => {
      rows.push(row);
      if (row.observation_phase === 'WINDOW_SHOWN') finishRecovery(row);
    },
  });
  t.after(() => observer.stop());
  await observer.initial;
  assert.equal((await recovered).ok, true);
  assert.deepEqual(rows.map((row) => [row.ok, row.observation_phase]), [[false, 'BOOTSTRAP'], [true, 'WINDOW_SHOWN']]);
  assert.equal(rows[1].stable_ms, 200);
});

test('late readback cannot substitute another visible window for the notified primary', async (t) => {
  const primary = fakeWindow({ visible: false });
  const other = fakeWindow({ visible: true });
  let windows = [primary];
  let now = 0;
  let sleeps = 0;
  let finishRecovery;
  const recovered = new Promise((resolve) => { finishRecovery = resolve; });
  const rows = [];
  const observer = observePrimaryWindowStartup({ getAllWindows: () => windows }, {
    timeout_ms: 500,
    stable_ms: 200,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
      sleeps += 1;
      if (primary.isVisible()) windows = [other];
    },
    onReadback: (row) => {
      rows.push(row);
      if (row.observation_phase === 'WINDOW_SHOWN') finishRecovery(row);
    },
  });
  t.after(() => observer.stop());
  await observer.initial;
  const afterInitial = sleeps;
  notifyPrimaryWindowShown(primary); // Still hidden: cannot restart observation.
  notifyPrimaryWindowShown(other); // Not a live window in this observer.
  await Promise.resolve();
  assert.equal(sleeps, afterInitial);
  primary.show();
  notifyPrimaryWindowShown(primary);
  const late = await recovered;
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'PRIMARY_WINDOW_STABLE_TIMEOUT');
  assert.equal(rows.length, 2);
  const afterRecovery = sleeps;
  await Promise.resolve();
  assert.equal(sleeps, afterRecovery, 'a failed readback must await a real lifecycle edge');
});

test('window observer stops on shutdown and ignores later show events', async () => {
  const win = fakeWindow({ visible: false });
  let now = 0;
  let sleeps = 0;
  const rows = [];
  const observer = observePrimaryWindowStartup({ getAllWindows: () => [win] }, {
    timeout_ms: 200,
    stable_ms: 100,
    clock: () => now,
    sleep: async (ms) => { now += ms; sleeps += 1; },
    onReadback: (row) => rows.push(row),
  });
  observer.stop();
  const initial = await observer.initial;
  assert.equal(initial.reason, 'PRIMARY_WINDOW_OBSERVER_CANCELLED');
  const stoppedSleeps = sleeps;
  win.show();
  notifyPrimaryWindowShown(win);
  await Promise.resolve();
  assert.equal(sleeps, stoppedSleeps);
  assert.equal(rows.length, 0);
});

test('window readback clamps the final sleep and rejects a backwards observation clock', async () => {
  let now = 0;
  const sleeps = [];
  const noWindows = { getAllWindows: () => [] };
  const timeout = await waitForStablePrimaryWindow(noWindows, {
    timeout_ms: 250,
    stable_ms: 100,
    poll_ms: 100,
    clock: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
  });
  assert.equal(timeout.elapsed_ms, 250);
  assert.deepEqual(sleeps, [100, 100, 50]);
  now = 100;
  const backwards = await waitForStablePrimaryWindow(noWindows, {
    clock: () => now,
    sleep: async () => { now = 99; },
  });
  assert.equal(backwards.ok, false);
  assert.equal(backwards.reason, 'PRIMARY_WINDOW_OBSERVER_CLOCK_INVALID');
});

test('window readback retains the exact live hidden window identity without claiming stability', async () => {
  let now = 0;
  const window = { id: 47, isDestroyed: () => false, isVisible: () => false };
  const windows = { getAllWindows: () => [window] };
  const timeout = await waitForStablePrimaryWindow(windows, {
    timeout_ms: 100, stable_ms: 40, poll_ms: 20, clock: () => now,
    sleep: async ms => { now += ms; },
  });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.window_id, 47);
  window.isVisible = () => true;
  const stable = await waitForStablePrimaryWindow(windows, {
    timeout_ms: 100, stable_ms: 40, poll_ms: 20, clock: () => now,
    sleep: async ms => { now += ms; },
  });
  assert.equal(stable.ok, true);
  assert.equal(stable.window_id, timeout.window_id);
  window.show = () => {};
  window.focus = () => {};
  assert.equal(activateExistingPrimaryWindow(windows).window_id, 47);
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
  assert.equal(contract.late_window_show_requires_independent_stability_readback, true);
  assert.equal(contract.initial_window_timeout_is_preserved, true);
  assert.equal(contract.authority_effect, false);
});

test('ESM primary arms Electron ready continuation instead of awaiting app.whenReady', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /await\s+app\.whenReady\s*\(/);
  assert.match(source, /APP_READY_CONTINUATION_ARMED/);
  assert.match(source, /typeof app\.isReady === 'function' && app\.isReady\(\)/);
  assert.match(source, /app\.once\('ready', runReadyContinuation\)/);

  const importSettled = source.indexOf('await browserRuntimePromise;');
  const continuation = source.indexOf('const continueStartupAfterReady = async () =>');
  const hostStart = source.indexOf('resilienceStartup = hostResilience.start()', continuation);
  const barrierRelease = source.indexOf('resolveBrowserBootstrap?.(hostSnapshot)', hostStart);
  const listener = source.indexOf("app.once('ready', runReadyContinuation)", continuation);
  assert.ok(importSettled >= 0 && continuation > importSettled);
  assert.ok(hostStart > continuation);
  assert.ok(barrierRelease > hostStart, 'host bootstrap must settle before Browser window barrier release');
  assert.ok(listener > continuation, 'ready listener must be armed after continuation definition');
});
