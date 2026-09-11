import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSelfUpdateSessionContinuity,
  clearSelfUpdateSessionContinuity,
  loadSelfUpdateSessionContinuity,
  persistSelfUpdateSessionContinuity,
  restoreSelfUpdateSessionContinuity,
} from '../src/self-update-session-continuity.mjs';

test('continuity capsule keeps tab topology and lifecycle metadata without chat text or credentials', () => {
  const row = buildSelfUpdateSessionContinuity({
    currentVersion: '0.6.3-dev.100.0',
    targetVersion: '0.6.3-dev.100.1',
    tabsSnapshot: {
      selected_tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tabs: [
        { tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://chatgpt.com/c/a', kind: 'CHATGPT', title: 'Sensitive title', generation_state: 'GENERATING' },
        { tab_id: 'tab_bbbbbbbb-cccc-dddd-eeee-ffffffffffff', url: 'https://example.com/', kind: 'USER_WEB', title: 'Docs' },
      ],
    },
    lifecycleSnapshot: {
      active_request: {
        wake_id: 'wake_123', tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', retry_attempt: 1,
        same_chat_retry_attempt: 1, blocked_ambiguous: false, effect_class: 'IDEMPOTENT_WRITE', trusted_prompt_body: 'MUST_NOT_PERSIST',
      },
      keepalive: {
        supervisor_id: 'METAENGINE_SUPERVISOR', supervisor_epoch: 2, cycle_seq: 9,
        conversation_url: 'https://chatgpt.com/c/a', tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        last_wake_reason: 'WORKER_RESULT_READY', queued_wakes: [{ reason: 'WORKER_LOST' }],
      },
    },
  });
  assert.equal(row.tabs.length, 2);
  assert.equal(row.tabs[0].selected, true);
  assert.equal(row.tabs[0].generation_state, 'GENERATING');
  assert.equal(row.lifecycle.active_request.retry_attempt, 1);
  assert.equal(row.lifecycle.keepalive.queued_wake_count, 1);
  assert.equal(row.persisted_chat_text, false);
  assert.equal(row.persisted_credentials, false);
  assert.equal(JSON.stringify(row).includes('MUST_NOT_PERSIST'), false);
});

test('continuity capsule is atomically persisted, loaded and cleared', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-update-continuity-'));
  const row = buildSelfUpdateSessionContinuity({ currentVersion: '1.0.0', targetVersion: '1.0.1', tabsSnapshot: { tabs: [], selected_tab_id: null } });
  await persistSelfUpdateSessionContinuity(dir, row);
  assert.deepEqual(await loadSelfUpdateSessionContinuity(dir), row);
  await clearSelfUpdateSessionContinuity(dir);
  assert.equal(await loadSelfUpdateSessionContinuity(dir), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('invalid/non-https tab entries are not restored from continuity capsule', () => {
  const row = buildSelfUpdateSessionContinuity({
    currentVersion: '1.0.0', targetVersion: '1.0.1',
    tabsSnapshot: {
      selected_tab_id: 'tab_goodgood-good-good-good-goodgoodgood',
      tabs: [
        { tab_id: 'tab_goodgood-good-good-good-goodgoodgood', url: 'https://chatgpt.com/c/a' },
        { tab_id: 'tab_badbadbad-bad-bad-bad-badbadbadbad', url: 'file:///etc/passwd' },
        { tab_id: 'not-a-tab', url: 'https://example.com/' },
      ],
    },
  });
  assert.equal(row.tabs.length, 1);
});

test('restore deduplicates existing URL, recreates missing generating chat and restores selection with typed actions only', async () => {
  const row = buildSelfUpdateSessionContinuity({
    currentVersion: '1.0.0', targetVersion: '1.0.1',
    tabsSnapshot: {
      selected_tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tabs: [
        { tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://chatgpt.com/c/live', kind: 'CHATGPT', generation_state: 'GENERATING' },
        { tab_id: 'tab_bbbbbbbb-cccc-dddd-eeee-ffffffffffff', url: 'https://example.com/', kind: 'USER_WEB' },
      ],
    },
  });
  const actions = [];
  const result = await restoreSelfUpdateSessionContinuity({
    row,
    currentVersion: '1.0.1',
    getState: async () => ({ tabs: [{ tab_id: 'tab_existing-existing-existing-existing', url: 'https://example.com/' }] }),
    executeCommand: async (command) => {
      actions.push(structuredClone(command));
      if (command.action === 'NEW_TAB') return { tab_id: 'tab_restored-restored-restored-restored', url: command.payload.url };
      if (command.action === 'SELECT_TAB') return { ok: true, tab_id: command.payload.tab_id };
      throw new Error(`unexpected:${command.action}`);
    },
  });
  assert.equal(result.state, 'RESTORED');
  assert.equal(result.restored_tabs, 1);
  assert.equal(result.had_generating_tabs, true);
  assert.deepEqual(actions.map((row) => row.action), ['NEW_TAB', 'SELECT_TAB']);
  assert.equal(actions[0].payload.url, 'https://chatgpt.com/c/live');
  assert.equal(actions[1].payload.tab_id, 'tab_restored-restored-restored-restored');
  assert.equal(JSON.stringify(actions).includes('Runtime.evaluate'), false);
});

test('restore refuses continuity capsule meant for another target version without actuation', async () => {
  const row = buildSelfUpdateSessionContinuity({
    currentVersion: '1.0.0', targetVersion: '1.0.2',
    tabsSnapshot: { tabs: [], selected_tab_id: null },
  });
  let acted = false;
  const result = await restoreSelfUpdateSessionContinuity({
    row,
    currentVersion: '1.0.1',
    getState: async () => ({ tabs: [] }),
    executeCommand: async () => { acted = true; },
  });
  assert.equal(result.state, 'TARGET_VERSION_MISMATCH');
  assert.equal(acted, false);
});
