import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateActiveWakeTerminalRetirement } from '../src/supervisor-terminal-retirement.mjs';

const activeWake = {
  wake_id: 'wake_66af3fcf-849c-4d7f-b7e9-7b7f60ddcae2',
  reason: 'WORKER_LOST',
  confirmed_at: '2026-08-31T14:33:23.772Z',
};
const terminal = { state: 'IDLE', terminal_ready: true, generation_epoch: 5 };

function evaluate(overrides = {}) {
  return evaluateActiveWakeTerminalRetirement({
    active_request: {
      wake_id: activeWake.wake_id,
      tab_id: 'tab_old',
      restored_from_durable_keepalive: false,
      ...(overrides.active_request || {}),
    },
    active_wake: { ...activeWake, ...(overrides.active_wake || {}) },
    terminal_row: { ...terminal, ...(overrides.terminal_row || {}) },
    previous_state: overrides.previous_state ?? 'IDLE',
    observed_tab_id: overrides.observed_tab_id ?? 'tab_new',
    keepalive_tab_id: overrides.keepalive_tab_id ?? 'tab_new',
    now_ms: overrides.now_ms ?? Date.parse('2026-08-31T15:05:00Z'),
    orphan_grace_ms: 30_000,
  });
}

test('normal generating-to-terminal transition retires the exact active wake', () => {
  const result = evaluate({ previous_state: 'GENERATING', observed_tab_id: 'tab_old', keepalive_tab_id: 'tab_old' });
  assert.equal(result.retire, true);
  assert.equal(result.reason, 'GENERATION_TO_TERMINAL');
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('restored durable active wake may retire from an already-idle exact terminal readback', () => {
  const result = evaluate({
    active_request: { tab_id: 'tab_new', restored_from_durable_keepalive: true },
    previous_state: 'IDLE',
  });
  assert.equal(result.retire, true);
  assert.equal(result.reason, 'RESTORED_ACTIVE_WAKE_TERMINAL');
});

test('stale request tab may retire only after exact rebind and grace period', () => {
  const result = evaluate();
  assert.equal(result.retire, true);
  assert.equal(result.reason, 'REBIND_ORPHAN_TERMINAL');

  const early = evaluate({ now_ms: Date.parse('2026-08-31T14:33:30Z') });
  assert.equal(early.retire, false);
  assert.equal(early.reason, 'REBIND_GRACE_NOT_ELAPSED');
});

test('just-sent request cannot be retired merely because the first observation is idle', () => {
  const result = evaluate({
    active_request: { tab_id: 'tab_new', restored_from_durable_keepalive: false },
    previous_state: 'IDLE',
  });
  assert.equal(result.retire, false);
  assert.equal(result.reason, 'JUST_SENT_IDLE_RACE');
});

test('wake, current tab and terminal generation bindings fail closed', () => {
  assert.equal(evaluate({ active_request: { wake_id: 'wake_other' } }).retire, false);
  assert.equal(evaluate({ keepalive_tab_id: 'tab_other' }).retire, false);
  assert.equal(evaluate({ terminal_row: { terminal_ready: false } }).retire, false);
  assert.equal(evaluate({ terminal_row: { generation_epoch: -1 } }).retire, false);
});
