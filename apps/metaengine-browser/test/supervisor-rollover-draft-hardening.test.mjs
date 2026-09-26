import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentSessionMonitor } from '../src/agent-session-monitor.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

// ---------------------------------------------------------------------------
// R82 (live 2026-09-26): rollover hardening against the two live-observed
// failure modes that kept the supervisor dead for >57h (cycle_seq stuck at
// 2109, shell .36089462649.1 = release cf747798):
//   R82-DRAFT-CANARY  — a PRECONVERSATION_ROOT composer holding an oversized
//                       account-synced draft (live: 28,708 chars since
//                       2026-09-19) is provably unusable and every insert
//                       GROWS the shared draft; the canary aborts BEFORE any
//                       physical effect with the distinct reason
//                       ROOT_DRAFT_OVERSIZED.
//   R82-BLANK-TAB     — a rollover tab whose bounded navigation never
//                       committed (url:'', zero DOM nodes) can never grow a
//                       composer; it is closed immediately (provably never
//                       held a send) and a fresh tab is opened, bounded.
// ---------------------------------------------------------------------------

const CONVERSATION = 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ROOT = 'https://chat.z.ai/';
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
const SEED_HEAD = 'METAENGINE SUPERVISOR CONVERSATION SEED v1';

const COMPOSER_REF = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'c'.repeat(64) };

function conversationFrame(text = '') {
  return {
    url: CONVERSATION,
    title: 'Z.ai',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Send a Message', semantic_ref: COMPOSER_REF, backend_node_id: 1770, value_length: text.length, value_sha256: text ? sha256(text) : null },
    ],
  };
}

function rootFrame({ draftLength = 0 } = {}) {
  return {
    url: ROOT,
    title: 'Z.ai',
    text_excerpt: '',
    semantic_targets: [
      { role: 'textbox', name: 'How can I help you today?', semantic_ref: COMPOSER_REF, backend_node_id: 196, value_length: draftLength, value_sha256: draftLength ? sha256('x'.repeat(draftLength)) : null },
    ],
  };
}

function blankFrame() {
  return {
    url: '',
    title: '',
    text_excerpt: '',
    interaction_tree: { elements: [], element_count: 0, truncated: false },
    semantic_targets: [],
  };
}

