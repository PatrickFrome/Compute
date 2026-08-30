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
