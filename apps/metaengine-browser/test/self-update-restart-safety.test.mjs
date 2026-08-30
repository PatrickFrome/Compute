import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmSelfUpdateRestartSafety } from '../src/self-update-restart-safety.mjs';

const idleFrame = () => ({
  url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  semantic_targets: [
    { role: 'textbox', name: 'Чат с ChatGPT' },
    { role: 'button', name: 'Отправить' },
  ],
});

function liveLikeLifecycle(overrides = {}) {
  return {
    schema: 'metaengine.supervisor-lifecycle-runtime.v2',
    supervisor_generation: 'IDLE',
    active_request: null,
    last_recovery: null,
    worker_signals: [
      { agent_id: 'a1', generation_state: 'TERMINAL' },
      { agent_id: 'a2', generation_state: 'TERMINAL' },
    ],
    quiescent: false,
    keepalive: {
      state: 'WAKE_AMBIGUOUS',
      pending_wake: {
        wake_id: 'wake_persisted',
        ambiguous_reason: 'SEND_WITHOUT_POSITIVE_READBACK',
      },
      queued_wakes: [
        { key: 'WORKER_LOST:a1', reason: 'WORKER_LOST' },
        { key: 'RESEARCH_ACCELERATOR_DUE:epoch-1', reason: 'RESEARCH_ACCELERATOR_DUE' },
      ],
    },
    ...overrides,
  };
}

function liveState(overrides = {}) {
  return {
    tabs: [
      { tab_id: 'supervisor', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      { tab_id: 'current-user-chat', url: 'https://chatgpt.com/c/bbbbbbbb-cccc-dddd-eeee-ffffffffffff' },
      { tab_id: 'docs', url: 'https://example.com/' },
    ],
    downloads: { state: 'IDLE' },
    network: { tabs: [] },
    ...overrides,
  };
}

test('durable ambiguous and queued wakes do not starve a physically idle restart', async () => {
  const captured = [];
  const safe = await confirmSelfUpdateRestartSafety({
    getState: async () => liveState(),
    lifecycleSnapshot: () => liveLikeLifecycle(),
    captureTab: async (tabId) => { captured.push(tabId); return idleFrame(); },
  });
  assert.equal(safe, true);
  assert.deepEqual(captured.sort(), ['current-user-chat', 'supervisor']);
});

test('fresh ChatGPT generation blocks restart even when lifecycle backlog is durable', async () => {
  const safe = await confirmSelfUpdateRestartSafety({
    getState: async () => liveState(),
    lifecycleSnapshot: liveLikeLifecycle(),
    captureTab: async (tabId) => tabId === 'current-user-chat'
      ? { ...idleFrame(), semantic_targets: [{ role: 'button', name: 'Остановить ответ' }] }
      : idleFrame(),
  });
  assert.equal(safe, false);
});

test('network activity, active request, ambiguous recovery and unknown worker fail closed', async () => {
  const common = { captureTab: async () => idleFrame() };
  assert.equal(await confirmSelfUpdateRestartSafety({
    ...common,
    getState: async () => liveState({ network: { tabs: [{ tab_id: 'supervisor', inflight_tracked: 1 }] } }),
    lifecycleSnapshot: liveLikeLifecycle(),
  }), false);
  assert.equal(await confirmSelfUpdateRestartSafety({
    ...common,
    getState: async () => liveState(),
    lifecycleSnapshot: liveLikeLifecycle({ active_request: { wake_id: 'wake_live' } }),
  }), false);
  assert.equal(await confirmSelfUpdateRestartSafety({
    ...common,
    getState: async () => liveState(),
    lifecycleSnapshot: liveLikeLifecycle({ last_recovery: { ambiguous: true } }),
  }), false);
  assert.equal(await confirmSelfUpdateRestartSafety({
    ...common,
    getState: async () => liveState(),
    lifecycleSnapshot: liveLikeLifecycle({ worker_signals: [{ agent_id: 'a1', generation_state: 'UNKNOWN' }] }),
  }), false);
});

test('busy verified-download activity and capture failure block restart', async () => {
  assert.equal(await confirmSelfUpdateRestartSafety({
    getState: async () => liveState({ downloads: { state: 'DOWNLOADING' } }),
    lifecycleSnapshot: liveLikeLifecycle(),
    captureTab: async () => idleFrame(),
  }), false);
  assert.equal(await confirmSelfUpdateRestartSafety({
    getState: async () => liveState(),
    lifecycleSnapshot: liveLikeLifecycle(),
    captureTab: async () => { throw new Error('capture_failed'); },
  }), false);
});
