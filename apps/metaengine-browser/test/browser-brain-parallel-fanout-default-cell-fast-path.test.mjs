import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

const batch = (width) => Array.from({ length: width }, (_, index) => ({
  command_id: `cmd-${index}`,
  payload: { tab_id: `tab-${index}` },
}));

test('default BrowserCell fast path preserves the preflight barrier at width 128', async () => {
  const width = 128;
  const state = { budgetReads: 0, executeStarts: 0 };
  let releaseBudget;
  const budgetGate = new Promise((resolve) => { releaseBudget = resolve; });
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: width,
    readMutationBudget: async () => {
      state.budgetReads += 1;
      await budgetGate;
      return width;
    },
    execute: async (_command, { browserCell }) => {
      state.executeStarts += 1;
      return browserCell;
    },
  });

  const pending = coordinator.dispatch(batch(width));
  assert.deepEqual(state, { budgetReads: 0, executeStarts: 0 });
  await Promise.resolve();
  assert.deepEqual(state, { budgetReads: 1, executeStarts: 0 });
  releaseBudget();

  const result = await pending;
  assert.equal(state.executeStarts, width);
  assert.deepEqual(
    result.map(({ command_id, browser_cell, status, value }) => [command_id, browser_cell, status, value]),
    batch(width).map(({ command_id, payload }) => [command_id, payload.tab_id, 'fulfilled', payload.tab_id]),
  );
});

test('invalid default BrowserCell fails before budget or effect authority', async () => {
  const calls = [];
  const commands = batch(4);
  commands[2].payload.tab_id = '   ';
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 4,
    readMutationBudget: async () => { calls.push('budget'); return 4; },
    execute: async () => { calls.push('effect'); },
  });

  await assert.rejects(
    coordinator.dispatch(commands),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'missing_browser_cell',
  );
  assert.deepEqual(calls, []);
});
