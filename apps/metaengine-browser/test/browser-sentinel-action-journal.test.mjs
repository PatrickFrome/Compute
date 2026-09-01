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

test('journal rejects exact binding drift across token pid and executable', async () => {
  const { statePath, journal } = await journalFixture();
  await journal.beginTermination(binding(), { state: 'PROGRESS_STALE' });

  for (const drift of [
    binding({ token: 'other-token' }),
    binding({ parent_pid: process.pid + 1 }),
    binding({ executable: `${process.execPath}.other` }),
  ]) {
    const restarted = new BrowserSentinelActionJournal({ statePath });
    await assert.rejects(() => restarted.init(drift), /binding_drift/);
  }
});
