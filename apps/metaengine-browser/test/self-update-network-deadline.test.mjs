import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

function hangingFetch(_url, init = {}) {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    const fail = () => reject(signal.reason || new Error('aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

function fakeUpdater() {
  const listeners = new Map();
  return {
    allowPrerelease: false,
    channel: null,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    setFeedURL() {},
    on(name, fn) { listeners.set(name, fn); },
    async checkForUpdates() {},
    async downloadUpdate() {},
    quitAndInstall() {},
  };
}

test('hung trusted release discovery is bounded and cannot deadlock supervisor service', async () => {
  const runtime = new SelfUpdateRuntime({
    updater: fakeUpdater(),
    packaged: true,
    currentVersion: '0.6.3-dev.20260831143000.1',
    fetchImpl: hangingFetch,
    hintProbe: async () => null,
    networkDeadlineMs: 500,
    releaseResolver: async ({ fetchImpl }) => {
      await fetchImpl('https://example.invalid/hangs-forever');
      return null;
    },
    hostResilience: false,
  });

  await runtime.start();
  const started = Date.now();
  const snapshot = await runtime.cycle({ force: true });
  const elapsed = Date.now() - started;

  assert.ok(elapsed >= 450, `deadline fired suspiciously early: ${elapsed}ms`);
  assert.ok(elapsed < 1500, `optional discovery blocked too long: ${elapsed}ms`);
  assert.equal(snapshot.state, 'DISCOVERY_ERROR');
  assert.equal(snapshot.network_discovery_bounded, true);
  assert.equal(snapshot.network_deadline_ms, 500);
  assert.match(String(snapshot.last_error || ''), /self_update_discovery_deadline_exceeded/);
});
