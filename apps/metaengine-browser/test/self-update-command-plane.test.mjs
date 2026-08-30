import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime, SELF_UPDATE_COMMANDS } from '../src/self-update-runtime.mjs';

const INFO = {
  version: '0.6.3-dev.99.1',
  files: [{
    url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.99.1-x64.exe',
    sha512: 'b'.repeat(88),
    size: 54321,
  }],
  stagingPercentage: 100,
  releaseDate: '2026-08-29T18:00:00.000Z',
};

class FakeUpdater extends EventEmitter {
  constructor({ downloadError = null } = {}) {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
    this.downloadError = downloadError;
    this.disableWebInstaller = false;
    this.allowUnverifiedLinuxPackages = true;
  }
  async checkForUpdates() { this.checks += 1; this.emit('checking-for-update'); return { updateInfo: INFO }; }
  async downloadUpdate() {
    this.downloads += 1;
    if (this.downloadError) throw this.downloadError;
    return ['candidate.exe'];
  }
  quitAndInstall(isSilent, forceRunAfter) {
    this.installs += 1;
    this.installArgs = { isSilent, forceRunAfter };
  }
}

function runtimeFor(updater, options = {}) {
  return new SelfUpdateRuntime({ updater, packaged: true, hostResilience: false, ...options });
}

async function emitAvailable(updater) {
  updater.emit('update-available', INFO);
  await new Promise((resolve) => setImmediate(resolve));
}

test('command surface is finite and automatic development updates are enabled by default', async () => {
  assert.deepEqual(SELF_UPDATE_COMMANDS, [
    'SELF_UPDATE_STATUS',
    'SELF_UPDATE_CHECK',
    'SELF_UPDATE_DOWNLOAD',
    'SELF_UPDATE_INSTALL',
    'SELF_UPDATE_RETRY',
    'SELF_UPDATE_SET_AUTOMATIC',
  ]);
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  const started = await runtime.start();
  assert.equal(started.schema, 'metaengine.self-update-runtime.v8');
  assert.equal(started.automatic_update_enabled, true);
  assert.equal(started.trusted_channel, 'dev');
  assert.equal(updater.autoDownload, false, 'download remains runtime-gated');
  assert.equal(updater.autoInstallOnAppQuit, false, 'install remains runtime-gated');
});

test('automatic mode verifies metadata and starts only the trusted updater download', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  await runtime.start();
  await emitAvailable(updater);
  const snap = runtime.snapshot();
  assert.equal(snap.metadata_verified, true);
  assert.equal(snap.available_version, INFO.version);
  assert.equal(snap.state, 'DOWNLOADING');
  assert.equal(updater.downloads, 1);
});

test('manual mode exposes CHECK and DOWNLOAD without arbitrary artifact authority', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater, { automaticUpdate: false });
  await runtime.start();
  assert.equal(runtime.snapshot().automatic_update_enabled, false);

  const checked = await runtime.command('SELF_UPDATE_CHECK');
  assert.equal(updater.checks, 1);
  assert.equal(checked.last_control_action, 'SELF_UPDATE_CHECK');

  await emitAvailable(updater);
  assert.equal(runtime.snapshot().state, 'AVAILABLE_VERIFIED');
  assert.equal(updater.downloads, 0);
  await runtime.command('SELF_UPDATE_DOWNLOAD');
  assert.equal(updater.downloads, 1);
  assert.equal(runtime.snapshot().state, 'DOWNLOADING');
});

