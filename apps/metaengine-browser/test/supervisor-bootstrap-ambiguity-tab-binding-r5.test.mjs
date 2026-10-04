import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';
import { buildSupervisorWakeMessage } from '../src/supervisor-keepalive.mjs';

// D-S1 (live deadlock 2026-09-19): a supervisor bootstrap wake that went
// ambiguous recorded no tab binding, so the recovery scoping fell back to a
// stale cross-process keepalive.tab_id, observed nothing and deadlocked the
// keepalive in WAKE_AMBIGUOUS forever (which also fenced every devos task
// lease via devos_dispatch_continuity_degraded). These tests pin the current
// recovery boundary:
// (1) bootstrap ambiguities durably record their own tab,
// (2) a unique non-fleet chat candidate is a valid fallback observation
//     surface when the durable tab id is provably absent,
// (3) an empty root or matching draft cannot prove an unknown historical Send
//     had no effect, so the original wake remains fenced without replay,
// (4) unrelated user surfaces and ambiguous evidence keep failing closed.

const ROOT_URL = 'https://chatgpt.com/';
const WAKE_ID = 'wake_ds1_live_deadlock';
const STALE_TAB = 'tab_stale_previous_process';
// Matches seedAmbiguous(): the pending wake belongs to THIS process, which is
// exactly the D-S1 live condition (the deadlock was created in-process).
const PROCESS_ID = 'process_deadbeef-dead-beef-dead-beefdeadbeef';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function wakeMessage() {
  return buildSupervisorWakeMessage({
    supervisorEpoch: 1,
    cycleSeq: 501,
    wakeId: WAKE_ID,
    reason: 'RESEARCH_ACCELERATOR_DUE',
  });
}

function draftSha() {
  return sha256(wakeMessage());
}

function seedAmbiguous({ continuationTabId = null, continuationAttemptedAt = null } = {}) {
  return {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 500,
    state: 'WAKE_AMBIGUOUS',
    conversation_url: null,
    // The live deadlock: a tab id from a previous process incarnation that no
    // longer exists in this boot's registry while the real draft tab was never
    // recorded on the ambiguity.
    tab_id: STALE_TAB,
    paused: false,
    process_incarnation_id: 'process_deadbeef-dead-beef-dead-beefdeadbeef',
    admission_state: 'OPEN',
    queued_wakes: [],
    pending_wake: {
      wake_id: WAKE_ID,
      reason: 'RESEARCH_ACCELERATOR_DUE',
      queue_key: 'RESEARCH_ACCELERATOR_DUE:epoch-1',
      prepared_at: '2026-09-19T00:24:59.933Z',
      supervisor_epoch: 1,
      cycle_seq: 501,
      process_incarnation_id: 'process_deadbeef-dead-beef-dead-beefdeadbeef',
      ambiguous_at: '2026-09-19T00:25:03.484Z',
      ambiguous_reason: 'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING',
      ...(continuationTabId ? { ambiguity_continuation_tab_id: continuationTabId } : {}),
      ...(continuationAttemptedAt ? { ambiguity_continuation_attempted_at: continuationAttemptedAt } : {}),
      automatic_retry_allowed: false,
    },
    active_wake: null,
  };
}

function rootFrame({ composerSha = null, composerLength = null, marker = false, unrelatedDraft = false } = {}) {
  const textbox = { role: 'textbox', name: 'Message ChatGPT', semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'a'.repeat(64) }, backend_node_id: 1112 };
  if (composerSha != null) textbox.value_sha256 = composerSha;
  if (composerLength != null) textbox.value_length = composerLength;
  if (unrelatedDraft) {
    textbox.value_sha256 = sha256('user own draft text');
    textbox.value_length = 21;
  }
  return {
    url: ROOT_URL,
    title: 'ChatGPT',
    text_excerpt: marker ? `METAENGINE_SUPERVISOR_WAKE_V1 ... ${WAKE_ID} ...` : 'What can I build for you?',
    semantic_targets: [textbox, { role: 'button', name: 'Send', semantic_ref: 'send' }],
  };
}

function conversationFrame(text = '') {
  return {
    url: 'https://chatgpt.com/c/55fd8c37-00d0-4821-8e56-14f36c7be6db',
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT', semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'b'.repeat(64) }, backend_node_id: 2213 },
      { role: 'button', name: 'Send', semantic_ref: 'send' },
    ],
  };
}

