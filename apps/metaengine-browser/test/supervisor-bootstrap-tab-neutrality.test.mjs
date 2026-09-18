import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

// P0 (2026-09-17) intra-process amplifier, closed by this contract file.
//
// The live host reached tab_capacity_exceeded through TWO NEW_TAB leak vectors
// while the user session was logged out:
//   (a) every supervisor bootstrap retry created a fresh dedicated-root tab,
//       the auth redirect made #waitForBootstrapRoot fail (BOOTSTRAP_ROOT_NOT_READY)
//       and the failed-attempt tab was never closed -> one leaked tab per
//       maintenance tick;
//   (b) once a conversation was bound, #supervisorTab recreated the bound
//       conversation tab on every tick after the original redirected to
//       /auth/login.
//
// Contracts proven here:
//   1. failed bootstrap pre-effects close their own tab (tab-neutral retry);
//   2. a wedged CLOSE_TAB is retried before the next attempt (bounded ledger);
//   3. a tab the user has selected is never closed (claim respected);
//   4. the bound-conversation path reuses the auth-redirect tab as observation
//      target instead of creating one tab per tick;
//   5. a successful bootstrap clears the stale supervisor_bootstrap* error.

const AUTH_URL = 'https://chatgpt.com/auth/login';
const ROOT_URL = 'https://chat.z.ai/';
const CONV_URL = 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function authFrame() {
  return { url: AUTH_URL, title: 'Начать работу | ChatGPT', text_excerpt: 'Log in', semantic_targets: [] };
}
function rootFrame() {
  return {
    url: ROOT_URL,
    title: 'ChatGPT',
    text_excerpt: '',
    semantic_targets: [{ role: 'textbox', name: 'Message ChatGPT' }],
  };
}
function convFrame() {
  return {
    url: CONV_URL,
    title: 'ChatGPT',
    text_excerpt: '',
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + '1'.repeat(64) }, backend_node_id: 3 },
      { role: 'button', name: 'Stop generating' },
    ],
  };
}

async function writeDurableState(statePath, overrides = {}) {
  const base = {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 1,
    state: 'RECOVERING',
    conversation_url: null,
    tab_id: null,
    paused: false,
    process_incarnation_id: 'process_predecessor_neutrality',
    process_incarnation_started_at: '2026-09-17T14:00:00Z',
    queued_wakes: [],
    pending_wake: null,
    active_wake: null,
    ambiguous_history: [],
    last_wake_at: null,
    last_wake_reason: null,
    last_completed_cycle_at: null,
    last_research_wake_at: null,
    previous_worker_generation: {},
    rollover_reason: null,
    rollover_release_at: null,
    updated_at: '2026-09-17T14:52:35Z',
    authority_effect: false,
    ...overrides,
  };
  await fs.writeFile(statePath, JSON.stringify(base), 'utf8');
}

function makeRegistry() {
  const tabs = [];
  let seq = 0;
  return {
    tabs,
    create(url, { selected = false } = {}) {
      seq += 1;
      const tab = { tab_id: `tab_boot_${seq}`, url, selected };
      tabs.push(tab);
      return { ...tab };
    },
    close(id) {
      const index = tabs.findIndex((t) => t.tab_id === id);
      if (index === -1) throw new Error('tab_not_found');
      tabs.splice(index, 1);
      return { ok: true };
    },
    setUrl(id, url) {
      const tab = tabs.find((t) => t.tab_id === id);
      if (tab) tab.url = url;
    },
  };
}