// A harness whose tab registry, frames and typed commands are fully scripted
// per tab. blankRounds: how many NEW_TAB rounds capture as permanently blank
// before a committed root tab appears (R82-BLANK-TAB retry path).
function harness({ rootDraftLength = 0, blankRounds = 0 } = {}) {
  const tabs = new Map([['tab1', { frame: conversationFrame(''), url: CONVERSATION }]]);
  const closed = [];
  const typed = [];
  let newTabIndex = 0;
  let blankServed = 0;
  const getState = async () => ({
    tabs: [...tabs.entries()].map(([tab_id, t]) => ({ tab_id, url: t.url, selected: tab_id === 'tab1' })),
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    const action = command.action;
    if (action === 'CAPTURE') {
      const tab = tabs.get(String(command.payload?.tab_id || ''));
      return tab ? structuredClone(tab.frame) : blankFrame();
    }
    if (action === 'NEW_TAB') {
      newTabIndex += 1;
      const tab_id = `tabroll_${newTabIndex}`;
      const blank = blankServed < blankRounds;
      if (blank) {
        blankServed += 1;
        tabs.set(tab_id, { frame: blankFrame(), url: '' });
      } else {
        tabs.set(tab_id, { frame: rootFrame({ draftLength: rootDraftLength }), url: ROOT });
      }
      return { tab_id, url: blank ? '' : ROOT, kind: 'GLM_CHAT', role: 'USER' };
    }
    if (action === 'CLOSE_TAB') {
      closed.push(String(command.payload?.tab_id || ''));
      tabs.delete(String(command.payload?.tab_id || ''));
      return { closed: true };
    }
    if (action === 'SEMANTIC_TYPE') {
      const tab = tabs.get(String(command.payload?.tab_id || ''));
      const text = String(command.payload?.text || '');
      typed.push({ tab_id: String(command.payload?.tab_id || ''), text, replace_existing: command.payload?.replace_existing === true });
      if (String(command.payload?.tab_id || '') === 'tab1') {
        // The bound conversation surface: the suppressed pre-effect path (the
        // D-K7 shape) so three cycles request the rollover deterministically.
        return { suppressed: true, reason: 'TYPE_EFFECT_AMBIGUOUS' };
      }
      if (text.startsWith(SEED_HEAD)) {
        // The seed provably creates the conversation on this surface.
        const url = `https://chat.z.ai/c/r82seed-0000-4000-8000-${String(newTabIndex).padStart(12, '0')}`;
        tab.url = url;
        tab.frame = { ...conversationFrame(''), url };
      } else if (tab) {
        // A submit on the conversation surface lands the message in the
        // transcript (the readback marker source) with an unproven effect
        // state, driving the readback lane like the live executor does.
        tab.frame = { ...structuredClone(tab.frame), text_excerpt: text };
      }
      return { effect_state: 'SENT_READBACK_PENDING', replace_verified: true, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_action:${action}`);
  };
  return { tabs, closed, typed, getState, executeCommand };
}

async function makeRuntime(h, { monitorMs = 1 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r82-'));
  const statePath = path.join(dir, 'keepalive.json');
  const runtime = new SupervisorLifecycleRuntime({
    getState: h.getState,
    executeCommand: h.executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs,
    researchMs: 5 * 60 * 1000,
    sessionMonitor: new AgentSessionMonitor({ clock: () => Date.now(), settleMs: 1500 }),
  });
  return { runtime, dir };
}

test('R82-DRAFT-CANARY: an oversized root draft aborts BEFORE any insert with the distinct machine reason', async () => {
  // Live shape 2026-09-26: 28,708-char account-synced draft on the root
  // surface. The historical path typed the seed into it anyway (growing the
  // shared draft by ~202 chars per attempt) and looped on TYPE_EFFECT_AMBIGUOUS.
  const h = harness({ rootDraftLength: 28708, blankRounds: 0 });
  const { runtime, dir } = await makeRuntime(h);
  try {
    await runtime.start();               // cycle 1: first composer-blocking wake failure
    await runtime.cycle({ force: true }); // cycle 2: second failure
    await runtime.cycle({ force: true }); // cycle 3: third failure -> ROLLOVER_REQUIRED
    let snap = runtime.snapshot();
    assert.equal(['ROLLOVER_REQUIRED', 'ROLLOVER_DEFERRED', 'ROLLOVER_PENDING'].includes(snap.keepalive.state), true,
      `expected a rollover state after 3 composer-blocking failures, got ${snap.keepalive.state}`);
    await runtime.cycle({ force: true }); // cycle 4: the rollover attempt runs
    snap = runtime.snapshot();
    assert.equal(snap.keepalive.state, 'ROLLOVER_AMBIGUOUS');
    assert.equal(snap.keepalive.rollover_reason, 'ROOT_DRAFT_OVERSIZED',
      `the canary reason must be distinct and machine-readable, got ${snap.keepalive.rollover_reason}`);
    const rolloverTabs = h.typed.filter((t) => t.tab_id.startsWith('tabroll_'));
    assert.equal(rolloverTabs.length, 0, 'the canary must abort before ANY insert into the oversized root draft');
    await runtime.cycle({ force: true }); // cycle 5: the D-C7 drain retires the leaked root tab
    assert.ok(h.closed.some((id) => id.startsWith('tabroll_')), 'the leaked rollover tab must be closed by proof');
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  }
});

test('R82-BLANK-TAB: a never-committed rollover tab is closed and retried, and a committed tab completes the rollover', async () => {
  // Live shape 2026-09-26: rollover NEW_TABs whose bounded navigation was
  // stopped by DEADLINE_EXCEEDED stayed url:'' with zero DOM nodes forever
  // (webcontents:68 still blank 5+ minutes later) while a manual tab hydrated.
  const h = harness({ rootDraftLength: 120, blankRounds: 2 });
  const { runtime, dir } = await makeRuntime(h);
  try {
    await runtime.start();               // cycle 1: first composer-blocking wake failure
    await runtime.cycle({ force: true }); // cycle 2
    await runtime.cycle({ force: true }); // cycle 3 -> ROLLOVER_REQUIRED
    await runtime.cycle({ force: true }); // cycle 4: rollover with 2 blank rounds then a committed tab
    const snap = runtime.snapshot();
    const blanks = h.closed.filter((id) => id === 'tabroll_1' || id === 'tabroll_2');
    assert.equal(blanks.length, 2, `both provably-blank tabs must be closed inline, closed=${JSON.stringify(h.closed)}`);
    const committedTyping = h.typed.filter((t) => t.tab_id === 'tabroll_3');
    assert.equal(committedTyping.length, 2, 'seed + rollover message must both be typed on the committed tab');
    assert.ok(committedTyping.some((t) => t.text.startsWith(SEED_HEAD) && t.replace_existing === true),
      'the root seed must run with a verified replace on the clean composer');
    assert.ok(committedTyping.some((t) => t.text.includes('METAENGINE_SUPERVISOR_ROLLOVER_V1')),
      'the rollover message must be typed and submitted');
    assert.equal(String(snap.keepalive.state).startsWith('ROLLOVER'), false,
      `the rollover must bind the new conversation, got ${snap.keepalive.state}`);
    assert.equal(snap.keepalive.conversation_url, 'https://chat.z.ai/c/r82seed-0000-4000-8000-000000000003');
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  }
});

test('R82-DRAFT-CANARY (regression guard): a normal-size root draft still runs the verified seed protocol', async () => {
  const h = harness({ rootDraftLength: 500, blankRounds: 0 });
  const { runtime, dir } = await makeRuntime(h);
  try {
    await runtime.start();
    await runtime.cycle({ force: true });
    await runtime.cycle({ force: true }); // ROLLOVER_REQUIRED
    await runtime.cycle({ force: true }); // the rollover attempt runs
    const seeds = h.typed.filter((t) => t.tab_id.startsWith('tabroll_') && t.text.startsWith(SEED_HEAD));
    assert.equal(seeds.length, 1, 'the seed must be dispatched exactly once on the clean root surface');
    assert.equal(seeds[0].replace_existing, true);
    assert.equal(h.closed.filter((id) => id.startsWith('tabroll_')).length, 0,
      'a committed tab with a clean draft is never closed inline');
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  }
});
