import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  SelfUpdateRuntime,
  classifySelfUpdateDisableEnvironment,
} from '../src/self-update-runtime-v8.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const VERSION = '0.7.0-dev.3.1';
const INSTALLER = `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`;
const SHA512 = 'a'.repeat(128);

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
    this.feed = null;
  }

  setFeedURL(value) { this.feed = value; }

  async checkForUpdates() {
    this.checks += 1;
    this.emit('update-available', {
      version: VERSION,
      files: [{ url: INSTALLER, sha512: SHA512, size: 1 }],
    });
  }

  async downloadUpdate() {
    this.downloads += 1;
    this.emit('update-downloaded', { version: VERSION });
  }

  quitAndInstall() { this.installs += 1; }
}

function trustedRelease() {
  return Object.freeze({
    schema: 'metaengine.trusted-dev-release.v1',
    version: VERSION,
    tag: `v${VERSION}`,
    git_sha: 'b'.repeat(40),
    feed_url: 'https://releases.example.invalid/dev/',
    installer_name: INSTALLER,
    installer_sha512: SHA512,
    authority_effect: false,
  });
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('ambiguous install is effect-quarantined without disabling the update control plane', async () => {
  const classified = classifySelfUpdateDisableEnvironment({
    METAENGINE_DISABLE_SELF_UPDATE: '1',
    METAENGINE_SELF_UPDATE_HOLD_REASON: 'AMBIGUOUS_INSTALL',
  });
  assert.equal(classified.globally_disabled, false);
  assert.equal(classified.install_effect_quarantined, true);
  assert.equal(classified.control_plane_enabled, true);
  assert.equal(classified.automatic_effect_retry_allowed, false);

  const previousDisable = process.env.METAENGINE_DISABLE_SELF_UPDATE;
  const previousReason = process.env.METAENGINE_SELF_UPDATE_HOLD_REASON;
  process.env.METAENGINE_DISABLE_SELF_UPDATE = '1';
  process.env.METAENGINE_SELF_UPDATE_HOLD_REASON = 'AMBIGUOUS_INSTALL';
  try {
    const updater = new FakeUpdater();
    const runtime = new SelfUpdateRuntime({
      updater,
      packaged: true,
      hostResilience: false,
      currentVersion: '0.7.0-dev.2.1',
      releaseResolver: async () => null,
      fetchImpl: async () => { throw new Error('unexpected_fetch'); },
    });
    const started = await runtime.start();
    assert.equal(started.state, 'IDLE');
    assert.equal(started.control_plane_enabled, true);
    assert.equal(started.install_effect_quarantined, true);
    assert.equal(started.self_update_hold_reason, 'AMBIGUOUS_INSTALL');
  } finally {
    if (previousDisable == null) delete process.env.METAENGINE_DISABLE_SELF_UPDATE;
    else process.env.METAENGINE_DISABLE_SELF_UPDATE = previousDisable;
    if (previousReason == null) delete process.env.METAENGINE_SELF_UPDATE_HOLD_REASON;
    else process.env.METAENGINE_SELF_UPDATE_HOLD_REASON = previousReason;
  }
});

test('successor receipt ambiguity also keeps discovery control plane alive', () => {
  const classified = classifySelfUpdateDisableEnvironment({
    METAENGINE_DISABLE_SELF_UPDATE: '1',
    METAENGINE_SELF_UPDATE_HOLD_REASON: 'SUCCESSOR_RECEIPT_AMBIGUOUS',
  });
  assert.equal(classified.globally_disabled, false);
  assert.equal(classified.install_effect_quarantined, true);
  assert.equal(classified.control_plane_enabled, true);
});

test('explicit kill switch without a recoverable hold remains globally disabling', () => {
  const classified = classifySelfUpdateDisableEnvironment({ METAENGINE_DISABLE_SELF_UPDATE: '1' });
  assert.equal(classified.globally_disabled, true);
  assert.equal(classified.install_effect_quarantined, false);
  assert.equal(classified.control_plane_enabled, false);
});

test('developer emergency update bypasses the normal restart gate but still uses the same durable effect fence', async () => {
  const updater = new FakeUpdater();
  let normalGateCalls = 0;
  let emergencyGateCalls = 0;
  let beforeInstallCalls = 0;
  let beforeLaunchCalls = 0;
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.7.0-dev.2.1',
    releaseResolver: async () => trustedRelease(),
    fetchImpl: async () => { throw new Error('unexpected_fetch'); },
    canRestart: async () => { normalGateCalls += 1; return false; },
    canEmergencyRestart: async () => { emergencyGateCalls += 1; return true; },
    beforeInstall: async () => { beforeInstallCalls += 1; },
    beforeInstallerLaunch: async () => { beforeLaunchCalls += 1; },
  });
  await runtime.start();
  await runtime.requestDeveloperEmergencyUpdate({ commandId: COMMAND_ID });
  await settle();

  const snapshot = runtime.snapshot();
  assert.equal(updater.checks, 1);
  assert.equal(updater.downloads, 1);
  assert.equal(normalGateCalls, 0);
  assert.ok(emergencyGateCalls >= 1);
  assert.equal(beforeInstallCalls, 1);
  assert.equal(beforeLaunchCalls, 1);
  assert.equal(updater.installs, 1);
  assert.equal(snapshot.state, 'RESTARTING');
  assert.equal(snapshot.developer_emergency_state, 'INSTALLER_DISPATCHED');
  assert.equal(snapshot.developer_emergency_policy_bypass, true);
});

test('ambiguous durable effect blocks emergency installer and is never blindly retried', async () => {
  const updater = new FakeUpdater();
  let beforeInstallCalls = 0;
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.7.0-dev.2.1',
    releaseResolver: async () => trustedRelease(),
    fetchImpl: async () => { throw new Error('unexpected_fetch'); },
    canRestart: async () => false,
    canEmergencyRestart: async () => true,
    beforeInstall: async () => {
      beforeInstallCalls += 1;
      throw new Error('existing_ambiguous_install_effect');
    },
  });
  await runtime.start();
  await runtime.requestDeveloperEmergencyUpdate({ commandId: COMMAND_ID });
  await settle();

  assert.equal(beforeInstallCalls, 1);
  assert.equal(updater.installs, 0);
  assert.equal(runtime.snapshot().developer_emergency_state, 'EFFECT_BLOCKED_OR_FAILED');
  assert.equal(runtime.snapshot().developer_emergency_requested, false);

  await runtime.cycle();
  await runtime.cycle();
  await settle();
  assert.equal(beforeInstallCalls, 1);
  assert.equal(updater.installs, 0);
});
