import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

// R-SUP-SEED (live 2026-09-21 regression class): the PRECONVERSATION_ROOT
// composer silently refuses Enter on oversized prompts, so the supervisor
// rollover — which types the FULL rollover message into a fresh root tab —
// produced the live black hole: TYPE_EFFECT_AMBIGUOUS → markRolloverAmbiguous
// → no-progress rerequest → fresh tab → repeat (keepalive pinned at
// ROLLOVER_AMBIGUOUS, cycle_seq frozen). The runtime now proves the root
// conversation FIRST with a tiny deterministic seed, then types the real
// message on the conversation surface. These tests pin that medicine.

const conversationUrl = 'https://chat.z.ai/c/0799499c-9ead-4a7e-8edc-be365222c4d4';
const NEW_CONVERSATION = 'https://chat.z.ai/c/newconv-rolled-seed-1234';
const ROOT = 'https://chat.z.ai/';

function seedKeepalive(statePath) {
  let stored = null;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    processIncarnationId: 'process_test_current',
  });
  return keepalive.init().then(async () => {
    await keepalive.bindConversation({ url: conversationUrl, tab_id: 'tab_keep' });
    await keepalive.requestRollover('TYPE_EFFECT_AMBIGUOUS', { autoRelease: true });
    assert.equal(keepalive.snapshot().state, 'ROLLOVER_REQUIRED');
    fs.writeFileSync(statePath, `${JSON.stringify(stored)}\n`);
    return keepalive;
  });
}

function frameFor(url, { composer = true, generating = false } = {}) {
  const targets = [];
  if (composer) targets.push({ role: 'textbox', name: 'Ask anything', semantic_ref: 'sr-1', value_length: 0 });
  if (generating) targets.push({ role: 'button', name: 'Stop' });
  return { url, text_excerpt: 'supervisor transcript excerpt', semantic_targets: targets };
}

// Harness: the keepalive's conversation tab exists; the rollover opens a
// fresh root tab. `seedProvesConversation` models whether the site accepts
// the tiny seed submit (root URL flips to a conversation). `wakeProves`
// models whether the real rollover send lands.
function makeHarness(statePath, { seedProvesConversation = true, wakeProves = true } = {}) {
  const types = [];
  let newTabs = 0;
  let registry = [
    { tab_id: 'tab_keep', url: conversationUrl, selected: false },
  ];
  const captureCounts = new Map();
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: structuredClone(registry), fleet: { agents: [] } }),
    executeCommand: async (command) => {
      if (command.action === 'NEW_TAB') {
        newTabs += 1;
        const id = `tab_new_${newTabs}`;
        registry.push({ tab_id: id, url: ROOT, selected: false });
        return { tab_id: id };
      }
      if (command.action === 'CLOSE_TAB') {
        const id = String(command.payload?.tab_id || '');
        registry = registry.filter((t) => t.tab_id !== id);
        return { closed: id };
      }
      if (command.action === 'CAPTURE') {
        const id = String(command.payload?.tab_id || '');
        const n = (captureCounts.get(id) || 0) + 1;
        captureCounts.set(id, n);
        const row = registry.find((t) => t.tab_id === id);
        // Fresh root tabs hydrate: no composer on the first capture.
        const settled = n >= 2 || row?.url !== ROOT;
        return frameFor(row?.url || ROOT, { composer: settled });
      }
      if (command.action === 'SEMANTIC_TYPE') {
        const text = String(command.payload?.text || '');
        const isSeed = text.includes('SUPERVISOR CONVERSATION SEED');
        types.push({ text, isSeed });
        const proves = isSeed ? seedProvesConversation : wakeProves;
        if (proves) {
          const id = String(command.payload?.tab_id || '');
          const row = registry.find((t) => t.tab_id === id);
          if (row && row.url === ROOT) row.url = NEW_CONVERSATION;
          return {
            effect_state: 'PROVEN_NEW_CONVERSATION',
            suppressed: false,
            url: NEW_CONVERSATION,
            text_excerpt: text,
            semantic_targets: [{ role: 'button', name: 'Stop' }, { role: 'textbox', name: 'Ask anything', semantic_ref: 'sr-next', value_length: 0 }],
            authority_effect: true,
          };
        }
        return { effect_state: 'AMBIGUOUS_AFTER_ENTER', suppressed: false, authority_effect: true };
      }
      if (command.action === 'READ_TRANSCRIPT') return { text: `seed\nMETAENGINE_SUPERVISOR_ROLLOVER_V1\nattempt marker` };
      return {};
    },
    canActuate: () => true,
    statePath,
    // No post-test timer cycles: node:test flags async activity after the
    // test ended; the tests drive their own cycles.
    monitorMs: 10 * 60 * 1000,
  });
  return { runtime, types, get newTabs() { return newTabs; }, get registry() { return registry; } };
}

