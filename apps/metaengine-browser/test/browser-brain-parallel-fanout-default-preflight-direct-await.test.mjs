import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainParallelFanoutCoordinator } from '../src/browser-brain-parallel-fanout.mjs';

const commands = Array.from({ length: 16 }, (_, index) => ({
  command_id: `cmd-${index}`,
  payload: { tab_id: `tab-${index}` },
}));

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

test('default BrowserCell path waits directly on async budget before effects', async () => {
  const budget = deferred();
  const starts = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: commands.length,
    readMutationBudget: () => budget.promise,
    execute: (command, { browserCell }) => {
      starts.push(command.command_id);
      return `${command.command_id}:${browserCell}`;
    },
  });

  const resultPromise = coordinator.dispatch(commands);
  await Promise.resolve();
  assert.deepEqual(starts, []);

  budget.resolve(commands.length);
  const result = await resultPromise;
  assert.deepEqual(starts, commands.map(({ command_id }) => command_id));
  assert.deepEqual(
    result.map(({ command_id, browser_cell, status, value }) => [command_id, browser_cell, status, value]),
    commands.map(({ command_id, payload }) => [command_id, payload.tab_id, 'fulfilled', `${command_id}:${payload.tab_id}`]),
  );
});

test('abort while direct default preflight waits still fences every effect', async () => {
  const budget = deferred();
  const controller = new AbortController();
  let effectStarts = 0;
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: commands.length,
    readMutationBudget: () => budget.promise,
    execute: () => { effectStarts += 1; },
  });

  const resultPromise = coordinator.dispatch(commands, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();

  await assert.rejects(resultPromise, (error) => error?.code === 'aborted');
  assert.equal(effectStarts, 0);

  budget.resolve(commands.length);
  await Promise.resolve();
  assert.equal(effectStarts, 0);
});
