import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatGptSessionMonitor } from '../src/chatgpt-session-monitor.mjs';

function frame({ text = '', buttons = [], url = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } = {}) {
  return {
    url,
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      ...buttons.map((name) => ({ role: 'button', name })),
    ],
  };
}

function harness() {
  let now = Date.parse('2026-08-29T14:30:00Z');
  const monitor = new ChatGptSessionMonitor({
    clock: () => now,
    settleMs: 3000,
    softStallFloorMs: 30_000,
    hardStallFloorMs: 60_000,
    hardStallCeilingMs: 10 * 60_000,
    maxRecoveryAttempts: 3,
  });
  return { monitor, advance(ms) { now += ms; } };
}

test('generation must settle before worker is terminal-ready', () => {
  const h = harness();
  let row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'start', buttons: ['Stop generating'] }) });
  assert.equal(row.state, 'GENERATING');
  assert.equal(row.terminal_ready, false);

  h.advance(1000);
  row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'partial answer' }) });
  assert.equal(row.state, 'SETTLING');
  assert.equal(row.terminal_ready, false);

  h.advance(3100);
  row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'partial answer' }) });
  assert.equal(row.state, 'IDLE');
  assert.equal(row.terminal_ready, true);
});

test('current Russian Stop response label is generation authority', () => {
  const h = harness();
  const row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'думаю', buttons: ['Остановить ответ'] }) });
  assert.equal(row.controls.stop, 1);
  assert.equal(row.state, 'GENERATING');
  assert.equal(row.terminal_ready, false);
});

test('content progress resets stall timer and adaptive hard stall stops before replay', () => {
  const h = harness();
  h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'a', buttons: ['Stop generating'] }) });
  h.advance(45_000);
  let row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'a more', buttons: ['Stop generating'] }) });
  assert.equal(row.hard_stall, false);
  assert.equal(row.progress_age_ms, 0);
  assert.equal(row.last_progress_source, 'DOM');

  h.advance(61_000);
  row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'a more', buttons: ['Stop generating'] }) });
  assert.equal(row.state, 'STALLED');
  assert.equal(row.hard_stall, true);
  assert.equal(row.adaptive_hard_ms, 60_000);
  assert.equal(h.monitor.nextRecovery('tab1').action, 'STOP_GENERATION');
});

test('positive network liveness resets the adaptive stall timer without persisting network content', () => {
  const h = harness();
  h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'a', buttons: ['Stop generating'] }) });
  h.advance(61_000);
  let row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'a', buttons: ['Stop generating'] }), network_active: true });
  assert.equal(row.state, 'GENERATING');
  assert.equal(row.progress_age_ms, 0);
  assert.equal(row.last_progress_source, 'NETWORK');
  assert.equal(row.network_active, true);
});

test('unique Continue generating is continuation, never a prompt replay', () => {
  const h = harness();
  h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'partial', buttons: ['Stop generating'] }) });
  h.advance(5000);
  const row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'partial', buttons: ['Continue generating'] }) });
  assert.equal(row.state, 'INTERRUPTED');
  const recovery = h.monitor.nextRecovery('tab1');
  assert.deepEqual(recovery, { action: 'CONTINUE_GENERATION', reason: 'UNIQUE_CONTINUATION_CONTROL', authority_effect: false });
  h.monitor.markRecovery('tab1', recovery.action);
  assert.notEqual(h.monitor.nextRecovery('tab1').action, 'CONTINUE_GENERATION');
});

test('retry/regenerate controls never become automatic recovery authority', () => {
  const h = harness();
  const row = h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'error', buttons: ['Regenerate'] }) });
  assert.equal(row.controls.retry, 1);
  assert.equal(h.monitor.nextRecovery('tab1').action, 'NONE');
});

test('renderer loss escalates immediately — navigation-class auto-reload is forbidden (P0 repair)', () => {
  const h = harness();
  h.monitor.observe({ tab_id: 'tab1', frame: frame(), physical_health: 'RENDERER_GONE' });
  const recovery = h.monitor.nextRecovery('tab1');
  // v1.3.0: RELOAD_SAME_CONVERSATION is dismantled. A reload on an
  // auth-redirected or logged-out surface re-enters the redirect and
  // multiplies login tabs (2026-09-17 incident). Physical breakage
  // escalates; semantic refs are recovered by the bounded Runtime.enable
  // re-seed, never by navigation.
  assert.equal(recovery.action, 'ESCALATE');
  assert.equal(recovery.reason, 'RELOAD_FORBIDDEN_BROKEN');
  h.monitor.observe({ tab_id: 'tab1', frame: frame(), physical_health: 'LOAD_FAILED' });
  const recovery2 = h.monitor.nextRecovery('tab1');
  assert.equal(recovery2.action, 'ESCALATE');
  assert.equal(recovery2.reason, 'RELOAD_FORBIDDEN_BROKEN');
  // markRecovery no longer arms any reload epoch — the field stays null.
  h.monitor.markRecovery('tab1', 'STOP_GENERATION');
  assert.equal(h.monitor.get('tab1').reload_attempted_epoch, null);
});

test('monitor snapshots never persist response text', () => {
  const h = harness();
  h.monitor.observe({ tab_id: 'tab1', frame: frame({ text: 'SECRET RESPONSE BODY', buttons: ['Stop generating'] }) });
  const serialized = JSON.stringify(h.monitor.snapshot());
  assert.doesNotMatch(serialized, /SECRET RESPONSE BODY/);
  assert.match(serialized, /last_digest/);
  assert.match(serialized, /persisted_response_text/);
});
