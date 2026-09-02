import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  beginSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';
import {
  attemptSelfUpdateOldParentHandoff,
  readSelfUpdateOldParentHandoff,
} from '../src/self-update-old-parent-handoff.mjs';

async function fixture(version = '0.6.6-dev.8.1') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-old-parent-handoff-'));
  let current = version;
  return {
    app: {
      getPath: (name) => { assert.equal(name, 'userData'); return userData; },
      getVersion: () => current,
      setVersion: (value) => { current = String(value); },
    },
  };
}

function receipt(version) {
  return {
    version,
    available_version: version,
    metadata_verified: true,
    restart_gate_safe: true,
    resolved_git_sha: 'b'.repeat(40),
    authority_effect: false,
  };
}

async function transactionAt(app, state, target = '0.6.6-dev.9.1') {
  await beginSelfUpdateTransaction(app, receipt(target));
  if (state === 'PREPARED') return;
  await transitionSelfUpdateTransaction(app, 'INSTALLING', { requireTargetVersion: target });
  if (state === 'INSTALLING') return;
  await transitionSelfUpdateTransaction(app, state, { requireTargetVersion: target });
}

function hooks() {
  const calls = [];
  return {
    calls,
    relaunch: () => calls.push(['relaunch']),
    exit: (code) => calls.push(['exit', code]),
  };
}

test('old parent watcher is read-only while installer transaction has not proven successor boot', async () => {
  const { app } = await fixture();
  await transactionAt(app, 'INSTALLING');
  const h = hooks();
  const result = await attemptSelfUpdateOldParentHandoff({ app, relaunch: h.relaunch, exit: h.exit });
  assert.equal(result.state, 'WAITING_SUCCESSOR_BOOT');
  assert.equal(result.continue_watch, true);
  assert.equal(result.recovered, false);
  assert.deepEqual(h.calls, []);
  assert.equal(await readSelfUpdateOldParentHandoff(app), null);
});

test('exact SUCCESSOR_BOOTED old parent persists intent before one process relaunch', async () => {
  const { app } = await fixture('0.6.6-dev.8.1');
  await transactionAt(app, 'SUCCESSOR_BOOTED', '0.6.6-dev.9.1');
  const h = hooks();
  const result = await attemptSelfUpdateOldParentHandoff({
    app,
    relaunch: h.relaunch,
    exit: h.exit,
    clock: () => Date.parse('2026-09-02T20:05:00.000Z'),
  });
  assert.equal(result.state, 'HANDOFF_DISPATCHED');
  assert.equal(result.recovered, true);
  assert.deepEqual(h.calls, [['relaunch'], ['exit', 19]]);

  const intent = await readSelfUpdateOldParentHandoff(app);
  assert.equal(intent.transaction_id, result.transaction_id);
  assert.equal(intent.source_version, '0.6.6-dev.8.1');
  assert.equal(intent.target_version, '0.6.6-dev.9.1');
  assert.equal(intent.reason, 'SUCCESSOR_BOOTED_OLD_PARENT_STILL_ALIVE');
  assert.equal(intent.automatic_retry_allowed, false);
  assert.equal(intent.authority_effect, false);
  assert.equal(intent.intent_at, '2026-09-02T20:05:00.000Z');
});

test('durable intent makes old-parent process handoff single-shot across repeated checks', async () => {
  const { app } = await fixture();
  await transactionAt(app, 'SUCCESSOR_BOOTED');
  const first = hooks();
  const result1 = await attemptSelfUpdateOldParentHandoff({ app, relaunch: first.relaunch, exit: first.exit });
  assert.equal(result1.state, 'HANDOFF_DISPATCHED');
  assert.deepEqual(first.calls, [['relaunch'], ['exit', 19]]);

  const second = hooks();
  const result2 = await attemptSelfUpdateOldParentHandoff({ app, relaunch: second.relaunch, exit: second.exit });
  assert.equal(result2.state, 'HANDOFF_ALREADY_DISPATCHED');
  assert.equal(result2.recovered, false);
  assert.deepEqual(second.calls, []);
});

test('source drift and non-newer target never gain process relaunch authority', async () => {
  {
    const { app } = await fixture('0.6.6-dev.8.1');
    await transactionAt(app, 'SUCCESSOR_BOOTED', '0.6.6-dev.9.1');
    app.setVersion('0.6.6-dev.7.1');
    const h = hooks();
    const result = await attemptSelfUpdateOldParentHandoff({ app, relaunch: h.relaunch, exit: h.exit });
    assert.equal(result.state, 'SOURCE_VERSION_MISMATCH');
    assert.deepEqual(h.calls, []);
  }
  {
    const { app } = await fixture('0.6.6-dev.8.1');
    await transactionAt(app, 'SUCCESSOR_BOOTED', '0.6.6-dev.8.1');
    const h = hooks();
    const result = await attemptSelfUpdateOldParentHandoff({ app, relaunch: h.relaunch, exit: h.exit });
    assert.equal(result.state, 'TARGET_NOT_NEWER_COMPATIBLE');
    assert.deepEqual(h.calls, []);
  }
  {
    const { app } = await fixture('0.6.6-dev.8.1');
    await transactionAt(app, 'SUCCESSOR_BOOTED', '0.6.7-dev.1.1');
    const h = hooks();
    const result = await attemptSelfUpdateOldParentHandoff({ app, relaunch: h.relaunch, exit: h.exit });
    assert.equal(result.state, 'TARGET_NOT_NEWER_COMPATIBLE');
    assert.deepEqual(h.calls, []);
  }
});

test('production updater arms durable parent watchdog after install barrier but before native handoff', async () => {
  const source = await fs.readFile(new URL('../src/self-update-runtime.mjs', import.meta.url), 'utf8');
  const wrapperAt = source.indexOf('beforeInstallerLaunch: async (receipt) => {');
  const barrierAt = source.indexOf('await installEffectBarrier(structuredClone(receipt))', wrapperAt);
  const watchdogAt = source.indexOf('await oldParentHandoffWatchdog?.()', barrierAt);
  const nativeHandoffAt = source.indexOf('await originalBeforeInstallerLaunch?.(structuredClone(receipt))', watchdogAt);
  assert.ok(wrapperAt >= 0);
  assert.ok(barrierAt > wrapperAt, 'installer effect must be write-ahead fenced first');
  assert.ok(watchdogAt > barrierAt, 'parent watchdog may arm only after durable installer effect barrier');
  assert.ok(nativeHandoffAt > watchdogAt, 'watchdog must arm before singleton/supervisor handoff and installer dispatch');
  assert.match(source, /startSelfUpdateOldParentHandoffWatchdog/);
  assert.match(source, /old_parent_handoff_requires_successor_booted: true/);
  assert.match(source, /old_parent_handoff_automatic_retry: false/);
});
