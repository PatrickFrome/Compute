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

function generatingFrame(text = '') {
  return {
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Stop generating' },
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
