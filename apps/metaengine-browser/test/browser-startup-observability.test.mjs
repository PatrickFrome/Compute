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
  waitForStablePrimaryWindow,
} from '../src/browser-startup-observability.mjs';

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

test('observability contract rejects stderr-only startup semantics', () => {
  const contract = browserStartupObservabilityContract();
  assert.equal(contract.runtime_import_failure_must_be_durable, true);
  assert.equal(contract.gui_stderr_is_diagnostic_authority, false);
  assert.equal(contract.second_instance_must_activate_primary_window, true);
  assert.equal(contract.normal_ui_boot_requires_stable_window_readback, true);
  assert.equal(contract.authority_effect, false);
});
