import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.allowPrerelease = false;
    this.channel = 'latest';
    this.allowDowngrade = true;
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.disableWebInstaller = false;
    this.allowUnverifiedLinuxPackages = true;
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
  }
  async checkForUpdates() { this.checks += 1; }
  async downloadUpdate() { this.downloads += 1; }
  quitAndInstall() { this.installs += 1; }
}

function runtimeFor(updater, options = {}) {
  return new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    intervalMs: 60_000,
    restartGraceMs: 3_000,
    ...options,
  });
}

test('disables updater outside packaged application', async () => {
  const runtime = new SelfUpdateRuntime({ updater: new FakeUpdater(), packaged: false, hostResilience: false });
  await runtime.start();
  assert.equal(runtime.snapshot().state, 'DISABLED');
});

test('binds updater to builder-compatible dev channel and reasserts no downgrade', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  await runtime.start();
  assert.equal(updater.allowPrerelease, true);
  assert.equal(updater.channel, 'dev');
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableWebInstaller, true);
  assert.equal(updater.allowUnverifiedLinuxPackages, false);
  assert.equal(runtime.snapshot().trusted_channel, 'dev');
});

test('valid files[] sha512 metadata is approved before download', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater);
  await runtime.start();
  updater.emit('update-available', {
    version: '0.6.3-dev.2',
    files: [{ url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe', sha512: 'a'.repeat(88), size: 123 }],
    stagingPercentage: 100,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.snapshot().metadata_verified, true);
  assert.equal(runtime.snapshot().available_version, '0.6.3-dev.2');
  assert.equal(updater.downloads, 1);
});

test('invalid or sha512-less update metadata fails closed before download', async () => {
  for (const info of [
    { version: '0.6.3-dev.2', files: [] },
    { version: '0.6.3-dev.2', files: [{ url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe' }] },
  ]) {
    const updater = new FakeUpdater();
    const runtime = runtimeFor(updater);
    await runtime.start();
    updater.emit('update-available', info);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.snapshot().state, 'REJECTED_METADATA');
    assert.equal(runtime.snapshot().metadata_verified, false);
    assert.equal(updater.downloads, 0);
  }
});

test('absolute, traversing, wrong-prefix or version-mismatched artifacts fail closed', async () => {
  const invalid = [
    'https://example.com/METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe',
    '../METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe',
    'OTHER-Setup-0.6.3-dev.2-x64.exe',
    'METAENGINE-Browser-Test-Setup-0.6.3-dev.3-x64.exe',
  ];
  for (const url of invalid) {
    const updater = new FakeUpdater();
    const runtime = runtimeFor(updater);
    await runtime.start();
    updater.emit('update-available', { version: '0.6.3-dev.2', files: [{ url, sha512: 'b'.repeat(88), size: 123 }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.snapshot().state, 'REJECTED_METADATA');
    assert.equal(updater.downloads, 0);
  }
});

test('downloaded update orders receipt, sentinel, handoff, then silent NSIS install', async () => {
  const updater = new FakeUpdater();
  const events = [];
  updater.quitAndInstall = (...args) => { events.push(['install', ...args]); updater.installs += 1; };
  const host = {
    start: async () => {},
    snapshot: () => ({ state: 'ACTIVE' }),
    prepareExpectedRestart: async (reason) => { events.push(['sentinel', reason]); },
  };
  let now = Date.parse('2026-08-29T12:00:00.000Z');
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: host,
    intervalMs: 60_000,
    restartGraceMs: 3_000,
    canRestart: async () => true,
    clock: () => now,
    beforeInstall: async (receipt) => { events.push(['receipt', receipt.version]); },
    beforeInstallerLaunch: async (receipt) => { events.push(['handoff', receipt.version]); },
  });
  await runtime.start();
  updater.emit('update-available', {
    version: '0.6.3-dev.2',
    files: [{ url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe', sha512: 'c'.repeat(88), size: 123 }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  updater.emit('update-downloaded', { version: '0.6.3-dev.2' });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'RESTART_GRACE');
  now += 3001;
  await runtime.cycle();
  assert.deepEqual(events, [
    ['receipt', '0.6.3-dev.2'],
    ['sentinel', 'SELF_UPDATE'],
    ['handoff', '0.6.3-dev.2'],
    ['install', true, true],
  ]);
  assert.equal(runtime.snapshot().pre_install_receipt_persisted, true);
  assert.equal(runtime.snapshot().installer_handoff_prepared, true);
  assert.equal(updater.installs, 1);
});

test('pre-install receipt persistence failure blocks sentinel, handoff and NSIS launch', async () => {
  const updater = new FakeUpdater();
  const events = [];
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: { start: async()=>{}, snapshot:()=>({}), prepareExpectedRestart: async()=>events.push('sentinel') },
    restartGraceMs: 3_000,
    canRestart: async () => true,
    beforeInstall: async () => { throw new Error('disk_full'); },
    beforeInstallerLaunch: async () => events.push('handoff'),
  });
  await runtime.start();
  updater.emit('update-available', { version:'0.6.3-dev.2', files:[{ url:'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe', sha512:'d'.repeat(88), size:1 }] });
  await new Promise((resolve)=>setImmediate(resolve));
  updater.emit('update-downloaded', { version:'0.6.3-dev.2' });
  await runtime.cycle();
  await new Promise((resolve)=>setTimeout(resolve, 3100));
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'ERROR');
  assert.match(runtime.snapshot().last_error, /disk_full/);
  assert.deepEqual(events, []);
  assert.equal(updater.installs, 0);
});

test('installer handoff failure happens after sentinel and blocks NSIS launch', async () => {
  const updater = new FakeUpdater();
  const events = [];
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: { start: async()=>{}, snapshot:()=>({}), prepareExpectedRestart: async()=>events.push('sentinel') },
    restartGraceMs: 3_000,
    canRestart: async () => true,
    beforeInstall: async () => events.push('receipt'),
    beforeInstallerLaunch: async () => { events.push('handoff'); throw new Error('handoff_failed'); },
  });
  await runtime.start();
  updater.emit('update-available', { version:'0.6.3-dev.2', files:[{ url:'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe', sha512:'e'.repeat(88), size:1 }] });
  await new Promise((resolve)=>setImmediate(resolve));
  updater.emit('update-downloaded', { version:'0.6.3-dev.2' });
  await runtime.cycle();
  await new Promise((resolve)=>setTimeout(resolve, 3100));
  await runtime.cycle();
  assert.deepEqual(events, ['receipt','sentinel','handoff']);
  assert.equal(updater.installs, 0);
  assert.equal(runtime.snapshot().state, 'ERROR');
  assert.match(runtime.snapshot().last_error, /handoff_failed/);
});

test('one downloaded version gets at most one install attempt', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater, { canRestart: async () => true });
  await runtime.start();
  updater.emit('update-available', { version:'0.6.3-dev.2', files:[{ url:'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe', sha512:'f'.repeat(88), size:1 }] });
  await new Promise((resolve)=>setImmediate(resolve));
  updater.emit('update-downloaded', { version:'0.6.3-dev.2' });
  await runtime.cycle();
  await new Promise((resolve)=>setTimeout(resolve, 3100));
  await runtime.cycle();
  await runtime.cycle();
  assert.equal(updater.installs, 1);
});

