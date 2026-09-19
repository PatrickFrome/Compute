import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

// D-C7 (live 2026-09-19): every failed #rollover() used to leak its NEW_TAB at
// the preconversation root forever. Combined with the D-C5 fresh-tab
// re-request this hit the 32-tab registry wall (live: total_at_wall=true,
// capacity_backpressure TAB_CAPACITY_EXCEEDED_PRE_EFFECT, keepalive frozen at
// a fixed cycle_seq). The repair: a leaked-rollover-tab ledger with
// close-by-proof reclaim — root-only, never selected/fleet/keepalive tabs,
// never conversation tabs (a drifted conversation may hold a landed send;
// reconciliation owns it). Failed closes stay in the ledger and are retried
// BEFORE the next rollover opens a new tab, so the retry loop is tab-neutral.

const conversationUrl = 'https://chat.z.ai/c/0799499c-9ead-4a7e-8edc-be365222c4d4';
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

function frameFor(url, { composer = true } = {}) {
  return {
    url,
    text_excerpt: 'supervisor transcript excerpt',
    viewport: { width: 1200, height: 800 },
    semantic_targets: composer
      ? [{ role: 'textbox', name: 'Ask anything', semantic_ref: 'sr-1', value_length: 0 }]
      : [{ role: 'textbox', name: 'Search', semantic_ref: 'sr-search' }, { role: 'textbox', name: 'Ask anything', semantic_ref: 'sr-2', value_length: 0 }],
  };
}

// Harness: the keepalive's conversation tab exists; rollover attempts open
// fresh root tabs whose FIRST capture shows a hydrating multi-textbox surface
// (the D-C7 composer-wait motivation). `closeAttemptsBeforeSuccess` wedges the
// first N CLOSE_TAB commands (the retry-ledger path); the send effect is
// configurable per test.
function makeHarness(statePath, { sendEffect = 'AMBIGUOUS', closeAttemptsBeforeSuccess = 0 } = {}) {
  const calls = [];
  let newTabs = 0;
  let closeAttempts = 0;
  const closed = [];
  let registry = [
    { tab_id: 'tab_keep', url: conversationUrl, selected: false },
    { tab_id: 'tab_fleet', url: ROOT, selected: false },
  ];
  const captureCounts = new Map();
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({
      fleet: { agents: [{ tab_id: 'tab_fleet', agent_id: 'agent_x', lifecycle_state: 'ACTIVE' }] },
      tabs: registry,
    }),
    executeCommand: async (command) => {
      calls.push({ action: command.action, tab: command.payload?.tab_id || '' });
      if (command.action === 'NEW_TAB') {
        newTabs += 1;
        const id = `tab_new_${newTabs}`;
        registry.push({ tab_id: id, url: ROOT, selected: false });
        return { tab_id: id };
      }
      if (command.action === 'CLOSE_TAB') {
        closeAttempts += 1;
        if (closeAttempts <= closeAttemptsBeforeSuccess) throw new Error('native_supervisor_close_wedged');
        const id = String(command.payload?.tab_id || '');
        if (!registry.some((t) => t.tab_id === id)) throw new Error('native_supervisor_exact_target_tab_unavailable');
        registry = registry.filter((t) => t.tab_id !== id);
        closed.push(id);
        return { closed: id };
      }
      if (command.action === 'CAPTURE') {
        const id = String(command.payload?.tab_id || '');
        const n = (captureCounts.get(id) || 0) + 1;
        captureCounts.set(id, n);
        const row = registry.find((t) => t.tab_id === id);
        // Fresh root tabs hydrate: ambiguous multi-textbox surface on the
        // first capture, settled unique composer afterwards.
        const settled = n >= 2;
        return frameFor(row?.url || ROOT, { composer: settled || row?.url !== ROOT });
      }
      if (command.action === 'SEMANTIC_TYPE') {
        // The native lane's post-submit result carries the surface it landed
        // on: a proven new conversation exposes the conversation URL and a
        // STOP control (generating); an ambiguous send exposes neither.
        if (sendEffect === 'PROVEN_NEW_CONVERSATION') {
          const id = String(command.payload?.tab_id || '');
          const row = registry.find((t) => t.tab_id === id);
          if (row) row.url = 'https://chat.z.ai/c/newconv-rolled-1234';
          return {
            effect_state: sendEffect,
            suppressed: false,
            url: 'https://chat.z.ai/c/newconv-rolled-1234',
            text_excerpt: 'rolled over',
            semantic_targets: [{ role: 'button', name: 'Stop' }, { role: 'textbox', name: 'Ask anything', semantic_ref: 'sr-next', value_length: 0 }],
          };
        }
        return { effect_state: sendEffect, suppressed: false };
      }
      return {};
    },
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
  });
  return {
    runtime, calls,
    get closed() { return closed; },
    get registry() { return registry; },
    get newTabs() { return newTabs; },
  };
}

// start() runs its own cycle (the first rollover attempt); the forced cycle
// then exercises the post-failure machinery (scan no-progress + drain).
async function drive(h) {
  await h.runtime.start().catch(() => {});
  await h.runtime.cycle({ force: true });
}

