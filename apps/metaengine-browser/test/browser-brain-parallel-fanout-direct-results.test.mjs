import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainParallelFanoutCoordinator } from '../src/browser-brain-parallel-fanout.mjs';

function command(commandId, tabId) {
  return {
    command_id: commandId,
    type: 'PROVIDER_NEUTRAL_ACTION',
    payload: {
      tab_id: tabId,
      provider: 'opaque-provider',
      action: { kind: 'opaque-action', value: commandId },
    },
  };
}

test('direct per-lane result materialization preserves caller order across out-of-order settlement', async () => {
  const releases = new Map();
  const rejection = new Error('ambiguous provider outcome');
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 3,
    execute: (_entry, context) => new Promise((resolve, reject) => {
      releases.set(context.commandId, { resolve, reject });
    }),
  });

  const dispatchPromise = coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
    command('cmd-c', 'tab-c'),
  ]);

  await new Promise((resolve) => setImmediate(resolve));
  releases.get('cmd-c').resolve('value-c');
  releases.get('cmd-a').reject(rejection);
  releases.get('cmd-b').resolve('value-b');

  const results = await dispatchPromise;
  assert.deepEqual(results.map((entry) => entry.command_id), ['cmd-a', 'cmd-b', 'cmd-c']);
  assert.deepEqual(results.map((entry) => entry.browser_cell), ['tab-a', 'tab-b', 'tab-c']);
  assert.deepEqual(results.map((entry) => entry.status), ['rejected', 'fulfilled', 'fulfilled']);
  assert.equal(results[0].reason, rejection);
  assert.equal(results[1].value, 'value-b');
  assert.equal(results[2].value, 'value-c');
});
