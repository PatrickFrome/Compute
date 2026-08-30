import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS,
  DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS,
  SelfUpdateRuntime,
} from '../src/self-update-runtime.mjs';

class FakeUpdater extends EventEmitter {
  checks = 0;
  feed = null;
  setFeedURL(value) { this.feed = value; }
  async checkForUpdates() {
    this.checks += 1;
    this.emit('checking-for-update');
    this.emit('update-not-available');
    return null;
  }
}

test('packaged dev runtime rechecks on the permanent one-minute default cadence', async () => {
  assert.equal(DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS, 60 * 1000);
  assert.equal(DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS, 3 * 1000);
  let now = 1;
  const updater = new FakeUpdater();
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.3-dev.77.1',
    ciTestFeedUrl: 'http://127.0.0.1:1/',
    ciTestMode: true,
    githubActions: true,
    clock: () => now,
  });

  await runtime.start();
  await runtime.checkNow();
  assert.equal(updater.checks, 1);
  assert.equal(runtime.snapshot().restart_grace_ms, DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS);

  now += DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS - 1;
  await runtime.cycle();
  assert.equal(updater.checks, 1);

  now += 1;
  await runtime.cycle();
  assert.equal(updater.checks, 2);
});