test('D-C7: a failed rollover leak is reclaimed by proof — the retry loop is tab-neutral', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-leak-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  const h = makeHarness(statePath, { sendEffect: 'AMBIGUOUS' });

  await drive(h);
  assert.equal(h.newTabs, 1, 'one rollover attempt opened one tab');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.state, 'ROLLOVER_AMBIGUOUS', 'the ambiguous send marked the attempt');
  assert.ok(h.closed.includes('tab_new_1'), 'the leaked tab is reclaimed by proof');
  assert.ok(!h.registry.some((t) => t.tab_id === 'tab_new_1'), 'the leak is gone from the registry');

  // A second rollover attempt stays tab-neutral: it opens its tab and the
  // failed attempt never accumulates.
  await h.runtime.cycle({ force: true });
  await h.runtime.cycle({ force: true });
  const leaked = h.registry.filter((t) => t.tab_id.startsWith('tab_new_'));
  assert.ok(leaked.length <= 1, `at most the in-flight attempt tab exists (found ${leaked.length})`);
  assert.ok(h.closed.length + leaked.length >= h.newTabs, 'every completed failed attempt was reclaimed');
});

test('D-C7: a wedged CLOSE_TAB stays in the ledger and is retried BEFORE the next rollover opens a tab', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-leak-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  // Every close stays wedged: the leak can only be retried, never cleared.
  const h = makeHarness(statePath, { sendEffect: 'AMBIGUOUS', closeAttemptsBeforeSuccess: 99 });

  await drive(h);
  assert.equal(h.newTabs, 1);
  assert.deepEqual(h.closed, [], 'the wedged close left the leak in the ledger');
  assert.ok(h.registry.some((t) => t.tab_id === 'tab_new_1'), 'the leaked tab still exists');

  // Burn enough cycles for the D-C5 no-progress escape (>= 8) so a fresh
  // rollover attempt runs after the re-request.
  for (let i = 0; i < 10; i += 1) {
    await h.runtime.cycle({ force: true });
  }
  assert.ok(h.newTabs >= 2, `a fresh rollover attempt ran (newTabs=${h.newTabs})`);

  // The contract: before the NEXT tab is opened, the leaked tab's reclaim is
  // attempted — a CLOSE_TAB for the leak must occur BETWEEN the two NEW_TABs.
  const newTabIdxs = h.calls.map((c) => c.action).reduce((acc, a, i) => (a === 'NEW_TAB' ? [...acc, i] : acc), []);
  const firstNewIdx = newTabIdxs[0];
  const secondNewIdx = newTabIdxs[1];
  const between = h.calls.slice(firstNewIdx + 1, secondNewIdx);
  assert.ok(
    between.some((c) => c.action === 'CLOSE_TAB' && c.tab === 'tab_new_1'),
    'the leaked tab reclaim is attempted BEFORE the next tab is created',
  );
});

test('D-C7: the composer wait rescues a hydrating fresh tab (no premature composer_not_unique leak)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-leak-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  const h = makeHarness(statePath, { sendEffect: 'PROVEN_NEW_CONVERSATION' });

  await drive(h);
  // The first capture is a multi-textbox hydrating surface; without the
  // composer wait the rollover would throw supervisor_composer_not_unique
  // and leak the tab. With it, the send is proven and the rollover binds.
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.ok(['WAITING', 'ACTIVE'].includes(state.state), `the rollover bound the new conversation (state=${state.state})`);
  assert.equal(state.conversation_url, 'https://chat.z.ai/c/newconv-rolled-1234', 'the keepalive bound the new conversation URL');
  assert.deepEqual(h.closed, [], 'no reclaim needed on the success path');
  assert.equal(h.newTabs, 1);
});

test('D-C7: a leaked tab that drifted to a conversation URL is NEVER closed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-leak-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  const h = makeHarness(statePath, { sendEffect: 'AMBIGUOUS', closeAttemptsBeforeSuccess: 99 });

  await drive(h);
  // The ambiguous send lands late: the wedged leaked tab drifts to a conversation.
  h.registry.find((t) => t.tab_id === 'tab_new_1').url = 'https://chat.z.ai/c/drifted-4242';
  for (let i = 0; i < 4; i += 1) {
    await h.runtime.cycle({ force: true });
  }

  assert.ok(!h.closed.includes('tab_new_1'), 'conversation tabs are reconciliation territory, never reclaimed');
  assert.ok(h.registry.some((t) => t.tab_id === 'tab_new_1'), 'the conversation tab survives');
});

test('D-C7: close-by-proof obligations — the selected tab, the fleet tab and the keepalive tab are never closed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-leak-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedKeepalive(statePath);
  const h = makeHarness(statePath, { sendEffect: 'AMBIGUOUS', closeAttemptsBeforeSuccess: 99 });

  await drive(h);
  // The user takes over the wedged leaked tab (selects it).
  h.registry.find((t) => t.tab_id === 'tab_new_1').selected = true;
  for (let i = 0; i < 4; i += 1) {
    await h.runtime.cycle({ force: true });
  }

  assert.ok(!h.closed.includes('tab_new_1'), 'a tab the user took over is never closed');
  assert.ok(!h.closed.includes('tab_fleet'), 'fleet-bound tabs are never closed');
  assert.ok(!h.closed.includes('tab_keep'), 'the keepalive tab is never closed');
  assert.ok(h.registry.some((t) => t.tab_id === 'tab_new_1'), 'the user-owned tab survives');
});
