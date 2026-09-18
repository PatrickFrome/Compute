import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

function harness() {
  let stored = null;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => Date.parse('2026-08-29T16:45:00.000Z'),
    uuid: () => '00000000-0000-4000-8000-000000000001',
    minWakeIntervalMs: 30000,
  });
  return { keepalive, state: () => structuredClone(stored) };
}

test('simultaneous fleet loss is coalesced into one supervisor wake', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tab_id: 'supervisor' });

  const lost = Array.from({ length: 6 }, (_, i) => ({
    agent_id: `agent_${i + 1}`,
    lifecycle_state: 'LOST',
    generation_state: 'TERMINAL',
  }));
  await h.keepalive.observeWorkers(lost);

  const queued = h.state().queued_wakes;
  assert.equal(queued.length, 1, 'one restart-wide loss incident must not produce one prompt per worker');
  assert.equal(queued[0].reason, 'WORKER_LOST');
  assert.deepEqual(queued[0].metadata.agent_ids, lost.map((row) => row.agent_id));
});
