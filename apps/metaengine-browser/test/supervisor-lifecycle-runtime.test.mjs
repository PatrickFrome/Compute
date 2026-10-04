import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';
import { ChatGptSessionMonitor } from '../src/chatgpt-session-monitor.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const COMPOSER_REF = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'e'.repeat(64) };
const STOP_REF = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'f'.repeat(64) };

function chatgptFrame(text = '', { generating = false, draft = '' } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: 'tab1',
    target_id: 'webcontents:1',
    process_incarnation_id: 'process_test_incarnation_0001',
    state_revision_id: 'rev_' + 'a'.repeat(64),
    url: CONVERSATION,
    title: 'ChatGPT',
    text_excerpt: text,
    viewport: { width: 1200, height: 700 },
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT', semantic_ref: COMPOSER_REF, backend_node_id: 3, value_length: draft.length, value_sha256: crypto.createHash('sha256').update(draft).digest('hex') },
      ...(generating ? [{ role: 'button', name: 'Stop generating', semantic_ref: STOP_REF, backend_node_id: 4 }] : []),
      ...(!generating ? [{ role: 'button', name: 'Send', semantic_ref: 'send' }] : []),
    ],
    authority_effect: false,
  };
}

test('trusted supervisor wake uses ChatGPT semantic submit and adaptive hard stall issues one bounded stop', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-chatgpt-'));
  const statePath = path.join(dir, 'keepalive.json');
  let monitorNow = Date.parse('2026-10-04T05:00:00Z');
  let typed = '';
  let draft = '';
  let digestSeq = 0;
  let frozen = false;
  let generating = false;
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
    if (command.action === 'CAPTURE') return chatgptFrame(frozen ? typed : `${typed}#chunk${digestSeq++}`, { generating, draft });
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.platform, 'CHATGPT');
      assert.equal(command.payload.submit_after_type, false);
      typed = String(command.payload?.text || '');
      draft = typed;
      assert.equal(generating, false, 'typing cannot start inference');
      return { replace_verified: true, authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') {
      assert.equal(command.payload.chatgpt_submit, true);
      assert.equal(command.payload.prompt_length, draft.length);
      draft = '';
      generating = true;
      return {
        effect_state: 'PROVEN_GENERATING',
        composer_cleared: true,
        new_conversation_observed: false,
        stop_observed: true,
        automatic_retry_allowed: false,
        authority_effect: true,
      };
    }
    if (command.action === 'STOP_GENERATION') {
      generating = false;
      return { action: 'STOP_GENERATION', authority_effect: true };
    }
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
  assert.match(typed, /METAENGINE_SUPERVISOR_WAKE_V1/);
  assert.equal(actions.filter((row) => row === 'SEMANTIC_TYPE').length, 1);
  assert.equal(actions.filter((row) => row === 'TYPED_CLICK').length, 1);
  assert.equal(runtime.snapshot().active_request?.same_chat_retry_attempt, 0);

  frozen = true;
  monitorNow += 20_000;
  await runtime.cycle({ force: true });
  monitorNow += 61_000;
  await runtime.cycle({ force: true });

  const snap = runtime.snapshot();
  assert.equal(actions.filter((row) => row === 'STOP_GENERATION').length, 1, 'exact ChatGPT stop control permits one bounded recovery effect');
  assert.equal(
    snap.supervisor_session.tabs[0].stop_attempted_epoch + 1,
    snap.supervisor_session.tabs[0].generation_epoch,
    'the bounded STOP belongs to the predecessor generation; continuous service may already have started the successor',
  );
  assert.equal(JSON.stringify(snap).includes(typed), false, 'trusted prompt body must not be persisted in lifecycle snapshot');

  await fs.rm(dir, { recursive: true, force: true });
});

test('ChatGPT session generation follows STOP/readback and settles terminal-ready after generation ends', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-chatgpt-settle-'));
  const statePath = path.join(dir, 'keepalive.json');
  let monitorNow = Date.parse('2026-10-04T05:00:00Z');
  let typed = '';
  let draft = '';
  let generating = false;
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return chatgptFrame(typed, { generating, draft });
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type, false);
      typed = String(command.payload?.text || '');
      draft = typed;
      assert.equal(generating, false);
      return { replace_verified: true, authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') {
      assert.equal(command.payload.chatgpt_submit, true);
      draft = '';
      generating = true;
      return {
        effect_state: 'PROVEN_GENERATING',
        composer_cleared: true,
        new_conversation_observed: false,
        stop_observed: true,
        automatic_retry_allowed: false,
        authority_effect: true,
      };
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
    sessionMonitor: new ChatGptSessionMonitor({ clock: () => monitorNow, settleMs: 1500 }),
  });

  await runtime.start();
  await runtime.cycle({ force: true });
  let snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'GENERATING');
  assert.equal(snap.quiescent, false);
  assert.equal(snap.supervisor_session.tabs[0].controls.stop, 1);

  generating = false;
  monitorNow += 500;
  await runtime.cycle({ force: true });
  snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'SETTLING');

  monitorNow += 2000;
  await runtime.cycle({ force: true });
  snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'IDLE', 'terminal readback was observed before the next autonomous wake');
  assert.equal(snap.supervisor_session.tabs[0].terminal_ready, false, 'continuous service immediately starts the successor generation');
  assert.equal(snap.supervisor_session.tabs[0].generation_epoch, 2);

  await fs.rm(dir, { recursive: true, force: true });
});

