import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileRestoredGeneratingChats } from '../src/self-update-chat-reconcile.mjs';

const frame = (buttons = []) => ({ semantic_targets: buttons.map((name) => ({ role: 'button', name })) });

test('already resumed generation is observed without duplicate actuation', async () => {
  let clicked = false;
  const result = await reconcileRestoredGeneratingChats({
    bindings: [{ tab_id: 'tab_a', generation_state: 'GENERATING' }],
    captureTab: async () => frame(['Остановить ответ']),
    clickControl: async () => { clicked = true; },
  });
  assert.equal(result.tabs[0].state, 'GENERATION_CONTINUED');
  assert.equal(clicked, false);
  assert.equal(result.authority_effect, false);
});

test('interrupted generating chat clicks exact Continue once and requires readback', async () => {
  let captures = 0;
  const clicks = [];
  const result = await reconcileRestoredGeneratingChats({
    bindings: [{ tab_id: 'tab_a', generation_state: 'GENERATING' }],
    captureTab: async () => {
      captures += 1;
      return captures === 1 ? frame(['Продолжить создание']) : frame(['Остановить ответ']);
    },
    clickControl: async (tabId, name) => { clicks.push({ tabId, name }); },
  });
  assert.deepEqual(clicks, [{ tabId: 'tab_a', name: 'Продолжить создание' }]);
  assert.equal(result.tabs[0].state, 'CONTINUE_CONFIRMED');
  assert.equal(result.authority_effect, true);
});

test('terminal chat and unknown capture do not trigger blind retry', async () => {
  let clicks = 0;
  const terminal = await reconcileRestoredGeneratingChats({
    bindings: [{ tab_id: 'tab_a', generation_state: 'GENERATING' }],
    captureTab: async () => frame(['Retry']),
    clickControl: async () => { clicks += 1; },
  });
  assert.equal(terminal.tabs[0].state, 'TERMINAL_OR_IDLE');
  assert.equal(clicks, 0);

  const failed = await reconcileRestoredGeneratingChats({
    bindings: [{ tab_id: 'tab_b', generation_state: 'GENERATING' }],
    captureTab: async () => { throw new Error('capture unavailable'); },
    clickControl: async () => { clicks += 1; },
  });
  assert.equal(failed.tabs[0].state, 'CAPTURE_FAILED');
  assert.equal(clicks, 0);
});
