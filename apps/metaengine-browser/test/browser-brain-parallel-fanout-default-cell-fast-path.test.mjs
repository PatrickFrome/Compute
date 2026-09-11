import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

function commands(width) {
  return Array.from({ length: width }, (_, index) => Object.freeze({
    command_id: `cmd-${index}`,
    payload: Object.freeze({ tab_id: `tab-${index}` }),
  }));
}

test('default BrowserCell projection completes synchronously before the async budget lane', async () => {
  const width = 128;
  let budgetReads = 0;
  let executeStarts = 0;
  let releaseBudget;
  const budgetGate = new Promise((resolve) => { releaseBudget = resolve; });

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: width,
    readMutationBudget: async () => {
      budgetReads += 1;
      await budgetGate;
      return width;
    },
    execute: async (_command, context) => {
      executeStarts += 1;
      return context.browserCell;
    },
  });

  const pending = coordinator.dispatch(commands(width));

  // The built-in BrowserCell projection no longer needs 128 deferred resolver
  // lanes. The only asynchronous preflight provider is the mutation budget.
  assert.equal(budgetReads, 0);
  assert.equal(executeStarts, 0);

  await Promise.resolve();
  assert.equal(budgetReads, 1);
  assert.equal(executeStarts, 0);

  releaseBudget();
  const result = await pending;

  assert.equal(executeStarts, width);
  assert.equal(result.length, width);
  for (let index = 0; index < width; index += 1) {
    assert.equal(result[index].command_id, `cmd-${index}`);
    assert.equal(result[index].browser_cell, `tab-${index}`);
    assert.equal(result[index].status, 'fulfilled');
    assert.equal(result[index].value, `tab-${index}`);
  }
});

test('malformed built-in BrowserCell binding fails closed before budget read or effect', async () => {
  let budgetReads = 0;
  let executeStarts = 0;
  const batch = commands(4).map((command, index) => index === 2
    ? Object.freeze({ command_id: command.command_id, payload: Object.freeze({ tab_id: '   ' }) })
    : command);

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 4,
    readMutationBudget: async () => {
      budgetReads += 1;
      return 4;
    },
    execute: async () => {
      executeStarts += 1;
      return 'unexpected';
    },
  });

  await assert.rejects(
    coordinator.dispatch(batch),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'missing_browser_cell',
  );

  assert.equal(budgetReads, 0);
  assert.equal(executeStarts, 0);
});
