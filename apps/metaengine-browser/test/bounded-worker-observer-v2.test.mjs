import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedWorkerObserver } from '../src/bounded-worker-observer.mjs';
import { createFleetTargetLocalObserver } from '../src/fleet-target-local-observer.mjs';

function makeAgents(n = 12) {
  return Array.from({ length: n }, (_, i) => ({
    agent_id: `agent_${String(i).padStart(8, '0')}`,
    role: i % 2 ? 'RESEARCHER' : 'IMPLEMENTER',
    lifecycle_state: i % 3 === 0 ? 'ACTIVE' : 'BOUND_UNVERIFIED',
    tab_id: `tab_${String(i).padStart(8, '0')}`,
    target_id: `webcontents:${i + 1}`,
    generation_epoch: 1,
    automatic_retry_allowed: false,
    authority_effect: false,
  }));
}

function localHarness(rows) {
  const views = new Map(rows.map((row, i) => [row.tab_id, {
    webContents: {
      id: i + 1,
      isDestroyed: () => false,
    },
  }]));
  const observeLocalTarget = createFleetTargetLocalObserver({ lookupView: (tabId) => views.get(tabId) });
  return { views, observeLocalTarget };
}

test('observation cost stays bounded independently of fleet size', async () => {
  const rows = makeAgents(24);
  const { observeLocalTarget } = localHarness(rows);
  const observer = new BoundedWorkerObserver({ budget: 4 });
  const captures = [];
  const signals = await observer.observe(rows, {
    observeLocalTarget,
    capture: async (tabId) => { captures.push(tabId); return {}; },
    isGenerating: () => false,
  });
  assert.equal(captures.length, 4);
  assert.equal(signals.filter((row) => row.observation_state === 'CAPTURED_EXACT_LOCAL_TARGET').length, 4);
  assert.equal(signals.length, 24);
});

test('round robin advances instead of repeatedly scanning the first workers', async () => {
  const rows = makeAgents(10);
  const { observeLocalTarget } = localHarness(rows);
  const observer = new BoundedWorkerObserver({ budget: 3 });
  const captures = [];
  const capture = async (tabId) => { captures.push(tabId); return {}; };
  await observer.observe(rows, { observeLocalTarget, capture, isGenerating: () => false });
  await observer.observe(rows, { observeLocalTarget, capture, isGenerating: () => false });
  assert.deepEqual(captures, rows.slice(0, 6).map((row) => row.tab_id));
});

test('pre-capture target drift blocks Browser capture entirely', async () => {
  const rows = makeAgents(1);
  const { views, observeLocalTarget } = localHarness(rows);
  views.get(rows[0].tab_id).webContents.id = 99;
  let captures = 0;
  const signals = await new BoundedWorkerObserver({ budget: 1 }).observe(rows, {
    observeLocalTarget,
    capture: async () => { captures += 1; return {}; },
    isGenerating: () => false,
  });
  assert.equal(captures, 0);
  assert.equal(signals[0].generation_state, 'UNKNOWN');
  assert.equal(signals[0].observation_state, 'TARGET_DRIFT_PRE_CAPTURE');
});

test('post-capture target drift discards the observation and cache', async () => {
  const rows = makeAgents(1);
  const { views, observeLocalTarget } = localHarness(rows);
  const observer = new BoundedWorkerObserver({ budget: 1 });
  const signals = await observer.observe(rows, {
    observeLocalTarget,
    capture: async () => {
      views.get(rows[0].tab_id).webContents.id = 77;
      return {};
    },
    isGenerating: () => false,
  });
  assert.equal(signals[0].generation_state, 'UNKNOWN');
  assert.equal(signals[0].observation_state, 'TARGET_DRIFT_POST_CAPTURE');
  assert.equal(observer.snapshot().cached_bindings, 0);
});

test('cache is reusable only for the exact agent lifecycle tab target and generation incarnation', async () => {
  const rows = makeAgents(3);
  const { observeLocalTarget } = localHarness(rows);
  const observer = new BoundedWorkerObserver({ budget: 1 });
  await observer.observe(rows, { observeLocalTarget, capture: async () => ({}), isGenerating: () => false });
  const stable = await observer.observe(rows, { observeLocalTarget, capture: async () => ({}), isGenerating: () => false });
  assert.equal(stable[0].generation_state, 'IDLE');
  assert.equal(stable[0].observation_state, 'EXACT_INCARNATION_CACHE');

  rows[0] = { ...rows[0], target_id: 'webcontents:99', generation_epoch: 2 };
  const drifted = await observer.observe(rows, { observeLocalTarget, capture: async () => ({}), isGenerating: () => false });
  assert.equal(drifted[0].generation_state, 'UNKNOWN');
  assert.equal(drifted[0].observation_state, 'NOT_OBSERVED_THIS_CYCLE');
});

test('terminal workers never cause Browser capture', async () => {
  const rows = [{ agent_id: 'agent_deadbeef', lifecycle_state: 'LOST', tab_id: null, target_id: null, generation_epoch: 7 }];
  const { observeLocalTarget } = localHarness([]);
  let captures = 0;
  const signals = await new BoundedWorkerObserver({ budget: 4 }).observe(rows, {
    observeLocalTarget,
    capture: async () => { captures += 1; return {}; },
    isGenerating: () => false,
  });
  assert.equal(captures, 0);
  assert.equal(signals[0].observation_state, 'TERMINAL_NO_CAPTURE');
});

test('observer signals can never grant lease or scheduler authority', async () => {
  const rows = makeAgents(2);
  const { observeLocalTarget } = localHarness(rows);
  const observer = new BoundedWorkerObserver({ budget: 2 });
  const signals = await observer.observe(rows, {
    observeLocalTarget,
    capture: async () => ({}),
    isGenerating: () => true,
  });
  for (const row of signals) {
    assert.equal(row.lease_eligible, false);
    assert.equal(row.scheduler_authority, false);
    assert.equal(row.automatic_retry_allowed, false);
    assert.equal(row.authority_effect, false);
  }
  assert.equal(observer.snapshot().lease_eligible, false);
});