test('supervisor wake uses one ChatGPT semantic submit and trusts its event-driven generation proof', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-submit-latch-'));
  const statePath = path.join(dir, 'keepalive.json');
  const commands = [];
  let draft = '';
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    commands.push(structuredClone(command));
    if (command.action === 'CAPTURE') return chatgptFrame('', { draft });
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.platform, 'CHATGPT');
      assert.equal(command.payload.submit_after_type, false);
      draft = command.payload.text;
      return { replace_verified: true, authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') {
      assert.equal(command.payload.chatgpt_submit, true);
      draft = '';
      return {
        effect_state: 'PROVEN_GENERATING',
        composer_cleared: true,
        new_conversation_observed: false,
        stop_observed: true,
        automatic_retry_allowed: false,
        authority_effect: true,
      };
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
  assert.equal(commands.filter((row) => row.action === 'SEMANTIC_TYPE').length, 1);
  assert.equal(commands.filter((row) => row.action === 'TYPED_CLICK').length, 1);
  const typeIndex = commands.findIndex((row) => row.action === 'SEMANTIC_TYPE');
  const sendIndex = commands.findIndex((row) => row.action === 'TYPED_CLICK');
  assert.ok(commands.slice(typeIndex + 1, sendIndex).some((row) => row.action === 'CAPTURE'), 'Send follows a fresh draft readback');
  assert.equal(runtime.snapshot().keepalive.state, 'ACTIVE');
  assert.equal(runtime.snapshot().keepalive.ambiguous_history.length, 0);
  assert.equal(runtime.snapshot().continuous_service.wake_send_transport, 'TYPE_FRESH_DRAFT_READBACK_SINGLE_SEND');

  await fs.rm(dir, { recursive: true, force: true });
});

test('process restart fences predecessor wake and backlog before emitting one fresh ChatGPT lifecycle wake', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-active-retire-'));
  const statePath = path.join(dir, 'keepalive.json');
  const oldWake = 'wake_66af3fcf-849c-4d7f-b7e9-7b7f60ddcae2';
  const predecessorProcess = 'process_predecessor_20260831';
  const url = CONVERSATION;
  await fs.writeFile(statePath, JSON.stringify({
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.4.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 13,
    state: 'ACTIVE',
    conversation_url: url,
    tab_id: 'tab_old',
    paused: false,
    process_incarnation_id: predecessorProcess,
    process_incarnation_started_at: '2026-08-31T14:00:00Z',
    queued_wakes: [{
      key: 'CONTINUE_DEVELOPMENT:recovery',
      reason: 'CONTINUE_DEVELOPMENT',
      metadata: { key: 'recovery' },
      queued_at: '2026-08-31T14:40:00Z',
      process_incarnation_id: predecessorProcess,
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
      process_incarnation_id: predecessorProcess,
      origin_process_incarnation_id: predecessorProcess,
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

  let typed = '';
  let draft = '';
  let submitCount = 0;
  const getState = async () => ({
    tabs: [{ tab_id: 'tab_new', url, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return { ...chatgptFrame(typed, { draft }), tab_id: 'tab_new' };
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type, false);
      typed = String(command.payload?.text || '');
      draft = typed;
      return { replace_verified: true, authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') {
      assert.equal(command.payload.chatgpt_submit, true);
      submitCount += 1;
      draft = '';
      return {
        effect_state: 'PROVEN_GENERATING',
        composer_cleared: true,
        new_conversation_observed: false,
        stop_observed: true,
        automatic_retry_allowed: false,
        authority_effect: true,
      };
    }
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
  assert.equal(submitCount, 1, 'only one fresh current-process wake may be emitted');
  assert.notEqual(snap.keepalive.active_wake?.wake_id, oldWake);
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.tab_id, 'tab_new');
  assert.equal(snap.active_request?.restored_from_durable_keepalive, false);
  assert.equal(snap.keepalive.predecessor_process_incarnation_id, predecessorProcess);
  assert.equal(snap.keepalive.predecessor_queued_wake_count, 1);
  assert.equal(snap.keepalive.predecessor_wake_history?.[0]?.wake_id, oldWake);
  assert.equal(snap.keepalive.predecessor_wake_history?.[0]?.automatic_retry_allowed, false);
  assert.match(typed, /METAENGINE_SUPERVISOR_WAKE_V1/);
  assert.match(typed, /reason=(?:RESEARCH_ACCELERATOR_DUE|CONTINUE_DEVELOPMENT)/);
  assert.doesNotMatch(typed, new RegExp(oldWake));

  await fs.rm(dir, { recursive: true, force: true });
});
