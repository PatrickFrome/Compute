import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { showInstalledRestoredProviderWizard } from '../src/local-restored-pg17-setup.mjs';

async function fixture(t, rendererFailure = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-pg17-wizard-ui-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const trace = [];
  const handlers = new Map();
  let current = null;
  class FakeWizard extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.title = options.title;
      this.destroyed = false;
      this.webContents = {
        id: 42,
        setWindowOpenHandler() {},
        on() {},
        loadURL: async url => {
          assert.match(url, /^data:text\/html;charset=utf-8,/);
          trace.push('recovery-document');
        },
      };
      current = this;
      trace.push('window-created');
    }
    setMenu() {}
    setTitle(title) { this.title = title; trace.push('title:' + title); }
    isDestroyed() { return this.destroyed; }
    show() { trace.push('show'); }
    async loadFile(filename) {
      assert.match(filename, /local-restored-pg17-setup\.html$/);
      trace.push('load-start');
      await new Promise(resolve => setImmediate(resolve));
      if (rendererFailure) throw new Error('simulated_renderer_failure');
      trace.push('load-complete');
    }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const app = {
    isPackaged: true,
    whenReady: async () => { trace.push('app-ready'); },
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: channel => handlers.delete(channel),
  };
  const start = () => showInstalledRestoredProviderWizard({
    app, BrowserWindow: FakeWizard, ipcMain,
    dialog: { showOpenDialog: async () => { throw new Error('picker_must_not_run'); } },
    env: { APPDATA: root, LOCALAPPDATA: root },
    platform: 'win32', resourcesPath: root,
    operator: () => { throw new Error('owner_effect_forbidden'); },
  });
  return { trace, handlers, start, get window() { return current; } };
}

test('first-run wizard shows preparatory window before renderer load and admits title only after document', async t => {
  const f = await fixture(t);
  const pending = f.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(f.window, 'window must exist');
  assert.equal(f.window.options.show, false);
  assert.equal(f.window.options.webPreferences.nodeIntegration, false);
  assert.equal(f.window.options.webPreferences.sandbox, true);
  const show = f.trace.indexOf('show');
  const done = f.trace.indexOf('load-complete');
  const final = f.trace.indexOf('title:METAENGINE - Connect existing PostgreSQL 17');
  assert.ok(show >= 0 && show < done, 'render delay may not suppress a visible setup frame');
  assert.ok(final > done, 'ready title must require loaded trusted document');
  assert.equal(f.handlers.size, 2);
  f.window.close();
  assert.deepEqual(await pending, { state: 'CANCELLED', authority_effect: false });
  assert.equal(f.handlers.size, 0);
});

test('renderer failure leaves zero-authority visible error boundary, never a fake wizard', async t => {
  const f = await fixture(t, true);
  const pending = f.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(f.trace.includes('show'));
  assert.ok(f.trace.includes('recovery-document'));
  assert.equal(f.trace.includes('title:METAENGINE - Connect existing PostgreSQL 17'), false);
  assert.equal(f.window.title, 'METAENGINE - Local setup unavailable');
  f.window.close();
  assert.deepEqual(await pending, { state: 'CANCELLED', authority_effect: false });
  assert.equal(f.handlers.size, 0);
});
