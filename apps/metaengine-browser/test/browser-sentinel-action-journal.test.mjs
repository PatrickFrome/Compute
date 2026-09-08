import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  BrowserSentinelActionJournal,
  actionJournalPath,
  incarnationActionJournalPath,
} = require('../src/browser-sentinel-action-journal.cjs');

function binding(overrides = {}) {
  return {
    schema: 'metaengine.browser-sentinel.state.v1',
    token: 'sentinel-token',
    parent_pid: process.pid,
    executable: process.execPath,
    authority_effect: false,
    ...overrides,
  };
}

async function journalFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-journal-'));
  const statePath = path.join(dir, 'metaengine-browser-sentinel-v1.json');
  const journal = new BrowserSentinelActionJournal({ statePath });
  await journal.init(binding());
  return { dir, statePath, journal };
}

test('termination intent is durable exact-binding write-ahead evidence and blocks duplicate termination', async () => {
  const { statePath, journal } = await journalFixture();
  const row = await journal.beginTermination(binding(), { state: 'PROGRESS_STALE', progress_at: '2026-09-01T00:00:00.000Z' });
  assert.equal(row.state, 'PARENT_TERMINATION_INTENT');
  assert.equal(row.physical_effect_attempted, false);
  assert.equal(row.effect_barrier_crossed, true);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
  assert.equal(Object.hasOwn(row, 'task_id'), false);
  assert.equal(Object.hasOwn(row, 'lease_generation'), false);

  const disk = JSON.parse(await fs.readFile(actionJournalPath(statePath), 'utf8'));
  assert.equal(disk.state, 'PARENT_TERMINATION_INTENT');
  assert.equal(disk.token, 'sentinel-token');
  assert.equal(disk.parent_pid, process.pid);
  await assert.rejects(() => journal.beginTermination(binding(), { state: 'PROGRESS_STALE' }), /already_attempted/);
});

test('restart after unresolved termination intent fails closed to ambiguous and cannot replay termination', async () => {
  const { statePath, journal } = await journalFixture();
  await journal.beginTermination(binding(), { state: 'PROGRESS_STALE' });

  const restarted = new BrowserSentinelActionJournal({ statePath });
  await restarted.init(binding());
  assert.equal(restarted.terminationAttempted(), true);
  const ambiguous = await restarted.failClosed(binding(), 'worker_restart_after_termination_barrier');
  assert.equal(ambiguous.state, 'PARENT_TERMINATION_AMBIGUOUS');
  assert.equal(ambiguous.physical_effect_attempted, true);
  assert.equal(ambiguous.automatic_retry_allowed, false);
  await assert.rejects(() => restarted.beginTermination(binding(), { state: 'PROGRESS_STALE' }), /already_attempted/);
});