test('manual INSTALL request cannot bypass unsafe restart gate and still observes grace before NSIS', async () => {
  const updater = new FakeUpdater();
  let safe = false;
  let now = 4_000_000;
  const order = [];
  const originalInstall = updater.quitAndInstall.bind(updater);
  updater.quitAndInstall = (...args) => { order.push('install'); return originalInstall(...args); };
  const runtime = runtimeFor(updater, {
    automaticUpdate: false,
    canRestart: async () => safe,
    restartGraceMs: 3000,
    clock: () => now,
    beforeInstall: async () => { order.push('receipt'); },
    beforeInstallerLaunch: async () => { order.push('handoff'); },
  });
  await runtime.start();
  await emitAvailable(updater);
  await runtime.command('SELF_UPDATE_DOWNLOAD');
  updater.emit('update-downloaded', { version: INFO.version });

  await runtime.command('SELF_UPDATE_INSTALL');
  assert.equal(runtime.snapshot().state, 'READY_RESTART');
  assert.equal(runtime.snapshot().manual_install_requested, true);
  assert.equal(updater.installs, 0);

  safe = true;
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'RESTART_GRACE');
  now += 2999;
  await runtime.cycle();
  assert.equal(updater.installs, 0);
  now += 2;
  await runtime.cycle();
  assert.equal(updater.installs, 1);
  assert.deepEqual(order, ['receipt', 'handoff', 'install']);
  assert.deepEqual(updater.installArgs, { isSilent: true, forceRunAfter: true });
});

test('SET_AUTOMATIC can resume a verified candidate and disabling it immediately cancels restart grace', async () => {
  const updater = new FakeUpdater();
  let now = 5_000_000;
  const runtime = runtimeFor(updater, {
    automaticUpdate: false,
    canRestart: async () => true,
    restartGraceMs: 3000,
    clock: () => now,
  });
  await runtime.start();
  await emitAvailable(updater);
  assert.equal(runtime.snapshot().state, 'AVAILABLE_VERIFIED');

  await runtime.command('SELF_UPDATE_SET_AUTOMATIC', { enabled: true });
  assert.equal(runtime.snapshot().automatic_update_enabled, true);
  assert.equal(updater.downloads, 1);
  updater.emit('update-downloaded', { version: INFO.version });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'RESTART_GRACE');

  await runtime.command('SELF_UPDATE_SET_AUTOMATIC', { enabled: false });
  assert.equal(runtime.snapshot().automatic_update_enabled, false);
  assert.equal(runtime.snapshot().state, 'READY_RESTART');
  assert.equal(runtime.snapshot().restart_gate_since, null);
  assert.equal(updater.installs, 0);
});

test('download transport failure is ERROR while verified metadata remains distinguishable from REJECTED_METADATA', async () => {
  const updater = new FakeUpdater({ downloadError: new Error('network_down_during_download') });
  const runtime = runtimeFor(updater);
  await runtime.start();
  await emitAvailable(updater);
  const snap = runtime.snapshot();
  assert.equal(snap.state, 'ERROR');
  assert.equal(snap.metadata_verified, true);
  assert.equal(snap.available_version, INFO.version);
  assert.match(snap.last_error, /network_down_during_download/);
  assert.equal(updater.downloads, 1);
});

test('RETRY is explicit recovery for a latched updater error', async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => {
    updater.checks += 1;
    if (updater.checks === 1) throw new Error('temporary_feed_failure');
    updater.emit('checking-for-update');
    return { updateInfo: INFO };
  };
  const runtime = runtimeFor(updater, { automaticUpdate: false });
  await runtime.start();
  await runtime.command('SELF_UPDATE_CHECK');
  assert.equal(runtime.snapshot().state, 'ERROR');
  await runtime.command('SELF_UPDATE_RETRY');
  assert.equal(updater.checks, 2);
  assert.equal(runtime.snapshot().state, 'CHECKING');
});

test('STATUS is non-authoritative and invalid control requests fail closed', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  await runtime.start();
  const status = await runtime.command('SELF_UPDATE_STATUS');
  assert.equal(status.authority_effect, false);
  assert.equal(status.last_control_action, 'SELF_UPDATE_STATUS');
  await assert.rejects(() => runtime.command('SELF_UPDATE_SET_AUTOMATIC', { enabled: 'yes' }), /automatic_flag_invalid/);
  await assert.rejects(() => runtime.command('SELF_UPDATE_EXEC', { url: 'https://example.invalid/payload.exe' }), /command_unknown/);
}
);
