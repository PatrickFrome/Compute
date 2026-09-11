import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatGptServiceThrottleGate,
  chatGptServiceAvailableReadback,
  classifyChatGptServiceThrottle,
} from '../src/chatgpt-service-throttle.mjs';
import {
  createSupervisorSendBoundaryExecutor,
  SupervisorLifecycleRuntime,
} from '../src/supervisor-lifecycle-runtime.mjs';

function nativeFrame({
  text = '',
  buttons = [],
  textbox = true,
  tabId = 'tab_rate_limit',
  url = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
} = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    captured_at: '2026-09-02T20:10:00.000Z',
    process_incarnation_id: 'process-1',
    target_id: 'webcontents:42',
    tab_id: tabId,
    url,
    title: 'ChatGPT',
    semantic_targets: [
      ...(textbox ? [{ role: 'textbox', name: 'Message ChatGPT' }] : []),
      ...buttons.map((name) => ({ role: 'button', name })),
    ],
    text_excerpt: text,
    viewport: { width: 800, height: 600, page_x: 0, page_y: 0, scale: 1 },
    authority_effect: false,
  };
}

const russianThrottle = () => nativeFrame({
  textbox: false,
  buttons: ['Понятно'],
  text: 'Слишком много запросов\nВы отправляете запросы слишком часто. Доступ к вашим диалогам временно ограничен в целях защиты данных.\nПодождите несколько минут и повторите попытку.\nПонятно',
});

const englishThrottle = () => nativeFrame({
  textbox: false,
  buttons: ['Got it'],
  text: 'Too many requests\nYou are sending requests too frequently. Access is temporarily limited. Please wait a few minutes and try again.\nGot it',
});

test('exact Russian and English service throttle dialogs are recognized without persisting text', () => {
  for (const frame of [russianThrottle(), englishThrottle()]) {
    const result = classifyChatGptServiceThrottle(frame);
    assert.equal(result?.state, 'THROTTLED');
    assert.equal(result?.reason, 'CHATGPT_RATE_LIMIT_DIALOG');
    assert.equal(result?.automatic_retry_allowed, false);
    assert.equal(result?.authority_effect, false);
    assert.doesNotMatch(JSON.stringify(result), /Слишком много запросов|Too many requests/);
  }
});

test('conversation text quoting rate-limit language does not become throttle authority while normal composer is present', () => {
  const quoted = nativeFrame({
    textbox: true,
    text: 'Документируй ошибку: “Слишком много запросов”. Доступ к вашим диалогам временно ограничен — это пример текста.',
  });
  assert.equal(classifyChatGptServiceThrottle(quoted), null);
  assert.equal(chatGptServiceAvailableReadback(quoted), true);
});

test('throttle gate stays closed until a clean ChatGPT composer readback proves service availability', () => {
  let now = Date.parse('2026-09-02T20:10:00.000Z');
  const gate = new ChatGptServiceThrottleGate({ clock: () => now });
  gate.observe('tab_rate_limit', russianThrottle());
  assert.equal(gate.active(), true);
  const held = gate.snapshot();
  assert.equal(held.state, 'THROTTLED');
  assert.equal(held.source_tab_id, 'tab_rate_limit');
  assert.equal(held.automatic_retry_allowed, false);

  now += 60_000;
  gate.observe('tab_other', nativeFrame({ textbox: false, text: 'loading' }));
  assert.equal(gate.active(), true, 'non-throttle unknown surface is not positive recovery evidence');

  gate.observe('tab_other', nativeFrame({ textbox: true, text: 'Ready' }));
  assert.equal(gate.active(), false);
  assert.equal(gate.snapshot().state, 'AVAILABLE');
});

test('supervisor send boundary suppresses service actuation while throttle is observed and reopens on clean readback', async () => {
  const gate = new ChatGptServiceThrottleGate();
  const calls = [];
  let captured = russianThrottle();
  const rawExecute = async (command) => {
    calls.push(command.action);
    if (command.action === 'CAPTURE') return captured;
    return { ok: true, action: command.action };
  };
  const guarded = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [{ tab_id: 'tab_rate_limit', selected: true }] }),
    executeCommand: rawExecute,
    throttleGate: gate,
  });

  await guarded({ action: 'CAPTURE', payload: { tab_id: 'tab_rate_limit' } });
  assert.equal(gate.active(), true);
  const typeHeld = await guarded({ action: 'SEMANTIC_TYPE', payload: { tab_id: 'tab_rate_limit', text: 'do not send' } });
  const newTabHeld = await guarded({ action: 'NEW_TAB', payload: { url: 'https://chatgpt.com/' } });
  assert.equal(typeHeld.suppressed, true);
  assert.equal(typeHeld.reason, 'CHATGPT_SERVICE_THROTTLED');
  assert.equal(newTabHeld.suppressed, true);
  assert.deepEqual(calls, ['CAPTURE'], 'throttled service actions never cross the native executor boundary');

  captured = nativeFrame({ textbox: true, text: 'Ready' });
  await guarded({ action: 'CAPTURE', payload: { tab_id: 'tab_rate_limit' } });
  assert.equal(gate.active(), false);
  const typeAllowed = await guarded({ action: 'SEMANTIC_TYPE', payload: { tab_id: 'tab_rate_limit', text: 'safe after readback' } });
  assert.equal(typeAllowed.ok, true);
  assert.deepEqual(calls, ['CAPTURE', 'CAPTURE', 'SEMANTIC_TYPE']);
});

test('lifecycle actuation authority closes while throttle gate is active', () => {
  const gate = new ChatGptServiceThrottleGate();
  gate.observe('tab_rate_limit', russianThrottle());
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: [] }),
    executeCommand: async () => null,
    canActuate: () => true,
    serviceThrottleGate: gate,
  });
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.actuation_enabled, false);
  assert.equal(snapshot.service_throttle.state, 'THROTTLED');
  assert.equal(snapshot.continuous_service.service_throttle_backpressure, 'UI_READBACK_GATE_V1');
});