test('failed bootstrap pre-effects close their own tab: repeated attempts leave zero tabs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-neutral-'));
  const statePath = path.join(dir, 'keepalive.json');
  await writeDurableState(statePath);
  const reg = makeRegistry();
  const counts = { NEW_TAB: 0, CLOSE_TAB: 0 };
  const getState = async () => ({ tabs: reg.tabs.map((t) => ({ ...t })), fleet: { agents: [] } });
  const executeCommand = async (command) => {
    if (command.action === 'NEW_TAB') { counts.NEW_TAB += 1; return reg.create(AUTH_URL); }
    if (command.action === 'CLOSE_TAB') { counts.CLOSE_TAB += 1; return reg.close(String(command.payload?.tab_id || '')); }
    if (command.action === 'CAPTURE') return authFrame();
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
  });

  await runtime.start();
  await runtime.cycle({ force: true });
  await runtime.cycle({ force: true });

  const snap = runtime.snapshot();
  assert.ok(counts.NEW_TAB >= 3, `expected repeated bootstrap attempts, saw ${counts.NEW_TAB}`);
  assert.equal(counts.CLOSE_TAB, counts.NEW_TAB, 'every failed attempt must close exactly the tab it created');
  assert.equal(reg.tabs.length, 0, 'no failed-attempt tab may survive (tab-neutral retry)');
  assert.match(String(snap.last_error || ''), /BOOTSTRAP_ROOT_NOT_READY/);
  assert.equal(snap.keepalive.state, 'RECOVERING');

  await fs.rm(dir, { recursive: true, force: true });
});

test('a wedged CLOSE_TAB is retried before the next bootstrap attempt (bounded ledger)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-ledger-'));
  const statePath = path.join(dir, 'keepalive.json');
  await writeDurableState(statePath);
  const reg = makeRegistry();
  const counts = { NEW_TAB: 0, CLOSE_TAB: 0 };
  const failCloseOnce = new Set(['tab_boot_1']);
  const getState = async () => ({ tabs: reg.tabs.map((t) => ({ ...t })), fleet: { agents: [] } });
  const executeCommand = async (command) => {
    if (command.action === 'NEW_TAB') { counts.NEW_TAB += 1; return reg.create(AUTH_URL); }
    if (command.action === 'CLOSE_TAB') {
      counts.CLOSE_TAB += 1;
      const id = String(command.payload?.tab_id || '');
      if (failCloseOnce.has(id)) { failCloseOnce.delete(id); throw new Error('command_plane_wedge'); }
      return reg.close(id);
    }
    if (command.action === 'CAPTURE') return authFrame();
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
  });

  await runtime.start();
  assert.equal(reg.tabs.length, 1, 'the wedged close leaves exactly one leaked tab for now');
  await runtime.cycle({ force: true });

  assert.equal(counts.NEW_TAB, 2);
  assert.equal(counts.CLOSE_TAB, 3, 'one wedged close + ledger retry + current attempt close');
  assert.equal(reg.tabs.length, 0, 'ledger sweep must reclaim the leaked tab before any new tab is created');
  assert.equal(failCloseOnce.size, 0);

  await fs.rm(dir, { recursive: true, force: true });
});

test('a tab the user has selected is never closed by bootstrap cleanup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-claimed-'));
  const statePath = path.join(dir, 'keepalive.json');
  await writeDurableState(statePath);
  const reg = makeRegistry();
  const counts = { NEW_TAB: 0, CLOSE_TAB: 0 };
  const getState = async () => ({ tabs: reg.tabs.map((t) => ({ ...t })), fleet: { agents: [] } });
  const executeCommand = async (command) => {
    if (command.action === 'NEW_TAB') {
      counts.NEW_TAB += 1;
      // Simulate the user grabbing the very first failed-attempt tab.
      return reg.create(AUTH_URL, { selected: counts.NEW_TAB === 1 });
    }
    if (command.action === 'CLOSE_TAB') { counts.CLOSE_TAB += 1; return reg.close(String(command.payload?.tab_id || '')); }
    if (command.action === 'CAPTURE') return authFrame();
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
  });

  await runtime.start();
  await runtime.cycle({ force: true });

  const claimed = reg.tabs.find((t) => t.tab_id === 'tab_boot_1');
  assert.ok(claimed, 'the user-claimed tab must survive');
  assert.equal(claimed.selected, true);
  assert.equal(reg.tabs.length, 1, 'exactly one bounded, user-owned tab remains');
  assert.equal(counts.CLOSE_TAB, counts.NEW_TAB - 1, 'only the unclaimed attempts are closed');

  await fs.rm(dir, { recursive: true, force: true });
});

