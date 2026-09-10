import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainParallelFanoutCoordinator } from '../src/browser-brain-parallel-fanout.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test('concurrent out-of-order BrowserCell preflight keeps exact command binding', async () => {
  const gates = new Map([
    ['cmd-a', deferred()],
    ['cmd-b', deferred()],
    ['cmd-c', deferred()],
  ]);
  const started = [];
  const executed = [];

  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    hardBatchLimit: 3,
    readMutationBudget: () => 3,
    resolveCellKey: (command) => {
      started.push(command.command_id);
      return gates.get(command.command_id).promise;
    },
    execute: async (command, context) => {
      executed.push({
        command_id: command.command_id,
        browser_cell: context.browserCell,
      });
      return command.command_id;
    },
  });

  const dispatchPromise = coordinator.dispatch([
    { command_id: 'cmd-a', payload: { provider: 'alpha' } },
    { command_id: 'cmd-b', payload: { provider: 'beta' } },
    { command_id: 'cmd-c', payload: { provider: 'gamma' } },
  ]);

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ['cmd-a', 'cmd-b', 'cmd-c']);
  assert.equal(executed.length, 0);

  gates.get('cmd-c').resolve('tab-c');
  gates.get('cmd-a').resolve('tab-a');
  gates.get('cmd-b').resolve('tab-b');

  const results = await dispatchPromise;

  assert.deepEqual(executed, [
    { command_id: 'cmd-a', browser_cell: 'tab-a' },
    { command_id: 'cmd-b', browser_cell: 'tab-b' },
    { command_id: 'cmd-c', browser_cell: 'tab-c' },
  ]);
  assert.deepEqual(
    results.map(({ command_id, browser_cell, status }) => ({ command_id, browser_cell, status })),
    [
      { command_id: 'cmd-a', browser_cell: 'tab-a', status: 'fulfilled' },
      { command_id: 'cmd-b', browser_cell: 'tab-b', status: 'fulfilled' },
      { command_id: 'cmd-c', browser_cell: 'tab-c', status: 'fulfilled' },
    ],
  );
});
