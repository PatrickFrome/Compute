import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectMissingLocalProvider, showUnprovisionedLocalStateBoundary } from '../src/local-provider-unavailable-boundary.mjs';

test('absent local state is classified read-only with no provider claim', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-no-owner-boundary-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const s = await inspectMissingLocalProvider({ localAppData: tmp });
  assert.deepEqual(s, { state: 'FRESH_LOCAL_DATABASE_NOT_PROVISIONED', authority_effect: false });
  assert.deepEqual(await fs.readdir(tmp), []);
});

test('existing incomplete PG17 staging is held for reconciliation and never deleted', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-no-owner-staged-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'METAENGINE', 'restored-postgres-17');
  const stage = path.join(root, 'data-staging-existing');
  await fs.mkdir(stage, { recursive: true });
  await fs.writeFile(path.join(stage, 'PG_VERSION'), '17\n');
  const s = await inspectMissingLocalProvider({ localAppData: tmp });
  assert.deepEqual(s, { state: 'PRIVATE_STATE_RECONCILIATION_REQUIRED', authority_effect: false });
  assert.equal(await fs.readFile(path.join(stage, 'PG_VERSION'), 'utf8'), '17\n');
});

test('unsafe state path or unreadable state cannot silently become an empty database', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-no-owner-unsafe-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'METAENGINE');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'restored-postgres-17'), 'not a directory');
  assert.equal((await inspectMissingLocalProvider({ localAppData: tmp })).state,
    'PRIVATE_STATE_RECONCILIATION_REQUIRED');
  assert.equal((await inspectMissingLocalProvider({ localAppData: 'relative' })).state,
    'LOCAL_STORAGE_UNAVAILABLE');
  assert.equal((await inspectMissingLocalProvider({
    localAppData: tmp, read: { lstat: async () => { throw new Error('EACCES'); } },
  })).state, 'LOCAL_STORAGE_UNAVAILABLE');
});

test('installed boundary has no chooser, IPC, owner write, cloud requests or retry effect', async () => {
  const events = [];
  let handlers = {};
  let page = '';
  const win = {
    isDestroyed: () => false,
    setMenu: value => events.push(['menu', value]),
    setTitle: value => events.push(['title', value]),
    show: () => events.push(['show']),
    webContents: {
      setWindowOpenHandler: fn => events.push(['window-handler', fn({}).action]),
      on: (name, fn) => { handlers[name] = fn; },
    },
    on: (name, fn) => { handlers[name] = fn; },
    loadURL: async url => { page = decodeURIComponent(url); events.push(['load']); },
  };
  const BrowserWindow = function BrowserWindow(options) {
    assert.equal(options.webPreferences.nodeIntegration, false);
    assert.equal(options.webPreferences.sandbox, true);
    assert.equal(options.webPreferences.contextIsolation, true);
    assert.equal(options.webPreferences.preload, undefined);
    return win;
  };
  const response = showUnprovisionedLocalStateBoundary({
    app: { isPackaged: true, whenReady: async () => events.push(['ready']) },
    BrowserWindow,
    env: { LOCALAPPDATA: '/unused' },
    inspect: async () => ({ state: 'PRIVATE_STATE_RECONCILIATION_REQUIRED', authority_effect: false }),
  });
  // Wait until its trusted static HTML navigation completes before closing it.
  for (let i = 0; i < 20 && !events.some(e => e[0] === 'load'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(page, /Local runtime unavailable/);
  assert.match(page, /incomplete restore or initialization/);
  assert.doesNotMatch(page, /Select private runtime-host JSON|Select verified restore report|<form|<input/i);
  assert.match(page, /connect-src 'none'|default-src 'none'/);
  assert.equal(events.filter(e => e[0] === 'show').length, 1);
  assert.equal(events.some(e => e[0] === 'menu' && e[1] === null), true);
  assert.equal(handlers['will-navigate'] !== undefined, true);
  // Its completion must not depend on closing the status window: updater
  // shutdown waits on initial startup preparation, never on user activity.
  const result = await response;
  handlers.closed();
  assert.deepEqual(result, {
    state: 'PRIVATE_STATE_RECONCILIATION_REQUIRED', local_runtime_ready: false,
    owner_profile_written: false, automatic_cloud_fallback: false, authority_effect: false,
  });
});
