import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

class FakeUpdater extends EventEmitter {
  constructor() { super(); this.checks = 0; this.installs = 0; this.disableWebInstaller = false; }
  async checkForUpdates() { this.checks += 1; this.emit('checking-for-update'); return { updateInfo: { version: '0.6.2-dev.1' } }; }
  quitAndInstall(isSilent, forceRunAfter) { this.installs += 1; this.installArgs = { isSilent, forceRunAfter }; }
}

test('disables updater outside packaged application', async () => {
  const updater = new FakeUpdater();
  const runtime = new SelfUpdateRuntime({ updater, packaged: false });
  const snap = await runtime.start();
  assert.equal(snap.state, 'DISABLED');
  assert.equal(updater.checks, 0);
});

test('hardens updater policy and checks for updates', async () => {
  const updater = new FakeUpdater();
  const runtime = new SelfUpdateRuntime({ updater, packaged: true, intervalMs: 60000 });
  await runtime.start();
  await runtime.cycle({ force: true });
  assert.equal(updater.allowPrerelease, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableWebInstaller, true);
  assert.equal(updater.checks, 1);
});

test('downloaded update waits for quiescent restart gate', async () => {
  const updater = new FakeUpdater();
  let safe = false;
  const runtime = new SelfUpdateRuntime({ updater, packaged: true, canRestart: async () => safe });
  await runtime.start();
  updater.emit('update-downloaded', { version: '0.6.2-dev.1' });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'READY_RESTART');
  assert.equal(updater.installs, 0);
  safe = true;
  await runtime.cycle();
  assert.equal(updater.installs, 1);
  assert.deepEqual(updater.installArgs, { isSilent: false, forceRunAfter: true });
  assert.equal(runtime.snapshot().state, 'RESTARTING');
});

test('updater errors fail closed without attempting install', async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => { throw new Error('network_down'); };
  const runtime = new SelfUpdateRuntime({ updater, packaged: true, canRestart: async () => true });
  await runtime.start();
  await runtime.cycle({ force: true });
  assert.equal(runtime.snapshot().state, 'ERROR');
  assert.match(runtime.snapshot().last_error, /network_down/);
  assert.equal(updater.installs, 0);
});
