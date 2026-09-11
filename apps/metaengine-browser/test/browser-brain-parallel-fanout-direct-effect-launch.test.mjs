import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainParallelFanoutCoordinator } from '../src/browser-brain-parallel-fanout.mjs';

const commands = Array.from({ length: 8 }, (_, index) => ({
  command_id: `cmd-${index}`,
  payload: { tab_id: `tab-${index}` },
}));

test('direct effect launch preserves per-lane settlement and caller order', async () => {
  const starts = [];
  const failure = new Error('lane-3 failed');
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: commands.length,
    readMutationBudget: () => commands.length,
    execute: (command, { browserCell }) => {
      starts.push(command.command_id);
      if (command.command_id === 'cmd-3') throw failure;
      return `${command.command_id}:${browserCell}`;
    },
  });

  const result = await coordinator.dispatch(commands);

  assert.deepEqual(starts, commands.map(({ command_id }) => command_id));
  assert.deepEqual(result.map(({ command_id, browser_cell, status }) => [command_id, browser_cell, status]), [
    ['cmd-0', 'tab-0', 'fulfilled'],
    ['cmd-1', 'tab-1', 'fulfilled'],
    ['cmd-2', 'tab-2', 'fulfilled'],
    ['cmd-3', 'tab-3', 'rejected'],
    ['cmd-4', 'tab-4', 'fulfilled'],
    ['cmd-5', 'tab-5', 'fulfilled'],
    ['cmd-6', 'tab-6', 'fulfilled'],
    ['cmd-7', 'tab-7', 'fulfilled'],
  ]);
  assert.equal(result[3].reason, failure);
  assert.equal(result[7].value, 'cmd-7:tab-7');
});

test('abort raised by one lane fences later lanes before their physical effect', async () => {
  const controller = new AbortController();
  const starts = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: commands.length,
    readMutationBudget: () => commands.length,
    execute: (command) => {
      starts.push(command.command_id);
      if (command.command_id === 'cmd-0') controller.abort();
      return command.command_id;
    },
  });

  const result = await coordinator.dispatch(commands, { signal: controller.signal });

  assert.deepEqual(starts, ['cmd-0']);
  assert.equal(result[0].status, 'fulfilled');
  for (let index = 1; index < result.length; index += 1) {
    assert.equal(result[index].status, 'rejected');
    assert.equal(result[index].reason.code, 'aborted');
  }
});
