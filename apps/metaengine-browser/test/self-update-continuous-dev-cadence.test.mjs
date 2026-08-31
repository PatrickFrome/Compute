import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS,
  DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS,
  DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS,
  DEFAULT_DEV_UPDATE_HINT_RETRY_MS,
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

function runtimeWith({ updater, clock, hintProbe }) {
  return new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.3-dev.124.1',
    ciTestFeedUrl: 'http://127.0.0.1:1/',
    ciTestMode: true,
    githubActions: true,
    clock,
    hintProbe,
  });
}

test('packaged dev runtime uses a quota-safe fifteen-minute exact fallback cadence', async () => {
  assert.equal(DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS, 15 * 60 * 1000);
  assert.equal(DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS, 1 * 1000);
  let now = 1;
  const updater = new FakeUpdater();
  const runtime = runtimeWith({ updater, clock: () => now, hintProbe: async () => null });

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

test('new two-second hint wakes the exact resolver once, while repeated same hint is deduplicated', async () => {
  assert.equal(DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS, 2 * 1000);
  let now = 1;
  let hintChecks = 0;
  const updater = new FakeUpdater();
  const runtime = runtimeWith({
    updater,
    clock: () => now,
    hintProbe: async () => {
      hintChecks += 1;
      return {
        version: '0.6.3-dev.125.1',
        newer_than_current: true,
        authority_effect: false,
      };
    },
  });

  await runtime.start();
  await runtime.checkNow();
  assert.equal(updater.checks, 1);

  now = DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS - 1;
  await runtime.cycle();
  assert.equal(hintChecks, 0);
  assert.equal(updater.checks, 1);

  now = DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS;
  await runtime.cycle();
  assert.equal(hintChecks, 1);
  assert.equal(updater.checks, 2);
  assert.equal(runtime.snapshot().hint_triggered_version, '0.6.3-dev.125.1');

  now += DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS;
  await runtime.cycle();
  assert.equal(hintChecks, 2);
  assert.equal(updater.checks, 2);
});

test('same newer hint retries a failed exact discovery only after the bounded retry cooldown', async () => {
  assert.equal(DEFAULT_DEV_UPDATE_HINT_RETRY_MS, 5 * 60 * 1000);
  let now = DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS;
  let releaseAttempts = 0;
  const updater = new FakeUpdater();
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.3-dev.124.1',
    clock: () => now,
    hintProbe: async () => ({
      version: '0.6.3-dev.125.1',
      newer_than_current: true,
      authority_effect: false,
    }),
    releaseResolver: async () => {
      releaseAttempts += 1;
      throw new Error('trusted_release_list_http_403');
    },
  });

  await runtime.start();
  await runtime.cycle();
  assert.equal(releaseAttempts, 1);
  assert.equal(runtime.snapshot().state, 'DISCOVERY_ERROR');

  now += DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS;
  await runtime.cycle();
  assert.equal(releaseAttempts, 1);

  now = DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS + DEFAULT_DEV_UPDATE_HINT_RETRY_MS;
  await runtime.cycle();
  assert.equal(releaseAttempts, 2);
  assert.equal(runtime.snapshot().state, 'DISCOVERY_ERROR');
});

test('hint failure never latches updater failure state', async () => {
  let now = DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS;
  const updater = new FakeUpdater();
  const runtime = runtimeWith({
    updater,
    clock: () => now,
    hintProbe: async () => { throw new Error('hint transport failed'); },
  });
  await runtime.start();
  await runtime.cycle();
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.hint_last_error, 'hint transport failed');
  assert.notEqual(snapshot.state, 'ERROR');
  assert.notEqual(snapshot.state, 'DISCOVERY_ERROR');
});
