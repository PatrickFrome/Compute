import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmSelfUpdateRestartSafety } from '../src/self-update-restart-safety.mjs';

function liveState(overrides = {}) {
  return {
    tabs: [
      { tab_id: 'supervisor', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      { tab_id: 'current-user-chat', url: 'https://chatgpt.com/c/bbbbbbbb-cccc-dddd-eeee-ffffffffffff' },
    ],
    downloads: { active: null },
    network: { tabs: [{ tab_id: 'current-user-chat', inflight_tracked: 4 }] },
    ...overrides,
  };
}

test('active ChatGPT generation and streaming network do not block self-update handoff', async () => {
  const safe = await confirmSelfUpdateRestartSafety({ getState: async () => liveState() });
  assert.equal(safe, true);
});

test('supervisor wake backlog and active model request are continuity state, not restart blockers', async () => {
  const safe = await confirmSelfUpdateRestartSafety({
    getState: async () => liveState(),
    lifecycleSnapshot: {
      supervisor_generation: 'GENERATING',
      active_request: { wake_id: 'wake_live' },
      keepalive: { state: 'WAKE_AMBIGUOUS', queued_wakes: [{ reason: 'WORKER_LOST' }] },
    },
  });
  assert.equal(safe, true);
});

test('local verified-download mutation still blocks installer handoff', async () => {
  for (const activeState of ['ARMED', 'DOWNLOADING']) {
    assert.equal(await confirmSelfUpdateRestartSafety({
      getState: async () => liveState({ downloads: { active: { request_id: 'd1', state: activeState } } }),
    }), false, activeState);
  }
});

test('state-read failure fails closed', async () => {
  assert.equal(await confirmSelfUpdateRestartSafety({
    getState: async () => { throw new Error('state_unavailable'); },
  }), false);
});
