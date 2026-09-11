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

test('collapsed preflight reactions preserve concurrent async provider admission at full width', async () => {
  const width = 128;
  let resolverStarts = 0;
  let executeStarts = 0;
  let releaseBudget;
  let releaseCells;
  const budgetGate = new Promise((resolve) => { releaseBudget = resolve; });
  const cellGate = new Promise((resolve) => { releaseCells = resolve; });

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: width,
    readMutationBudget: async () => {
      await budgetGate;
      return width;
    },
    resolveCellKey: async (command) => {
      resolverStarts += 1;
      await cellGate;
      return command.payload.tab_id;
    },
    execute: async (_command, context) => {
      executeStarts += 1;
      return context.browserCell;
    },
  });

  const pending = coordinator.dispatch(commands(width));
  await Promise.resolve();

  assert.equal(resolverStarts, width);
  assert.equal(executeStarts, 0);

  releaseBudget();
  releaseCells();
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

test('collapsed async cell validation still fails closed before every physical effect', async () => {
  let executeStarts = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 4,
    readMutationBudget: async () => 4,
    resolveCellKey: async (command) => command.command_id === 'cmd-2' ? '   ' : command.payload.tab_id,
    execute: async () => {
      executeStarts += 1;
      return 'unexpected';
    },
  });

  await assert.rejects(
    coordinator.dispatch(commands(4)),
    (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'missing_browser_cell',
  );
  assert.equal(executeStarts, 0);
});
