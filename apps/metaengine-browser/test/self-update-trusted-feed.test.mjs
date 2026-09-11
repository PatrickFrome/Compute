import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';

const VERSION = '0.6.3-dev.72.1';
const INSTALLER = `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`;
const SHA512 = 'A'.repeat(86) + '==';
const RESOLVED = {
  schema:'metaengine.trusted-dev-release.v1',
  version:VERSION,
  tag:`v${VERSION}`,
  git_sha:'a'.repeat(40),
  feed_url:`https://github.com/PatrickFrome/Compute/releases/download/v${VERSION}/`,
  installer_name:INSTALLER,
  installer_sha256:'b'.repeat(64),
  installer_sha512:SHA512,
  manifest_sha256:'c'.repeat(64),
  dev_yml_sha256:'d'.repeat(64),
  authority_effect:false,
};

class FakeUpdater extends EventEmitter {
  constructor(info) { super(); this.info = info; this.checks = 0; this.downloads = 0; this.feed = null; this.disableWebInstaller = false; this.allowUnverifiedLinuxPackages = true; }
  setFeedURL(value) { this.feed = structuredClone(value); }
  async checkForUpdates() { this.checks += 1; this.emit('checking-for-update'); this.emit('update-available', this.info); return { updateInfo:this.info }; }
  async downloadUpdate() { this.downloads += 1; return ['candidate.exe']; }
  quitAndInstall() {}
}

const validInfo = () => ({
  version:VERSION,
  files:[{ url:INSTALLER, sha512:SHA512, size:119997999 }],
  stagingPercentage:100,
  releaseDate:'2026-08-29T20:00:00.000Z',
});

test('production updater resolves exact trusted release before any electron-updater check', async () => {
  const updater = new FakeUpdater(validInfo());
  let resolutions = 0;
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged:true,
    hostResilience:false,
    currentVersion:'0.6.3-dev.64.1',
    releaseResolver:async ({ currentVersion }) => { resolutions += 1; assert.equal(currentVersion, '0.6.3-dev.64.1'); return RESOLVED; },
  });
  await runtime.start();
  await runtime.cycle({ force:true });
  await new Promise((resolve) => setImmediate(resolve));
  const snap = runtime.snapshot();
  assert.equal(resolutions, 1);
  assert.deepEqual(updater.feed, { provider:'generic', url:RESOLVED.feed_url, channel:'dev' });
  assert.equal(updater.checks, 1);
  assert.equal(updater.downloads, 1);
  assert.equal(snap.publisher_verified, true);
  assert.equal(snap.release_resolution, 'VERIFIED');
  assert.equal(snap.resolved_tag, RESOLVED.tag);
  assert.equal(snap.resolved_git_sha, RESOLVED.git_sha);
  assert.equal(snap.metadata_verified, true);
  assert.equal(snap.available_version, VERSION);
  assert.equal(snap.state, 'DOWNLOADING');
});

test('TOCTOU metadata substitution after trusted release resolution fails closed before download', async () => {
  const info = validInfo();
  info.files[0].sha512 = 'Z'.repeat(86) + '==';
  const updater = new FakeUpdater(info);
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged:true,
    hostResilience:false,
    currentVersion:'0.6.3-dev.64.1',
    releaseResolver:async () => RESOLVED,
  });
  await runtime.start();
  await runtime.cycle({ force:true });
  await new Promise((resolve) => setImmediate(resolve));
  const snap = runtime.snapshot();
  assert.equal(updater.downloads, 0);
  assert.equal(snap.state, 'REJECTED_METADATA');
  assert.equal(snap.metadata_verified, false);
  assert.match(snap.last_error, /publisher_installer_binding_mismatch/);
});

test('read-only discovery failure never falls through to built-in GitHub provider and can retry later', async () => {
  const updater = new FakeUpdater(validInfo());
  let attempt = 0;
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged:true,
    hostResilience:false,
    currentVersion:'0.6.3-dev.64.1',
    releaseResolver:async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('trusted_release_list_http_503');
      return RESOLVED;
    },
  });
  await runtime.start();
  await runtime.cycle({ force:true });
  assert.equal(runtime.snapshot().state, 'DISCOVERY_ERROR');
  assert.equal(updater.checks, 0);
  await runtime.cycle({ force:true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempt, 2);
  assert.equal(updater.checks, 1);
  assert.equal(updater.downloads, 1);
});

test('no newer trusted release reports CURRENT without calling updater provider at all', async () => {
  const updater = new FakeUpdater(validInfo());
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged:true,
    hostResilience:false,
    currentVersion:'0.6.3-dev.72.1',
    releaseResolver:async () => null,
  });
  await runtime.start();
  await runtime.cycle({ force:true });
  const snap = runtime.snapshot();
  assert.equal(snap.state, 'CURRENT');
  assert.equal(snap.publisher_verified, false);
  assert.equal(updater.checks, 0);
  assert.equal(updater.feed, null);
});
