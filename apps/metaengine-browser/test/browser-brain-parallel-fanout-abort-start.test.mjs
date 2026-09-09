import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

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

test('shared abort raised by an earlier executor prevents later peer effects from starting', async () => {
  const controller = new AbortController();
  const calls = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 3,
    execute: (_command, context) => {
      calls.push(context.commandId);
      if (context.commandId === 'cmd-a') controller.abort();
      return `ok:${context.commandId}`;
    },
  });

  const result = await coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
    command('cmd-c', 'tab-c'),
  ], { signal: controller.signal });

  assert.deepEqual(calls, ['cmd-a']);
  assert.equal(result[0].status, 'fulfilled');
  assert.deepEqual(result.slice(1).map((entry) => entry.status), ['rejected', 'rejected']);
  for (const entry of result.slice(1)) {
    assert.ok(entry.reason instanceof BrowserBrainFanoutPlanError);
    assert.equal(entry.reason.code, 'aborted');
  }
});
