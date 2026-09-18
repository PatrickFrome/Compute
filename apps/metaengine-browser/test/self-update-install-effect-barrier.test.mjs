import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';
import {
  beginSelfUpdateTransaction,
  markSelfUpdateInstallEffectAttempted,
  readSelfUpdateTransaction,
  SELF_UPDATE_INSTALL_ACTUATOR,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
  SELF_UPDATE_INSTALL_EFFECT_SCOPE,
} from '../src/self-update-transaction-journal.mjs';

async function appFixture(version = '0.6.3-dev.168.1') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-install-effect-barrier-'));
  return {
    app: {
      getPath(name) { assert.equal(name, 'userData'); return userData; },
      getVersion() { return version; },
    },
  };
}

function receipt(version = '0.6.3-dev.169.1') {
  return {
    version,
    available_version: version,
    metadata_verified: true,
    restart_gate_safe: true,
    resolved_git_sha: 'a'.repeat(40),
    authority_effect: false,
  };
}

class FakeUpdater extends EventEmitter {
  constructor(events) {
    super();
    this.events = events;
    this.installs = 0;
    this.downloads = 0;
  }
  setFeedURL() {}
  async checkForUpdates() {}
  async downloadUpdate() { this.downloads += 1; }
  quitAndInstall(...args) {
    this.installs += 1;
    this.events.push(['install', ...args]);
  }
}

async function prepareRuntime({ barrier, finalHook = async () => {}, events = [] } = {}) {
  const updater = new FakeUpdater(events);
  let now = Date.parse('2026-09-01T16:00:00.000Z');
  const runtime = new SelfUpdateRuntime({
    updater,
    packaged: true,
    hostResilience: false,
    currentVersion: '0.6.3-dev.168.1',
    ciTestFeedUrl: 'http://127.0.0.1:3999/',
    ciTestMode: true,
    githubActions: true,
    restartGraceMs: 1_000,
    canRestart: async () => true,
    clock: () => now,
    beforeInstall: async (row) => { events.push(['receipt', row.version]); },
    beforeInstallerLaunch: finalHook,
    installEffectBarrier: barrier,
  });
  await runtime.start();
  updater.emit('update-available', {
    version: '0.6.3-dev.169.1',
    files: [{
      url: 'METAENGINE-Browser-Test-Setup-0.6.3-dev.169.1-x64.exe',
      sha512: 'b'.repeat(88),
      size: 123,
    }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.downloads, 1);
  updater.emit('update-downloaded', { version: '0.6.3-dev.169.1' });
  await runtime.cycle();
  assert.equal(runtime.snapshot().state, 'RESTART_GRACE');
  now += 1_001;
  return { runtime, updater, cycle: () => runtime.cycle() };
}

test('durable write-ahead barrier is single-shot even under concurrent callers', async () => {
  const { app } = await appFixture();
  await beginSelfUpdateTransaction(app, receipt());

  const attempts = await Promise.allSettled([
    markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.169.1' }),
    markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.169.1' }),
  ]);
  assert.equal(attempts.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((row) => row.status === 'rejected').length, 1);
  assert.match(String(attempts.find((row) => row.status === 'rejected')?.reason?.message), /barrier_state_invalid:INSTALLING/);

  const row = await readSelfUpdateTransaction(app);
  assert.equal(row.state, 'INSTALLING');
  assert.equal(row.swapping, true);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
  assert.equal(row.evidence.effect_barrier_contract, SELF_UPDATE_INSTALL_EFFECT_BARRIER);
  assert.equal(row.evidence.effect_scope, SELF_UPDATE_INSTALL_EFFECT_SCOPE);
  assert.equal(row.evidence.actuator_type, SELF_UPDATE_INSTALL_ACTUATOR);
  assert.equal(row.evidence.physical_effect_attempted, true);
  assert.equal(row.evidence.effect_barrier_crossed, true);
  assert.equal(row.evidence.effect_must_be_single_shot, true);
  assert.equal(row.evidence.post_effect_readback_required, true);
});

test('wrong target cannot cross install barrier and leaves PREPARED state intact', async () => {
  const { app } = await appFixture();
  await beginSelfUpdateTransaction(app, receipt());
  await assert.rejects(
    () => markSelfUpdateInstallEffectAttempted(app, { targetVersion: '0.6.3-dev.999.1' }),
    /target_binding_mismatch/,
  );
  const row = await readSelfUpdateTransaction(app);
  assert.equal(row.state, 'PREPARED');
  assert.equal(row.evidence.effect_barrier_crossed, undefined);
  assert.equal(row.automatic_retry_allowed, false);
});

test('stable runtime crosses barrier before final handoff and quitAndInstall', async () => {
  const events = [];
  const { runtime, updater, cycle } = await prepareRuntime({
    events,
    barrier: async (row) => { events.push(['barrier', row.version]); },
    finalHook: async (row) => { events.push(['final-handoff', row.version]); },
  });
  await cycle();
  assert.deepEqual(events, [
    ['receipt', '0.6.3-dev.169.1'],
    ['barrier', '0.6.3-dev.169.1'],
    ['final-handoff', '0.6.3-dev.169.1'],
    ['install', true, true],
  ]);
  assert.equal(updater.installs, 1);
  assert.equal(runtime.snapshot().install_effect_barrier_mode, 'INJECTED_BARRIER');
  assert.equal(runtime.snapshot().install_effect_barrier_before_final_handoff, true);
  assert.equal(runtime.snapshot().automatic_effect_retry, false);
});

test('barrier persistence failure blocks final handoff and physical installer effect', async () => {
  const events = [];
  const { runtime, updater, cycle } = await prepareRuntime({
    events,
    barrier: async () => { events.push(['barrier']); throw new Error('barrier_fsync_failed'); },
    finalHook: async () => { events.push(['final-handoff']); },
  });
  await cycle();
  assert.deepEqual(events, [
    ['receipt', '0.6.3-dev.169.1'],
    ['barrier'],
  ]);
  assert.equal(updater.installs, 0);
  assert.equal(runtime.snapshot().state, 'ERROR');
  assert.match(runtime.snapshot().last_error, /barrier_fsync_failed/);
});

test('production wiring places durable barrier between v8 restart gate and physical install', async () => {
  const stable = await fs.readFile(new URL('../src/self-update-runtime.mjs', import.meta.url), 'utf8');
  const v8 = await fs.readFile(new URL('../src/self-update-runtime-v8.mjs', import.meta.url), 'utf8');
  assert.match(stable, /markSelfUpdateInstallEffectAttempted/);
  assert.match(stable, /SELF_UPDATE_INSTALL_EFFECT_BARRIER/);
  assert.match(stable, /await installEffectBarrier\(structuredClone\(receipt\)\)/);
  assert.match(stable, /await originalBeforeInstallerLaunch\?\.\(structuredClone\(receipt\)\)/);
  assert.ok(
    stable.indexOf('await installEffectBarrier(structuredClone(receipt))')
      < stable.indexOf('await originalBeforeInstallerLaunch?.(structuredClone(receipt))'),
    'durable barrier must precede the final handoff hook',
  );
  assert.ok(
    v8.indexOf('await this.#beforeInstallerLaunch(structuredClone(receipt))')
      < v8.indexOf('this.#updater.quitAndInstall(true, true)'),
    'final hook must return before physical installer effect',
  );
});
