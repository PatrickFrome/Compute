import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatGptSessionMonitor } from '../src/chatgpt-session-monitor.mjs';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function keepaliveHarness() {
  let stored = null;
  let now = Date.parse('2026-08-30T13:00:00.000Z');
  let seq = 0;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    minWakeIntervalMs: 30_000,
  });
  return { keepalive, state: () => structuredClone(stored), advance: (ms) => { now += ms; } };
}

function idleFrame(text = '') {
  return {
    tab_id: 'tab1',
    process_incarnation_id: 'process-test-1',
    target_id: 'webcontents:1',
    url: CONVERSATION,
    title: 'ChatGPT',
    text_excerpt: text,
    viewport: { width: 1280, height: 720 },
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Send' },
    ],
  };
}

function generatingFrame(text = '') {
  return {
    ...idleFrame(text),
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Stop generating' },
    ],
  };
}

test('tab rebind cannot launder an ambiguous pending wake into WAITING', async () => {
  const h = keepaliveHarness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: CONVERSATION, tab_id: 'tab_old' });
  await h.keepalive.enqueueWake('WORKER_LOST', { agent_id: 'agent_a' });
  const prepared = await h.keepalive.prepareNextWake();
  const oldWakeId = prepared.pending.wake_id;
  await h.keepalive.markWakeAmbiguous(oldWakeId, 'SEND_WITHOUT_POSITIVE_READBACK');

  await h.keepalive.rebindTab('tab_replaced');
  assert.equal(h.keepalive.snapshot().state, 'WAKE_AMBIGUOUS');
  assert.equal(h.keepalive.snapshot().pending_wake.wake_id, oldWakeId);
  assert.equal(h.keepalive.canWake(), false);

  await h.keepalive.retireAmbiguousAfterTerminal({
    tab_id: 'tab_replaced',
    generation_epoch: 7,
    reason: 'TEST_TERMINAL_BOUNDARY',
  });
  const retired = h.keepalive.snapshot();
  assert.equal(retired.pending_wake, null);
  assert.equal(retired.queued_wakes.length, 0, 'old logical event must be consumed, not replayed');
  assert.equal(retired.ambiguous_history.length, 1);
  assert.equal(retired.ambiguous_history[0].wake_id, oldWakeId);
  assert.equal(retired.ambiguous_history[0].automatic_retry_allowed, false);
  assert.equal(retired.ambiguous_history[0].terminal_generation_epoch, 7);

  await h.keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'successor' });
  const successor = await h.keepalive.prepareNextWake();
  assert.equal(successor.ok, true);
  assert.notEqual(successor.pending.wake_id, oldWakeId);
  assert.ok(successor.pending.cycle_seq > prepared.pending.cycle_seq);
});

test('restart with ambiguous wake and orphaned hard stall performs STOP-only then starts a fresh successor', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-hardening-'));
  const statePath = path.join(dir, 'keepalive.json');
  const oldWakeId = 'wake_00000000-0000-4000-8000-000000000099';
  const oldQueueKey = 'WORKER_LOST:agent_old';
  const nowIso = new Date().toISOString();
  await fs.writeFile(statePath, `${JSON.stringify({
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.2.1',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 5,
    state: 'WAKE_AMBIGUOUS',
    conversation_url: CONVERSATION,
    tab_id: 'tab1',
    paused: false,
    queued_wakes: [{ key: oldQueueKey, reason: 'WORKER_LOST', metadata: { agent_id: 'agent_old' }, queued_at: nowIso }],
    pending_wake: {
      wake_id: oldWakeId,
      reason: 'WORKER_LOST',
      queue_key: oldQueueKey,
      prepared_at: nowIso,
      ambiguous_at: nowIso,
      ambiguous_reason: 'SEND_WITHOUT_POSITIVE_READBACK',
      supervisor_epoch: 1,
      cycle_seq: 6,
    },
    active_wake: null,
    last_wake_at: null,
    last_wake_reason: null,
    last_completed_cycle_at: null,
    last_research_wake_at: nowIso,
    previous_worker_generation: {},
    rollover_reason: null,
    rollover_release_at: null,
    updated_at: nowIso,
    authority_effect: false,
  }, null, 2)}\n`, 'utf8');

  let monitorNow = Date.parse('2026-08-30T14:00:00.000Z');
  let isGenerating = true;
  let typed = '';
  const actions = [];
  const sessionMonitor = new ChatGptSessionMonitor({
    clock: () => monitorNow,
    softStallFloorMs: 30_000,
    hardStallFloorMs: 60_000,
    hardStallCeilingMs: 60_000,
    settleMs: 1500,
  });
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    actions.push(command.action);
    if (command.action === 'CAPTURE') return isGenerating ? generatingFrame(typed) : idleFrame(typed);
    if (command.action === 'STOP_GENERATION') { isGenerating = false; return { ok: true, authority_effect: true }; }
    if (command.action === 'SELECT_TAB') return { ok: true, authority_effect: true };
    if (command.action === 'SEMANTIC_TYPE') { typed = String(command.payload?.text || ''); return { ok: true, authority_effect: true }; }
    if (command.action === 'TYPED_CLICK') { isGenerating = true; return { ok: true, authority_effect: true }; }
    throw new Error(`unexpected_action:${command.action}`);
  };

  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
    sessionMonitor,
  });

  await runtime.start();
  assert.equal(runtime.snapshot().active_request, null, 'ambiguous wake must not be restored as a confirmed active request');

  monitorNow += 61_000;
  await runtime.cycle({ force: true });
  assert.equal(actions.filter((action) => action === 'STOP_GENERATION').length, 1);
  assert.equal(isGenerating, false);
  assert.equal(runtime.snapshot().last_recovery?.action, 'STOP_ORPHANED_GENERATION');
  assert.equal(runtime.snapshot().last_recovery?.automatic_retry_allowed, false);

  monitorNow += 2_000;
  await runtime.cycle({ force: true });
  monitorNow += 2_000;
  await runtime.cycle({ force: true });

  const snap = runtime.snapshot();
  assert.equal(actions.filter((action) => action === 'STOP_GENERATION').length, 1, 'orphaned generation must never receive a blind second STOP');
  assert.equal(snap.keepalive.pending_wake, null);
  assert.equal(snap.keepalive.ambiguous_history.length, 1);
  assert.equal(snap.keepalive.ambiguous_history[0].wake_id, oldWakeId);
  assert.equal(snap.keepalive.ambiguous_history[0].automatic_retry_allowed, false);
  assert.ok(snap.active_request, 'terminal boundary must release a fresh successor wake');
  assert.notEqual(snap.active_request.wake_id, oldWakeId);
  assert.ok(snap.keepalive.active_wake.cycle_seq > 6);
  assert.match(typed, /METAENGINE_SUPERVISOR_WAKE_V1/);
  assert.doesNotMatch(typed, new RegExp(oldWakeId));
  assert.doesNotMatch(typed, /METAENGINE_SAME_WAKE_RETRY_V1/);
  assert.equal(isGenerating, true, 'fresh successor must have positive generating proof');

  await fs.rm(dir, { recursive: true, force: true });
});
