import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

const VALID_INFO = {
  version: '0.6.2-dev.1',
  files: [{ url: 'METAENGINE-Browser-Test-Setup-0.6.2-dev.1-x64.exe', sha512: 'a'.repeat(88), size: 12345 }],
  stagingPercentage: 100,
  releaseDate: '2026-08-29T00:00:00.000Z',
};

class FakeUpdater extends EventEmitter {
  constructor() { super(); this.checks = 0; this.downloads = 0; this.installs = 0; this.disableWebInstaller = false; }
  async checkForUpdates() { this.checks += 1; this.emit('checking-for-update'); return { updateInfo: VALID_INFO }; }
  async downloadUpdate() { this.downloads += 1; return ['candidate.exe']; }
  quitAndInstall(isSilent, forceRunAfter) { this.installs += 1; this.installArgs = { isSilent, forceRunAfter }; }
}

function runtimeFor(updater, options = {}) {
  return new SelfUpdateRuntime({ updater, packaged: true, hostResilience: false, ...options });
}

test('disables updater outside packaged application', async () => {
  const updater = new FakeUpdater();
  const runtime = new SelfUpdateRuntime({ updater, packaged: false });
  const snap = await runtime.start();
  assert.equal(snap.state, 'DISABLED');
  assert.equal(updater.checks, 0);
});

test('hardens updater policy and checks for updates without automatic download', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater, { intervalMs: 60000 });
  await runtime.start();
  await runtime.cycle({ force: true });
  assert.equal(updater.allowPrerelease, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableWebInstaller, true);
  assert.equal(updater.checks, 1);
  assert.equal(updater.downloads, 0);
});

test('valid files[] sha512 metadata is approved before download', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  await runtime.start();
  updater.emit('update-available', VALID_INFO);
  await new Promise((resolve) => setImmediate(resolve));
  const state = runtime.snapshot();
  assert.equal(state.metadata_verified, true);
  assert.equal(state.available_version, VALID_INFO.version);
  assert.equal(state.candidate_file_count, 1);
  assert.equal(state.staging_percentage, 100);
  assert.equal(updater.downloads, 1);
  assert.equal(state.state, 'DOWNLOADING');
});

test('invalid or sha512-less update metadata fails closed before download', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  await runtime.start();
  updater.emit('update-available', { version: '0.6.2-dev.1', files: [{ url: 'candidate.exe' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.snapshot().state, 'REJECTED_METADATA');
  assert.equal(runtime.snapshot().metadata_verified, false);
  assert.match(runtime.snapshot().last_error, /digest_invalid/);
  assert.equal(updater.downloads, 0);
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'REJECTED_METADATA');
  assert.equal(updater.checks, 0);
});

test('downloaded update waits for quiescent restart gate and arms sentinel handoff', async () => {
  const updater = new FakeUpdater();
  let safe = false;
  const host = {
    starts: 0,
    restarts: [],
    async start() { this.starts += 1; },
    snapshot() { return { state: 'ACTIVE', authority_effect: false }; },
    async prepareExpectedRestart(reason) { this.restarts.push(reason); },
  };
  const runtime = new SelfUpdateRuntime({ updater, packaged: true, hostResilience: host, canRestart: async () => safe });
  await runtime.start();
  updater.emit('update-available', VALID_INFO);
  await new Promise((resolve) => setImmediate(resolve));
  updater.emit('update-downloaded', { version: VALID_INFO.version });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'READY_RESTART');
  assert.equal(updater.installs, 0);
  assert.deepEqual(host.restarts, []);
  safe = true;
  await runtime.cycle();
  assert.equal(updater.installs, 1);
  assert.deepEqual(host.restarts, ['SELF_UPDATE']);
  assert.deepEqual(updater.installArgs, { isSilent: false, forceRunAfter: true });
  assert.equal(runtime.snapshot().state, 'RESTARTING');
});

test('downloaded version mismatch remains latched until explicit recovery', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater, { canRestart: async () => true });
  await runtime.start();
  updater.emit('update-available', VALID_INFO);
  await new Promise((resolve) => setImmediate(resolve));
  updater.emit('update-downloaded', { version: '0.6.9-dev.999' });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'ERROR');
  assert.equal(runtime.snapshot().last_error, 'downloaded_version_binding_mismatch');
  assert.equal(updater.installs, 0);
  assert.equal(updater.checks, 0);
  await runtime.cycle({ force: true });
  assert.equal(updater.checks, 1);
});

test('updater errors fail closed without attempting install', async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => { throw new Error('network_down'); };
  const runtime = runtimeFor(updater, { canRestart: async () => true });
  await runtime.start();
  await runtime.cycle({ force: true });
  assert.equal(runtime.snapshot().state, 'ERROR');
  assert.match(runtime.snapshot().last_error, /network_down/);
  assert.equal(updater.installs, 0);
  const checksAfterFailure = updater.checks;
  await runtime.cycle();
  assert.equal(updater.checks, checksAfterFailure);
  assert.equal(runtime.snapshot().state, 'ERROR');
});
