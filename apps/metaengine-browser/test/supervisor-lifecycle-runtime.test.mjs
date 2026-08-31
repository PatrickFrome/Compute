import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatGptSessionMonitor } from '../src/chatgpt-session-monitor.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

function idleFrame(text = '') {
  return {
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Send' },
    ],
  };
}

function generatingFrame(text = '', stopLabel = 'Stop generating') {
  return {
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: stopLabel },
    ],
  };
}

test('trusted supervisor wake stops and retries same conversation after adaptive stall', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-'));
  const statePath = path.join(dir, 'keepalive.json');
  let monitorNow = Date.parse('2026-08-29T15:00:00Z');
  let isGenerating = false;
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
    tabs: [{ tab_id: 'tab1', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    actions.push(command.action);
    if (command.action === 'CAPTURE') return isGenerating ? generatingFrame(typed) : idleFrame(typed);
    if (command.action === 'SEMANTIC_TYPE') { typed = String(command.payload?.text || ''); return { ok: true, authority_effect: true }; }
    if (command.action === 'TYPED_CLICK') { isGenerating = true; return { ok: true, authority_effect: true }; }
    if (command.action === 'STOP_GENERATION') { isGenerating = false; return { ok: true, authority_effect: true }; }
    throw new Error(`unexpected_action:${command.action}`);
  };

  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 5000,
    researchMs: 5 * 60 * 1000,
    sessionMonitor,
  });

  await runtime.start();
  assert.equal(isGenerating, true);
  assert.match(typed, /METAENGINE_SUPERVISOR_WAKE_V1/);
  assert.equal(runtime.snapshot().active_request?.same_chat_retry_attempt, 0);

  await runtime.cycle({ force: true });
  monitorNow += 61_000;
  await runtime.cycle({ force: true });

  const snap = runtime.snapshot();
  assert.ok(actions.includes('STOP_GENERATION'));
  assert.equal(isGenerating, true);
  assert.match(typed, /METAENGINE_SAME_WAKE_RETRY_V1/);
  assert.match(typed, /Never repeat an observed or ambiguous effect/);
  assert.equal(snap.active_request?.same_chat_retry_attempt, 1);
  assert.equal(snap.last_recovery?.action, 'STOP_AND_RETRY_SAME_CONVERSATION');
  assert.equal(snap.last_recovery?.confirmed, true);
  assert.equal(JSON.stringify(snap).includes(typed), false, 'trusted prompt body must not be persisted in lifecycle snapshot');

  await fs.rm(dir, { recursive: true, force: true });
});

test('lifecycle recognizes current Russian stop-response control as active generation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-ru-'));
  const statePath = path.join(dir, 'keepalive.json');
  let typed = '';
  let isGenerating = false;
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return isGenerating ? generatingFrame(typed, 'Остановить ответ') : idleFrame(typed);
    if (command.action === 'SEMANTIC_TYPE') { typed = String(command.payload?.text || ''); return { ok: true, authority_effect: true }; }
    if (command.action === 'TYPED_CLICK') { isGenerating = true; return { ok: true, authority_effect: true }; }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({ getState, executeCommand, canActuate: () => true, statePath, monitorMs: 5000, researchMs: 5 * 60 * 1000 });
  await runtime.start();
  await runtime.cycle({ force: true });
  const snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'GENERATING');
  assert.equal(snap.quiescent, false);
  assert.equal(snap.supervisor_session.tabs[0].controls.stop, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test('restored durable active wake at terminal rebind retires and emits a fresh successor in the same cycle', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-active-retire-'));
  const statePath = path.join(dir, 'keepalive.json');
  const oldWake = 'wake_66af3fcf-849c-4d7f-b7e9-7b7f60ddcae2';
  const url = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  await fs.writeFile(statePath, JSON.stringify({
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.3.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 13,
    state: 'ACTIVE',
    conversation_url: url,
    tab_id: 'tab_old',
    paused: false,
    queued_wakes: [{
      key: 'CONTINUE_DEVELOPMENT:recovery',
      reason: 'CONTINUE_DEVELOPMENT',
      metadata: { key: 'recovery' },
      queued_at: '2026-08-31T14:40:00Z',
    }],
    pending_wake: null,
    active_wake: {
      wake_id: oldWake,
      reason: 'WORKER_LOST',
      queue_key: 'WORKER_LOST:fleet-terminal-burst',
      prepared_at: '2026-08-31T14:32:37Z',
      confirmed_at: '2026-08-31T14:33:23Z',
      supervisor_epoch: 1,
      cycle_seq: 13,
    },
    ambiguous_history: [],
    last_wake_at: '2026-08-31T14:33:23Z',
    last_wake_reason: 'WORKER_LOST',
    last_completed_cycle_at: '2026-08-31T14:32:37Z',
    last_research_wake_at: '2026-08-31T14:09:26Z',
    previous_worker_generation: {},
    rollover_reason: null,
    rollover_release_at: null,
    updated_at: '2026-08-31T14:52:01Z',
    authority_effect: false,
  }), 'utf8');

  let generating = false;
  let typed = '';
  const getState = async () => ({
    tabs: [{ tab_id: 'tab_new', url, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return generating ? generatingFrame(typed) : idleFrame(typed);
    if (command.action === 'SEMANTIC_TYPE') { typed = String(command.payload?.text || ''); return { ok: true, authority_effect: true }; }
    if (command.action === 'TYPED_CLICK') { generating = true; return { ok: true, authority_effect: true }; }
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

  const snap = runtime.snapshot();
  assert.equal(generating, true, 'fresh successor must be sent after terminal retirement');
  assert.notEqual(snap.keepalive.active_wake?.wake_id, oldWake);
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.tab_id, 'tab_new');
  assert.equal(snap.active_request?.restored_from_durable_keepalive, false);
  assert.match(typed, /reason=CONTINUE_DEVELOPMENT/);
  assert.doesNotMatch(typed, new RegExp(oldWake));

  await fs.rm(dir, { recursive: true, force: true });
});
