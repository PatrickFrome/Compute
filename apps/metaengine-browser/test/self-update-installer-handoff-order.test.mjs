import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime-v8.mjs';

class FakeUpdater extends EventEmitter {
  constructor(events) {
    super();
    this.events = events;
    this.downloads = 0;
    this.installs = 0;
  }

  setFeedURL() {}
  async downloadUpdate() { this.downloads += 1; }
  async checkForUpdates() {}
  quitAndInstall(...args) {
    this.installs += 1;
    this.events.push(['install', ...args]);
  }
}

test('durable receipt and sentinel release precede final installer launch hook', async () => {
  const events = [];
  const updater = new FakeUpdater(events);
  const host = {
    start: async () => {},
    snapshot: () => ({ state: 'ACTIVE' }),
    prepareExpectedRestart: async (reason) => { events.push(['expected-restart', reason]); },
    prepareInstallerHandoff: async (reason) => { events.push(['installer-handoff', reason]); },
  };
  let now = Date.parse('2026-09-01T06:00:00.000Z');
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: host,
    restartGraceMs: 1_000,
    canRestart: async () => true,
    clock: () => now,
    ciTestFeedUrl: 'http://127.0.0.1:3999/',
    ciTestMode: true,
    githubActions: true,
    beforeInstall: async (receipt) => { events.push(['receipt', receipt.version]); },
    beforeInstallerLaunch: async (receipt) => {
      assert.equal(events.some(([name]) => name === 'installer-handoff'), true, 'sentinel must be released before final launch hook');
      events.push(['before-installer-launch', receipt.version]);
    },
  });

  await runtime.start();
  updater.emit('update-available', {
    version: '0.6.3-dev.2',
    files: [{
      url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe',
      sha512: 'a'.repeat(88),
      size: 123,
    }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.downloads, 1);

  updater.emit('update-downloaded', { version: '0.6.3-dev.2' });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'RESTART_GRACE');

  now += 1_001;
  await runtime.cycle();

  assert.deepEqual(events, [
    ['receipt', '0.6.3-dev.2'],
    ['expected-restart', 'SELF_UPDATE'],
    ['installer-handoff', 'SELF_UPDATE'],
    ['before-installer-launch', '0.6.3-dev.2'],
    ['install', true, true],
  ]);
  assert.equal(runtime.snapshot().pre_install_receipt_persisted, true);
  assert.equal(runtime.snapshot().installer_handoff_prepared, true);
  assert.equal(updater.installs, 1);
});
