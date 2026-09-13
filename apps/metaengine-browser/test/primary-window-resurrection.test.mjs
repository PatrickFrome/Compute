import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';

import {
  PRIMARY_WINDOW_RESURRECTION_SCHEMA,
  primaryWindowResurrectionContract,
  requestPrimaryWindowResurrection,
} from '../src/primary-window-resurrection.mjs';

function fakeWindow() {
  return {
    isDestroyed: () => false,
  };
}

function fakeApp({ ready = true } = {}) {
  const app = new EventEmitter();
  app.isReady = () => ready;
  return app;
}

test('primary window resurrection preserves single-runtime and authority invariants', () => {
  const contract = primaryWindowResurrectionContract();
  assert.equal(contract.schema, PRIMARY_WINDOW_RESURRECTION_SCHEMA);
  assert.equal(contract.same_primary_process_only, true);
  assert.equal(contract.second_browser_runtime_allowed, false);
  assert.equal(contract.process_termination_allowed, false);
  assert.equal(contract.update_authority_effect, false);
  assert.equal(contract.activation_event_is_request_not_proof, true);
  assert.equal(contract.exact_launch_ack_remains_owned_by_main_entry, true);
  assert.equal(contract.authority_effect, false);
});

test('existing primary window never emits synthetic activate', async () => {
  const app = fakeApp();
  let activateCount = 0;
  app.on('activate', () => { activateCount += 1; });
  const BaseWindow = { getAllWindows: () => [fakeWindow()] };

  const out = await requestPrimaryWindowResurrection({ app, BaseWindow });
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'PRIMARY_WINDOW_ALREADY_PRESENT');
  assert.equal(out.recovery_requested, false);
  assert.equal(activateCount, 0);
});

test('windowless live primary requests recovery through existing activate handler only', async () => {
  const app = fakeApp();
  const windows = [];
  let activateCount = 0;
  app.on('activate', () => {
    activateCount += 1;
    windows.push(fakeWindow());
  });
  const BaseWindow = { getAllWindows: () => windows };

  const out = await requestPrimaryWindowResurrection({ app, BaseWindow });
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'PRIMARY_UI_RECOVERY_REQUESTED');
  assert.equal(out.recovery_requested, true);
  assert.equal(out.activate_event_observed, true);
  assert.equal(out.second_browser_runtime_started, false);
  assert.equal(out.primary_terminated, false);
  assert.equal(out.authority_effect, false);
  assert.equal(activateCount, 1);
  assert.equal(windows.length, 1);
});

test('recovery waits boundedly for main runtime activate handler to register', async () => {
  const app = fakeApp();
  const windows = [];
  let now = 0;
  let handlerInstalled = false;
  const BaseWindow = { getAllWindows: () => windows };
  const sleep = async (ms) => {
    now += ms;
    if (!handlerInstalled && now >= 200) {
      handlerInstalled = true;
      app.on('activate', () => windows.push(fakeWindow()));
    }
  };

  const out = await requestPrimaryWindowResurrection({
    app,
    BaseWindow,
    timeout_ms: 1_000,
    poll_ms: 100,
    clock: () => now,
    sleep,
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'PRIMARY_UI_RECOVERY_REQUESTED');
  assert.equal(windows.length, 1);
  assert.equal(now, 200);
});

test('missing activate handler fails closed without process or update authority', async () => {
  const app = fakeApp();
  let now = 0;
  const BaseWindow = { getAllWindows: () => [] };
  const out = await requestPrimaryWindowResurrection({
    app,
    BaseWindow,
    timeout_ms: 300,
    poll_ms: 100,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'PRIMARY_UI_RECOVERY_HANDLER_UNAVAILABLE');
  assert.equal(out.recovery_requested, false);
  assert.equal(out.second_browser_runtime_started, false);
  assert.equal(out.primary_terminated, false);
  assert.equal(out.authority_effect, false);
});

test('final runtime installs resurrection listener before importing main entry', async () => {
  const source = await fs.readFile(new URL('../src/final-runtime-entry.mjs', import.meta.url), 'utf8');
  const listenerIndex = source.indexOf("app.on('second-instance'");
  const mainImportIndex = source.indexOf("await import('./main-entry.mjs')");
  assert.ok(listenerIndex >= 0, 'pre-bootstrap second-instance recovery listener must exist');
  assert.ok(mainImportIndex > listenerIndex, 'recovery listener must be registered before main-entry import');
  assert.match(source, /requestPrimaryWindowResurrection/);
  assert.match(source, /second_browser_runtime_started:\s*false/);
  assert.match(source, /authority_effect:\s*false/);
});
