import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedWorkerObserver } from '../src/bounded-worker-observer.mjs';

function agents(n = 24) {
  return Array.from({ length: n }, (_, i) => ({
    agent_id: `agent_${i}`,
    tab_id: `tab_${i}`,
    generation_epoch: 1,
    lifecycle_state: 'BOUND_UNVERIFIED',
  }));
}

test('worker observation cost is bounded independently of fleet size', async () => {
  const observer = new BoundedWorkerObserver({ budget: 4 });
  const calls = [];
  const rows = await observer.observe(agents(24), {
    capture: async (tabId) => { calls.push(tabId); return { semantic_targets: [] }; },
    isGenerating: () => false,
  });
  assert.equal(calls.length, 4);
  assert.equal(rows.filter((row) => row.observation_state === 'CAPTURED').length, 4);
  assert.equal(rows.length, 24);
});

test('round robin advances instead of rescanning the first workers', async () => {
  const observer = new BoundedWorkerObserver({ budget: 3 });
  const calls = [];
  const capture = async (tabId) => { calls.push(tabId); return { semantic_targets: [] }; };
  const isGenerating = () => false;
  await observer.observe(agents(10), { capture, isGenerating });
  await observer.observe(agents(10), { capture, isGenerating });
  assert.deepEqual(calls, ['tab_0','tab_1','tab_2','tab_3','tab_4','tab_5']);
});

test('cached state is reusable only for the exact tab and generation incarnation', async () => {
  const observer = new BoundedWorkerObserver({ budget: 1 });
  const rows = agents(2);
  await observer.observe(rows, {
    capture: async () => ({ semantic_targets: [] }),
    isGenerating: () => false,
  });
  const stable = await observer.observe(rows, {
    capture: async () => ({ semantic_targets: [] }),
    isGenerating: () => false,
  });
  assert.equal(stable[0].generation_state, 'IDLE');
  assert.equal(stable[0].observation_state, 'EXACT_BINDING_CACHE');

  rows[0] = { ...rows[0], generation_epoch: 2 };
  const drifted = await observer.observe(rows, {
    capture: async () => ({ semantic_targets: [] }),
    isGenerating: () => false,
  });
  assert.equal(drifted[0].generation_state, 'UNKNOWN');
  assert.equal(drifted[0].observation_state, 'NOT_OBSERVED_THIS_CYCLE');
});

test('terminal workers require no browser capture', async () => {
  const observer = new BoundedWorkerObserver({ budget: 4 });
  let captures = 0;
  const rows = [{ agent_id:'lost_1', tab_id:null, generation_epoch:7, lifecycle_state:'LOST' }];
  const result = await observer.observe(rows, {
    capture: async () => { captures += 1; return {}; },
    isGenerating: () => false,
  });
  assert.equal(captures, 0);
  assert.equal(result[0].generation_state, 'TERMINAL');
  assert.equal(result[0].observation_state, 'TERMINAL_NO_CAPTURE');
});