test('relaunch intent is durable before dispatch and blocks replay after restart', async () => {
  const { statePath, journal } = await journalFixture();
  const intent = await journal.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT');
  assert.equal(intent.state, 'RELAUNCH_INTENT');
  assert.equal(intent.physical_effect_attempted, false);
  assert.equal(intent.effect_barrier_crossed, true);

  const restarted = new BrowserSentinelActionJournal({ statePath });
  await restarted.init(binding());
  assert.equal(restarted.relaunchAttempted(), true);
  const ambiguous = await restarted.failClosed(binding(), 'worker_restart_after_relaunch_barrier');
  assert.equal(ambiguous.state, 'RELAUNCH_AMBIGUOUS');
  assert.equal(ambiguous.physical_effect_attempted, true);
  assert.equal(ambiguous.automatic_retry_allowed, false);
  await assert.rejects(() => restarted.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT'), /already_attempted/);
});

test('proven spawn failure is the only relaunch outcome that can retry indefinitely', async () => {
  const { statePath, journal } = await journalFixture();
  await journal.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT');
  const failed = await journal.markRelaunch(binding(), {
    lifecycle: 'RELAUNCH_FAILED',
    pid: null,
    result: 'spawn ENOENT',
    relaunch_effect_absent: true,
    relaunch_pid_confirmed_absent: false,
  });
  assert.equal(failed.state, 'RELAUNCH_FAILED');
  assert.equal(failed.relaunch_effect_absent, true);
  assert.equal(failed.automatic_retry_allowed, true);
  assert.equal(journal.relaunchAttempted(), false);
  assert.equal(journal.relaunchRetryAllowed(), true);

  const restarted = new BrowserSentinelActionJournal({ statePath });
  await restarted.init(binding());
  assert.equal(restarted.relaunchRetryAllowed(), true, 'positive no-effect proof survives worker restart');
  const next = await restarted.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT');
  assert.equal(next.state, 'RELAUNCH_INTENT');
  assert.equal(next.relaunch_attempt, 2);
  assert.equal(next.automatic_retry_allowed, false, 'new effect barrier is fail-closed until this attempt resolves');
});

test('failed relaunch without positive no-effect proof remains non-retryable', async () => {
  const { journal } = await journalFixture();
  await journal.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT');
  const failed = await journal.markRelaunch(binding(), {
    lifecycle: 'RELAUNCH_FAILED',
    pid: null,
    result: 'unknown failure',
    relaunch_effect_absent: false,
  });
  assert.equal(failed.automatic_retry_allowed, false);
  assert.equal(journal.relaunchAttempted(), true);
  assert.equal(journal.relaunchRetryAllowed(), false);
  await assert.rejects(() => journal.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT'), /already_attempted/);
});

test('a dispatched relaunch may retry only after the exact relaunch pid is positively absent', async () => {
  const { journal } = await journalFixture();
  await journal.beginRelaunch(binding(), 'EXACT_OLD_PARENT_ABSENT');
  const dispatched = await journal.markRelaunch(binding(), {
    lifecycle: 'RELAUNCH_DISPATCHED',
    pid: 424242,
    result: 'pid:424242',
  });
  assert.equal(dispatched.automatic_retry_allowed, false);
  assert.equal(journal.relaunchAttempted(), true);
  await assert.rejects(() => journal.confirmDispatchedRelaunchAbsent(binding(), 424243), /pid_binding_mismatch/);

  const absent = await journal.confirmDispatchedRelaunchAbsent(binding(), 424242);
  assert.equal(absent.state, 'RELAUNCH_FAILED');
  assert.equal(absent.relaunch_pid, 424242);
  assert.equal(absent.relaunch_pid_confirmed_absent, true);
  assert.equal(absent.relaunch_effect_absent, true);
  assert.equal(absent.automatic_retry_allowed, true);
  assert.equal(journal.relaunchRetryAllowed(), true);
});

test('journal isolates cross-incarnation bindings without mutating prior physical-effect evidence', async () => {
  const { statePath, journal } = await journalFixture();
  const original = await journal.beginTermination(binding(), { state: 'PROGRESS_STALE' });
  const legacyPath = actionJournalPath(statePath);
  const legacyBefore = await fs.readFile(legacyPath, 'utf8');
  const paths = new Set();

  for (const drift of [
    binding({ token: 'other-token' }),
    binding({ parent_pid: process.pid + 1 }),
    binding({ executable: `${process.execPath}.other` }),
  ]) {
    const restarted = new BrowserSentinelActionJournal({ statePath });
    await restarted.init(drift);
    assert.equal(restarted.snapshot(), null);
    assert.equal(restarted.terminationAttempted(), false);

    const intent = await restarted.beginTermination(drift, { state: 'PROGRESS_STALE' });
    assert.equal(intent.state, 'PARENT_TERMINATION_INTENT');
    assert.equal(intent.token, drift.token);
    assert.equal(intent.parent_pid, drift.parent_pid);
    assert.equal(intent.executable, drift.executable);

    const scopedPath = incarnationActionJournalPath(statePath, drift);
    paths.add(scopedPath);
    assert.notEqual(scopedPath, legacyPath);
    assert.equal(incarnationActionJournalPath(statePath, drift), scopedPath, 'incarnation path is deterministic');
    const disk = JSON.parse(await fs.readFile(scopedPath, 'utf8'));
    assert.equal(disk.token, drift.token);
    assert.equal(disk.parent_pid, drift.parent_pid);
    assert.equal(disk.executable, drift.executable);
    assert.equal(await fs.readFile(legacyPath, 'utf8'), legacyBefore, 'prior incarnation evidence stays immutable');

    const sameIncarnationRestart = new BrowserSentinelActionJournal({ statePath });
    await sameIncarnationRestart.init(drift);
    assert.equal(sameIncarnationRestart.terminationAttempted(), true, 'same incarnation reuses its scoped journal');
    await assert.rejects(
      () => sameIncarnationRestart.beginTermination(drift, { state: 'PROGRESS_STALE' }),
      /already_attempted/,
      'same incarnation cannot replay a prior physical-effect barrier',
    );
  }

  assert.equal(paths.size, 3, 'each exact binding yields an isolated deterministic journal');
  assert.equal(JSON.parse(legacyBefore).sequence, original.sequence);
});

test('journal keeps commit binding fenced after init even when no row existed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-journal-fence-'));
  const statePath = path.join(dir, 'metaengine-browser-sentinel-v1.json');
  const journal = new BrowserSentinelActionJournal({ statePath });
  await journal.init(binding());
  await assert.rejects(
    () => journal.beginTermination(binding({ token: 'drift-after-init' }), { state: 'PROGRESS_STALE' }),
    /binding_drift/,
  );
  await assert.rejects(() => fs.readFile(actionJournalPath(statePath), 'utf8'), /ENOENT/);
});