test('bound-conversation path reuses an auth-redirect tab instead of creating one per tick', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-authreuse-'));
  const statePath = path.join(dir, 'keepalive.json');
  await writeDurableState(statePath, {
    state: 'ACTIVE',
    conversation_url: CONV_URL,
    tab_id: 'tab_dead',
    last_wake_at: '2026-09-17T14:30:00Z',
    last_wake_reason: 'WORKER_LOST',
    last_completed_cycle_at: '2026-09-17T14:29:00Z',
    last_research_wake_at: new Date().toISOString(),
  });
  const reg = makeRegistry();
  reg.tabs.push({ tab_id: 'tab_auth', url: AUTH_URL, selected: false });
  const getState = async () => ({ tabs: reg.tabs.map((t) => ({ ...t })), fleet: { agents: [] } });
  const executeCommand = async (command) => {
    if (command.action === 'NEW_TAB') throw new Error('NEW_TAB must not be called on an auth-redirect surface');
    if (command.action === 'CAPTURE') {
      const tab = reg.tabs.find((t) => t.tab_id === String(command.payload?.tab_id || ''));
      return tab && tab.url === AUTH_URL ? authFrame() : convFrame();
    }
    if (command.action === 'CLOSE_TAB') throw new Error('CLOSE_TAB must not be called here');
    if (command.action === 'SEMANTIC_TYPE') throw new Error('no wake may be sent while the session is logged out');
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 60 * 60 * 1000,
  });

  await runtime.start();
  let snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'NOT_AGENT_PLATFORM_CONVERSATION', 'the auth tab becomes the observation target');
  assert.equal(snap.keepalive.conversation_url, CONV_URL, 'the durable conversation binding is preserved');
  assert.equal(reg.tabs.length, 1);

  await runtime.cycle({ force: true });
  snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'NOT_AGENT_PLATFORM_CONVERSATION');
  assert.equal(reg.tabs.length, 1, 'repeated ticks must not add tabs');

  await fs.rm(dir, { recursive: true, force: true });
});

test('successful bootstrap clears the stale supervisor_bootstrap pre-effect error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-bootstrap-staleerr-'));
  const statePath = path.join(dir, 'keepalive.json');
  await writeDurableState(statePath);
  const reg = makeRegistry();
  let sessionLive = false;
  const getState = async () => ({ tabs: reg.tabs.map((t) => ({ ...t })), fleet: { agents: [] } });
  const executeCommand = async (command) => {
    if (command.action === 'NEW_TAB') return reg.create(sessionLive ? ROOT_URL : AUTH_URL);
    if (command.action === 'CLOSE_TAB') return reg.close(String(command.payload?.tab_id || ''));
    if (command.action === 'CAPTURE') {
      const tab = reg.tabs.find((t) => t.tab_id === String(command.payload?.tab_id || ''));
      const url = tab?.url || '';
      if (url === AUTH_URL) return authFrame();
      if (url === ROOT_URL) return rootFrame();
      return convFrame();
    }
    if (command.action === 'SEMANTIC_TYPE') {
      reg.setUrl(String(command.payload?.tab_id || ''), CONV_URL);
      return { effect_state: 'PROVEN_GENERATING', event_driven_readback: true, authority_effect: true };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
  });

  await runtime.start();
  let snap = runtime.snapshot();
  assert.match(String(snap.last_error || ''), /BOOTSTRAP_ROOT_NOT_READY/);
  assert.equal(reg.tabs.length, 0, 'logged-out attempt closed its tab');

  sessionLive = true; // the user signs back in
  await runtime.cycle({ force: true });

  snap = runtime.snapshot();
  assert.equal(snap.last_error, null, 'stale supervisor_bootstrap* error must not survive a successful bind');
  assert.equal(snap.last_recovery?.action, 'SUPERVISOR_BOOTSTRAP_BOUND');
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.conversation_url, CONV_URL);

  await fs.rm(dir, { recursive: true, force: true });
});
