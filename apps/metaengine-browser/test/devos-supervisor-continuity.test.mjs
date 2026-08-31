import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorKeepalive, buildSupervisorWakeMessage } from '../src/supervisor-keepalive.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

function keepaliveHarness() {
  let stored = null;
  let now = Date.parse('2026-08-30T10:30:00Z');
  let seq = 0;
  const make = () => new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    minWakeIntervalMs: 60_000,
    maxCyclesPerEpoch: 4,
  });
  return { make, state: () => structuredClone(stored), advance: (ms) => { now += ms; } };
}

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

function generatingFrame(text = '') {
  return {
    ...idleFrame(text),
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Stop generating' },
    ],
  };
}

test('CONTINUE_DEVELOPMENT bypasses ordinary wake throttle only after prior cycle is terminal', async () => {
  const h = keepaliveHarness();
  const keepalive = h.make();
  await keepalive.init();
  await keepalive.bindConversation({ url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tab_id: 'tab1' });
  await keepalive.enqueueWake('CI_TERMINAL', { key: 'first' });
  const first = await keepalive.prepareNextWake();
  await keepalive.confirmWakeSent(first.pending.wake_id);
  assert.equal(keepalive.canWake(), false, 'active wake must block a second effect');
  await keepalive.markCycleComplete();
  await keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'continuous' });
  const immediate = await keepalive.prepareNextWake();
  assert.equal(immediate.ok, true, 'continuous service must not wait for ordinary wake throttle');
  assert.equal(immediate.pending.reason, 'CONTINUE_DEVELOPMENT');
  assert.match(immediate.message, /Do not wait for user input/i);
});

test('confirmed active supervisor wake survives process restart and reconstructs its prompt deterministically', async () => {
  const h = keepaliveHarness();
  const first = h.make();
  await first.init();
  await first.bindConversation({ url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tab_id: 'tab1' });
  await first.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'boot' });
  const prepared = await first.prepareNextWake();
  await first.confirmWakeSent(prepared.pending.wake_id);

  const restored = h.make();
  await restored.init();
  const active = restored.activeWake();
  assert.equal(restored.snapshot().state, 'ACTIVE');
  assert.equal(active.wake_id, prepared.pending.wake_id);
  assert.equal(active.reason, 'CONTINUE_DEVELOPMENT');
  const message = buildSupervisorWakeMessage({
    supervisorEpoch: active.supervisor_epoch,
    cycleSeq: active.cycle_seq,
    wakeId: active.wake_id,
    reason: active.reason,
  });
  assert.match(message, new RegExp(active.wake_id));
  assert.match(message, /integration\/metaengine-development-os-v1/);
});

test('lifecycle automatically sends the next supervisor development cycle after terminal response', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-devos-continuity-'));
  const statePath = path.join(dir, 'keepalive.json');
  let isGenerating = false;
  let typed = '';
  let sendCount = 0;
  const sessionMonitor = {
    observe({ tab_id, frame }) {
      const active = frame.semantic_targets.some((x) => x.role === 'button' && /stop|остановить/i.test(x.name));
      return {
        tab_id,
        state: active ? 'GENERATING' : 'IDLE',
        terminal_ready: !active,
        generation_epoch: sendCount,
        controls: { continue: 0 },
        progress_age_ms: 0,
        adaptive_hard_ms: 60_000,
        network_active: false,
        external_progress: false,
      };
    },
    snapshot() { return { schema: 'test.session', tabs: [] }; },
    markRecovery() {},
  };
  const getState = async () => ({
    tabs: [{ tab_id: 'tab1', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selected: true }],
    fleet: { agents: [] },
  });
  const executeCommand = async (command) => {
    if (command.action === 'CAPTURE') return isGenerating ? generatingFrame(typed) : idleFrame(typed);
    if (command.action === 'SEMANTIC_TYPE') { typed = String(command.payload?.text || ''); return { ok: true, authority_effect: true }; }
    if (command.action === 'TYPED_CLICK') { sendCount += 1; isGenerating = true; return { ok: true, authority_effect: true }; }
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
  assert.equal(sendCount, 1, 'initial durable supervisor wake must start');
  assert.equal(isGenerating, true);
  await runtime.cycle({ force: true });
  isGenerating = false;
  await runtime.cycle({ force: true });
  assert.equal(sendCount, 2, 'terminal supervisor response must immediately trigger next cycle');
  assert.match(typed, /reason=CONTINUE_DEVELOPMENT/);
  assert.match(typed, /Do not wait for user input/i);
  assert.equal(runtime.snapshot().continuous_service.enabled, true);
  assert.equal(runtime.snapshot().continuous_service.terminal_requires_user_message, false);

  await fs.rm(dir, { recursive: true, force: true });
});

test('page text can only defer rollover; it cannot auto-authorize a replacement supervisor chat', async () => {
  const source = await fs.readFile(new URL('../src/supervisor-lifecycle-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /CHATGPT_CONVERSATION_LIMIT_HINT/);
  assert.match(source, /reason\.startsWith\('MAX_CYCLES_PER_EPOCH'\)/);
  assert.doesNotMatch(source, /reason\.startsWith\('CHATGPT_CONVERSATION_LIMIT_HINT'\)/);
});