async function makeRuntime({ seed = null, tabs = [], frames = {}, onSubmit = null }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-ds1-'));
  const statePath = path.join(dir, 'keepalive.json');
  if (seed) await fs.writeFile(statePath, `${JSON.stringify(seed, null, 2)}\n`);
  const actions = [];
  const liveTabs = structuredClone(tabs);
  const drafts = new Map();
  const frameFor = (tabId) => {
    const entry = Object.entries(frames).find(([key]) => key === tabId || tabId.startsWith(key));
    const frame = typeof entry?.[1] === 'function' ? entry[1]() : entry?.[1];
    const captured = structuredClone(frame ?? rootFrame({}));
    const draft = drafts.get(tabId);
    if (draft != null) {
      const composer = captured.semantic_targets.find((row) => row.role === 'textbox');
      composer.value_sha256 = sha256(draft);
      composer.value_length = draft.length;
    }
    return { ...captured, tab_id: tabId, target_id: `webcontents:${tabId}` };
  };
  const executeCommand = async ({ action, payload }) => {
    const tabId = String(payload?.tab_id || '');
    actions.push(action);
    if (action === 'NEW_TAB') {
      const tab = { tab_id: `boot_${liveTabs.filter((t) => t.tab_id.startsWith('boot_')).length + 1}`, url: ROOT_URL, selected: false };
      liveTabs.push(tab);
      return structuredClone(tab);
    }
    if (action === 'CAPTURE') return frameFor(tabId);
    if (action === 'SEMANTIC_TYPE') {
      assert.equal(payload.submit_after_type, false);
      drafts.set(tabId, payload.text);
      return { replace_verified: true, authority_effect: true };
    }
    if (action === 'TYPED_CLICK') {
      assert.equal(payload.chatgpt_submit, true);
      drafts.delete(tabId);
      if (onSubmit) return onSubmit({ action, payload });
      return { effect_state: 'PROVEN_GENERATING', stop_observed: true, automatic_retry_allowed: false, authority_effect: true };
    }
    if (action === 'CLOSE_TAB') return { ok: true };
    throw new Error(`unexpected_effect:${action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: structuredClone(liveTabs), fleet: { agents: [] } }),
    executeCommand,
    canActuate: () => true,
    statePath,
    researchMs: 60 * 60 * 1000,
    processIncarnationId: PROCESS_ID,
  });
  return { runtime, actions, statePath, liveTabs };
}

test('bootstrap ambiguity durably records its own tab (seed-unproven pre-binding)', async () => {
  const { runtime, statePath } = await makeRuntime({
    tabs: [{ tab_id: 'user_root', url: ROOT_URL, selected: true }],
    frames: { user_root: rootFrame({}) },
    // boot_* tabs get the default root frame: the submit reports proven but
    // the surface never navigates to /c/<id> — with the R-SUP-SEED medicine
    // the SEED's conversation-URL readback now fails first, so the wake is
    // never typed and the ambiguity is recorded as ROOT_SEED_CONVERSATION_
    // NOT_PROVEN (conservatively ambiguous, clicked=true — the seed DID
    // submit). The durable contract under test is unchanged: the ambiguity
    // records its OWN continuation tab so recovery can observe it.
  });
  const snap = await runtime.start();
  // The bootstrap must have run (fresh state, research wake queued) and gone
  // ambiguous with the continuation tab recorded.
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.ok(durable.pending_wake, 'pending wake exists');
  assert.equal(durable.pending_wake.ambiguous_reason, 'ROOT_SEED_CONVERSATION_NOT_PROVEN');
  assert.equal(typeof durable.pending_wake.ambiguity_continuation_tab_id, 'string');
  assert.ok(durable.pending_wake.ambiguity_continuation_tab_id.startsWith('boot_'),
    `continuation tab recorded, got: ${durable.pending_wake.ambiguity_continuation_tab_id}`);
});

test('stale dead durable tab and a unique exact draft keep the unknown wake read-only', async () => {
  let submits = 0;
  let markerShown = false;
  const { runtime, actions } = await makeRuntime({
    seed: seedAmbiguous({}),
    tabs: [
      { tab_id: 'draft_tab', url: ROOT_URL, selected: false },
    ],
    frames: {
      // user_root is an unrelated surface; draft_tab holds the exact wake draft.
      user_root: rootFrame({}),
      draft_tab: () => (markerShown
        ? rootFrame({ marker: true, composerSha: null, composerLength: 0 })
        : rootFrame({ composerSha: draftSha(), composerLength: wakeMessage().length })),
    },
    onSubmit: () => {
      submits += 1;
      markerShown = true;
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    },
  });
  await runtime.start();
  const snap = await runtime.cycle({ force: true });
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake.wake_id, WAKE_ID);
  assert.equal(snap.keepalive.active_wake, null);
  assert.equal(submits, 0);
  assert.equal(markerShown, false);
  assert.equal(actions.includes('SEMANTIC_TYPE'), false);
  assert.equal(actions.includes('TYPED_CLICK'), false);
  assert.equal(actions.includes('NEW_TAB'), false, 'no new tab amplification');
  assert.equal(actions.includes('CLOSE_TAB'), false, 'nothing closed while recovering');
});

test('an empty replacement root cannot prove absence of the historical Send or retire its wake', async () => {
  let bootstrappedConversation = false;
  const { runtime, actions, statePath } = await makeRuntime({
    seed: seedAmbiguous({}),
    tabs: [{ tab_id: 'user_root', url: ROOT_URL, selected: true }],
    frames: {
      user_root: rootFrame({ composerSha: null, composerLength: 0 }),
      boot_: () => (bootstrappedConversation
        ? conversationFrame(`METAENGINE_SUPERVISOR_WAKE_V1 ... ${WAKE_ID}`)
        : rootFrame({ composerSha: null, composerLength: 0 })),
    },
    onSubmit: () => {
      bootstrappedConversation = true;
      return { effect_state: 'PROVEN_NEW_CONVERSATION', new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    },
  });
  let snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake.wake_id, WAKE_ID);
  snap = await runtime.cycle({ force: true });
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake.wake_id, WAKE_ID);
  assert.equal(snap.keepalive.conversation_url, null);
  assert.equal(snap.keepalive.active_wake, null);
  assert.equal(bootstrappedConversation, false);
  assert.equal(actions.includes('NEW_TAB'), false);
  assert.equal(actions.includes('SEMANTIC_TYPE'), false);
  assert.equal(actions.includes('TYPED_CLICK'), false);
  assert.equal(actions.includes('CLOSE_TAB'), false, 'empty root was not closed (could be the user tab)');
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.ambiguous_history.length, 0);
  assert.equal(durable.pending_wake.ambiguous_reason, 'BOOTSTRAP_WITHOUT_CONVERSATION_BINDING');
  assert.equal(durable.pending_wake.automatic_retry_allowed, false);
});

test('unrelated user draft surface never retires or resubmits the ambiguous wake', async () => {
  let submits = 0;
  const { runtime, actions } = await makeRuntime({
    seed: seedAmbiguous({}),
    tabs: [{ tab_id: 'user_root', url: ROOT_URL, selected: true }],
    frames: { user_root: rootFrame({ unrelatedDraft: true, marker: false }) },
    onSubmit: () => { submits += 1; return {}; },
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, WAKE_ID);
  assert.equal(submits, 0, 'no send authority over an unrelated surface');
  assert.equal(actions.includes('NEW_TAB'), false);
  assert.equal(actions.includes('CLOSE_TAB'), false);
});

test('a spent legacy continuation flag cannot retire, close or replay an unresolved draft', async () => {
  let submits = 0;
  let bootstrappedConversation = false;
  const { runtime, actions, statePath } = await makeRuntime({
    seed: seedAmbiguous({ continuationAttemptedAt: '2026-09-19T00:26:00.000Z' }),
    tabs: [{ tab_id: 'draft_tab', url: ROOT_URL, selected: false }],
    frames: {
      draft_tab: rootFrame({ composerSha: draftSha(), composerLength: wakeMessage().length, marker: false }),
      boot_: () => (bootstrappedConversation
        ? conversationFrame(`METAENGINE_SUPERVISOR_WAKE_V1 ... wake`)
        : rootFrame({ composerSha: null, composerLength: 0 })),
    },
    onSubmit: () => {
      submits += 1;
      bootstrappedConversation = true;
      return { effect_state: 'PROVEN_NEW_CONVERSATION', new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    },
  });
  let snap = await runtime.start();
  assert.equal(snap.keepalive.pending_wake.wake_id, WAKE_ID);
  snap = await runtime.cycle({ force: true });
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake.wake_id, WAKE_ID);
  assert.equal(submits, 0);
  assert.equal(bootstrappedConversation, false);
  assert.equal(actions.includes('SEMANTIC_TYPE'), false);
  assert.equal(actions.includes('TYPED_CLICK'), false);
  assert.equal(actions.includes('NEW_TAB'), false);
  assert.equal(actions.includes('CLOSE_TAB'), false);
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.ambiguous_history.length, 0);
  assert.equal(durable.pending_wake.automatic_retry_allowed, false);
});

test('multiple candidates with a stale dead durable tab keep failing closed', async () => {
  const { runtime, actions } = await makeRuntime({
    seed: seedAmbiguous({}),
    tabs: [
      { tab_id: 'root_a', url: ROOT_URL, selected: false },
      { tab_id: 'root_b', url: ROOT_URL, selected: false },
    ],
    frames: { root_a: rootFrame({ composerSha: draftSha() }), root_b: rootFrame({}) },
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.keepalive.pending_wake?.wake_id, WAKE_ID);
  assert.equal(actions.includes('SEMANTIC_TYPE'), false);
  assert.equal(actions.includes('NEW_TAB'), false);
  assert.equal(actions.includes('CLOSE_TAB'), false);
});
