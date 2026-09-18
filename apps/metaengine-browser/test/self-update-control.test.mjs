import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

const INFO = {
  version: '0.6.4-dev.1',
  files: [{ url: 'METAENGINE-Browser-Test-Setup-0.6.4-dev.1-x64.exe', sha512: 'b'.repeat(88), size: 4096 }],
};

class FakeUpdater extends EventEmitter {
  constructor() { super(); this.checks = 0; this.downloads = 0; this.installs = 0; this.disableWebInstaller = false; this.allowUnverifiedLinuxPackages = true; }
  async checkForUpdates() { this.checks += 1; this.emit('checking-for-update'); }
  async downloadUpdate() { this.downloads += 1; }
  quitAndInstall(isSilent, forceRunAfter) { this.installs += 1; this.args = { isSilent, forceRunAfter }; }
}

test('checkNow triggers the same trusted updater path used by automatic development checks', async () => {
  const updater = new FakeUpdater();
  const runtime = new SelfUpdateRuntime({ updater, packaged: true, hostResilience: false });
  await runtime.start();
  const state = await runtime.checkNow();
  assert.equal(updater.checks, 1);
  assert.equal(state.state, 'CHECKING');
  assert.equal(state.automatic_install, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test('applyWhenSafe never bypasses restart grace and installs only metadata-bound downloaded version', async () => {
  const updater = new FakeUpdater();
  let now = 1_000_000;
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    canRestart: async () => true,
    restartGraceMs: 3000,
    clock: () => now,
  });
  await runtime.start();
  await assert.rejects(runtime.applyWhenSafe(), /apply_not_ready/);
  updater.emit('update-available', INFO);
  await new Promise((resolve) => setImmediate(resolve));
  updater.emit('update-downloaded', { version: INFO.version });
  const first = await runtime.applyWhenSafe();
  assert.equal(first.state, 'RESTART_GRACE');
  assert.equal(updater.installs, 0);
  now += 2999;
  const second = await runtime.applyWhenSafe();
  assert.equal(second.state, 'RESTART_GRACE');
  assert.equal(updater.installs, 0);
  now += 2;
  const third = await runtime.applyWhenSafe();
  assert.equal(third.state, 'RESTARTING');
  assert.equal(updater.installs, 1);
  assert.deepEqual(updater.args, { isSilent: true, forceRunAfter: true });
});
