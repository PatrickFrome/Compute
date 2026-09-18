import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

function limitFrame() {
  return {
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'ChatGPT',
    text_excerpt: 'Maximum conversation length reached. Start a new chat.',
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Send' },
    ],
  };
}

test('conversation limit never auto-creates a replacement supervisor before explicit release', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-single-supervisor-'));
  const statePath = path.join(dir, 'keepalive.json');
  const actions = [];

  const runtime = new SupervisorLifecycleRuntime({
    statePath,
    monitorMs: 5000,
    researchMs: 5 * 60 * 1000,
    canActuate: () => true,
    getState: async () => ({
      tabs: [{
        tab_id: 'current-supervisor',
        url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        selected: true,
      }],
      fleet: { agents: [] },
    }),
    executeCommand: async (command) => {
      actions.push(structuredClone(command));
      if (command.action === 'CAPTURE') return limitFrame();
      if (command.action === 'NEW_TAB') throw new Error('replacement_supervisor_must_not_be_created');
      throw new Error(`unexpected_action:${command.action}`);
    },
  });

  await runtime.start();
  await runtime.cycle({ force: true });

  const snapshot = runtime.snapshot();
  assert.equal(snapshot.keepalive?.state, 'ROLLOVER_DEFERRED');
  assert.equal(snapshot.keepalive?.conversation_url, 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(actions.some((row) => row.action === 'NEW_TAB'), false);
  assert.equal(snapshot.actuation_enabled, true);

  await fs.rm(dir, { recursive: true, force: true });
});
