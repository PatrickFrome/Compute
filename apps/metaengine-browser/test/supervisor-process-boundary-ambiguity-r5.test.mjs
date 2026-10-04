import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';

const OLD_PROCESS = 'process_old-r5';
const OLD_WAKE = 'wake_process-boundary-r5';

function seedState() {
  return {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 0,
    state: 'WAKE_AMBIGUOUS',
    conversation_url: null,
    tab_id: null,
    paused: false,
    process_incarnation_id: OLD_PROCESS,
    process_incarnation_started_at: '2026-09-16T00:00:00.000Z',
    admission_state: 'UNKNOWN',
    queued_wakes: [],
    pending_wake: {
      wake_id: OLD_WAKE,
      reason: 'RESEARCH_ACCELERATOR_DUE',
      queue_key: 'RESEARCH_ACCELERATOR_DUE:epoch-1',
      prepared_at: '2026-09-16T00:00:00.000Z',
      supervisor_epoch: 1,
      cycle_seq: 1,
      process_incarnation_id: OLD_PROCESS,
      ambiguous_at: '2026-09-16T00:00:01.000Z',
      ambiguous_reason: 'TYPE_EFFECT_AMBIGUOUS',
      automatic_retry_allowed: false,
    },
    active_wake: null,
    last_research_wake_at: null,
  };
}

function rootFrame(draft = '') {
  return {
    url: 'https://chatgpt.com/',
    title: 'ChatGPT',
    text_excerpt: '',
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT', semantic_ref: 'composer', value_length: draft.length, value_sha256: crypto.createHash('sha256').update(draft).digest('hex') },
      { role: 'button', name: 'Send prompt', semantic_ref: 'send' },
    ],
  };
}

async function makeRuntime({ tabs, seed = seedState() }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r5-'));
  const statePath = path.join(dir, 'keepalive.json');
  await fs.writeFile(statePath, `${JSON.stringify(seed, null, 2)}\n`);
  const actions = [];
  let typed = 0;
  const drafts = new Map();
  let currentTabs = structuredClone(tabs);
  const executeCommand = async ({ action, payload }) => {
    actions.push(action);
    if (action === 'CAPTURE') {
      const tab = currentTabs.find((row) => String(row?.tab_id || '') === String(payload?.tab_id || ''));
      const tabId = String(payload?.tab_id || '');
      return { ...rootFrame(drafts.get(tabId) || ''), url: String(tab?.url || 'https://chatgpt.com/'), tab_id: tabId, target_id: `webcontents:${tabId}` };
    }
    if (action === 'SEMANTIC_TYPE') {
      assert.equal(payload.submit_after_type, false);
      typed += 1;
      drafts.set(payload.tab_id, String(payload.text));
      return { replace_verified: true, authority_effect: true };
    }
    if (action === 'TYPED_CLICK') {
      assert.equal(payload.chatgpt_submit, true);
      drafts.delete(payload.tab_id);
      currentTabs = currentTabs.map((row) => String(row?.tab_id || '') === String(payload?.tab_id || '')
        ? { ...row, url: 'https://chatgpt.com/c/r5-recovered' }
        : row);
      return {
        effect_state: 'PROVEN_NEW_CONVERSATION',
        url: 'https://chatgpt.com/c/r5-recovered',
        tab_id: String(payload?.tab_id || ''),
        text_excerpt: '',
        semantic_targets: [],
      };
    }
    if (action === 'NEW_TAB') throw new Error('r5_must_reuse_existing_root');
    throw new Error(`unexpected_effect:${action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: structuredClone(currentTabs), fleet: { agents: [] } }),
    executeCommand,
    canActuate: () => true,
    statePath,
    researchMs: 24 * 60 * 60 * 1000,
  });
  return { runtime, actions, statePath, typed: () => typed };
}

test('process-boundary unknown Send retains its wake even when one clean replacement root exists', async () => {
  const { runtime, actions, statePath, typed } = await makeRuntime({
    tabs: [{ tab_id: 'replacement-root', url: 'https://chatgpt.com/', selected: false }],
  });
  await runtime.start();
  const snap = await runtime.cycle({ force: true });
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.conversation_url, null);
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.active_wake, null);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.equal(snap.last_recovery.action, 'PROCESS_BOUNDARY_EFFECT_READBACK_REQUIRED');
  assert.equal(typed(), 0);
  assert.equal(actions.some((action) => ['NEW_TAB', 'TYPED_CLICK', 'CLOSE_TAB'].includes(action)), false);
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.pending_wake.wake_id, OLD_WAKE);
  assert.equal(durable.pending_wake.automatic_retry_allowed, false);
  assert.equal(durable.ambiguous_history.length, 0);
});

test('process-boundary ambiguity stays fail-closed when replacement roots are not unique', async () => {
  const { runtime, actions, typed } = await makeRuntime({
    tabs: [
      { tab_id: 'replacement-root-a', url: 'https://chatgpt.com/', selected: false },
      { tab_id: 'replacement-root-b', url: 'https://chatgpt.com/', selected: false },
    ],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.equal(typed(), 0);
  assert.equal(actions.includes('NEW_TAB'), false);
});


test('multi-hop process restarts retain an unknown wake without replay, retirement or replacement', async () => {
  const seed = seedState();
  seed.process_incarnation_id = 'process_intermediate-r6';
  seed.process_incarnation_started_at = '2026-09-16T00:10:00.000Z';
  seed.predecessor_process_incarnation_id = 'process_other-r6';
  seed.predecessor_fenced_at = '2026-09-16T00:10:00.000Z';
  const { runtime, actions, statePath, typed } = await makeRuntime({
    seed,
    tabs: [{ tab_id: 'replacement-root-multihop', url: 'https://chatgpt.com/', selected: false }],
  });
  await runtime.start();
  const snap = await runtime.cycle({ force: true });
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.active_wake, null);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.ok(snap.keepalive.pending_wake.process_boundary_fenced_at);
  assert.equal(snap.keepalive.pending_wake.automatic_retry_allowed, false);
  assert.equal(typed(), 0);
  assert.equal(actions.some((action) => ['NEW_TAB', 'TYPED_CLICK', 'CLOSE_TAB'].includes(action)), false);
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.pending_wake.wake_id, OLD_WAKE);
  assert.ok(durable.pending_wake.process_boundary_fenced_by_process_incarnation_id);
  assert.equal(durable.ambiguous_history.length, 0);
});

test('missing pending process identity stays fail-closed under the multihop fence', async () => {
  const seed = seedState();
  seed.process_incarnation_id = 'process_intermediate-r6';
  seed.pending_wake.process_incarnation_id = null;
  const { runtime, actions, typed } = await makeRuntime({
    seed,
    tabs: [{ tab_id: 'identity-missing-root', url: 'https://chatgpt.com/', selected: false }],
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, OLD_WAKE);
  assert.equal(snap.keepalive.ambiguous_history.length, 0);
  assert.equal(typed(), 0);
  assert.equal(actions.includes('NEW_TAB'), false);
});
