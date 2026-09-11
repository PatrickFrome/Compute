import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

const commands = [
  {
    command_id: 'sync-budget-a',
    payload: { tab_id: 'tab_00000000-0000-4000-8000-000000000001' },
  },
  {
    command_id: 'sync-budget-b',
    payload: { tab_id: 'tab_00000000-0000-4000-8000-000000000002' },
  },
];

test('default BrowserCell path keeps budget provider deferred while collapsing synchronous validation', async () => {
  let budgetReads = 0;
  const executeStarts = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: commands.length,
    readMutationBudget: () => {
      budgetReads += 1;
      return commands.length;
    },
    execute: async (command) => {
      executeStarts.push(command.command_id);
      return command.command_id;
    },
  });

  const pending = coordinator.dispatch(commands);

  assert.equal(budgetReads, 0);
  assert.deepEqual(executeStarts, []);

  await Promise.resolve();
  assert.equal(budgetReads, 1);
  assert.deepEqual(executeStarts, []);

  const results = await pending;
  assert.deepEqual(executeStarts, commands.map(({ command_id }) => command_id));
  assert.deepEqual(results.map(({ status }) => status), ['fulfilled', 'fulfilled']);
  assert.deepEqual(results.map(({ browser_cell }) => browser_cell), commands.map(({ payload }) => payload.tab_id));
});

test('immediate abort before deferred synchronous budget read still prevents every physical effect', async () => {
  const controller = new AbortController();
  let budgetReads = 0;
  let executeStarts = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => {
      budgetReads += 1;
      return commands.length;
    },
    execute: async () => {
      executeStarts += 1;
    },
  });

  const pending = coordinator.dispatch(commands, { signal: controller.signal });
  controller.abort();

  await assert.rejects(pending, (error) => error?.code === 'aborted');
  assert.ok(budgetReads <= 1);
  assert.equal(executeStarts, 0);
});