test('downloaded version mismatch remains latched until explicit recovery', async () => {
  const updater = new FakeUpdater();
  const runtime = runtimeFor(updater, { canRestart: async () => true });
  await runtime.start();
  updater.emit('update-available', { version:'0.6.3-dev.2', files:[{ url:'METAENGINE-Browser-Test-Setup-0.6.3-dev.2-x64.exe', sha512:'1'.repeat(88), size:1 }] });
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

test('updater discovery errors fail closed without attempting install and remain non-authoritative', async () => {
  const updater = new FakeUpdater();
  updater.checkForUpdates = async () => { throw new Error('network_down'); };
  const runtime = runtimeFor(updater, { canRestart: async () => true });
  await runtime.start();
  await runtime.cycle({ force: true });
  assert.equal(runtime.snapshot().state, 'DISCOVERY_ERROR');
  assert.match(runtime.snapshot().last_error, /network_down/);
  assert.equal(runtime.snapshot().metadata_verified, false);
  assert.equal(runtime.snapshot().authority_effect, false);
  assert.equal(updater.installs, 0);
  const checksAfterFailure = updater.checks;
  await runtime.cycle();
  assert.equal(updater.checks, checksAfterFailure);
  assert.equal(runtime.snapshot().state, 'DISCOVERY_ERROR');
});
