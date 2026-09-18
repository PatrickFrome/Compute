import assert from 'node:assert/strict';
import test from 'node:test';
import { prefetchFleetWorkerFrames } from '../src/supervisor-lifecycle-runtime.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('worker observation prefetch parallelizes reads within a bounded concurrency cap', async () => {
  const agents = [
    ...Array.from({ length: 6 }, (_, index) => ({
      agent_id: `agent-${index}`,
      tab_id: `tab-active-${index}`,
      lifecycle_state: 'BOUND_UNVERIFIED',
    })),
    { agent_id: 'agent-lost', tab_id: 'tab-lost', lifecycle_state: 'LOST' },
    { agent_id: 'agent-retired', tab_id: 'tab-retired', lifecycle_state: 'RETIRED' },
  ];
  let active = 0;
  let peak = 0;
  const calls = [];

  const result = await prefetchFleetWorkerFrames({
    state: { fleet: { agents } },
    concurrency: 3,
    executeCommand: async (command) => {
      assert.equal(command.action, 'CAPTURE');
      const tabId = String(command.payload.tab_id);
      calls.push(tabId);
      active += 1;
      peak = Math.max(peak, active);
      await sleep(15);
      active -= 1;
      return {
        schema: 'metaengine.native-browser.perception.v1',
        tab_id: tabId,
        semantic_targets: [],
        authority_effect: false,
      };
    },
  });

  assert.equal(result.candidate_count, 6);
  assert.equal(result.captured_count, 6);
  assert.equal(result.failed_count, 0);
  assert.equal(result.concurrency, 3);
  assert.equal(result.frames.size, 6);
  assert.equal(peak, 3);
  assert.equal(calls.includes('tab-lost'), false);
  assert.equal(calls.includes('tab-retired'), false);
  assert.equal(result.authority_effect, false);
});

test('worker observation prefetch isolates read failures and clamps concurrency', async () => {
  const agents = Array.from({ length: 4 }, (_, index) => ({
    agent_id: `agent-${index}`,
    tab_id: `tab-${index}`,
    lifecycle_state: 'ACTIVE',
  }));

  const result = await prefetchFleetWorkerFrames({
    state: { fleet: { agents } },
    concurrency: 99,
    executeCommand: async (command) => {
      const tabId = String(command.payload.tab_id);
      if (tabId === 'tab-2') throw new Error('capture_unavailable');
      return { schema: 'metaengine.native-browser.perception.v1', tab_id: tabId, semantic_targets: [] };
    },
  });

  assert.equal(result.candidate_count, 4);
  assert.equal(result.captured_count, 3);
  assert.equal(result.failed_count, 1);
  assert.equal(result.concurrency, 16);
  assert.equal(result.frames.has('tab-2'), false);
});
