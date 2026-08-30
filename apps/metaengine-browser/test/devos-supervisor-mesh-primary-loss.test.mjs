import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorMeshRuntime } from '../src/supervisor-mesh-runtime.mjs';

const A = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const B = 'https://chatgpt.com/c/bbbbbbbb-1111-2222-3333-444444444444';

test('lost primary permits standby recovery event without replaying a prior delivery', async () => {
  const commands = [];
  let generating = false;
  const runtime = new SupervisorMeshRuntime({
    getState: async () => ({ tabs: [{ tab_id: 'tabB', url: B, selected: true }], fleet: { agents: [] } }),
    executeCommand: async (command) => {
      commands.push(command);
      if (command.action === 'CAPTURE') return {
        url: B,
        text_excerpt: '',
        semantic_targets: generating
          ? [{ role: 'textbox', name: 'Message ChatGPT' }, { role: 'button', name: 'Stop generating' }]
          : [{ role: 'textbox', name: 'Message ChatGPT' }, { role: 'button', name: 'Send' }],
      };
      if (command.action === 'SEMANTIC_TYPE') return { ok: true };
      if (command.action === 'TYPED_CLICK') { generating = true; return { ok: true }; }
      throw new Error(`unexpected:${command.action}`);
    },
    canActuate: () => true,
    primaryLifecycle: () => ({ keepalive: { state: 'WAITING', conversation_url: A, supervisor_epoch: 2 } }),
    statePath: `${process.cwd()}/.tmp-mesh-primary-loss-${process.pid}.json`,
    uuid: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`; })(),
  });
  await runtime.start();
  const result = await runtime.dispatchRecoveryIfNeeded();
  assert.equal(result.ok, true);
  assert.ok(commands.some((row) => row.action === 'SEMANTIC_TYPE' && /PRIMARY_SUPERVISOR_UNAVAILABLE/.test(row.payload.text)));
});
