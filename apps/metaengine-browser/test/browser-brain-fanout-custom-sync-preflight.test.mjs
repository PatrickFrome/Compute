import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

const WIDTH = 32;
const commands = Array.from({ length: WIDTH }, (_, index) => ({
  command_id: `custom-sync-${index}`,
  opaque_cell: `cell-${index}`,
}));

test('custom synchronous preflight providers stay deferred and settle before effects', async () => {
  let budgetReads = 0;
  const resolverStarts = [];
  const executeStarts = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: WIDTH,
    readMutationBudget: () => {
      budgetReads += 1;
      return WIDTH;
    },
    resolveCellKey: (command) => {
      resolverStarts.push(command.command_id);
      return command.opaque_cell;
    },
    execute: async (command, { browserCell }) => {
      executeStarts.push(command.command_id);
      return browserCell;
    },
  });

  const pending = coordinator.dispatch(commands);
  assert.equal(budgetReads, 0);
  assert.deepEqual(resolverStarts, []);
  assert.deepEqual(executeStarts, []);

  await Promise.resolve();
  assert.equal(budgetReads, 1);
  assert.deepEqual(resolverStarts, commands.map(({ command_id }) => command_id));
  assert.deepEqual(executeStarts, []);

  const results = await pending;
  assert.deepEqual(executeStarts, commands.map(({ command_id }) => command_id));
  assert.deepEqual(results.map(({ status }) => status), Array(WIDTH).fill('fulfilled'));
  assert.deepEqual(results.map(({ browser_cell }) => browser_cell), commands.map(({ opaque_cell }) => opaque_cell));
  assert.deepEqual(results.map(({ value }) => value), commands.map(({ opaque_cell }) => opaque_cell));
});