test('R-SUP-SEED: the rollover seeds the fresh root tab first, then the real rollover message types into the proven conversation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-seed-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  const h = makeHarness(statePath, { seedProvesConversation: true, wakeProves: true });

  await h.runtime.start().catch(() => {});
  await h.runtime.cycle({ force: true });

  assert.equal(h.newTabs, 1, 'one rollover attempt opened one tab');
  assert.equal(h.types.length, 2, 'exactly two submits: the conversation seed, then the rollover message');
  assert.equal(h.types[0].isSeed, true, 'the seed went first');
  assert.ok(h.types[0].text.length < 1000, 'the seed stays far below any site-side oversize refusal threshold');
  assert.equal(h.types[1].isSeed, false, 'the real rollover message went second');
  assert.ok(h.types[1].text.includes('METAENGINE_SUPERVISOR_ROLLOVER_V1'), 'the second submit carries the rollover contract');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(['WAITING', 'ACTIVE'].includes(state.state), `the rollover bound the seeded conversation (state=${state.state})`);
  assert.equal(state.conversation_url, NEW_CONVERSATION, 'the keepalive bound the new conversation URL');
});

test('R-SUP-SEED: a refused seed fails closed — the full rollover message is NEVER typed into the root composer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-seed-refused-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  const h = makeHarness(statePath, { seedProvesConversation: false, wakeProves: true });

  await h.runtime.start().catch(() => {});
  await h.runtime.cycle({ force: true });

  assert.equal(h.newTabs, 1);
  assert.equal(h.types.length, 1, 'only the seed was typed — the oversized rollover message never touched the root composer');
  assert.equal(h.types[0].isSeed, true);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.state, 'ROLLOVER_AMBIGUOUS', 'the unproven seed marks the attempt ambiguous (honest, bounded)');
  assert.equal(state.rollover_attempt?.ambiguous_reason, 'ROOT_SEED_CONVERSATION_NOT_PROVEN');
});

test('R-SUP-SEED: an established conversation surface never pays the seed cost', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-no-seed-'));
  const statePath = path.join(dir, 'keepalive.json');
  let stored = null;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    processIncarnationId: 'process_test_current',
  });
  await keepalive.init();
  await keepalive.bindConversation({ url: conversationUrl, tab_id: 'tab_keep' });
  // No fs cleanup: node:test on this runner flags trailing fs.rm async
  // activity as a post-test uncaughtException (see rollover-tab-leak-reclaim
  // tests — they deliberately leave their mkdtemp dirs behind).

  const types = [];
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({
      tabs: [{ tab_id: 'tab_keep', url: conversationUrl, selected: false }],
      fleet: { agents: [] },
    }),
    executeCommand: async (command) => {
      if (command.action === 'CAPTURE') return frameFor(conversationUrl);
      if (command.action === 'SEMANTIC_TYPE') {
        types.push(String(command.payload?.text || ''));
        return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, authority_effect: true, replace_verified: true };
      }
      if (command.action === 'READ_TRANSCRIPT') return { text: 'wake marker present' };
      return {};
    },
    canActuate: () => true,
    statePath,
    monitorMs: 10 * 60 * 1000,
  });
  await runtime.start();
  await runtime.cycle({ force: true });

  assert.equal(types.length, 1, 'a conversation surface types the wake directly');
  assert.ok(types[0].includes('METAENGINE_SUPERVISOR_WAKE_V1'), 'and it is the wake, not a seed');
});
