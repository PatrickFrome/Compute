import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

class Updater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
    this.feed = null;
  }
  setFeedURL(value) { this.feed = value; }
  async checkForUpdates() { this.checks += 1; }
  async downloadUpdate() { this.downloads += 1; }
  quitAndInstall() { this.installs += 1; }
}

function newerHint() {
  return { version: '0.6.6-dev.5.1', newer_than_current: true, authority_effect: false };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('newer hint starts exact discovery singleflight without awaiting it on cycle', async () => {
  const updater = new Updater();
  let resolverCalls = 0;
  let releaseResolver;
  const blocker = new Promise((resolve) => { releaseResolver = resolve; });
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.6-dev.4.1',
    clock: () => 10_000,
    hintIntervalMs: 1_000,
    hintProbe: async () => newerHint(),
    releaseResolver: async () => { resolverCalls += 1; return blocker; },
  });
  await runtime.start();

  const cycleResult = await Promise.race([
    runtime.cycle(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('heartbeat_path_blocked')), 100)),
  ]);
  assert.equal(cycleResult.exact_discovery_in_flight, true);
  assert.equal(cycleResult.hint_triggered_exact_discovery_background, true);
  assert.equal(resolverCalls, 1);
  assert.equal(updater.checks, 0);

  await runtime.cycle();
  assert.equal(resolverCalls, 1, 'singleflight must not start a duplicate resolver');
  releaseResolver(null);
  await settle();
  assert.equal(runtime.snapshot().exact_discovery_in_flight, false);
  assert.equal(runtime.snapshot().state, 'CURRENT');
});

test('manual force waits for an existing exact singleflight instead of starting another', async () => {
  const updater = new Updater();
  let resolverCalls = 0;
  let releaseResolver;
  const blocker = new Promise((resolve) => { releaseResolver = resolve; });
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.6-dev.4.1',
    clock: () => 20_000,
    hintIntervalMs: 1_000,
    hintProbe: async () => newerHint(),
    releaseResolver: async () => { resolverCalls += 1; return blocker; },
  });
  await runtime.start();
  await runtime.cycle();
  assert.equal(resolverCalls, 1);

  let forceSettled = false;
  const forced = runtime.cycle({ force: true }).then((value) => { forceSettled = true; return value; });
  await settle();
  assert.equal(forceSettled, false);
  assert.equal(resolverCalls, 1);
  releaseResolver(null);
  await forced;
  assert.equal(resolverCalls, 1);
  assert.equal(runtime.snapshot().state, 'CURRENT');
});

test('hint and exact verification expose separate bounded network budgets', async () => {
  const updater = new Updater();
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.6-dev.4.1',
    networkDeadlineMs: 700,
    exactDiscoveryDeadlineMs: 4_000,
    hintProbe: async () => ({ version: null, newer_than_current: false, authority_effect: false }),
    releaseResolver: async () => null,
  });
  await runtime.start();
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.network_deadline_ms, 700);
  assert.equal(snapshot.hint_network_deadline_ms, 700);
  assert.equal(snapshot.exact_discovery_deadline_ms, 4_000);
  assert.equal(snapshot.network_discovery_bounded, true);
  assert.equal(snapshot.automatic_effect_retry, false);
});

test('slow exact verification stays fail-closed and cannot fall through to updater provider', async () => {
  const updater = new Updater();
  let resolverCalls = 0;
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.6-dev.4.1',
    networkDeadlineMs: 500,
    exactDiscoveryDeadlineMs: 500,
    hintIntervalMs: 1_000,
    hintProbe: async () => newerHint(),
    fetchImpl: async (_url, init = {}) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')), { once: true });
    }),
    releaseResolver: async ({ fetchImpl }) => {
      resolverCalls += 1;
      await fetchImpl('https://api.github.com/repos/PatrickFrome/Compute/releases?per_page=30');
      return null;
    },
  });
  await runtime.start();
  const started = Date.now();
  await runtime.cycle();
  assert.ok(Date.now() - started < 200, 'hint-triggered cycle must not await exact network deadline');
  assert.equal(runtime.snapshot().exact_discovery_in_flight, true);
  await new Promise((resolve) => setTimeout(resolve, 650));
  await settle();
  const snapshot = runtime.snapshot();
  assert.equal(resolverCalls, 1);
  assert.equal(snapshot.exact_discovery_in_flight, false);
  assert.equal(snapshot.state, 'DISCOVERY_ERROR');
  assert.match(snapshot.last_error, /self_update_exact_discovery_deadline_exceeded/);
  assert.equal(snapshot.metadata_verified, false);
  assert.equal(updater.checks, 0);
  assert.equal(updater.downloads, 0);
  assert.equal(updater.installs, 0);
});
