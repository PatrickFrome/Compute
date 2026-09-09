import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { BrowserSentinelActionJournal, actionJournalPath } = require('../src/browser-sentinel-action-journal.cjs');

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

test('empty journal retains exact init binding before first effect and rejects drift', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-init-binding-'));
  const statePath = path.join(dir, 'metaengine-browser-sentinel-v1.json');
  const journal = new BrowserSentinelActionJournal({ statePath });

  await journal.init(binding());
  assert.equal(journal.snapshot(), null);
  await assert.rejects(
    () => journal.beginTermination(binding({ token: 'drift-after-init' }), { state: 'PROGRESS_STALE' }),
    /binding_drift/,
  );
  await assert.rejects(() => fs.readFile(actionJournalPath(statePath), 'utf8'), /ENOENT/);

  const row = await journal.beginTermination(binding(), { state: 'PROGRESS_STALE' });
  assert.equal(row.state, 'PARENT_TERMINATION_INTENT');
  assert.equal(row.token, 'sentinel-token');
  assert.equal(row.parent_pid, process.pid);
  assert.equal(row.executable, process.execPath);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
});

test('journal cannot commit an effect before a successful exact init binding', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-uninitialized-binding-'));
  const statePath = path.join(dir, 'metaengine-browser-sentinel-v1.json');
  const journal = new BrowserSentinelActionJournal({ statePath });

  await assert.rejects(
    () => journal.beginTermination(binding(), { state: 'PROGRESS_STALE' }),
    /binding_drift/,
  );
  await assert.rejects(() => fs.readFile(actionJournalPath(statePath), 'utf8'), /ENOENT/);
});
