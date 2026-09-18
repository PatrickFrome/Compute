import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatGptServiceThrottleGate } from '../src/chatgpt-service-throttle.mjs';
import { createSupervisorSendBoundaryExecutor } from '../src/supervisor-lifecycle-runtime.mjs';

function throttledFrame() {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: 'tab1',
    process_incarnation_id: 'process-1',
    target_id: 'webcontents:1',
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    semantic_targets: [{ role: 'button', name: 'Понятно' }],
    text_excerpt: 'Слишком много запросов. Доступ к вашим диалогам временно ограничен. Подождите несколько минут и повторите попытку.',
    viewport: { width: 800, height: 600 },
    authority_effect: false,
  };
}

test('service throttle preserves CAPTURE and local SELECT_TAB while blocking network/page actuation', async () => {
  const gate = new ChatGptServiceThrottleGate();
  const calls = [];
  const executeCommand = async (command) => {
    calls.push(command.action);
    if (command.action === 'CAPTURE') return throttledFrame();
    return { ok: true };
  };
  const guarded = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [{ tab_id: 'tab1', selected: true }] }),
    executeCommand,
    throttleGate: gate,
  });

  await guarded({ action: 'CAPTURE', payload: { tab_id: 'tab1' } });
  assert.equal(gate.active(), true);
  const selected = await guarded({ action: 'SELECT_TAB', payload: { tab_id: 'tab1' } });
  const blocked = await guarded({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/' } });

  assert.equal(selected.ok, true);
  assert.equal(blocked.suppressed, true);
  assert.equal(blocked.reason, 'CHATGPT_SERVICE_THROTTLED');
  assert.deepEqual(calls, ['CAPTURE', 'SELECT_TAB']);
});
