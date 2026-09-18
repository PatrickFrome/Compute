import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentSessionMonitor } from '../src/agent-session-monitor.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

const CONVERSATION = 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const COMPOSER_REF = { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'e'.repeat(64) };

function glmFrame(text = '') {
  // GLM surface: placeholder-named (or unnamed) composer addressed by its
  // semantic_ref; no named Send/Stop controls exist on chat.z.ai.
  return {
    url: CONVERSATION,
    title: 'Z.ai',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: COMPOSER_REF, backend_node_id: 3 },
    ],
  };
}

test('trusted supervisor wake submits via Enter and an adaptive hard stall escalates without a stop effect', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-'));
  const statePath = path.join(dir, 'keepalive.json');
  let monitorNow = Date.parse('2026-09-19T15:00:00Z');
  let typed = '';
  let digestSeq = 0;
  let frozen = false;
  const actions = [];
  const sessionMonitor = new AgentSessionMonitor({
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
    if (command.action === 'CAPTURE') return glmFrame(frozen ? typed : `${typed}#chunk${digestSeq++}`);
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.platform, 'GLM_ZAI');
      assert.equal(command.payload.submit_after_type, true);
      typed = String(command.payload?.text || '');
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') throw new Error('no named control click exists on the GLM platform');
    if (command.action === 'STOP_GENERATION') throw new Error('GLM stop requires an exact semantic-ref button and is never auto-dispatched');
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
  assert.equal(actions.includes('TYPED_CLICK'), false);
  assert.equal(runtime.snapshot().active_request?.same_chat_retry_attempt, 0);

  // Advance past the adaptive hard-stall floor with a frozen digest: the GLM
  // session monitor escalates instead of dispatching a stop effect. The first
  // frozen cycle absorbs the churn-to-quiet digest transition; the second one
  // crosses the hard-stall floor with a proven-quiet surface.
  frozen = true;
  monitorNow += 20_000;
  await runtime.cycle({ force: true });
  monitorNow += 61_000;
  await runtime.cycle({ force: true });

  const snap = runtime.snapshot();
  assert.equal(actions.includes('STOP_GENERATION'), false, 'chat.z.ai exposes no addressable stop control — a stall must escalate, never auto-stop');
  assert.equal(snap.supervisor_generation, 'STALLED');
  assert.equal(JSON.stringify(snap).includes(typed), false, 'trusted prompt body must not be persisted in lifecycle snapshot');

  await fs.rm(dir, { recursive: true, force: true });
});

test('GLM session generation runs on digest churn and settles terminal-ready', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-glm-digest-'));
  const statePath = path.join(dir, 'keepalive.json');
  let monitorNow = Date.parse('2026-09-19T15:00:00Z');
  let typed = '';
  let digestSeq = 0;
  let frozen = false;
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return glmFrame(frozen ? typed : `${typed}#chunk${digestSeq++}`);
    if (command.action === 'SEMANTIC_TYPE') {
      typed = String(command.payload?.text || '');
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
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
    sessionMonitor: new AgentSessionMonitor({ clock: () => monitorNow, settleMs: 1500 }),
  });
  await runtime.start();
  await runtime.cycle({ force: true });
  let snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'GENERATING');
  assert.equal(snap.quiescent, false);
  assert.equal(snap.supervisor_session.tabs[0].controls.stop, 0, 'no named control signals exist on the GLM platform');

  monitorNow += 2000;
  await runtime.cycle({ force: true });
  snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'GENERATING', 'digest churn keeps the generation active');

  frozen = true;
  monitorNow += 2000;
  await runtime.cycle({ force: true });
  monitorNow += 4000;
  await runtime.cycle({ force: true });
  snap = runtime.snapshot();
  assert.equal(snap.supervisor_generation, 'IDLE', 'a quiet settle window flips the session terminal-ready');
  await fs.rm(dir, { recursive: true, force: true });
});

test('supervisor wake uses one semantic submit and trusts its event-driven generation proof', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-submit-latch-'));
  const statePath = path.join(dir, 'keepalive.json');
  const commands = [];
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: CONVERSATION, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    commands.push(structuredClone(command));
    if (command.action === 'CAPTURE') return glmFrame();
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.platform, 'GLM_ZAI');
      assert.equal(command.payload.submit_after_type, true);
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') throw new Error('second send effect must not be dispatched');
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
  assert.equal(commands.some((row) => row.action === 'TYPED_CLICK'), false);
  assert.equal(runtime.snapshot().keepalive.state, 'ACTIVE');
  assert.equal(runtime.snapshot().keepalive.ambiguous_history.length, 0);
  assert.equal(runtime.snapshot().continuous_service.wake_send_transport, 'SEMANTIC_TYPE_SUBMIT_EVENT_LATCH_V1');

  await fs.rm(dir, { recursive: true, force: true });
});

test('process restart fences predecessor wake and backlog before emitting one fresh lifecycle wake', async () => {
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
  let submitCount = 0;
  const getState = async () => ({
    tabs: [{ tab_id: 'tab_new', url, selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return glmFrame(typed);
    if (command.action === 'SEMANTIC_TYPE') {
      submitCount += 1;
      typed = String(command.payload?.text || '');
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
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
